const express = require('express');
const cors = require('cors');
const { GoogleGenAI } = require('@google/genai');

const app = express();

// تفعيل CORS الكامل لضمان عبور طلبات الواجهة بدون قيود المتصفح
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// قراءة المفتاح وتوليد تنبيه واضح في الـ Logs إذا كان فارغاً لمنع توقف السيرفر
const apiKey = process.env.GEMINI_API_KEY || "";
if (!apiKey) {
    console.log("⚠️ تنبيه حاسم: متغير البيئة GEMINI_API_KEY فارغ حالياً في ريندر! يرجى التحقق من إعداده.");
}

// تهيئة كائن جوجل
const ai = new GoogleGenAI({ apiKey: apiKey });

// نقطة فحص نبضات الخادم للتأكد من استقراره وعمله
app.get('/api/health', (req, res) => {
    res.status(200).json({ 
        status: process.env.GEMINI_API_KEY ? "healthy" : "missing_key", 
        message: process.env.GEMINI_API_KEY ? "السيرفر نشط والمفتاح تم رصده بنجاح!" : "السيرفر نشط لكن المفتاح غائب في ريندر." 
    });
});

// المسار الرئيسي لمعالجة طلبات واجهة كرة القدم
app.post('/api/football', async (req, res) => {
    const { action, team } = req.body;
    let prompt = "";

    if (action === "today_matches") {
        prompt = `أنت خبير ومحلل كرة قدم محترف متصل بالإنترنت وقواعد البيانات الحية. اليوم هو 13 يونيو 2026.
        أعطني قائمة بالمباريات الحقيقية والواقعية الجارية أو المجدولة لهذا اليوم (13 يونيو 2026) في البطولات الكبرى (الأوروبية، القارية، أو العربية).
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
    } else {
        return res.status(400).json({ error: "Action configuration is missing or invalid." });
    }

    let rawTextResponse = "";
    try {
        // طلب التوليد من الذكاء الاصطناعي
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
        });

        // استخراج النص بذكاء وبأكثر من طريقة لتجنب الانهيار تماماً
        if (response && response.text) {
            rawTextResponse = typeof response.text === 'function' ? response.text() : response.text;
        } else if (response && response.candidates && response.candidates[0]?.content?.parts[0]?.text) {
            rawTextResponse = response.candidates[0].content.parts[0].text;
        }

        // إذا كانت الاستجابة فارغة، نمررها مباشرة للـ catch بدون إحداث كراش للسيرفر
        if (!rawTextResponse || typeof rawTextResponse !== 'string') {
            throw new Error("استجابة الذكاء الاصطناعي فارغة أو غير نصية.");
        }

        let cleanJsonText = rawTextResponse.trim();
        
        // معالجة نصوص الماركداون بشكل آمن جداً يضمن عدم حدوث خطأ سطر 11 السابق
        if (cleanJsonText.includes("```json")) {
            const parts = cleanJsonText.split("```json");
            if (parts[1]) cleanJsonText = parts[1].split("```")[0].trim();
        } else if (cleanJsonText.includes("```")) {
            const parts = cleanJsonText.split("```");
            if (parts[1]) cleanJsonText = parts[1].trim();
        }

        const parsedData = JSON.parse(cleanJsonText);
        res.json({ type: "parsed", data: parsedData });

    } catch (error) {
        // طباعة تشخيصية واضحة في الـ Render Logs
        console.error("--- LOG ERROR FOOTBALL ---");
        console.error("المشكلة:", error.message);
        console.error("النص الخام المستلم:", rawTextResponse);
        console.error("--------------------------");

        // إرجاع رد خام آمن للواجهة بدلاً من جعل السيرفر يعطي Status 1 ويموت
        res.status(200).json({ 
            type: "raw_error", 
            message: "فشل السيرفر في هيكلة الـ JSON، تم تحويل البيانات للحالة الخام لتفادي الانهيار.",
            errorDetails: error.message,
            rawText: rawTextResponse || "لم يتم استقبال نص من الذكاء الاصطناعي بنجاح، تحقق من إعداد الـ API Key الخاص بك."
        });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Real-Time Server active on port ${PORT}`));
