const express = require('express');
const { Pool } = require('pg');
const app = express();
const port = process.env.PORT || 5000;

// إعدادات JSON
app.use(express.json());

// رابط قاعدة البيانات
const DATABASE_URL = process.env.DATABASE_URL;

// إعداد Pool الاتصال
const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// معرف الأدمن الثابت
const ADMIN_ID = 7011476249;

// ==================== نظام الأقفال (Locks) ====================
// لمنع تكرار الضغط من نفس المستخدم
const userLocks = new Map();

function acquireLock(userId) {
    if (userLocks.has(userId)) {
        return false; // المستخدم لديه قفل نشط
    }
    userLocks.set(userId, true);
    return true;
}

function releaseLock(userId) {
    userLocks.delete(userId);
}

// ==================== تهيئة الجداول ====================
async function initTables() {
    try {
        // 1. جدول الجوائز
        await pool.query(`
            CREATE TABLE IF NOT EXISTS wheel_prizes (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                description TEXT,
                probability DECIMAL(5,2) NOT NULL CHECK (probability >= 0 AND probability <= 100),
                icon VARCHAR(50),
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 2. جدول سجل التدوير (مع إضافة حقل last_spin_date)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS wheel_spins (
                id SERIAL PRIMARY KEY,
                user_id BIGINT NOT NULL,
                prize_id INTEGER REFERENCES wheel_prizes(id),
                prize_name VARCHAR(255),
                spin_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_claimed BOOLEAN DEFAULT FALSE,
                claimed_date TIMESTAMP,
                last_spin_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 3. جدول الإعدادات
        await pool.query(`
            CREATE TABLE IF NOT EXISTS wheel_settings (
                id SERIAL PRIMARY KEY,
                setting_key VARCHAR(100) UNIQUE NOT NULL,
                setting_value TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 4. إضافة جوائز افتراضية
        const prizesExist = await pool.query('SELECT COUNT(*) FROM wheel_prizes');
        if (parseInt(prizesExist.rows[0].count) === 0) {
            await pool.query(`
                INSERT INTO wheel_prizes (name, description, probability, icon) VALUES
                ('🎁 1000 SYP', 'الفوز بـ 1000 ليرة سورية', 15, '🎁'),
                ('🎁 500 SYP', 'الفوز بـ 500 ليرة سورية', 20, '🎁'),
                ('🎁 200 SYP', 'الفوز بـ 200 ليرة سورية', 30, '🎁'),
                ('🎫 كود هدية', 'كود هدية بقيمة 50 SYP', 10, '🎫'),
                ('😅 حظ سعيد', 'لا يوجد فوز هذه المرة', 20, '😅'),
                ('⭐ 50 SYP', 'الفوز بـ 50 ليرة سورية', 5, '⭐')
            `);
        }

        // 5. إعدادات افتراضية
        const settingsExist = await pool.query('SELECT COUNT(*) FROM wheel_settings');
        if (parseInt(settingsExist.rows[0].count) === 0) {
            await pool.query(`
                INSERT INTO wheel_settings (setting_key, setting_value) VALUES
                ('spin_interval_hours', '24'),
                ('is_active', 'true')
            `);
        }

        console.log('✅ Tables initialized successfully');
    } catch (error) {
        console.error('❌ Error initializing tables:', error);
    }
}

// تشغيل التهيئة
initTables();

// ==================== المسارات (Routes) ====================

// ✅ الصفحة الرئيسية
app.get('/', (req, res) => {
    res.json({
        status: 'running',
        service: 'Wheel of Fortune Server',
        timestamp: new Date().toISOString(),
        database_configured: Boolean(DATABASE_URL)
    });
});

// ==================== مسارات العجلة ====================

// 🎡 1. تدوير العجلة (مع قفل ومنع التكرار)
app.post('/api/wheel/spin', async (req, res) => {
    const { user_id } = req.body;

    if (!user_id) {
        return res.status(400).json({
            success: false,
            error: 'user_id is required'
        });
    }

    // ========== التحقق من القفل ==========
    if (!acquireLock(user_id)) {
        return res.status(429).json({
            success: false,
            error: 'You have an ongoing spin request. Please wait.',
            is_processing: true
        });
    }

    try {
        // ========== التحقق من أن العجلة مفعلة ==========
        const isActive = await pool.query(
            'SELECT setting_value FROM wheel_settings WHERE setting_key = $1',
            ['is_active']
        );
        if (isActive.rows[0]?.setting_value !== 'true') {
            releaseLock(user_id);
            return res.status(403).json({
                success: false,
                error: 'Wheel is currently disabled'
            });
        }

        // ========== التحقق من آخر تدوير (كل 24 ساعة) ==========
        const intervalHours = await pool.query(
            'SELECT setting_value FROM wheel_settings WHERE setting_key = $1',
            ['spin_interval_hours']
        );
        const intervalHoursValue = parseInt(intervalHours.rows[0]?.setting_value || 24);

        const lastSpin = await pool.query(`
            SELECT spin_date FROM wheel_spins 
            WHERE user_id = $1 
            ORDER BY spin_date DESC 
            LIMIT 1
        `, [user_id]);

        if (lastSpin.rows.length > 0) {
            const lastSpinDate = new Date(lastSpin.rows[0].spin_date);
            const now = new Date();
            const hoursDiff = (now - lastSpinDate) / (1000 * 60 * 60);

            if (hoursDiff < intervalHoursValue) {
                const remainingHours = Math.ceil(intervalHoursValue - hoursDiff);
                const remainingMinutes = Math.ceil((intervalHoursValue - hoursDiff) * 60);
                
                releaseLock(user_id);
                return res.status(429).json({
                    success: false,
                    error: `You can spin again in ${remainingHours} hours (${remainingMinutes} minutes)`,
                    last_spin: lastSpinDate.toISOString(),
                    next_spin_allowed: new Date(lastSpinDate.getTime() + intervalHoursValue * 60 * 60 * 1000).toISOString(),
                    remaining_hours: Math.floor(remainingHours),
                    remaining_minutes: remainingMinutes % 60
                });
            }
        }

        // ========== اختيار جائزة عشوائية ==========
        const prizes = await pool.query(`
            SELECT * FROM wheel_prizes 
            WHERE is_active = true
            ORDER BY probability DESC
        `);

        if (prizes.rows.length === 0) {
            releaseLock(user_id);
            return res.status(500).json({
                success: false,
                error: 'No prizes available'
            });
        }

        // خوارزمية اختيار الجائزة
        let random = Math.random() * 100;
        let selectedPrize = prizes.rows[0];

        for (const prize of prizes.rows) {
            if (random <= prize.probability) {
                selectedPrize = prize;
                break;
            }
            random -= prize.probability;
        }

        // ========== تسجيل التدوير ==========
        const result = await pool.query(`
            INSERT INTO wheel_spins (user_id, prize_id, prize_name, last_spin_date)
            VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
            RETURNING id, spin_date
        `, [user_id, selectedPrize.id, selectedPrize.name]);

        // ========== جلب إحصائيات المستخدم ==========
        const userStats = await pool.query(`
            SELECT 
                COUNT(*) as total_spins,
                COUNT(CASE WHEN prize_name NOT LIKE '%حظ سعيد%' THEN 1 END) as wins
            FROM wheel_spins 
            WHERE user_id = $1
        `, [user_id]);

        // ========== حساب وقت التدوير التالي ==========
        const nextSpinDate = new Date();
        nextSpinDate.setHours(nextSpinDate.getHours() + intervalHoursValue);

        res.json({
            success: true,
            spin: {
                id: result.rows[0].id,
                prize: selectedPrize,
                spin_date: result.rows[0].spin_date
            },
            stats: {
                total_spins: parseInt(userStats.rows[0].total_spins),
                wins: parseInt(userStats.rows[0].wins)
            },
            next_spin_allowed: nextSpinDate.toISOString(),
            interval_hours: intervalHoursValue
        });

    } catch (error) {
        console.error('Spin error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    } finally {
        // ========== تحرير القفل ==========
        releaseLock(user_id);
    }
});

// 📊 2. جلب سجل المستخدم
app.get('/api/wheel/history/:user_id', async (req, res) => {
    const { user_id } = req.params;

    try {
        // جلب آخر تدوير للمستخدم
        const lastSpin = await pool.query(`
            SELECT spin_date FROM wheel_spins 
            WHERE user_id = $1 
            ORDER BY spin_date DESC 
            LIMIT 1
        `, [user_id]);

        // جلب إعدادات الفاصل الزمني
        const intervalHours = await pool.query(
            'SELECT setting_value FROM wheel_settings WHERE setting_key = $1',
            ['spin_interval_hours']
        );
        const intervalHoursValue = parseInt(intervalHours.rows[0]?.setting_value || 24);

        // حساب الوقت المتبقي
        let can_spin = true;
        let remaining_hours = 0;
        let remaining_minutes = 0;
        let next_spin_allowed = null;

        if (lastSpin.rows.length > 0) {
            const lastSpinDate = new Date(lastSpin.rows[0].spin_date);
            const now = new Date();
            const hoursDiff = (now - lastSpinDate) / (1000 * 60 * 60);

            if (hoursDiff < intervalHoursValue) {
                can_spin = false;
                remaining_hours = Math.floor(intervalHoursValue - hoursDiff);
                remaining_minutes = Math.ceil((intervalHoursValue - hoursDiff) * 60) % 60;
                next_spin_allowed = new Date(lastSpinDate.getTime() + intervalHoursValue * 60 * 60 * 1000).toISOString();
            }
        }

        // جلب سجل التدويرات
        const history = await pool.query(`
            SELECT 
                s.id,
                s.user_id,
                s.prize_name,
                s.spin_date,
                s.is_claimed,
                p.icon,
                p.description
            FROM wheel_spins s
            LEFT JOIN wheel_prizes p ON s.prize_id = p.id
            WHERE s.user_id = $1
            ORDER BY s.spin_date DESC
            LIMIT 50
        `, [user_id]);

        const stats = await pool.query(`
            SELECT 
                COUNT(*) as total_spins,
                COUNT(CASE WHEN prize_name NOT LIKE '%حظ سعيد%' THEN 1 END) as wins,
                COUNT(CASE WHEN is_claimed = true THEN 1 END) as claimed
            FROM wheel_spins 
            WHERE user_id = $1
        `, [user_id]);

        res.json({
            success: true,
            history: history.rows,
            stats: {
                total_spins: parseInt(stats.rows[0].total_spins),
                wins: parseInt(stats.rows[0].wins),
                claimed: parseInt(stats.rows[0].claimed)
            },
            spin_status: {
                can_spin: can_spin,
                remaining_hours: remaining_hours,
                remaining_minutes: remaining_minutes,
                next_spin_allowed: next_spin_allowed,
                interval_hours: intervalHoursValue
            }
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 🏆 3. المطالبة بالجائزة
app.put('/api/wheel/claim/:spin_id', async (req, res) => {
    const { spin_id } = req.params;
    const { user_id } = req.body;

    try {
        const spin = await pool.query(
            'SELECT * FROM wheel_spins WHERE id = $1',
            [spin_id]
        );

        if (spin.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Spin not found'
            });
        }

        if (spin.rows[0].user_id !== parseInt(user_id)) {
            return res.status(403).json({
                success: false,
                error: 'You are not the owner of this spin'
            });
        }

        if (spin.rows[0].is_claimed) {
            return res.status(400).json({
                success: false,
                error: 'Prize already claimed'
            });
        }

        await pool.query(`
            UPDATE wheel_spins 
            SET is_claimed = true, claimed_date = CURRENT_TIMESTAMP
            WHERE id = $1
        `, [spin_id]);

        res.json({
            success: true,
            message: 'Prize claimed successfully!',
            prize_name: spin.rows[0].prize_name
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==================== مسارات الأدمن (نفسها كما هي) ====================
// ... (جميع مسارات الأدمن من الكود السابق تبقى كما هي)

// ==================== تشغيل الخادم ====================
app.listen(port, () => {
    console.log(`🚀 Wheel of Fortune server running on port ${port}`);
    console.log(`👑 Admin ID: ${ADMIN_ID}`);
    console.log(`⏰ Default spin interval: 24 hours`);
});
