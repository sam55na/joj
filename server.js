const express = require('express');
const cors = require('cors');
const { GoogleGenAI } = require('@google/genai');

const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json());

// ربط حساب الذكاء الاصطناعي بمفتاح البيئة الخاص بك في ريندر
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

// نقطة فحص نبضات الخادم والاتصال بالـ API
app.get('/api/health', async (req, res) => {
    if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({ status: "error", message: "Missing GEMINI_API_KEY in environment variables." });
    }
    res.status(200).json({ status: "healthy", message: "Server is ready and key is loaded." });
});

app.post('/api/football', async (req, res) => {
    const { action, team } = req.body;
    let prompt = "";

    // صياغة الأوامر بدقة لإجبار النموذج على جلب الحقيقة الحالية فقط بتنسيق صلب
    if (action === "today_matches") {
        prompt = `أنت خبير ومحلل كرة قدم محترف متصل بالإنترنت وقواعد البيانات الحية. اليوم هو 13 يونيو 2026.
        أعطني قائمة بالمباريات الحقيقية والواقعية الجارية أو المجدولة لهذا اليوم (13 يونيو 2026) في البطولات الكبرى (أوروبية، قارية، عربية).
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
        // استدعاء الموديل الرسمي السريع
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
        });

        rawTextResponse = response.text.trim();
        
        // تنظيف أي علامات نصوص برمجية (Markdown) قد يضيفها الموديل تلقائياً
        let cleanJsonText = rawTextResponse;
        if (cleanJsonText.startsWith("```json")) {
            cleanJsonText = cleanJsonText.replace(/```json|```/g, "").trim();
        }

        // محاولة تحويل النص إلى كائن وبرمجته للموقع
        const parsedData = JSON.parse(cleanJsonText);
        res.json({ type: "parsed", data: parsedData });

    } catch (error) {
        // طباعة المشكلة بالكامل في سيرفر ريندر (Logs)
        console.error("--- FOOTBALL SERVER ERROR LOG ---");
        console.error("Error details:", error.message);
        console.error("Raw response captured from AI:", rawTextResponse);
        console.error("---------------------------------");

        // إرسال الرد الخام والمشكلة إلى الواجهة لمعاينتها فوراً بدلاً من الانهيار
        res.status(200).json({ 
            type: "raw_error", 
            message: "فشل في معالجة القالب القياسي لـ JSON، إليك البيانات الخام القادمة من السيرفر مباشرة.",
            errorDetails: error.message,
            rawText: rawTextResponse || "لم يتم استقبال أي نص من الذكاء الاصطناعي، يرجى التحقق من صلاحية الـ API Key الخاص بك في ريندر."
        });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`Pure Real-Time Backend active on port ${PORT}`));
