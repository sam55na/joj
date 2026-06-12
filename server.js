const express = require('express');
const cors = require('cors');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

// تمكين CORS للواجهة الأمامية
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// مفتاح API الخاص بك
const API_KEY = "336a21e939mshac0730101b33687p1e3240jsnf4be017cee09";
const API_HOST = "api-football-v1.p.rapidapi.com";

// Proxy لجميع طلبات API-Football
app.get('/api/:endpoint', async (req, res) => {
    const endpoint = req.params.endpoint;
    const params = req.query;
    
    try {
        const response = await axios.get(`https://api-football-v1.p.rapidapi.com/v3/${endpoint}`, {
            headers: {
                'x-rapidapi-key': API_KEY,
                'x-rapidapi-host': API_HOST
            },
            params: params
        });
        
        res.json(response.data);
    } catch (error) {
        console.error('API Error:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json({ 
            error: true, 
            message: error.message,
            details: error.response?.data 
        });
    }
});

// Proxy لإحصائيات المباراة
app.get('/api/fixtures/statistics/:fixtureId', async (req, res) => {
    const fixtureId = req.params.fixtureId;
    
    try {
        const response = await axios.get(`https://api-football-v1.p.rapidapi.com/v3/fixtures/statistics`, {
            headers: {
                'x-rapidapi-key': API_KEY,
                'x-rapidapi-host': API_HOST
            },
            params: { fixture: fixtureId }
        });
        
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: true, message: error.message });
    }
});

// Proxy لتاريخ المواجهات
app.get('/api/headtohead/:homeId/:awayId', async (req, res) => {
    const { homeId, awayId } = req.params;
    
    try {
        const response = await axios.get(`https://api-football-v1.p.rapidapi.com/v3/fixtures/headtohead`, {
            headers: {
                'x-rapidapi-key': API_KEY,
                'x-rapidapi-host': API_HOST
            },
            params: { h2h: `${homeId}-${awayId}`, last: 5 }
        });
        
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: true, message: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`📍 http://localhost:${PORT}`);
});
