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
const userLocks = new Map();

function acquireLock(userId) {
    if (userLocks.has(userId)) {
        return false;
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
                probability DECIMAL(5,2) NOT NULL DEFAULT 0,
                icon VARCHAR(50),
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 2. جدول سجل التدوير
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

        // 4. جدول سجل الإيداعات (للبحث عن إيداعات المستخدم)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS wheel_deposits (
                id SERIAL PRIMARY KEY,
                user_id BIGINT NOT NULL,
                amount DECIMAL(20,2) NOT NULL,
                deposit_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                source VARCHAR(100)
            )
        `);

        // 5. إضافة جوائز افتراضية
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

        // 6. إعدادات افتراضية
        const settingsExist = await pool.query('SELECT COUNT(*) FROM wheel_settings');
        if (parseInt(settingsExist.rows[0].count) === 0) {
            await pool.query(`
                INSERT INTO wheel_settings (setting_key, setting_value) VALUES
                ('spin_interval_hours', '24'),
                ('is_active', 'true'),
                ('deposit_required', 'false'),
                ('deposit_min_amount', '1000'),
                ('deposit_check_hours', '24')
            `);
        }

        console.log('✅ Tables initialized successfully');
    } catch (error) {
        console.error('❌ Error initializing tables:', error);
    }
}

// تشغيل التهيئة
initTables();

// ==================== خدمة الملفات الثابتة ====================
app.use(express.static('public'));

// ==================== المسارات (Routes) ====================

// ✅ الصفحة الرئيسية
app.get('/api/status', (req, res) => {
    res.json({
        status: 'running',
        service: 'Wheel of Fortune Server',
        timestamp: new Date().toISOString(),
        database_configured: Boolean(DATABASE_URL)
    });
});

// ==================== مسارات العجلة ====================

// 🎡 1. تدوير العجلة
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
        // ========== 1. التحقق من أن العجلة مفعلة ==========
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

        // ========== 2. التحقق من شرط الإيداع ==========
        const depositRequired = await pool.query(
            'SELECT setting_value FROM wheel_settings WHERE setting_key = $1',
            ['deposit_required']
        );
        const isDepositRequired = depositRequired.rows[0]?.setting_value === 'true';

        if (isDepositRequired) {
            const minAmount = await pool.query(
                'SELECT setting_value FROM wheel_settings WHERE setting_key = $1',
                ['deposit_min_amount']
            );
            const checkHours = await pool.query(
                'SELECT setting_value FROM wheel_settings WHERE setting_key = $1',
                ['deposit_check_hours']
            );
            
            const minAmountValue = parseFloat(minAmount.rows[0]?.setting_value || 1000);
            const checkHoursValue = parseInt(checkHours.rows[0]?.setting_value || 24);

            // البحث عن إيداعات المستخدم في آخر X ساعة
            const userDeposits = await pool.query(`
                SELECT COALESCE(SUM(amount), 0) as total_deposits
                FROM wheel_deposits
                WHERE user_id = $1 
                AND deposit_date >= NOW() - INTERVAL '${checkHoursValue} hours'
            `, [user_id]);

            const totalDeposits = parseFloat(userDeposits.rows[0]?.total_deposits || 0);

            if (totalDeposits < minAmountValue) {
                releaseLock(user_id);
                return res.status(403).json({
                    success: false,
                    error: `You need to deposit at least ${minAmountValue} SYP in the last ${checkHoursValue} hours to spin`,
                    deposit_required: true,
                    min_deposit: minAmountValue,
                    check_hours: checkHoursValue,
                    current_deposits: totalDeposits,
                    remaining: minAmountValue - totalDeposits
                });
            }
        }

        // ========== 3. التحقق من آخر تدوير (الفاصل الزمني) ==========
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

        // ========== 4. اختيار جائزة عشوائية حسب النسب ==========
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

        // حساب المجموع الكلي للنسب
        const totalProbability = prizes.rows.reduce((sum, p) => sum + parseFloat(p.probability), 0);
        
        // اختيار جائزة عشوائية
        let random = Math.random() * totalProbability;
        let selectedPrize = prizes.rows[0];

        for (const prize of prizes.rows) {
            if (random <= parseFloat(prize.probability)) {
                selectedPrize = prize;
                break;
            }
            random -= parseFloat(prize.probability);
        }

        // ========== 5. تسجيل التدوير ==========
        const result = await pool.query(`
            INSERT INTO wheel_spins (user_id, prize_id, prize_name, last_spin_date)
            VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
            RETURNING id, spin_date
        `, [user_id, selectedPrize.id, selectedPrize.name]);

        // ========== 6. جلب إحصائيات المستخدم ==========
        const userStats = await pool.query(`
            SELECT 
                COUNT(*) as total_spins,
                COUNT(CASE WHEN prize_name NOT LIKE '%حظ سعيد%' THEN 1 END) as wins
            FROM wheel_spins 
            WHERE user_id = $1
        `, [user_id]);

        // ========== 7. حساب وقت التدوير التالي ==========
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
        releaseLock(user_id);
    }
});

// 📊 2. جلب سجل المستخدم
app.get('/api/wheel/history/:user_id', async (req, res) => {
    const { user_id } = req.params;

    try {
        // جلب آخر تدوير
        const lastSpin = await pool.query(`
            SELECT spin_date FROM wheel_spins 
            WHERE user_id = $1 
            ORDER BY spin_date DESC 
            LIMIT 1
        `, [user_id]);

        // جلب الإعدادات
        const intervalHours = await pool.query(
            'SELECT setting_value FROM wheel_settings WHERE setting_key = $1',
            ['spin_interval_hours']
        );
        const intervalHoursValue = parseInt(intervalHours.rows[0]?.setting_value || 24);

        // جلب إعدادات الإيداع
        const depositRequired = await pool.query(
            'SELECT setting_value FROM wheel_settings WHERE setting_key = $1',
            ['deposit_required']
        );
        const isDepositRequired = depositRequired.rows[0]?.setting_value === 'true';
        
        let depositInfo = null;
        if (isDepositRequired) {
            const minAmount = await pool.query(
                'SELECT setting_value FROM wheel_settings WHERE setting_key = $1',
                ['deposit_min_amount']
            );
            const checkHours = await pool.query(
                'SELECT setting_value FROM wheel_settings WHERE setting_key = $1',
                ['deposit_check_hours']
            );
            const minAmountValue = parseFloat(minAmount.rows[0]?.setting_value || 1000);
            const checkHoursValue = parseInt(checkHours.rows[0]?.setting_value || 24);

            const userDeposits = await pool.query(`
                SELECT COALESCE(SUM(amount), 0) as total_deposits
                FROM wheel_deposits
                WHERE user_id = $1 
                AND deposit_date >= NOW() - INTERVAL '${checkHoursValue} hours'
            `, [user_id]);

            depositInfo = {
                required: true,
                min_amount: minAmountValue,
                check_hours: checkHoursValue,
                current_deposits: parseFloat(userDeposits.rows[0]?.total_deposits || 0),
                is_met: parseFloat(userDeposits.rows[0]?.total_deposits || 0) >= minAmountValue
            };
        }

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

        // جلب السجل
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
            },
            deposit_requirement: depositInfo
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

// 💰 4. تسجيل إيداع (يستخدمه البوت الرئيسي أو الأدمن)
app.post('/api/wheel/deposit', async (req, res) => {
    const { user_id, amount, source } = req.body;

    if (!user_id || !amount) {
        return res.status(400).json({
            success: false,
            error: 'user_id and amount are required'
        });
    }

    try {
        await pool.query(`
            INSERT INTO wheel_deposits (user_id, amount, source)
            VALUES ($1, $2, $3)
        `, [user_id, amount, source || 'manual']);

        res.json({
            success: true,
            message: 'Deposit recorded successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==================== مسارات الأدمن ====================

// 📋 5. عرض جميع الجوائز
app.get('/api/admin/prizes', async (req, res) => {
    const { admin_id } = req.query;

    if (parseInt(admin_id) !== ADMIN_ID) {
        return res.status(403).json({
            success: false,
            error: 'Unauthorized - Admin only'
        });
    }

    try {
        const prizes = await pool.query(`
            SELECT * FROM wheel_prizes 
            ORDER BY probability DESC
        `);

        res.json({
            success: true,
            prizes: prizes.rows
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ➕ 6. إضافة جائزة جديدة
app.post('/api/admin/prizes', async (req, res) => {
    const { admin_id, name, description, probability, icon } = req.body;

    if (parseInt(admin_id) !== ADMIN_ID) {
        return res.status(403).json({
            success: false,
            error: 'Unauthorized - Admin only'
        });
    }

    if (!name || probability === undefined) {
        return res.status(400).json({
            success: false,
            error: 'Name and probability are required'
        });
    }

    try {
        const result = await pool.query(`
            INSERT INTO wheel_prizes (name, description, probability, icon)
            VALUES ($1, $2, $3, $4)
            RETURNING *
        `, [name, description || '', probability, icon || '🎁']);

        res.json({
            success: true,
            prize: result.rows[0]
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ✏️ 7. تحديث جائزة
app.put('/api/admin/prizes/:prize_id', async (req, res) => {
    const { prize_id } = req.params;
    const { admin_id, name, description, probability, icon, is_active } = req.body;

    if (parseInt(admin_id) !== ADMIN_ID) {
        return res.status(403).json({
            success: false,
            error: 'Unauthorized - Admin only'
        });
    }

    try {
        const result = await pool.query(`
            UPDATE wheel_prizes 
            SET 
                name = COALESCE($1, name),
                description = COALESCE($2, description),
                probability = COALESCE($3, probability),
                icon = COALESCE($4, icon),
                is_active = COALESCE($5, is_active),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $6
            RETURNING *
        `, [name, description, probability, icon, is_active, prize_id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Prize not found'
            });
        }

        res.json({
            success: true,
            prize: result.rows[0]
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 🗑️ 8. حذف جائزة
app.delete('/api/admin/prizes/:prize_id', async (req, res) => {
    const { prize_id } = req.params;
    const { admin_id } = req.body;

    if (parseInt(admin_id) !== ADMIN_ID) {
        return res.status(403).json({
            success: false,
            error: 'Unauthorized - Admin only'
        });
    }

    try {
        const result = await pool.query(
            'DELETE FROM wheel_prizes WHERE id = $1 RETURNING id',
            [prize_id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Prize not found'
            });
        }

        res.json({
            success: true,
            message: 'Prize deleted successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ⚙️ 9. عرض الإعدادات
app.get('/api/admin/settings', async (req, res) => {
    const { admin_id } = req.query;

    if (parseInt(admin_id) !== ADMIN_ID) {
        return res.status(403).json({
            success: false,
            error: 'Unauthorized - Admin only'
        });
    }

    try {
        const settings = await pool.query('SELECT * FROM wheel_settings');
        const settingsObj = {};
        settings.rows.forEach(row => {
            settingsObj[row.setting_key] = row.setting_value;
        });

        res.json({
            success: true,
            settings: settingsObj
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 🔧 10. تحديث الإعدادات
app.put('/api/admin/settings', async (req, res) => {
    const { admin_id, settings } = req.body;

    if (parseInt(admin_id) !== ADMIN_ID) {
        return res.status(403).json({
            success: false,
            error: 'Unauthorized - Admin only'
        });
    }

    try {
        for (const [key, value] of Object.entries(settings)) {
            await pool.query(`
                INSERT INTO wheel_settings (setting_key, setting_value, updated_at)
                VALUES ($1, $2, CURRENT_TIMESTAMP)
                ON CONFLICT (setting_key) 
                DO UPDATE SET setting_value = $2, updated_at = CURRENT_TIMESTAMP
            `, [key, value]);
        }

        res.json({
            success: true,
            message: 'Settings updated successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 📊 11. إحصائيات عامة
app.get('/api/admin/stats', async (req, res) => {
    const { admin_id } = req.query;

    if (parseInt(admin_id) !== ADMIN_ID) {
        return res.status(403).json({
            success: false,
            error: 'Unauthorized - Admin only'
        });
    }

    try {
        const totalSpins = await pool.query('SELECT COUNT(*) FROM wheel_spins');
        const todaySpins = await pool.query(`
            SELECT COUNT(*) FROM wheel_spins 
            WHERE DATE(spin_date) = CURRENT_DATE
        `);
        const topPrizes = await pool.query(`
            SELECT prize_name, COUNT(*) as count
            FROM wheel_spins
            WHERE prize_name NOT LIKE '%حظ سعيد%'
            GROUP BY prize_name
            ORDER BY count DESC
            LIMIT 5
        `);
        const topUsers = await pool.query(`
            SELECT user_id, COUNT(*) as spins
            FROM wheel_spins
            GROUP BY user_id
            ORDER BY spins DESC
            LIMIT 5
        `);

        res.json({
            success: true,
            stats: {
                total_spins: parseInt(totalSpins.rows[0].count),
                today_spins: parseInt(todaySpins.rows[0].count),
                top_prizes: topPrizes.rows,
                top_users: topUsers.rows
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==================== تشغيل الخادم ====================
app.listen(port, () => {
    console.log(`🚀 Wheel of Fortune server running on port ${port}`);
    console.log(`👑 Admin ID: ${ADMIN_ID}`);
    console.log(`⏰ Default spin interval: 24 hours`);
});
