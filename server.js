const express = require('express');
const cors = require('cors');
const { GoogleGenAI } = require('@google/genai');

const app = express();

// تفعيل العبور الآمن للمتصفحات بشكل كامل لإنهاء مشاكل اتصال الواجهة بالخادم
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// ربط حساب الذكاء الاصطناعي بمفتاح البيئة الخاص بك في ريندر
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

app.get('/api/health', (req, res) => {
    if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({ status: "error", message: "Missing GEMINI_API_KEY" });
    }
    res.status(200).json({ status: "healthy", message: "Server is ready!" });
});

app.post('/api/football', async (req, res) => {
    const { action, team } = req.body;
    let prompt = "";

    if (action === "today_matches") {
        prompt = `أنت خبير ومحلل كرة قدم محترف متصل بالإنترنت وقواعد البيانات الحية. اليوم هو 13 يونيو 2026.
        أعطني قائمة بالمباريات الحقيقية والواقعية الجارية أو المجدولة لهذا اليوم (13 يونيو 2026) في البطولات الكبرى.
        يجب أن يكون ردك بصيغة JSON فقط وبدون أي نصوص توضيحية خارج القالب (No Markdown formatting, just pure JSON object).
        هيكل الـ JSON المطلوب بدقة:
        {
            "matches": [
                { "homeTeam": "اسم الفريق المستضيف", "awayTeam": "اسم الفريق الضيف", "time": "توقيت المباراة", "tournament": "اسم البطولة", "liveStatus": "الحالة الحالية", "score": { "home": 0, "away": 0 } }
            ]
        }`;
    } 
    else if (action === "team_stats" && team) {
        prompt = `أعطني الإحصائيات الحقيقية والفعلية الحالية لفريق (${team}) لعام 2026.
        يجب أن يكون الرد بصيغة JSON نظيفة فقط.
        هيكل الـ JSON المطلوب:
        {
            "teamName": "${team}", "league": "اسم الدوري الحالي", "rank": 1, "matchesPlayed": 30, "wins": 20, "draws": 5, "losses": 5, "topScorer": "اسم هداف الفريق الحالي الحقيقي", "goalsScored": 60, "goalsConceded": 25
        }`;
    } 
    else if (action === "live_update") {
        prompt = `أعطني تحديثاً حياً ولحظياً حقيقياً لأهم مباراة جارية الآن في الملاعب بتاريخ اليوم 13 يونيو 2026.
        يجب أن يكون الرد بصيغة JSON فقط:
        {
            "minute": 75, "homeTeam": "الفريق الأول", "awayTeam": "الفريق الثاني", "score": { "home": 1, "away": 0 }, "possession": { "home": 50, "away": 50 }, "shotsOnTarget": { "home": 5, "away": 3 }, "lastEvent": "وصف دقيق باللغة العربية لآخر حدث"
        }`;
    }

    let rawTextResponse = "";
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
        });

        // حل مشكلة استخراج النص في الإصدارات الجديدة (تلمس النص بأكثر من طريقة لضمان الاستقرار)
        if (response.text && typeof response.text === 'function') {
            rawTextResponse = response.text();
        } else if (response.text) {
            rawTextResponse = response.text;
        } else if (response.candidates && response.candidates[0].content.parts[0].text) {
            rawTextResponse = response.candidates[0].content.parts[0].text;
        }

        rawTextResponse = rawTextResponse.trim();
        
        let cleanJsonText = rawTextResponse;
        if (cleanJsonText.startsWith("```json")) {
            cleanJsonText = cleanJsonText.replace(/```json|```/g, "").trim();
        } else if (cleanJsonText.startsWith("```")) {
            cleanJsonText = cleanJsonText.replace(/```/g, "").trim();
        }

        const parsedData = JSON.parse(cleanJsonText);
        res.json({ type: "parsed", data: parsedData });

    } catch (error) {
        console.error("Error Log:", error.message);
        res.status(200).json({ 
            type: "raw_error", 
            message: "حدث خطأ أثناء معالجة البيانات وتحويلها إلى JSON.",
            errorDetails: error.message,
            rawText: rawTextResponse || "لم يتم استلام نص من الذكاء الاصطناعي، يرجى تفقّد صلاحية الـ API Key في ريندر."
        });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`Backend active on port ${PORT}`));
