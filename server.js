const express = require('express');
const { Pool } = require('pg');
const app = express();
const port = process.env.PORT || 5000;

// ================================================================
//                      إعدادات CORS
// ================================================================
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

app.use(express.json());

// ================================================================
//                      الإعدادات الأساسية
// ================================================================
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
    console.error('❌ FATAL: DATABASE_URL is not set!');
    process.exit(1);
}

console.log('📊 DATABASE_URL:', DATABASE_URL.replace(/:[^:]*@/, ':****@'));

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
});

const ADMIN_ID = 7011476249;
let dbReady = false;

// ================================================================
//                      إنشاء الجداول
// ================================================================
const TABLE_SCHEMAS = {
    wheel_prizes: `
        CREATE TABLE IF NOT EXISTS wheel_prizes (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            description TEXT,
            probability DECIMAL(5,2) NOT NULL DEFAULT 0,
            icon VARCHAR(50),
            color VARCHAR(50) DEFAULT '#1a1a2e',
            color2 VARCHAR(50) DEFAULT '#16213e',
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `,
    wheel_spins: `
        CREATE TABLE IF NOT EXISTS wheel_spins (
            id SERIAL PRIMARY KEY,
            user_id BIGINT NOT NULL,
            prize_id INTEGER REFERENCES wheel_prizes(id) ON DELETE SET NULL,
            prize_name VARCHAR(255),
            spin_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            is_claimed BOOLEAN DEFAULT FALSE,
            claimed_date TIMESTAMP
        )
    `,
    wheel_settings: `
        CREATE TABLE IF NOT EXISTS wheel_settings (
            id SERIAL PRIMARY KEY,
            setting_key VARCHAR(100) UNIQUE NOT NULL,
            setting_value TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `,
    wheel_deposits: `
        CREATE TABLE IF NOT EXISTS wheel_deposits (
            id SERIAL PRIMARY KEY,
            user_id BIGINT NOT NULL,
            amount DECIMAL(20,2) NOT NULL,
            deposit_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            source VARCHAR(100)
        )
    `,
    wheel_banner: `
        CREATE TABLE IF NOT EXISTS wheel_banner (
            id SERIAL PRIMARY KEY,
            text TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `
};

const DEFAULT_PRIZES = [
    { name: '🎁 1000 SYP', description: 'الفوز بـ 1000 ليرة سورية', probability: 15, icon: '🎁', color: '#1a1a2e', color2: '#16213e' },
    { name: '🎁 500 SYP', description: 'الفوز بـ 500 ليرة سورية', probability: 20, icon: '🎁', color: '#2d1b3d', color2: '#1a0a0a' },
    { name: '🎁 200 SYP', description: 'الفوز بـ 200 ليرة سورية', probability: 30, icon: '🎁', color: '#0f3460', color2: '#1a1a2e' },
    { name: '🎫 كود هدية', description: 'كود هدية بقيمة 50 SYP', probability: 10, icon: '🎫', color: '#1a2a1a', color2: '#0f1a0f' },
    { name: '😅 حظ سعيد', description: 'لا يوجد فوز هذه المرة', probability: 20, icon: '😅', color: '#2a1a1a', color2: '#1a0a0a' },
    { name: '⭐ 50 SYP', description: 'الفوز بـ 50 ليرة سورية', probability: 5, icon: '⭐', color: '#1a1a2a', color2: '#0f0f2a' }
];

const DEFAULT_SETTINGS = [
    { key: 'spin_interval_hours', value: '24' },
    { key: 'is_active', value: 'true' },
    { key: 'deposit_required', value: 'false' },
    { key: 'deposit_min_amount', value: '1000' },
    { key: 'deposit_check_hours', value: '24' },
    { key: 'center_icon', value: '⭐' },
    { key: 'bg_image_url', value: 'https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=1920&q=80' },
    { key: 'loading_image_url', value: 'https://via.placeholder.com/200/1a1a2e/FFD700?text=🎡' },
    { key: 'spin_duration', value: '3500' }
];

