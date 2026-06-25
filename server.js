const express = require('express');
const { Pool } = require('pg');
const app = express();
const port = process.env.PORT || 5000;

// رابط قاعدة البيانات من متغيرات البيئة
const DATABASE_URL = process.env.DATABASE_URL;

// إعداد Pool الاتصال بقاعدة البيانات
const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// اختبار الاتصال بقاعدة البيانات عند بدء التشغيل
pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ Error connecting to database:', err.stack);
    } else {
        console.log('✅ Connected to PostgreSQL successfully!');
        release();
    }
});

// ==================== المسارات (Routes) ====================

// الصفحة الرئيسية
app.get('/', (req, res) => {
    res.json({
        status: 'running',
        service: 'PostgreSQL Connection Server',
        timestamp: new Date().toISOString(),
        database_configured: Boolean(DATABASE_URL)
    });
});

// اختبار الاتصال بقاعدة البيانات
app.get('/test-db', async (req, res) => {
    if (!DATABASE_URL) {
        return res.status(500).json({
            success: false,
            error: 'DATABASE_URL not configured'
        });
    }

    try {
        const result = await pool.query('SELECT NOW()');
        res.json({
            success: true,
            message: '✅ Connected to PostgreSQL successfully!',
            server_time: result.rows[0].now,
            database_url: DATABASE_URL.replace(
                DATABASE_URL.split('@')[0].split(':')[0] + ':' + DATABASE_URL.split('@')[0].split(':')[1],
                '********'
            )
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// معلومات عن قاعدة البيانات
app.get('/db-info', async (req, res) => {
    if (!DATABASE_URL) {
        return res.status(500).json({
            success: false,
            error: 'DATABASE_URL not configured'
        });
    }

    try {
        // جلب معلومات الإصدار
        const versionResult = await pool.query('SELECT version()');
        const version = versionResult.rows[0].version;

        // جلب قائمة الجداول
        const tablesResult = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
            ORDER BY table_name
        `);
        const tables = tablesResult.rows.map(row => row.table_name);

        // جلب عدد السجلات في كل جدول
        const tableStats = {};
        for (const table of tables) {
            const countResult = await pool.query(`SELECT COUNT(*) FROM ${table}`);
            tableStats[table] = parseInt(countResult.rows[0].count);
        }

        res.json({
            success: true,
            database: {
                version: version,
                tables: tables,
                table_stats: tableStats,
                total_tables: tables.length
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// تشغيل الخادم
app.listen(port, () => {
    console.log(`🚀 Server running on port ${port}`);
});
