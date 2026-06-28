// server.js - الخادم الوسيط
const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// تخزين جلسات المستخدمين
const sessions = {};

// ============================================================
//  🚀  تسجيل الدخول وجلب البيانات
// ============================================================
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'الرجاء إدخال اسم المستخدم وكلمة المرور' });
    }

    let browser;
    try {
        // تشغيل متصفح خفي
        browser = await puppeteer.launch({
            headless: true, // تشغيل في الخلفية
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        
        // 1. الذهاب إلى صفحة تسجيل الدخول
        await page.goto('https://www.ichancy200.com/ar/login', { 
            waitUntil: 'networkidle0',
            timeout: 30000 
        });

        // 2. انتظار ظهور نموذج تسجيل الدخول
        await page.waitForSelector('input[type="text"], input[name="username"], input[name="email"]', { timeout: 10000 });
        
        // 3. ملء البيانات
        await page.type('input[type="text"], input[name="username"], input[name="email"]', username);
        await page.type('input[type="password"]', password);

        // 4. الضغط على زر تسجيل الدخول
        await page.click('button[type="submit"], input[type="submit"]');
        
        // 5. انتظار تحميل الصفحة بعد تسجيل الدخول
        await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 });

        // 6. استخلاص البيانات
        const userData = await page.evaluate(() => {
            // استخلاص اسم المستخدم
            const nameSelectors = [
                '.user-name', '.profile-name', '.username',
                '.user-info h2', '[data-user-name]'
            ];
            let name = 'مستخدم';
            for (const selector of nameSelectors) {
                const el = document.querySelector(selector);
                if (el) {
                    name = el.textContent.trim();
                    break;
                }
            }

            // استخلاص رقم اللاعب
            const idSelectors = [
                '.player-id', '.user-id', '.account-id',
                '[data-player-id]', '.member-id'
            ];
            let playerId = '---';
            for (const selector of idSelectors) {
                const el = document.querySelector(selector);
                if (el) {
                    playerId = el.textContent.trim().replace(/#/g, '');
                    break;
                }
            }

            // استخلاص الرصيد
            const balanceSelectors = [
                '.balance', '.user-balance', '.account-balance',
                '.credit', '.wallet-amount', '[data-balance]'
            ];
            let balance = 0;
            for (const selector of balanceSelectors) {
                const el = document.querySelector(selector);
                if (el) {
                    const text = el.textContent.trim();
                    const match = text.match(/([\d,.]+)/);
                    if (match) {
                        balance = parseFloat(match[1].replace(/,/g, ''));
                        break;
                    }
                }
            }

            // استخلاص الألعاب
            const games = [];
            const gameLinks = document.querySelectorAll('a[href*="game"], a[href*="launch"], .game-card, .game-item');
            gameLinks.forEach((link) => {
                const href = link.getAttribute('href');
                const text = link.textContent.trim();
                
                // استخلاص معرف اللعبة
                const idMatch = href?.match(/[?&]gameId=(\d+)/) ||
                    href?.match(/\/game\/(\d+)/) ||
                    href?.match(/\/launch\/(\d+)/);
                
                if (idMatch && games.length < 20) {
                    const icon = link.querySelector('img, .icon, i')?.outerHTML || '🎮';
                    games.push({
                        id: idMatch[1],
                        name: text || `لعبة ${games.length + 1}`,
                        icon: icon,
                        url: href
                    });
                }
            });

            // جلب الكوكيز للجلسة
            const cookies = document.cookie;

            return {
                name,
                playerId,
                balance,
                games,
                cookies
            };
        });

        // 7. إغلاق المتصفح
        await browser.close();

        // 8. حفظ الجلسة
        const sessionId = Date.now().toString(36) + Math.random().toString(36).substr(2);
        sessions[sessionId] = {
            ...userData,
            username,
            timestamp: Date.now()
        };

        res.json({
            success: true,
            sessionId,
            user: userData
        });

    } catch (error) {
        console.error('خطأ:', error);
        if (browser) await browser.close();
        res.status(500).json({ 
            error: 'فشل تسجيل الدخول: ' + error.message 
        });
    }
});

// ============================================================
//  📊  جلب بيانات محدثة
// ============================================================
app.get('/api/refresh/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const session = sessions[sessionId];

    if (!session) {
        return res.status(404).json({ error: 'الجلسة غير موجودة' });
    }

    // هنا يمكن إعادة جلب البيانات باستخدام الكوكيز المخزنة
    // أو إرجاع البيانات المخزنة مؤقتاً
    res.json({
        success: true,
        user: {
            name: session.name,
            playerId: session.playerId,
            balance: session.balance,
            games: session.games
        }
    });
});

// ============================================================
//  🚪  تسجيل الخروج
// ============================================================
app.post('/api/logout/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    delete sessions[sessionId];
    res.json({ success: true });
});

// ============================================================
//  ▶️  تشغيل الخادم
// ============================================================
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`✅ الخادم يعمل على http://localhost:${PORT}`);
    console.log('📌 قم بفتح الرابط في المتصفح');
});