// ================================================================
//                      تحديث هيكل الجدول
// ================================================================
async function updateTableSchema() {
    const client = await pool.connect();
    try {
        console.log('📋 ===== التحقق من هيكل الجداول =====');
        
        const checkColumns = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'wheel_prizes' 
            AND column_name IN ('color', 'color2')
        `);
        
        const existingColumns = checkColumns.rows.map(row => row.column_name);
        console.log('📋 الأعمدة الموجودة:', existingColumns);
        
        if (!existingColumns.includes('color')) {
            console.log('➕ إضافة عمود color...');
            await client.query(`
                ALTER TABLE wheel_prizes 
                ADD COLUMN color VARCHAR(50) DEFAULT '#1a1a2e'
            `);
            console.log('✅ تم إضافة عمود color');
        }
        
        if (!existingColumns.includes('color2')) {
            console.log('➕ إضافة عمود color2...');
            await client.query(`
                ALTER TABLE wheel_prizes 
                ADD COLUMN color2 VARCHAR(50) DEFAULT '#16213e'
            `);
            console.log('✅ تم إضافة عمود color2');
        }
        
        const checkUpdatedAt = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'wheel_prizes' 
            AND column_name = 'updated_at'
        `);
        
        if (checkUpdatedAt.rows.length === 0) {
            console.log('➕ إضافة عمود updated_at...');
            await client.query(`
                ALTER TABLE wheel_prizes 
                ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            `);
            console.log('✅ تم إضافة عمود updated_at');
        }
        
        console.log('✅ ===== هيكل الجدول محدث =====');
        return true;
    } catch (error) {
        console.error('❌ خطأ في تحديث هيكل الجدول:', error);
        return false;
    } finally {
        client.release();
    }
}

// ================================================================
//                      تهيئة قاعدة البيانات
// ================================================================
async function ensureTables() {
    console.log('\n📋 ===== فحص قاعدة البيانات =====');
    
    const client = await pool.connect();

    try {
        for (const table of Object.keys(TABLE_SCHEMAS)) {
            try {
                await client.query(TABLE_SCHEMAS[table]);
                console.log(`   ✅ جدول ${table}: تم إنشاؤه/تأكيده`);
            } catch (err) {
                console.log(`   ❌ جدول ${table}: فشل - ${err.message}`);
                return false;
            }
        }
        
        await updateTableSchema();

        const prizesCount = await client.query('SELECT COUNT(*) FROM wheel_prizes');
        if (parseInt(prizesCount.rows[0].count) === 0) {
            console.log('   ⚠️ لا توجد جوائز، جاري إضافة الجوائز الافتراضية...');
            for (const prize of DEFAULT_PRIZES) {
                await client.query(`
                    INSERT INTO wheel_prizes (name, description, probability, icon, color, color2)
                    VALUES ($1, $2, $3, $4, $5, $6)
                `, [prize.name, prize.description, prize.probability, prize.icon, prize.color, prize.color2]);
            }
            console.log(`   ✅ تم إضافة ${DEFAULT_PRIZES.length} جائزة افتراضية`);
        } else {
            console.log('   🔄 تحديث الجوائز الموجودة بالألوان الافتراضية...');
            await client.query(`
                UPDATE wheel_prizes 
                SET color = COALESCE(color, '#1a1a2e'),
                    color2 = COALESCE(color2, '#16213e')
                WHERE color IS NULL OR color2 IS NULL
            `);
        }

        const settingsCount = await client.query('SELECT COUNT(*) FROM wheel_settings');
        if (parseInt(settingsCount.rows[0].count) === 0) {
            console.log('   ⚠️ لا توجد إعدادات، جاري إضافة الإعدادات الافتراضية...');
            for (const setting of DEFAULT_SETTINGS) {
                await client.query(`
                    INSERT INTO wheel_settings (setting_key, setting_value)
                    VALUES ($1, $2)
                `, [setting.key, setting.value]);
            }
            console.log(`   ✅ تم إضافة ${DEFAULT_SETTINGS.length} إعداد افتراضي`);
        }

        const bannerCount = await client.query('SELECT COUNT(*) FROM wheel_banner');
        if (parseInt(bannerCount.rows[0].count) === 0) {
            await client.query(`
                INSERT INTO wheel_banner (text)
                VALUES ($1)
            `, ['🎡 IChancy · عجلة الحظ']);
            console.log('   ✅ تم إضافة النص العلوي الافتراضي');
        }

        console.log('\n✅ ===== قاعدة البيانات جاهزة! =====');
        dbReady = true;
        return true;

    } catch (err) {
        console.error('❌ خطأ أثناء تهيئة قاعدة البيانات:', err);
        return false;
    } finally {
        client.release();
    }
}

