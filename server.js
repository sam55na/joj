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
    flip_prizes: `
        CREATE TABLE IF NOT EXISTS flip_prizes (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            description TEXT,
            icon VARCHAR(50),
            color VARCHAR(50) DEFAULT '#FFD700',
            card_color VARCHAR(50) DEFAULT '#1a1a2e',
            card_back_color VARCHAR(50) DEFAULT '#16213e',
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `,
    flip_games: `
        CREATE TABLE IF NOT EXISTS flip_games (
            id SERIAL PRIMARY KEY,
            user_id BIGINT NOT NULL,
            prize_id INTEGER REFERENCES flip_prizes(id) ON DELETE SET NULL,
            prize_name VARCHAR(255),
            card_index INTEGER,
            played_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            is_claimed BOOLEAN DEFAULT FALSE,
            claimed_date TIMESTAMP
        )
    `,
    flip_settings: `
        CREATE TABLE IF NOT EXISTS flip_settings (
            id SERIAL PRIMARY KEY,
            setting_key VARCHAR(100) UNIQUE NOT NULL,
            setting_value TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `,
    flip_deposits: `
        CREATE TABLE IF NOT EXISTS flip_deposits (
            id SERIAL PRIMARY KEY,
            user_id BIGINT NOT NULL,
            amount DECIMAL(20,2) NOT NULL,
            deposit_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            source VARCHAR(100)
        )
    `,
    flip_banner: `
        CREATE TABLE IF NOT EXISTS flip_banner (
            id SERIAL PRIMARY KEY,
            text TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `
};

const DEFAULT_PRIZES = [
    { name: '💎 1000 SYP', description: 'الفوز بـ 1000 ليرة سورية', icon: '💎', color: '#FFD700', card_color: '#1a1a2e', card_back_color: '#FFD700' },
    { name: '👑 500 SYP', description: 'الفوز بـ 500 ليرة سورية', icon: '👑', color: '#FF6B35', card_color: '#2d1b3d', card_back_color: '#FF6B35' },
    { name: '🌟 200 SYP', description: 'الفوز بـ 200 ليرة سورية', icon: '🌟', color: '#00D4FF', card_color: '#0f3460', card_back_color: '#00D4FF' },
    { name: '🎫 كود هدية', description: 'كود هدية بقيمة 50 SYP', icon: '🎫', color: '#7BFF8A', card_color: '#1a2a1a', card_back_color: '#7BFF8A' },
    { name: '🔄 حظ سعيد', description: 'لا يوجد فوز هذه المرة', icon: '🔄', color: '#FF6B6B', card_color: '#2a1a1a', card_back_color: '#FF6B6B' },
    { name: '⭐ 50 SYP', description: 'الفوز بـ 50 ليرة سورية', icon: '⭐', color: '#FFB800', card_color: '#1a1a2a', card_back_color: '#FFB800' }
];

