const express = require('express');
const cors = require('cors');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// ==================== المفاتيح (من الصورة المرفقة) ====================
const API_KEY = "336a21e939mshac0730101b33687p1e3240jsnf4be017cee09";
const API_HOST = "api-football-v1.p.rapidapi.com";

// ==================== الاتصال الأساسي ====================
async function callFootballAPI(endpoint, params) {
    try {
        const response = await axios.get(`https://api-football-v1.p.rapidapi.com/v3/${endpoint}`, {
            headers: {
                'x-rapidapi-key': API_KEY,
                'x-rapidapi-host': API_HOST,
                'x-rapidapi-ua': 'rapidapi-express/1.0',
                'Accept': 'application/json'
            },
            params: params,
            timeout: 15000
        });
        return response.data;
    } catch (error) {
        console.error(`API Error (${endpoint}):`, error.response?.status, error.response?.data);
        throw error;
    }
}

// ==================== الاتصال الاحتياطي (نفس المفتاح ولكن مع إعدادات مختلفة) ====================
async function callFootballAPIBackup(endpoint, params) {
    try {
        // محاولة ثانية مع user-agent مختلف وإعدادات أكثر تسامحاً
        const response = await axios.get(`https://api-football-v1.p.rapidapi.com/v3/${endpoint}`, {
            headers: {
                'x-rapidapi-key': API_KEY,
                'x-rapidapi-host': API_HOST,
                'User-Agent': 'Mozilla/5.0 (compatible; FootballBot/1.0)',
                'Accept': 'application/json'
            },
            params: params,
            timeout: 20000
        });
        return response.data;
    } catch (error) {
        console.error(`Backup API Error:`, error.message);
        throw error;
    }
}

// ==================== نقاط النهاية (Endpoints) ====================

// المباريات
app.get('/api/fixtures', async (req, res) => {
    try {
        let data = await callFootballAPI('fixtures', req.query);
        
        // إذا فشل الطلب الأول أو أعاد بيانات فارغة، جرب الاحتياطي
        if (!data?.response || data.response.length === 0) {
            console.log('البيانات فارغة، جاري استخدام الاتصال الاحتياطي...');
            data = await callFootballAPIBackup('fixtures', req.query);
        }
        
        res.json(data);
    } catch (error) {
        res.status(500).json({ 
            error: true, 
            message: error.message,
            suggestion: 'تأكد من صحة المفتاح على RapidAPI وخطة الاشتراك'
        });
    }
});

// جدول الترتيب
app.get('/api/standings', async (req, res) => {
    try {
        let data = await callFootballAPI('standings', req.query);
        
        if (!data?.response) {
            data = await callFootballAPIBackup('standings', req.query);
        }
        
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: true, message: error.message });
    }
});

// الهدافون
app.get('/api/topscorers', async (req, res) => {
    try {
        let data = await callFootballAPI('players/topscorers', req.query);
        
        if (!data?.response) {
            data = await callFootballAPIBackup('players/topscorers', req.query);
        }
        
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: true, message: error.message });
    }
});

// إحصائيات المباراة
app.get('/api/fixtures/statistics/:fixtureId', async (req, res) => {
    try {
        const fixtureId = req.params.fixtureId;
        let data = await callFootballAPI('fixtures/statistics', { fixture: fixtureId });
        
        if (!data?.response) {
            data = await callFootballAPIBackup('fixtures/statistics', { fixture: fixtureId });
        }
        
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: true, message: error.message });
    }
});

// تاريخ المواجهات (Head-to-Head)
app.get('/api/headtohead/:homeId/:awayId', async (req, res) => {
    try {
        const { homeId, awayId } = req.params;
        let data = await callFootballAPI('fixtures/headtohead', { h2h: `${homeId}-${awayId}`, last: 5 });
        
        if (!data?.response) {
            data = await callFootballAPIBackup('fixtures/headtohead', { h2h: `${homeId}-${awayId}`, last: 5 });
        }
        
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: true, message: error.message });
    }
});

// اختبار الاتصال
app.get('/api/test', async (req, res) => {
    try {
        const testResponse = await callFootballAPI('status');
        res.json({ 
            success: true, 
            message: 'الاتصال يعمل بشكل صحيح',
            apiResponse: testResponse 
        });
    } catch (error) {
        res.json({ 
            success: false, 
            message: 'فشل الاتصال',
            error: error.message,
            suggestion: 'تأكد من: 1) المفتاح صحيح، 2) الاشتراك مفعل، 3) الخطة تسمح بالطلبات'
        });
    }
});

// نقطة صحة الخادم
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`📍 http://localhost:${PORT}`);
    console.log(`🔑 API Key: ${API_KEY.substring(0, 10)}...`);
});
