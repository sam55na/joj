const express = require('express');
const cors = require('cors');

const app = express();

// تفعيل CORS لضمان قبول الطلبات القادمة من موقع الواجهة الخاص بك (مثل GitHub Pages)
app.use(cors({
    origin: '*', 
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
}));

app.use(express.json());

// 🟢 مسار فحص الحالة (Health Check) - الواجهة تستخدمه للتأكد من استيقاظ الخادم
app.get('/api/health', (req, res) => {
    res.status(200).json({ status: "healthy", message: "AI Football Server is ready!" });
});

// مسار معالجة طلبات كرة القدم
app.post('/api/football', async (req, res) => {
    const { action, team } = req.body;

    try {
        let aiResponse = {};

        if (action === "today_matches") {
            aiResponse = {
                matches: [
                    { homeTeam: "ريال مدريد", awayTeam: "برشلونة", time: "22:00", tournament: "الدوري الإسباني", liveStatus: "لم تبدأ", score: {home: 0, away: 0} },
                    { homeTeam: "ليفربول", awayTeam: "مانشستر سيتي", time: "18:30", tournament: "الدوري الإنجليزي", liveStatus: "مباشر (الدقيقة 65)", score: {home: 2, away: 1} },
                    { homeTeam: "الأهلي", awayTeam: "الزمالك", time: "20:00", tournament: "الدوري المصري", liveStatus: "لم تبدأ", score: {home: 0, away: 0} }
                ]
            };
        } else if (action === "team_stats") {
            const teamName = team || "فريق افتراضي";
            aiResponse = {
                teamName: teamName, league: "الدوري الممتاز", rank: 2, matchesPlayed: 30, wins: 21, draws: 6, losses: 3, topScorer: "المهاجم الذكي", goalsScored: 72, goalsConceded: 24
            };
        } else if (action === "live_update") {
            const randomMinute = Math.floor(Math.random() * 45) + 45;
            const homeScore = Math.floor(Math.random() * 3) + 1;
            const awayScore = Math.floor(Math.random() * 2);
            aiResponse = {
                minute: randomMinute, homeTeam: "بايرن ميونخ", awayTeam: "باريس سان جيرمان", score: {home: homeScore, away: awayScore}, possession: {home: 58, away: 42}, shotsOnTarget: {home: 9, away: 4}, lastEvent: "تسديدة قوية ترتطم بالقائم الأيمن للحارس!"
            };
        } else {
            return res.status(400).json({ error: "الطلب غير معروف" });
        }

        res.json(aiResponse);

    } catch (error) {
        console.error("AI Error:", error);
        res.status(500).json({ error: "حدث خطأ أثناء معالجة البيانات" });
    }
});

// ⚡ إعدادات ريندر الأساسية: استخدام المنفذ الممرر من البيئة أو المنفذ الافتراضي 10000
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server successfully deployed! Running on port ${PORT}`);
});