// ================================================================
//                      المسارات (API Endpoints)
// ================================================================

// -------------------- فحص الحالة --------------------
app.get('/api/status', (req, res) => {
    res.json({
        status: 'running',
        service: 'Wheel of Fortune API',
        timestamp: new Date().toISOString(),
        database: { ready: dbReady }
    });
});

// -------------------- الصفحة الرئيسية --------------------
app.get('/', (req, res) => {
    res.json({
        status: 'running',
        service: 'Wheel of Fortune API',
        message: '🚀 الخادم يعمل',
        endpoints: {
            spin: 'POST /api/wheel/spin',
            history: 'GET /api/wheel/history/:user_id',
            prizes: 'GET /api/prizes',
            admin: {
                settings: 'GET /api/admin/settings',
                setting: 'PUT /api/admin/setting',
                prizes: 'GET /api/admin/prizes',
                add_prize: 'POST /api/admin/prizes',
                update_prize: 'PUT /api/admin/prizes/:prize_id',
                delete_prize: 'DELETE /api/admin/prizes/:prize_id',
                seed_prizes: 'POST /api/admin/seed-prizes',
                reset_spins: 'POST /api/admin/reset-spins'
            }
        }
    });
});

// -------------------- النص العلوي (Banner) --------------------
app.get('/api/banner', async (req, res) => {
    try {
        const result = await pool.query('SELECT text FROM wheel_banner ORDER BY id DESC LIMIT 1');
        res.json({
            success: true,
            text: result.rows[0]?.text || '🎡 IChancy · عجلة الحظ'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.put('/api/banner', async (req, res) => {
    const { admin_id, text } = req.body;

    if (parseInt(admin_id) !== ADMIN_ID) {
        return res.status(403).json({
            success: false,
            error: 'Unauthorized - Admin only'
        });
    }

    try {
        await pool.query(`
            INSERT INTO wheel_banner (text, updated_at)
            VALUES ($1, CURRENT_TIMESTAMP)
        `, [text]);

        res.json({
            success: true,
            message: 'Banner updated successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// -------------------- الحصول على جميع الإعدادات --------------------
app.get('/api/admin/settings', async (req, res) => {
    const { admin_id } = req.query;

    if (parseInt(admin_id) !== ADMIN_ID) {
        return res.status(403).json({
            success: false,
            error: 'Unauthorized - Admin only'
        });
    }

    try {
        const result = await pool.query('SELECT * FROM wheel_settings');
        const settings = {};
        result.rows.forEach(row => {
            settings[row.setting_key] = row.setting_value;
        });

        const banner = await pool.query('SELECT text FROM wheel_banner ORDER BY id DESC LIMIT 1');
        settings.banner_text = banner.rows[0]?.text || '🎡 IChancy · عجلة الحظ';

        console.log('📋 Settings loaded:', Object.keys(settings).length, 'keys');
        
        res.json({
            success: true,
            settings
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// -------------------- تحديث إعداد واحد --------------------
app.put('/api/admin/setting', async (req, res) => {
    const { admin_id, key, value } = req.body;

    console.log(`📝 Updating setting: ${key} = ${value}`);

    if (parseInt(admin_id) !== ADMIN_ID) {
        return res.status(403).json({
            success: false,
            error: 'Unauthorized - Admin only'
        });
    }

    if (!key) {
        return res.status(400).json({
            success: false,
            error: 'Key is required'
        });
    }

    try {
        if (key === 'banner_text') {
            await pool.query(`
                INSERT INTO wheel_banner (text, updated_at)
                VALUES ($1, CURRENT_TIMESTAMP)
            `, [value]);
        } else {
            await pool.query(`
                INSERT INTO wheel_settings (setting_key, setting_value, updated_at)
                VALUES ($1, $2, CURRENT_TIMESTAMP)
                ON CONFLICT (setting_key) 
                DO UPDATE SET setting_value = $2, updated_at = CURRENT_TIMESTAMP
            `, [key, value]);
        }

        console.log(`✅ Setting ${key} updated successfully`);
        
        res.json({
            success: true,
            message: 'Setting updated successfully'
        });
    } catch (error) {
        console.error(`❌ Error updating setting ${key}:`, error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// -------------------- الحصول على الجوائز (للأدمن) --------------------
app.get('/api/admin/prizes', async (req, res) => {
    const { admin_id } = req.query;

    if (parseInt(admin_id) !== ADMIN_ID) {
        return res.status(403).json({
            success: false,
            error: 'Unauthorized - Admin only'
        });
    }

    try {
        const result = await pool.query(`
            SELECT * FROM wheel_prizes 
            ORDER BY id ASC
        `);
        
        console.log(`📋 Loaded ${result.rows.length} prizes for admin`);
        
        res.json({
            success: true,
            prizes: result.rows
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// -------------------- الحصول على الجوائز النشطة (للعجلة) --------------------
app.get('/api/prizes', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT * FROM wheel_prizes 
            WHERE is_active = true
            ORDER BY id ASC
        `);
        
        res.json({
            success: true,
            prizes: result.rows
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// -------------------- إضافة جائزة جديدة --------------------
app.post('/api/admin/prizes', async (req, res) => {
    const { admin_id, name, description, probability, icon, color, color2 } = req.body;

    console.log(`📝 Adding new prize: ${name}`);

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
            INSERT INTO wheel_prizes (name, description, probability, icon, color, color2, is_active)
            VALUES ($1, $2, $3, $4, $5, $6, true)
            RETURNING *
        `, [name, description || '', probability, icon || '🎁', color || '#1a1a2e', color2 || '#16213e']);

        console.log(`✅ Prize added: ${result.rows[0].id} - ${name}`);

        res.json({
            success: true,
            prize: result.rows[0],
            message: '✅ تم إضافة الجائزة بنجاح'
        });
    } catch (error) {
        console.error('❌ Error adding prize:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// -------------------- تحديث جائزة (مع دعم الألوان والنسبة) --------------------
app.put('/api/admin/prizes/:prize_id', async (req, res) => {
    const { prize_id } = req.params;
    const { admin_id, name, description, probability, icon, color, color2, is_active } = req.body;

    console.log(`📝 Updating prize ${prize_id}:`, { name, probability, color, color2 });

    if (parseInt(admin_id) !== ADMIN_ID) {
        return res.status(403).json({
            success: false,
            error: 'Unauthorized - Admin only'
        });
    }

    try {
        let query = 'UPDATE wheel_prizes SET ';
        const updates = [];
        const values = [];
        let paramIndex = 1;

        if (name !== undefined && name !== null && name !== '') {
            updates.push(`name = $${paramIndex++}`);
            values.push(name);
        }
        if (description !== undefined && description !== null) {
            updates.push(`description = $${paramIndex++}`);
            values.push(description);
        }
        if (probability !== undefined && probability !== null) {
            updates.push(`probability = $${paramIndex++}`);
            values.push(parseFloat(probability));
        }
        if (icon !== undefined && icon !== null && icon !== '') {
            updates.push(`icon = $${paramIndex++}`);
            values.push(icon);
        }
        if (color !== undefined && color !== null && color !== '') {
            updates.push(`color = $${paramIndex++}`);
            values.push(color);
            console.log(`🎨 Setting color to: ${color}`);
        }
        if (color2 !== undefined && color2 !== null && color2 !== '') {
            updates.push(`color2 = $${paramIndex++}`);
            values.push(color2);
            console.log(`🎨 Setting color2 to: ${color2}`);
        }
        if (is_active !== undefined && is_active !== null) {
            updates.push(`is_active = $${paramIndex++}`);
            values.push(is_active === true || is_active === 'true');
        }

        if (updates.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No fields to update'
            });
        }

        updates.push(`updated_at = CURRENT_TIMESTAMP`);
        values.push(prize_id);

        const fullQuery = query + updates.join(', ') + ` WHERE id = $${values.length} RETURNING *`;

        console.log('📝 Full query:', fullQuery);
        console.log('📝 Values:', values);

        const result = await pool.query(fullQuery, values);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Prize not found'
            });
        }

        console.log('✅ Prize updated:', result.rows[0]);

        res.json({
            success: true,
            prize: result.rows[0],
            message: '✅ تم تحديث الجائزة بنجاح'
        });
    } catch (error) {
        console.error('❌ Update error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// -------------------- حذف جائزة --------------------
app.delete('/api/admin/prizes/:prize_id', async (req, res) => {
    const { prize_id } = req.params;
    const { admin_id } = req.body;

    console.log(`🗑️ Deleting prize ${prize_id}`);

    if (parseInt(admin_id) !== ADMIN_ID) {
        return res.status(403).json({
            success: false,
            error: 'Unauthorized - Admin only'
        });
    }

    try {
        await pool.query(
            'UPDATE wheel_spins SET prize_id = NULL WHERE prize_id = $1',
            [prize_id]
        );

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

        console.log(`✅ Prize ${prize_id} deleted successfully`);

        res.json({
            success: true,
            message: '✅ تم حذف الجائزة بنجاح'
        });
    } catch (error) {
        console.error('❌ Delete error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// -------------------- إعادة تعيين الجوائز --------------------
app.post('/api/admin/seed-prizes', async (req, res) => {
    const { admin_id } = req.body;

    if (parseInt(admin_id) !== ADMIN_ID) {
        return res.status(403).json({
            success: false,
            error: 'Unauthorized - Admin only'
        });
    }

    try {
        await pool.query('UPDATE wheel_spins SET prize_id = NULL');
        await pool.query('DELETE FROM wheel_prizes');
        
        for (const prize of DEFAULT_PRIZES) {
            await pool.query(`
                INSERT INTO wheel_prizes (name, description, probability, icon, color, color2, is_active)
                VALUES ($1, $2, $3, $4, $5, $6, true)
            `, [prize.name, prize.description, prize.probability, prize.icon, prize.color, prize.color2]);
        }

        console.log('🔄 Prizes reset to defaults');

        res.json({
            success: true,
            message: '✅ تم إعادة تعيين الجوائز الافتراضية بنجاح!'
        });
    } catch (error) {
        console.error('❌ Reset error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// -------------------- إعادة تعيين التدويرات (بدون كاش) --------------------
app.post('/api/admin/reset-spins', async (req, res) => {
    const { admin_id, user_id } = req.body;

    console.log(`🔄 Resetting spins: admin=${admin_id}, user=${user_id || 'all'}`);

    if (parseInt(admin_id) !== ADMIN_ID) {
        return res.status(403).json({
            success: false,
            error: 'Unauthorized - Admin only'
        });
    }

    try {
        let deletedCount;
        
        if (user_id) {
            // حذف تدويرات مستخدم محدد
            const result = await pool.query(
                'DELETE FROM wheel_spins WHERE user_id = $1 RETURNING id',
                [user_id]
            );
            deletedCount = result.rowCount;
            console.log(`🗑️ Deleted ${deletedCount} spins for user ${user_id}`);
        } else {
            // حذف جميع التدويرات
            const result = await pool.query('DELETE FROM wheel_spins RETURNING id');
            deletedCount = result.rowCount;
            console.log(`🗑️ Deleted ${deletedCount} spins for all users`);
        }

        // إعادة تعيين التسلسل (sequence)
        await pool.query('ALTER SEQUENCE wheel_spins_id_seq RESTART WITH 1');

        res.json({
            success: true,
            deleted_count: deletedCount,
            message: `✅ تم حذف ${deletedCount} تدوير${user_id ? ` للمستخدم ${user_id}` : ''} بنجاح`
        });

    } catch (error) {
        console.error('❌ Reset spins error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// -------------------- تدوير العجلة --------------------
app.post('/api/wheel/spin', async (req, res) => {
    const { user_id } = req.body;

    if (!user_id) {
        return res.status(400).json({
            success: false,
            error: 'user_id is required'
        });
    }

    if (!dbReady) {
        return res.status(503).json({
            success: false,
            error: 'Database is not ready. Please try again later.'
        });
    }

    try {
        console.log(`🎡 Spin request for user: ${user_id}`);

        // 1. التحقق من تفعيل العجلة
        const isActive = await pool.query(
            'SELECT setting_value FROM wheel_settings WHERE setting_key = $1',
            ['is_active']
        );
        if (isActive.rows[0]?.setting_value !== 'true') {
            return res.status(403).json({
                success: false,
                error: 'العجلة معطلة حالياً'
            });
        }

        // 2. التحقق من شرط الإيداع
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

            const userDeposits = await pool.query(`
                SELECT COALESCE(SUM(final_amount), 0) as total
                FROM external_deposits
                WHERE user_id = $1 
                AND status = 'completed'
                AND created_at >= NOW() - INTERVAL '${checkHoursValue} hours'
            `, [user_id]);

            const totalDeposits = parseFloat(userDeposits.rows[0]?.total || 0);

            if (totalDeposits < minAmountValue) {
                return res.status(403).json({
                    success: false,
                    error: `مطلوب إيداع ${minAmountValue} SYP خلال آخر ${checkHoursValue} ساعة`,
                    deposit_required: true,
                    min_deposit: minAmountValue,
                    check_hours: checkHoursValue,
                    current_deposits: totalDeposits,
                    remaining: minAmountValue - totalDeposits
                });
            }
        }

        // 3. التحقق من آخر تدوير (من قاعدة البيانات مباشرة)
        const intervalHours = await pool.query(
            'SELECT setting_value FROM wheel_settings WHERE setting_key = $1',
            ['spin_interval_hours']
        );
        const intervalHoursValue = parseInt(intervalHours.rows[0]?.setting_value || 24);

        // ✅ استعلام مباشر من قاعدة البيانات - بدون كاش
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

            console.log(`⏰ Last spin: ${lastSpinDate}, Now: ${now}, Diff: ${hoursDiff}h`);

            if (hoursDiff < intervalHoursValue) {
                const remainingHours = Math.ceil(intervalHoursValue - hoursDiff);
                const remainingMinutes = Math.ceil((intervalHoursValue - hoursDiff) * 60);
                
                return res.status(429).json({
                    success: false,
                    error: `يمكنك التدوير مرة أخرى بعد ${remainingHours} ساعة`,
                    remaining_hours: Math.floor(remainingHours),
                    remaining_minutes: remainingMinutes % 60
                });
            }
        } else {
            console.log(`👤 User ${user_id} has no previous spins`);
        }

        // 4. اختيار جائزة
        const prizes = await pool.query(`
            SELECT * FROM wheel_prizes 
            WHERE is_active = true
        `);

        if (prizes.rows.length === 0) {
            return res.status(500).json({
                success: false,
                error: 'لا توجد جوائز متاحة'
            });
        }

        const totalProbability = prizes.rows.reduce((sum, p) => sum + parseFloat(p.probability), 0);
        let random = Math.random() * totalProbability;
        let selectedPrize = prizes.rows[0];

        for (const prize of prizes.rows) {
            if (random <= parseFloat(prize.probability)) {
                selectedPrize = prize;
                break;
            }
            random -= parseFloat(prize.probability);
        }

        console.log(`🎯 Selected prize: ${selectedPrize.name} (${selectedPrize.probability}%)`);

        // 5. تسجيل التدوير في قاعدة البيانات
        const result = await pool.query(`
            INSERT INTO wheel_spins (user_id, prize_id, prize_name, is_claimed)
            VALUES ($1, $2, $3, FALSE)
            RETURNING id, spin_date
        `, [user_id, selectedPrize.id, selectedPrize.name]);

        console.log(`✅ Spin recorded: ID=${result.rows[0].id}, User=${user_id}, Prize=${selectedPrize.name}`);

        // 6. إحصائيات المستخدم
        const userStats = await pool.query(`
            SELECT 
                COUNT(*) as total_spins,
                COUNT(CASE WHEN prize_name NOT LIKE '%حظ سعيد%' THEN 1 END) as wins
            FROM wheel_spins 
            WHERE user_id = $1
        `, [user_id]);

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
            }
        });

    } catch (error) {
        console.error('❌ Spin error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// -------------------- سجل المستخدم --------------------
app.get('/api/wheel/history/:user_id', async (req, res) => {
    const { user_id } = req.params;

    if (!dbReady) {
        return res.status(503).json({
            success: false,
            error: 'Database is not ready.'
        });
    }

    try {
        // ✅ استعلام مباشر من قاعدة البيانات - بدون كاش
        const lastSpin = await pool.query(`
            SELECT spin_date FROM wheel_spins 
            WHERE user_id = $1 
            ORDER BY spin_date DESC 
            LIMIT 1
        `, [user_id]);

        const intervalHours = await pool.query(
            'SELECT setting_value FROM wheel_settings WHERE setting_key = $1',
            ['spin_interval_hours']
        );
        const intervalHoursValue = parseInt(intervalHours.rows[0]?.setting_value || 24);

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
                SELECT COALESCE(SUM(final_amount), 0) as total
                FROM external_deposits
                WHERE user_id = $1 
                AND status = 'completed'
                AND created_at >= NOW() - INTERVAL '${checkHoursValue} hours'
            `, [user_id]);

            depositInfo = {
                required: true,
                min_amount: minAmountValue,
                check_hours: checkHoursValue,
                current_deposits: parseFloat(userDeposits.rows[0]?.total || 0),
                is_met: parseFloat(userDeposits.rows[0]?.total || 0) >= minAmountValue
            };
        }

        let can_spin = true;
        let remaining_hours = 0;
        let remaining_minutes = 0;

        if (lastSpin.rows.length > 0) {
            const lastSpinDate = new Date(lastSpin.rows[0].spin_date);
            const now = new Date();
            const hoursDiff = (now - lastSpinDate) / (1000 * 60 * 60);

            if (hoursDiff < intervalHoursValue) {
                can_spin = false;
                remaining_hours = Math.floor(intervalHoursValue - hoursDiff);
                remaining_minutes = Math.ceil((intervalHoursValue - hoursDiff) * 60) % 60;
            }
        }

        if (isDepositRequired && depositInfo && !depositInfo.is_met) {
            can_spin = false;
        }

        const stats = await pool.query(`
            SELECT 
                COUNT(*) as total_spins,
                COUNT(CASE WHEN prize_name NOT LIKE '%حظ سعيد%' THEN 1 END) as wins
            FROM wheel_spins 
            WHERE user_id = $1
        `, [user_id]);

        res.json({
            success: true,
            stats: {
                total_spins: parseInt(stats.rows[0].total_spins),
                wins: parseInt(stats.rows[0].wins)
            },
            spin_status: {
                can_spin: can_spin,
                remaining_hours: remaining_hours,
                remaining_minutes: remaining_minutes,
                interval_hours: intervalHoursValue
            },
            deposit_requirement: depositInfo
        });

    } catch (error) {
        console.error('History error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// -------------------- تسجيل إيداع --------------------
app.post('/api/wheel/deposit', async (req, res) => {
    const { user_id, amount, source } = req.body;

    if (!user_id || !amount) {
        return res.status(400).json({
            success: false,
            error: 'user_id and amount are required'
        });
    }

    if (!dbReady) {
        return res.status(503).json({
            success: false,
            error: 'Database is not ready.'
        });
    }

    try {
        await pool.query(`
            INSERT INTO external_deposits (user_id, amount_sent, final_amount, method_name, status, notes)
            VALUES ($1, $2, $3, 'يدوي', 'completed', $4)
        `, [user_id, amount, amount, source || 'wheel_deposit']);

        console.log(`💰 Deposit recorded: ${user_id} - ${amount} SYP`);

        res.json({
            success: true,
            message: '✅ تم تسجيل الإيداع بنجاح'
        });
    } catch (error) {
        console.error('Deposit error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ================================================================
//                      تشغيل الخادم
// ================================================================
async function startServer() {
    console.log('\n🚀 ===== بدء تشغيل الخادم =====');
    console.log(`📡 المنفذ: ${port}`);
    console.log(`👑 المدير: ${ADMIN_ID}`);
    
    const ready = await ensureTables();
    dbReady = ready;
    
    app.listen(port, () => {
        console.log(`\n✅ الخادم يعمل على المنفذ ${port}`);
        console.log(`🔗 فحص الحالة: http://localhost:${port}/api/status`);
        console.log(`🔗 الجوائز النشطة: http://localhost:${port}/api/prizes`);
        console.log(`🔗 لوحة الإدارة: http://localhost:${port}/api/admin/prizes?admin_id=${ADMIN_ID}`);
        console.log('\n📋 ===== جاهز! =====\n');
    });
}

startServer().catch(err => {
    console.error('❌ فشل تشغيل الخادم:', err);
    process.exit(1);
});
