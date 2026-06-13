const express = require('express');
const cors = require('cors');
const { GoogleGenAI } = require('@google/genai');

const app = express();

// تفعيل العبور الآمن للمتصفحات (CORS) بالكامل لضمان اتصال الواجهة
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// تهيئة كائن الذكاء الاصطناعي بشكل آمن ومباشر
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

// نقطة فحص نبضات الخادم للتأكد من استقراره وعمله
app.get('/api/health', (req, res) => {
    if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({ status: "error", message: "Missing GEMINI_API_KEY in Render Environment Variables." });
    }
    res.status(200).json({ status: "healthy", message: "Server is fully active and Gemini is ready!" });
});

// المسار الرئيسي لمعالجة طلبات واجهة كرة القدم
app.post('/api/football', async (req, res) => {
    const { action, team } = req.body;
    let prompt = "";

    if (action === "today_matches") {
        prompt = `أنت خبير ومحلل كرة قدم محترف متصل بالإنترنت وقواعد البيانات الحية. اليوم هو 13 يونيو 2026.
        أعطني قائمة بالمباريات الحقيقية والواقعية الجارية أو المجدولة لهذا اليوم (13 يونيو 2026) في البطولات الكبرى (الأوروبية، القارية، أو العربية).
        يجب أن يكون ردك بصيغة JSON فقط وبدون أي نصوص توضيحية خارج القالب أو علامات اقتباس مسبقة (No Markdown formatting, just pure JSON object).
        هيكل الـ JSON المطلوب بدقة:
        {
            "matches": [
                { "homeTeam": "اسم الفريق المستضيف", "awayTeam": "اسم الفريق الضيف", "time": "توقيت المباراة", "tournament": "اسم البطولة", "liveStatus": "الحالة الحالية للمباراة بالملعب", "score": { "home": 0, "away": 0 } }
            ]
        }`;
    } 
    else if (action === "team_stats" && team) {
        prompt = `أعطني الإحصائيات الحقيقية والفعلية الحالية لفريق (${team}) لآخر مواسمه الحالية لعام 2026.
        يجب أن يكون الرد بصيغة JSON نظيفة فقط (Pure JSON Object).
        هيكل الـ JSON المطلوب:
        {
            "teamName": "${team}", "league": "اسم الدوري الحالي", "rank": 1, "matchesPlayed": 30, "wins": 20, "draws": 5, "losses": 5, "topScorer": "اسم هداف الفريق الحالي الحقيقي", "goalsScored": 60, "goalsConceded": 25
        }`;
    } 
    else if (action === "live_update") {
        prompt = `أعطني تحديثاً حياً ولحظياً حقيقياً لأهم مباراة جارية الآن في الملاعب بتاريخ اليوم 13 يونيو 2026.
        إذا لم تكن هناك مباراة جارية في هذه الثواني، اختر آخر مباراة قوية انتهت اليوم وقدم بياناتها الحقيقية.
        يجب أن يكون الرد بصيغة JSON فقط:
        {
            "minute": 75, "homeTeam": "الفريق الأول", "awayTeam": "الفريق الثاني", "score": { "home": 1, "away": 0 }, "possession": { "home": 50, "away": 50 }, "shotsOnTarget": { "home": 5, "away": 3 }, "lastEvent": "وصف دقيق باللغة العربية لآخر حدث واقعي في الملعب"
        }`;
    } else {
        return res.status(400).json({ error: "Action configuration is missing or invalid." });
    }

    let rawTextResponse = "";
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
        });

        // استخراج النص بطريقة مرنة تمنع أي خطأ غير متوقع
        if (response && response.text) {
            rawTextResponse = typeof response.text === 'function' ? response.text() : response.text;
        } else if (response && response.candidates && response.candidates[0]?.content?.parts[0]?.text) {
            rawTextResponse = response.candidates[0].content.parts[0].text;
        }

        if (!rawTextResponse) {
            throw new Error("استجابة الذكاء الاصطناعي فارغة تماماً.");
        }

        rawTextResponse = rawTextResponse.trim();
        
        // تنظيف علامات الماركداون باحتياط كامل لحماية السيرفر من الانهيار عند السطر 11
        let cleanJsonText = rawTextResponse;
        if (cleanJsonText.includes("```json")) {
            cleanJsonText = cleanJsonText.split("```json")[1].split("```")[0].trim();
        } else if (cleanJsonText.includes("```")) {
            cleanJsonText = cleanJsonText.split("```")[1].split("```")[0].trim();
        }

        const parsedData = JSON.parse(cleanJsonText);
        res.json({ type: "parsed", data: parsedData });

    } catch (error) {
        console.error("--- FOOTBALL SERVER ERROR LOG ---");
        console.error("Error Message:", error.message);
        console.error("Raw response:", rawTextResponse);
        console.error("---------------------------------");

        res.status(200).json({ 
            type: "raw_error", 
            message: "حدث خطأ في معالجة البيانات، تم الانتقال للحالة الخام.",
            errorDetails: error.message,
            rawText: rawTextResponse || "لم يتم استقبال أي نص، يرجى تفقّد مفتاح البيئة في ريندر."
        });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Real-Time Server active on port ${PORT}`));
