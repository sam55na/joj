const express = require('express');
const cors = require('cors');
const { GoogleGenAI } = require('@google/genai');

const app = express();

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

const apiKey = process.env.GEMINI_API_KEY || "";
const ai = new GoogleGenAI({ apiKey: apiKey });

app.get('/api/health', (req, res) => {
    res.status(200).json({ 
        status: process.env.GEMINI_API_KEY ? "healthy" : "missing_key", 
        message: process.env.GEMINI_API_KEY ? "متصل" : "المفتاح غائب" 
    });
});

app.post('/api/football', async (req, res) => {
    const { action, homeTeam, awayTeam, matchStatus, tournament } = req.body;
    let prompt = "";

    // 1. جلب جدول مباريات اليوم الكامل الحقيقي
    if (action === "today_matches") {
        prompt = `أنت رادار كرة قدم حي متصل بقواعد البيانات الحالية لعام 2026. اليوم هو 13 يونيو 2026.
        أعطني قائمة بجميع المباريات الحقيقية والواقعية (التي انتهت اليوم، الجارية الآن، والمجدولة لاحقاً اليوم) في البطولات الكبرى.
        يجب أن يكون الرد بصيغة JSON صلبة فقط وبدون علامات ماركداون (No markdown, just pure JSON object).
        هيكل الـ JSON المطلوبة:
        {
            "matches": [
                { "homeTeam": "الفريق المستضيف", "awayTeam": "الفريق الضيف", "time": "التوقيت", "tournament": "البطولة", "status": "انتهت أو جارية أو قادمة", "score": { "home": 0, "away": 0 } }
            ]
        }`;
    } 
    // 2. إحصائيات المباراة الديناميكية بناءً على حالتها بالملعب
    else if (action === "match_stats") {
        prompt = `أعطني الإحصائيات والأحداث الحقيقية الدقيقة لمباراة (${homeTeam} ضد ${awayTeam}) في بطولة (${tournament}) لليوم 13 يونيو 2026.
        حالة المباراة الحالية بالملعب هي: (${matchStatus}).
        - إذا كانت المباراة (انتهت)، ركز على الأحداث والسيناريو الذي حدث ومسجلي الأهداف.
        - إذا كانت المباراة (جارية)، أعطني بيانات حية ولحظية للحالة الراهنة في هذه الدقيقة.
        - إذا كانت المباراة (قادمة)، أعطني لمحة سريعة عن توقعات الاستعداد البرمجي لها بالملعب.
        الرد JSON فقط:
        {
            "status": "${matchStatus}",
            "possession": { "home": 50, "away": 50 },
            "shots": { "home": 0, "away": 0 },
            "events": ["قائمة أحداث حقيقية واقعية مرتبة حسب الدقائق إن وجدت باللغة العربية"]
        }`;
    } 
    // 3. مقارنة تحليلية حقيقية بين فريقين
    else if (action === "compare_teams") {
        prompt = `قم بإجراء مقارنة تحليلية رياضية حقيقية وواقعية بناءً على أداء عام 2026 الحالي بين فريق (${homeTeam}) وفريق (${awayTeam}).
        الرد JSON نظيف فقط:
        {
            "teamA": "${homeTeam}",
            "teamB": "${awayTeam}",
            "analysisA": "تحليل أداء ومستوى الفريق الأول الحالي لعام 2026 في السطور الحالية",
            "analysisB": "تحليل أداء ومستوى الفريق الثاني الحالي لعام 2026 في السطور الحالية",
            "headToHead": "تاريخ المواجهات الحقيقية الأخيرة بينهما ونسبة الفوز المتوقعة بالملعب"
        }`;
    } else {
        return res.status(400).json({ error: "Invalid action type." });
    }

    let rawTextResponse = "";
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
        });

        if (response && response.text) {
            rawTextResponse = typeof response.text === 'function' ? response.text() : response.text;
        } else if (response && response.candidates && response.candidates[0]?.content?.parts[0]?.text) {
            rawTextResponse = response.candidates[0].content.parts[0].text;
        }

        if (!rawTextResponse) throw new Error("استجابة فارغة من الذكاء الاصطناعي.");

        let cleanJsonText = rawTextResponse.trim();
        if (cleanJsonText.includes("```json")) {
            cleanJsonText = cleanJsonText.split("```json")[1].split("```")[0].trim();
        } else if (cleanJsonText.includes("```")) {
            cleanJsonText = cleanJsonText.split("```")[1].split("```")[0].trim();
        }

        const parsedData = JSON.parse(cleanJsonText);
        res.json({ type: "parsed", data: parsedData });

    } catch (error) {
        console.error("Error Log:", error.message);
        res.status(200).json({ 
            type: "raw_error", 
            message: "فشل معالجة التنسيق الهيكلي، إليك المخرجات الخام مباشرة.",
            errorDetails: error.message,
            rawText: rawTextResponse || "لم يتم استقبال نص من الذكاء الاصطناعي."
        });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server up on port ${PORT}`));