const DEFAULT_SETTINGS = [
    { key: 'play_interval_hours', value: '24' },
    { key: 'is_active', value: 'true' },
    { key: 'deposit_required', value: 'false' },
    { key: 'deposit_min_amount', value: '1000' },
    { key: 'deposit_check_hours', value: '24' },
    { key: 'cards_count', value: '6' },
    { key: 'bg_image_url', value: 'https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=1920&q=80' },
    { key: 'loading_image_url', value: 'https://media.giphy.com/media/3o7bu8sRnYpTOG1p8k/giphy.gif' },
    { key: 'flip_duration', value: '600' },
    { key: 'card_reveal_delay', value: '200' }
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
            WHERE table_name = 'flip_prizes' 
            AND column_name IN ('color', 'card_color', 'card_back_color')
        `);
        
        const existingColumns = checkColumns.rows.map(row => row.column_name);
        console.log('📋 الأعمدة الموجودة:', existingColumns);
        
        const columnsToAdd = {
            'color': 'VARCHAR(50) DEFAULT \'#FFD700\'',
            'card_color': 'VARCHAR(50) DEFAULT \'#1a1a2e\'',
            'card_back_color': 'VARCHAR(50) DEFAULT \'#16213e\''
        };
        
        for (const [col, def] of Object.entries(columnsToAdd)) {
            if (!existingColumns.includes(col)) {
                console.log(`➕ إضافة عمود ${col}...`);
                await client.query(`
                    ALTER TABLE flip_prizes 
                    ADD COLUMN ${col} ${def}
                `);
                console.log(`✅ تم إضافة عمود ${col}`);
            }
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

        const prizesCount = await client.query('SELECT COUNT(*) FROM flip_prizes');
        if (parseInt(prizesCount.rows[0].count) === 0) {
            console.log('   ⚠️ لا توجد جوائز، جاري إضافة الجوائز الافتراضية...');
            for (const prize of DEFAULT_PRIZES) {
                await client.query(`
                    INSERT INTO flip_prizes (name, description, icon, color, card_color, card_back_color)
                    VALUES ($1, $2, $3, $4, $5, $6)
                `, [prize.name, prize.description, prize.icon, prize.color, prize.card_color, prize.card_back_color]);
            }
            console.log(`   ✅ تم إضافة ${DEFAULT_PRIZES.length} جائزة افتراضية`);
        }

        const settingsCount = await client.query('SELECT COUNT(*) FROM flip_settings');
        if (parseInt(settingsCount.rows[0].count) === 0) {
            console.log('   ⚠️ لا توجد إعدادات، جاري إضافة الإعدادات الافتراضية...');
            for (const setting of DEFAULT_SETTINGS) {
                await client.query(`
                    INSERT INTO flip_settings (setting_key, setting_value)
                    VALUES ($1, $2)
                `, [setting.key, setting.value]);
            }
            console.log(`   ✅ تم إضافة ${DEFAULT_SETTINGS.length} إعداد افتراضي`);
        }

        const bannerCount = await client.query('SELECT COUNT(*) FROM flip_banner');
        if (parseInt(bannerCount.rows[0].count) === 0) {
            await client.query(`
                INSERT INTO flip_banner (text)
                VALUES ($1)
            `, ['🃏 IChancy · بطاقات الحظ']);
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
//                      نظام الأقفال
// ================================================================
const userLocks = new Map();

function acquireLock(userId) {
    if (userLocks.has(userId)) return false;
    userLocks.set(userId, Date.now());
    return true;
}

function releaseLock(userId) {
    userLocks.delete(userId);
}

setInterval(() => {
    const now = Date.now();
    for (const [key, value] of userLocks) {
        if (value < now - 300000) {
            userLocks.delete(key);
        }
    }
}, 300000);

// ================================================================
//                      المسارات (API Endpoints)
// ================================================================

app.get('/api/status', (req, res) => {
    res.json({
        status: 'running',
        service: 'Flip Card Game API',
        timestamp: new Date().toISOString(),
        database: { ready: dbReady }
    });
});

app.get('/', (req, res) => {
    res.json({
        status: 'running',
        service: 'Flip Card Game API',
        message: '🚀 الخادم يعمل',
        endpoints: {
            play: 'POST /api/flip/play',
            history: 'GET /api/flip/history/:user_id',
            prizes: 'GET /api/prizes',
            admin: {
                settings: 'GET /api/admin/settings',
                setting: 'PUT /api/admin/setting',
                prizes: 'GET /api/admin/prizes',
                add_prize: 'POST /api/admin/prizes',
                update_prize: 'PUT /api/admin/prizes/:prize_id',
                delete_prize: 'DELETE /api/admin/prizes/:prize_id',
                seed_prizes: 'POST /api/admin/seed-prizes'
            }
        }
    });
});

app.get('/api/banner', async (req, res) => {
    try {
        const result = await pool.query('SELECT text FROM flip_banner ORDER BY id DESC LIMIT 1');
        res.json({
            success: true,
            text: result.rows[0]?.text || '🃏 IChancy · بطاقات الحظ'
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
            INSERT INTO flip_banner (text, updated_at)
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

app.get('/api/admin/settings', async (req, res) => {
    const { admin_id } = req.query;

    if (parseInt(admin_id) !== ADMIN_ID) {
        return res.status(403).json({
            success: false,
            error: 'Unauthorized - Admin only'
        });
    }

    try {
        const result = await pool.query('SELECT * FROM flip_settings');
        const settings = {};
        result.rows.forEach(row => {
            settings[row.setting_key] = row.setting_value;
        });

        const banner = await pool.query('SELECT text FROM flip_banner ORDER BY id DESC LIMIT 1');
        settings.banner_text = banner.rows[0]?.text || '🃏 IChancy · بطاقات الحظ';

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
                INSERT INTO flip_banner (text, updated_at)
                VALUES ($1, CURRENT_TIMESTAMP)
            `, [value]);
        } else {
            await pool.query(`
                INSERT INTO flip_settings (setting_key, setting_value, updated_at)
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
            SELECT * FROM flip_prizes 
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

app.get('/api/prizes', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT * FROM flip_prizes 
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

app.post('/api/admin/prizes', async (req, res) => {
    const { admin_id, name, description, icon, color, card_color, card_back_color } = req.body;

    console.log(`📝 Adding new prize: ${name}`);

    if (parseInt(admin_id) !== ADMIN_ID) {
        return res.status(403).json({
            success: false,
            error: 'Unauthorized - Admin only'
        });
    }

    if (!name) {
        return res.status(400).json({
            success: false,
            error: 'Name is required'
        });
    }

    try {
        const result = await pool.query(`
            INSERT INTO flip_prizes (name, description, icon, color, card_color, card_back_color, is_active)
            VALUES ($1, $2, $3, $4, $5, $6, true)
            RETURNING *
        `, [name, description || '', icon || '🎁', color || '#FFD700', card_color || '#1a1a2e', card_back_color || '#16213e']);

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

app.put('/api/admin/prizes/:prize_id', async (req, res) => {
    const { prize_id } = req.params;
    const { admin_id, name, description, icon, color, card_color, card_back_color, is_active } = req.body;

    console.log(`📝 Updating prize ${prize_id}:`, { name, color, card_color });

    if (parseInt(admin_id) !== ADMIN_ID) {
        return res.status(403).json({
            success: false,
            error: 'Unauthorized - Admin only'
        });
    }

    try {
        let query = 'UPDATE flip_prizes SET ';
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
        if (icon !== undefined && icon !== null && icon !== '') {
            updates.push(`icon = $${paramIndex++}`);
            values.push(icon);
        }
        if (color !== undefined && color !== null && color !== '') {
            updates.push(`color = $${paramIndex++}`);
            values.push(color);
        }
        if (card_color !== undefined && card_color !== null && card_color !== '') {
            updates.push(`card_color = $${paramIndex++}`);
            values.push(card_color);
        }
        if (card_back_color !== undefined && card_back_color !== null && card_back_color !== '') {
            updates.push(`card_back_color = $${paramIndex++}`);
            values.push(card_back_color);
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
            'UPDATE flip_games SET prize_id = NULL WHERE prize_id = $1',
            [prize_id]
        );

        const result = await pool.query(
            'DELETE FROM flip_prizes WHERE id = $1 RETURNING id',
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

app.post('/api/admin/seed-prizes', async (req, res) => {
    const { admin_id } = req.body;

    if (parseInt(admin_id) !== ADMIN_ID) {
        return res.status(403).json({
            success: false,
            error: 'Unauthorized - Admin only'
        });
    }

    try {
        await pool.query('UPDATE flip_games SET prize_id = NULL');
        await pool.query('DELETE FROM flip_prizes');
        
        for (const prize of DEFAULT_PRIZES) {
            await pool.query(`
                INSERT INTO flip_prizes (name, description, icon, color, card_color, card_back_color, is_active)
                VALUES ($1, $2, $3, $4, $5, $6, true)
            `, [prize.name, prize.description, prize.icon, prize.color, prize.card_color, prize.card_back_color]);
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

// ================================================================
//                      لعب البطاقات - النقطة الرئيسية
// ================================================================
app.post('/api/flip/play', async (req, res) => {
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

    if (!acquireLock(user_id)) {
        return res.status(429).json({
            success: false,
            error: 'لديك طلب قيد المعالجة، يرجى الانتظار',
            is_processing: true
        });
    }

    try {
        // 1. التحقق من تفعيل اللعبة
        const isActive = await pool.query(
            'SELECT setting_value FROM flip_settings WHERE setting_key = $1',
            ['is_active']
        );
        if (isActive.rows[0]?.setting_value !== 'true') {
            releaseLock(user_id);
            return res.status(403).json({
                success: false,
                error: 'اللعبة معطلة حالياً'
            });
        }

        // 2. التحقق من شرط الإيداع
        const depositRequired = await pool.query(
            'SELECT setting_value FROM flip_settings WHERE setting_key = $1',
            ['deposit_required']
        );
        const isDepositRequired = depositRequired.rows[0]?.setting_value === 'true';

        if (isDepositRequired) {
            const minAmount = await pool.query(
                'SELECT setting_value FROM flip_settings WHERE setting_key = $1',
                ['deposit_min_amount']
            );
            const checkHours = await pool.query(
                'SELECT setting_value FROM flip_settings WHERE setting_key = $1',
                ['deposit_check_hours']
            );
            
            const minAmountValue = parseFloat(minAmount.rows[0]?.setting_value || 1000);
            const checkHoursValue = parseInt(checkHours.rows[0]?.setting_value || 24);

            const userDeposits = await pool.query(`
                SELECT COALESCE(SUM(amount), 0) as total
                FROM flip_deposits
                WHERE user_id = $1 
                AND deposit_date >= NOW() - INTERVAL '${checkHoursValue} hours'
            `, [user_id]);

            const totalDeposits = parseFloat(userDeposits.rows[0]?.total || 0);

            if (totalDeposits < minAmountValue) {
                releaseLock(user_id);
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

        // 3. التحقق من آخر لعب
        const intervalHours = await pool.query(
            'SELECT setting_value FROM flip_settings WHERE setting_key = $1',
            ['play_interval_hours']
        );
        const intervalHoursValue = parseInt(intervalHours.rows[0]?.setting_value || 24);

        const lastPlay = await pool.query(`
            SELECT played_date FROM flip_games 
            WHERE user_id = $1 
            ORDER BY played_date DESC 
            LIMIT 1
        `, [user_id]);

        if (lastPlay.rows.length > 0) {
            const lastPlayDate = new Date(lastPlay.rows[0].played_date);
            const now = new Date();
            const hoursDiff = (now - lastPlayDate) / (1000 * 60 * 60);

            if (hoursDiff < intervalHoursValue) {
                const remainingHours = Math.ceil(intervalHoursValue - hoursDiff);
                const remainingMinutes = Math.ceil((intervalHoursValue - hoursDiff) * 60);
                
                releaseLock(user_id);
                return res.status(429).json({
                    success: false,
                    error: `يمكنك اللعب مرة أخرى بعد ${remainingHours} ساعة`,
                    remaining_hours: Math.floor(remainingHours),
                    remaining_minutes: remainingMinutes % 60
                });
            }
        }

        // 4. الحصول على عدد البطاقات (ثابت 6)
        const totalCards = 6;

        // 5. الحصول على الجوائز النشطة
        const prizes = await pool.query(`
            SELECT * FROM flip_prizes 
            WHERE is_active = true
        `);

        if (prizes.rows.length === 0) {
            releaseLock(user_id);
            return res.status(500).json({
                success: false,
                error: 'لا توجد جوائز متاحة'
            });
        }

        // 6. اختيار جائزة عشوائية
        const totalProbability = prizes.rows.reduce((sum, p) => sum + parseFloat(p.probability || 10), 0);
        let random = Math.random() * totalProbability;
        let selectedPrize = prizes.rows[0];

        for (const prize of prizes.rows) {
            const prob = parseFloat(prize.probability || 10);
            if (random <= prob) {
                selectedPrize = prize;
                break;
            }
            random -= prob;
        }

        // 7. اختيار بطاقة عشوائية (0-5)
        const cardIndex = Math.floor(Math.random() * totalCards);

        // 8. تسجيل اللعب
        const result = await pool.query(`
            INSERT INTO flip_games (user_id, prize_id, prize_name, card_index)
            VALUES ($1, $2, $3, $4)
            RETURNING id, played_date
        `, [user_id, selectedPrize.id, selectedPrize.name, cardIndex]);

        // 9. إحصائيات المستخدم
        const userStats = await pool.query(`
            SELECT 
                COUNT(*) as total_plays,
                COUNT(CASE WHEN prize_name NOT LIKE '%حظ سعيد%' THEN 1 END) as wins
            FROM flip_games 
            WHERE user_id = $1
        `, [user_id]);

        res.json({
            success: true,
            game: {
                id: result.rows[0].id,
                prize: selectedPrize,
                card_index: cardIndex,
                total_cards: totalCards,
                played_date: result.rows[0].played_date
            },
            stats: {
                total_plays: parseInt(userStats.rows[0].total_plays),
                wins: parseInt(userStats.rows[0].wins)
            }
        });

    } catch (error) {
        console.error('Play error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    } finally {
        releaseLock(user_id);
    }
});

app.get('/api/flip/history/:user_id', async (req, res) => {
    const { user_id } = req.params;

    if (!dbReady) {
        return res.status(503).json({
            success: false,
            error: 'Database is not ready.'
        });
    }

    try {
        const lastPlay = await pool.query(`
            SELECT played_date FROM flip_games 
            WHERE user_id = $1 
            ORDER BY played_date DESC 
            LIMIT 1
        `, [user_id]);

        const intervalHours = await pool.query(
            'SELECT setting_value FROM flip_settings WHERE setting_key = $1',
            ['play_interval_hours']
        );
        const intervalHoursValue = parseInt(intervalHours.rows[0]?.setting_value || 24);

        const depositRequired = await pool.query(
            'SELECT setting_value FROM flip_settings WHERE setting_key = $1',
            ['deposit_required']
        );
        const isDepositRequired = depositRequired.rows[0]?.setting_value === 'true';
        
        let depositInfo = null;
        if (isDepositRequired) {
            const minAmount = await pool.query(
                'SELECT setting_value FROM flip_settings WHERE setting_key = $1',
                ['deposit_min_amount']
            );
            const checkHours = await pool.query(
                'SELECT setting_value FROM flip_settings WHERE setting_key = $1',
                ['deposit_check_hours']
            );
            const minAmountValue = parseFloat(minAmount.rows[0]?.setting_value || 1000);
            const checkHoursValue = parseInt(checkHours.rows[0]?.setting_value || 24);

            const userDeposits = await pool.query(`
                SELECT COALESCE(SUM(amount), 0) as total
                FROM flip_deposits
                WHERE user_id = $1 
                AND deposit_date >= NOW() - INTERVAL '${checkHoursValue} hours'
            `, [user_id]);

            depositInfo = {
                required: true,
                min_amount: minAmountValue,
                check_hours: checkHoursValue,
                current_deposits: parseFloat(userDeposits.rows[0]?.total || 0),
                is_met: parseFloat(userDeposits.rows[0]?.total || 0) >= minAmountValue
            };
        }

        let can_play = true;
        let remaining_hours = 0;
        let remaining_minutes = 0;

        if (lastPlay.rows.length > 0) {
            const lastPlayDate = new Date(lastPlay.rows[0].played_date);
            const now = new Date();
            const hoursDiff = (now - lastPlayDate) / (1000 * 60 * 60);

            if (hoursDiff < intervalHoursValue) {
                can_play = false;
                remaining_hours = Math.floor(intervalHoursValue - hoursDiff);
                remaining_minutes = Math.ceil((intervalHoursValue - hoursDiff) * 60) % 60;
            }
        }

        const stats = await pool.query(`
            SELECT 
                COUNT(*) as total_plays,
                COUNT(CASE WHEN prize_name NOT LIKE '%حظ سعيد%' THEN 1 END) as wins
            FROM flip_games 
            WHERE user_id = $1
        `, [user_id]);

        res.json({
            success: true,
            stats: {
                total_plays: parseInt(stats.rows[0].total_plays),
                wins: parseInt(stats.rows[0].wins)
            },
            play_status: {
                can_play: can_play,
                remaining_hours: remaining_hours,
                remaining_minutes: remaining_minutes,
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

app.post('/api/flip/deposit', async (req, res) => {
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
            INSERT INTO flip_deposits (user_id, amount, source)
            VALUES ($1, $2, $3)
        `, [user_id, amount, source || 'manual']);

        console.log(`💰 Deposit recorded: ${user_id} - ${amount} SYP`);

        res.json({
            success: true,
            message: '✅ تم تسجيل الإيداع بنجاح'
        });
    } catch (error) {
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
        console.log('\n📋 ===== جاهز! =====\n');
    });
}

startServer().catch(err => {
    console.error('❌ فشل تشغيل الخادم:', err);
    process.exit(1);
});
