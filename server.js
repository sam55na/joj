// ==========================================
// الخادم الكامل للعبة التصويت
// ==========================================

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const cron = require('node-cron');
const axios = require('axios');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');
require('dotenv').config();

// ==========================================
// الاتصال بقاعدة البيانات المشتركة
// ==========================================

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_WBn21SarcbvT@ep-noisy-hill-at44qe5x-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require",
    ssl: {
        rejectUnauthorized: false
    },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

// اختبار الاتصال
pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ فشل الاتصال بقاعدة البيانات:', err.stack);
    } else {
        console.log('✅ تم الاتصال بقاعدة البيانات المشتركة');
        release();
    }
});

// ==========================================
// تهيئة الخادم
// ==========================================

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// WebSocket للاتصال المباشر مع الواجهة
// ==========================================

const clients = new Map();

wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const roundId = url.searchParams.get('roundId');
    
    if (roundId) {
        if (!clients.has(roundId)) {
            clients.set(roundId, new Set());
        }
        clients.get(roundId).add(ws);
        
        console.log(`✅ WebSocket متصل للجولة ${roundId}`);
        
        ws.on('close', () => {
            if (clients.has(roundId)) {
                clients.get(roundId).delete(ws);
                if (clients.get(roundId).size === 0) {
                    clients.delete(roundId);
                }
            }
            console.log(`❌ WebSocket مفصول للجولة ${roundId}`);
        });
        
        ws.on('error', (error) => {
            console.error(`⚠️ خطأ في WebSocket: ${error.message}`);
        });
    } else {
        ws.close();
    }
});

function broadcastToRound(roundId, data) {
    if (clients.has(roundId) && clients.get(roundId).size > 0) {
        const message = JSON.stringify(data);
        let sent = 0;
        clients.get(roundId).forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                try {
                    client.send(message);
                    sent++;
                } catch (error) {
                    console.error(`⚠️ فشل إرسال للعميل: ${error.message}`);
                }
            }
        });
        if (sent > 0) {
            console.log(`📡 تم إرسال تحديث إلى ${sent} عميل في الجولة ${roundId}`);
        }
    }
}

// ==========================================
// دوال مساعدة
// ==========================================

// دالة لإضافة إشعار للبوت
async function addNotification(roundId, userId, type, message) {
    try {
        const query = `
            INSERT INTO voting_notifications (round_id, user_id, notification_type, message)
            VALUES ($1, $2, $3, $4)
            RETURNING id
        `;
        const result = await pool.query(query, [roundId, userId, type, message]);
        console.log(`✅ تم إضافة إشعار للمستخدم ${userId} في الجولة ${roundId}`);
        return result.rows[0].id;
    } catch (error) {
        console.error('❌ فشل إضافة إشعار:', error);
        return null;
    }
}

// دالة لإرسال إشعار لجميع اللاعبين
async function notifyAllPlayers(roundId, type, message) {
    try {
        const query = `
            SELECT user_id FROM voting_players 
            WHERE round_id = $1 AND is_active = TRUE
        `;
        const result = await pool.query(query, [roundId]);
        
        let count = 0;
        for (const player of result.rows) {
            const notificationId = await addNotification(roundId, player.user_id, type, message);
            if (notificationId) count++;
        }
        console.log(`✅ تم إرسال إشعار جماعي لـ ${count} لاعب في الجولة ${roundId}`);
        return count;
    } catch (error) {
        console.error('❌ فشل إرسال إشعار جماعي:', error);
        return 0;
    }
}

// دالة لخصم رصيد المستخدم
async function deductUserBalance(userId, amount) {
    try {
        const query = `
            UPDATE users 
            SET balance = balance - $1 
            WHERE user_id = $2 AND balance >= $1
            RETURNING balance
        `;
        const result = await pool.query(query, [amount, userId]);
        if (result.rows.length > 0) {
            console.log(`✅ تم خصم ${amount} من المستخدم ${userId}`);
            return true;
        }
        console.log(`❌ رصيد المستخدم ${userId} غير كافي`);
        return false;
    } catch (error) {
        console.error('❌ فشل خصم الرصيد:', error);
        return false;
    }
}

// دالة لإضافة رصيد للمستخدم
async function addUserBalance(userId, amount) {
    try {
        const query = `
            UPDATE users 
            SET balance = balance + $1 
            WHERE user_id = $2
            RETURNING balance
        `;
        const result = await pool.query(query, [amount, userId]);
        if (result.rows.length > 0) {
            console.log(`✅ تم إضافة ${amount} للمستخدم ${userId}`);
            return true;
        }
        return false;
    } catch (error) {
        console.error('❌ فشل إضافة الرصيد:', error);
        return false;
    }
}

// دالة للحصول على المستخدم من قاعدة البيانات
async function getUser(userId) {
    try {
        const query = 'SELECT * FROM users WHERE user_id = $1';
        const result = await pool.query(query, [userId]);
        return result.rows[0] || null;
    } catch (error) {
        console.error('❌ فشل جلب المستخدم:', error);
        return null;
    }
}

// دالة للحصول على إعدادات التصويت
async function getVotingSetting(key, defaultValue) {
    try {
        const query = 'SELECT value FROM voting_settings WHERE key = $1';
        const result = await pool.query(query, [key]);
        if (result.rows.length > 0) {
            const value = result.rows[0].value;
            if (typeof value === 'string') {
                try {
                    return JSON.parse(value);
                } catch {
                    return value;
                }
            }
            return value;
        }
        return defaultValue;
    } catch (error) {
        console.error(`❌ فشل جلب الإعداد ${key}:`, error);
        return defaultValue;
    }
}

// دالة للحصول على حالة الجولة
function getStatusText(status) {
    const statuses = {
        'waiting': '⏳ في الانتظار',
        'active': '🟢 نشطة',
        'ended': '✅ منتهية',
        'cancelled': '❌ ملغية'
    };
    return statuses[status] || status;
}

// ==========================================
// API Routes
// ==========================================

// ==========================================
// 1. إنشاء جولة جديدة
// ==========================================
app.post('/api/rounds/create', async (req, res) => {
    const { 
        createdBy, 
        entryFee, 
        prizeAmount, 
        maxPlayers, 
        durationMinutes,
        channelId,
        isAdmin = true 
    } = req.body;

    // التحقق من البيانات
    if (!createdBy) {
        return res.status(400).json({
            success: false,
            message: '❌ يجب تحديد منشئ الجولة'
        });
    }

    try {
        // الحصول على الإعدادات الافتراضية
        const defaultEntryFee = await getVotingSetting('default_entry_fee', 10);
        const defaultPrize = await getVotingSetting('default_prize_amount', 100);
        const defaultMaxPlayers = await getVotingSetting('default_max_players', 10);
        const defaultDuration = await getVotingSetting('default_duration_minutes', 5);

        const finalEntryFee = entryFee || defaultEntryFee;
        const finalPrize = prizeAmount || defaultPrize;
        const finalMaxPlayers = maxPlayers || defaultMaxPlayers;
        const finalDuration = durationMinutes || defaultDuration;

        // التحقق من صحة القيم
        if (finalEntryFee < 0) {
            return res.status(400).json({
                success: false,
                message: '❌ رسوم الاشتراك يجب أن تكون أكبر من 0'
            });
        }
        if (finalPrize < 0) {
            return res.status(400).json({
                success: false,
                message: '❌ قيمة الجائزة يجب أن تكون أكبر من 0'
            });
        }
        if (finalMaxPlayers < 2) {
            return res.status(400).json({
                success: false,
                message: '❌ يجب أن يكون الحد الأقصى للاعبين على الأقل 2'
            });
        }
        if (finalDuration < 1) {
            return res.status(400).json({
                success: false,
                message: '❌ المدة يجب أن تكون على الأقل 1 دقيقة'
            });
        }

        // حساب رقم الجولة
        const roundCountResult = await pool.query(
            'SELECT COUNT(*) as count FROM voting_rounds'
        );
        const roundNumber = parseInt(roundCountResult.rows[0].count) + 1;

        // إنشاء الجولة
        const query = `
            INSERT INTO voting_rounds (
                round_number, created_by, created_by_type, entry_fee, 
                prize_amount, max_players, duration_minutes, status,
                channel_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *
        `;
        
        const values = [
            roundNumber,
            createdBy,
            isAdmin ? 'admin' : 'user',
            finalEntryFee,
            finalPrize,
            finalMaxPlayers,
            finalDuration,
            'waiting',
            channelId || null
        ];

        const result = await pool.query(query, values);
        const round = result.rows[0];

        // إضافة إشعار للمنشئ
        await addNotification(
            round.id,
            createdBy,
            'round_created',
            `🎮 تم إنشاء جولة جديدة رقم ${roundNumber}\n💰 الجائزة: ${finalPrize} نقطة\n💳 رسوم الاشتراك: ${finalEntryFee} نقطة\n👥 الحد الأقصى: ${finalMaxPlayers} لاعب`
        );

        console.log(`✅ تم إنشاء جولة جديدة #${roundNumber} بواسطة ${createdBy}`);

        res.status(201).json({
            success: true,
            round: round,
            message: '✅ تم إنشاء الجولة بنجاح'
        });

    } catch (error) {
        console.error('❌ خطأ في إنشاء الجولة:', error);
        res.status(500).json({
            success: false,
            message: '❌ حدث خطأ في إنشاء الجولة'
        });
    }
});

// ==========================================
// 2. بدء الجولة
// ==========================================
app.post('/api/rounds/:roundId/start', async (req, res) => {
    const { roundId } = req.params;

    try {
        // التحقق من وجود الجولة
        const roundResult = await pool.query(
            'SELECT * FROM voting_rounds WHERE id = $1',
            [roundId]
        );
        
        if (roundResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '❌ الجولة غير موجودة'
            });
        }

        const round = roundResult.rows[0];

        if (round.status !== 'waiting') {
            return res.status(400).json({
                success: false,
                message: `❌ لا يمكن بدء جولة بحالة ${getStatusText(round.status)}`
            });
        }

        // التحقق من عدد المشتركين
        const playersResult = await pool.query(
            'SELECT COUNT(*) as count FROM voting_players WHERE round_id = $1 AND is_active = TRUE',
            [roundId]
        );
        
        const playerCount = parseInt(playersResult.rows[0].count);
        const minPlayers = await getVotingSetting('min_players_to_start', 2);
        
        if (playerCount < minPlayers) {
            return res.status(400).json({
                success: false,
                message: `❌ يجب أن يكون هناك على الأقل ${minPlayers} مشتركين لبدء الجولة`
            });
        }

        // تحديث حالة الجولة
        const query = `
            UPDATE voting_rounds 
            SET status = 'active', 
                start_time = CURRENT_TIMESTAMP,
                end_time = CURRENT_TIMESTAMP + (duration_minutes || ' minutes')::INTERVAL
            WHERE id = $1
            RETURNING *
        `;
        
        const result = await pool.query(query, [roundId]);
        const updatedRound = result.rows[0];

        // تحديث current_round_players بجميع اللاعبين النشطين
        const activePlayers = await pool.query(
            'SELECT user_id FROM voting_players WHERE round_id = $1 AND is_active = TRUE',
            [roundId]
        );
        const playerIds = activePlayers.rows.map(p => p.user_id);
        await pool.query(
            'UPDATE voting_rounds SET current_round_players = $1 WHERE id = $2',
            [playerIds, roundId]
        );

        // إرسال إشعارات للجميع
        await notifyAllPlayers(
            roundId,
            'round_start',
            `🎮 بدأت الجولة رقم ${updatedRound.round_number}!\n⏱️ المدة: ${updatedRound.duration_minutes} دقيقة\n💰 الجائزة: ${updatedRound.prize_amount} نقطة`
        );

        // Broadcast للواجهة
        broadcastToRound(roundId, {
            type: 'round_started',
            round: updatedRound,
            timestamp: new Date().toISOString()
        });

        console.log(`✅ تم بدء الجولة #${updatedRound.round_number} مع ${playerCount} لاعب`);

        res.json({
            success: true,
            round: updatedRound,
            message: '✅ تم بدء الجولة بنجاح'
        });

    } catch (error) {
        console.error('❌ خطأ في بدء الجولة:', error);
        res.status(500).json({
            success: false,
            message: '❌ حدث خطأ في بدء الجولة'
        });
    }
});

// ==========================================
// 3. الاشتراك في الجولة
// ==========================================
app.post('/api/rounds/:roundId/join', async (req, res) => {
    const { roundId } = req.params;
    const { userId, username, displayName } = req.body;

    // التحقق من البيانات
    if (!userId) {
        return res.status(400).json({
            success: false,
            message: '❌ يجب تحديد المستخدم'
        });
    }

    try {
        // التحقق من وجود الجولة
        const roundResult = await pool.query(
            'SELECT * FROM voting_rounds WHERE id = $1',
            [roundId]
        );
        
        if (roundResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '❌ الجولة غير موجودة'
            });
        }

        const round = roundResult.rows[0];

        if (round.status !== 'waiting') {
            return res.status(400).json({
                success: false,
                message: `❌ لا يمكن الاشتراك في جولة بحالة ${getStatusText(round.status)}`
            });
        }

        // التحقق من عدد المشتركين
        const playersResult = await pool.query(
            'SELECT COUNT(*) as count FROM voting_players WHERE round_id = $1 AND is_active = TRUE',
            [roundId]
        );
        
        const currentPlayers = parseInt(playersResult.rows[0].count);
        if (currentPlayers >= round.max_players) {
            return res.status(400).json({
                success: false,
                message: '❌ اكتمل عدد المشتركين'
            });
        }

        // التحقق من أن المستخدم ليس مشتركاً بالفعل
        const existingResult = await pool.query(
            'SELECT * FROM voting_players WHERE round_id = $1 AND user_id = $2',
            [roundId, userId]
        );
        
        if (existingResult.rows.length > 0) {
            return res.status(400).json({
                success: false,
                message: '❌ أنت مشترك بالفعل في هذه الجولة'
            });
        }

        // التحقق من رصيد المستخدم
        const user = await getUser(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: '❌ المستخدم غير موجود'
            });
        }

        if (user.balance < round.entry_fee) {
            return res.status(400).json({
                success: false,
                message: `❌ رصيدك غير كافي. تحتاج ${round.entry_fee} نقطة`
            });
        }

        // خصم رسوم الاشتراك
        const deducted = await deductUserBalance(userId, round.entry_fee);
        if (!deducted) {
            return res.status(400).json({
                success: false,
                message: '❌ فشل خصم رسوم الاشتراك'
            });
        }

        // إضافة المشترك
        const playerDisplayName = displayName || username || user.name || 'مستخدم';
        const playerUsername = username || user.name || null;
        
        const query = `
            INSERT INTO voting_players (round_id, user_id, username, display_name)
            VALUES ($1, $2, $3, $4)
            RETURNING *
        `;
        
        const values = [roundId, userId, playerUsername, playerDisplayName];
        const result = await pool.query(query, values);
        const player = result.rows[0];

        // تحديث قائمة اللاعبين في الجولة
        await pool.query(
            'UPDATE voting_rounds SET current_round_players = array_append(current_round_players, $1) WHERE id = $2',
            [userId, roundId]
        );

        // إشعار للمنشئ
        await addNotification(
            roundId,
            round.created_by,
            'player_joined',
            `👤 ${playerDisplayName} انضم للجولة رقم ${round.round_number}`
        );

        // Broadcast للواجهة
        broadcastToRound(roundId, {
            type: 'player_joined',
            player: player,
            totalPlayers: currentPlayers + 1,
            timestamp: new Date().toISOString()
        });

        console.log(`✅ انضم المستخدم ${userId} للجولة ${roundId}`);

        res.json({
            success: true,
            player: player,
            message: '✅ تم الاشتراك في الجولة بنجاح'
        });

    } catch (error) {
        console.error('❌ خطأ في الاشتراك:', error);
        res.status(500).json({
            success: false,
            message: '❌ حدث خطأ في الاشتراك'
        });
    }
});

// ==========================================
// 4. التصويت
// ==========================================
app.post('/api/rounds/:roundId/vote', async (req, res) => {
    const { roundId } = req.params;
    const { voterId, targetId } = req.body;

    // التحقق من البيانات
    if (!voterId || !targetId) {
        return res.status(400).json({
            success: false,
            message: '❌ يجب تحديد المصوت والمستهدف'
        });
    }

    if (voterId === targetId) {
        return res.status(400).json({
            success: false,
            message: '❌ لا يمكنك التصويت لنفسك'
        });
    }

    try {
        // التحقق من أن الجولة نشطة
        const roundResult = await pool.query(
            'SELECT * FROM voting_rounds WHERE id = $1 AND status = $2',
            [roundId, 'active']
        );
        
        if (roundResult.rows.length === 0) {
            return res.status(400).json({
                success: false,
                message: '❌ الجولة غير نشطة أو منتهية'
            });
        }

        const round = roundResult.rows[0];

        // التحقق من أن المصوت مشترك
        const voterResult = await pool.query(
            'SELECT * FROM voting_players WHERE round_id = $1 AND user_id = $2 AND is_active = TRUE AND is_eliminated = FALSE',
            [roundId, voterId]
        );
        
        if (voterResult.rows.length === 0) {
            return res.status(400).json({
                success: false,
                message: '❌ أنت لست مشتركاً نشطاً في هذه الجولة'
            });
        }

        // التحقق من أن المستهدف مشترك
        const targetResult = await pool.query(
            'SELECT * FROM voting_players WHERE round_id = $1 AND user_id = $2 AND is_active = TRUE AND is_eliminated = FALSE',
            [roundId, targetId]
        );
        
        if (targetResult.rows.length === 0) {
            return res.status(400).json({
                success: false,
                message: '❌ المستهدف غير موجود أو مطرود'
            });
        }

        // التحقق من عدم التصويت مسبقاً
        const voteResult = await pool.query(
            'SELECT * FROM voting_votes WHERE round_id = $1 AND voter_id = $2',
            [roundId, voterId]
        );
        
        if (voteResult.rows.length > 0) {
            return res.status(400).json({
                success: false,
                message: '❌ لقد صوت مسبقاً في هذه الجولة'
            });
        }

        // تسجيل التصويت
        const query = `
            INSERT INTO voting_votes (round_id, voter_id, target_id)
            VALUES ($1, $2, $3)
            RETURNING *
        `;
        
        const values = [roundId, voterId, targetId];
        const result = await pool.query(query, values);
        const vote = result.rows[0];

        // تحديث عدد الأصوات للمستهدف
        await pool.query(
            'UPDATE voting_players SET votes_received = votes_received + 1 WHERE round_id = $1 AND user_id = $2',
            [roundId, targetId]
        );

        // الحصول على إحصائيات التصويت
        const votesCount = await pool.query(
            'SELECT COUNT(*) as count FROM voting_votes WHERE round_id = $1',
            [roundId]
        );
        
        const targetVotes = await pool.query(
            'SELECT votes_received FROM voting_players WHERE round_id = $1 AND user_id = $2',
            [roundId, targetId]
        );

        // إرسال إشعار للمستهدف
        await addNotification(
            roundId,
            targetId,
            'vote_received',
            `🗳️ تلقيت صوتاً جديداً في الجولة ${round.round_number}! (إجمالي: ${targetVotes.rows[0].votes_received})`
        );

        // Broadcast للواجهة
        broadcastToRound(roundId, {
            type: 'vote_cast',
            vote: vote,
            voterId: voterId,
            targetId: targetId,
            targetVotes: targetVotes.rows[0].votes_received,
            totalVotes: parseInt(votesCount.rows[0].count),
            timestamp: new Date().toISOString()
        });

        console.log(`✅ تم تسجيل صوت من ${voterId} للمستخدم ${targetId} في الجولة ${roundId}`);

        res.json({
            success: true,
            vote: vote,
            targetVotes: targetVotes.rows[0].votes_received,
            totalVotes: parseInt(votesCount.rows[0].count),
            message: '✅ تم تسجيل صوتك بنجاح'
        });

    } catch (error) {
        console.error('❌ خطأ في التصويت:', error);
        res.status(500).json({
            success: false,
            message: '❌ حدث خطأ في التصويت'
        });
    }
});

// ==========================================
// 5. إنهاء الجولة ومعالجة النتائج
// ==========================================
app.post('/api/rounds/:roundId/end', async (req, res) => {
    const { roundId } = req.params;

    try {
        // الحصول على الجولة
        const roundResult = await pool.query(
            'SELECT * FROM voting_rounds WHERE id = $1 AND status = $2',
            [roundId, 'active']
        );
        
        if (roundResult.rows.length === 0) {
            return res.status(400).json({
                success: false,
                message: '❌ الجولة غير نشطة'
            });
        }

        const round = roundResult.rows[0];

        // الحصول على جميع اللاعبين النشطين
        const playersResult = await pool.query(
            'SELECT * FROM voting_players WHERE round_id = $1 AND is_active = TRUE AND is_eliminated = FALSE',
            [roundId]
        );
        
        const activePlayers = playersResult.rows;

        if (activePlayers.length <= 2) {
            // نهاية اللعبة - تحديد الفائزين
            return await finalizeGame(roundId, res);
        }

        // تحديد اللاعب الأكثر تصويتاً
        const maxVotes = Math.max(...activePlayers.map(p => parseInt(p.votes_received)));
        const eliminated = activePlayers.filter(p => parseInt(p.votes_received) === maxVotes);

        // إقصاء اللاعبين
        for (const player of eliminated) {
            await pool.query(
                'UPDATE voting_players SET is_eliminated = TRUE, elimination_round = $1 WHERE id = $2',
                [round.round_number, player.id]
            );
        }

        // تحديث قائمة المطرودين في الجولة
        const eliminatedIds = eliminated.map(p => p.user_id);
        await pool.query(
            'UPDATE voting_rounds SET eliminated_players = array_cat(eliminated_players, $1) WHERE id = $2',
            [eliminatedIds, roundId]
        );

        // إرسال إشعارات للمطرودين
        for (const player of eliminated) {
            await addNotification(
                roundId,
                player.user_id,
                'eliminated',
                `❌ تم إقصاؤك في الجولة ${round.round_number}!\n📊 حصلت على ${player.votes_received} صوت`
            );
        }

        // إرسال إشعار للجميع بنتيجة الجولة
        const remainingPlayers = activePlayers.filter(p => !eliminatedIds.includes(p.user_id));
        const eliminatedText = eliminated.map(p => `❌ ${p.display_name} - ${p.votes_received} صوت`).join('\n');
        
        await notifyAllPlayers(
            roundId,
            'round_result',
            `📊 نتائج الجولة ${round.round_number}:\n${eliminatedText}\n\n🎯 المتبقون: ${remainingPlayers.length} لاعب`
        );

        // تحديث قائمة اللاعبين الحاليين
        await pool.query(
            'UPDATE voting_rounds SET current_round_players = $1 WHERE id = $2',
            [remainingPlayers.map(p => p.user_id), roundId]
        );

        // Broadcast للواجهة
        broadcastToRound(roundId, {
            type: 'round_ended',
            eliminated: eliminated,
            remaining: remainingPlayers,
            nextRoundNumber: round.round_number + 1,
            timestamp: new Date().toISOString()
        });

        console.log(`✅ تم إقصاء ${eliminated.length} لاعب في الجولة ${roundId}`);

        // إنشاء جولة جديدة تلقائياً إذا بقي أكثر من 2 لاعبين
        if (remainingPlayers.length > 2) {
            await createNextRound(roundId, remainingPlayers);
            
            res.json({
                success: true,
                eliminated: eliminated,
                remaining: remainingPlayers,
                nextRoundCreated: true,
                message: `✅ تم إقصاء ${eliminated.length} لاعب وبدء جولة جديدة`
            });
        } else {
            // نهاية اللعبة إذا بقي لاعبين أو أقل
            await finalizeGame(roundId, res);
        }

    } catch (error) {
        console.error('❌ خطأ في إنهاء الجولة:', error);
        res.status(500).json({
            success: false,
            message: '❌ حدث خطأ في إنهاء الجولة'
        });
    }
});

// ==========================================
// دالة لإنهاء اللعبة وتوزيع الجائزة
// ==========================================
async function finalizeGame(roundId, res) {
    try {
        const roundResult = await pool.query(
            'SELECT * FROM voting_rounds WHERE id = $1',
            [roundId]
        );
        const round = roundResult.rows[0];

        const playersResult = await pool.query(
            'SELECT * FROM voting_players WHERE round_id = $1 AND is_active = TRUE AND is_eliminated = FALSE',
            [roundId]
        );
        const finalists = playersResult.rows;

        let winners = [];

        if (finalists.length === 1) {
            // فائز واحد
            winners = [finalists[0]];
            await pool.query(
                'UPDATE voting_players SET is_winner = TRUE WHERE id = $1',
                [finalists[0].id]
            );
            
            // إضافة الجائزة للفائز
            await addUserBalance(finalists[0].user_id, round.prize_amount);

            await addNotification(
                roundId,
                finalists[0].user_id,
                'winner',
                `🏆 مبروك! أنت الفائز بالجولة ${round.round_number}!\n💰 الجائزة: ${round.prize_amount} نقطة`
            );
            
            console.log(`🏆 الفائز: ${finalists[0].user_id} - ${round.prize_amount} نقطة`);

        } else if (finalists.length === 2) {
            // فائزان يتقاسمان الجائزة
            winners = finalists;
            const halfPrize = round.prize_amount / 2;
            
            for (const player of finalists) {
                await pool.query(
                    'UPDATE voting_players SET is_winner = TRUE WHERE id = $1',
                    [player.id]
                );
                await addUserBalance(player.user_id, halfPrize);
                
                await addNotification(
                    roundId,
                    player.user_id,
                    'winner',
                    `🏆 مبروك! أنت من الفائزين بالجولة ${round.round_number}!\n💰 الجائزة: ${halfPrize} نقطة`
                );
            }
            
            console.log(`🏆 الفائزون: ${finalists.map(p => p.user_id).join(', ')} - ${halfPrize} نقطة لكل منهم`);
        }

        // تحديث حالة الجولة
        const winnerIds = winners.map(w => w.user_id);
        await pool.query(
            'UPDATE voting_rounds SET status = $1, winner_ids = $2 WHERE id = $3',
            ['ended', winnerIds, roundId]
        );

        // إشعار عام بنهاية اللعبة
        const winnerNames = winners.map(w => w.display_name).join(', ');
        await notifyAllPlayers(
            roundId,
            'game_ended',
            `🏁 انتهت اللعبة!\n🏆 الفائزون: ${winnerNames}\n💰 الجائزة: ${round.prize_amount} نقطة`
        );

        // Broadcast للواجهة
        broadcastToRound(roundId, {
            type: 'game_ended',
            winners: winners,
            prize: round.prize_amount,
            timestamp: new Date().toISOString()
        });

        console.log(`✅ انتهت اللعبة في الجولة ${roundId}`);

        if (res) {
            res.json({
                success: true,
                winners: winners,
                message: '✅ تم إنهاء اللعبة وتوزيع الجائزة'
            });
        }

    } catch (error) {
        console.error('❌ خطأ في إنهاء اللعبة:', error);
        if (res) {
            res.status(500).json({
                success: false,
                message: '❌ حدث خطأ في إنهاء اللعبة'
            });
        }
    }
}

// ==========================================
// دالة لإنشاء الجولة التالية
// ==========================================
async function createNextRound(roundId, remainingPlayers) {
    try {
        const roundResult = await pool.query(
            'SELECT * FROM voting_rounds WHERE id = $1',
            [roundId]
        );
        const currentRound = roundResult.rows[0];

        // حساب رقم الجولة الجديد
        const roundCountResult = await pool.query(
            'SELECT COUNT(*) as count FROM voting_rounds'
        );
        const newRoundNumber = parseInt(roundCountResult.rows[0].count) + 1;

        // إنشاء جولة جديدة بنفس الإعدادات
        const newRoundQuery = `
            INSERT INTO voting_rounds (
                round_number, created_by, created_by_type, entry_fee,
                prize_amount, max_players, duration_minutes, status,
                channel_id, current_round_players,
                round_type
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING *
        `;

        const values = [
            newRoundNumber,
            currentRound.created_by,
            currentRound.created_by_type,
            currentRound.entry_fee,
            currentRound.prize_amount,
            remainingPlayers.length,
            currentRound.duration_minutes,
            'waiting',
            currentRound.channel_id,
            remainingPlayers.map(p => p.user_id),
            'standard'
        ];

        const result = await pool.query(newRoundQuery, values);
        const newRound = result.rows[0];

        // إضافة اللاعبين المتبقيين تلقائياً للجولة الجديدة (بدون خصم رصيد)
        for (const player of remainingPlayers) {
            await pool.query(
                `INSERT INTO voting_players (round_id, user_id, username, display_name, is_active, is_eliminated)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [newRound.id, player.user_id, player.username, player.display_name, true, false]
            );
        }

        // إعلام اللاعبين بالجولة الجديدة
        await notifyAllPlayers(
            newRound.id,
            'new_round',
            `🔄 بدأت جولة جديدة رقم ${newRoundNumber}!\n👥 اللاعبين المتبقين: ${remainingPlayers.length}\n💰 الجائزة: ${newRound.prize_amount} نقطة`
        );

        // بدء الجولة الجديدة تلقائياً
        await pool.query(
            'UPDATE voting_rounds SET status = $1, start_time = CURRENT_TIMESTAMP, end_time = CURRENT_TIMESTAMP + (duration_minutes || \' minutes\')::INTERVAL WHERE id = $2',
            ['active', newRound.id]
        );

        // Broadcast للواجهة
        broadcastToRound(newRound.id, {
            type: 'new_round_created',
            round: newRound,
            remainingPlayers: remainingPlayers,
            timestamp: new Date().toISOString()
        });

        console.log(`✅ تم إنشاء جولة جديدة #${newRoundNumber} مع ${remainingPlayers.length} لاعب`);

        return newRound;

    } catch (error) {
        console.error('❌ خطأ في إنشاء الجولة التالية:', error);
        return null;
    }
}

// ==========================================
// 6. الحصول على بيانات الجولة
// ==========================================
app.get('/api/rounds/:roundId', async (req, res) => {
    const { roundId } = req.params;

    try {
        const roundResult = await pool.query(
            'SELECT * FROM voting_rounds WHERE id = $1',
            [roundId]
        );

        if (roundResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '❌ الجولة غير موجودة'
            });
        }

        const round = roundResult.rows[0];

        // الحصول على اللاعبين
        const playersResult = await pool.query(
            'SELECT * FROM voting_players WHERE round_id = $1 ORDER BY votes_received DESC',
            [roundId]
        );

        // الحصول على التصويتات
        const votesResult = await pool.query(
            'SELECT * FROM voting_votes WHERE round_id = $1',
            [roundId]
        );

        // الحصول على إحصائيات
        const stats = {
            totalVotes: votesResult.rows.length,
            totalPlayers: playersResult.rows.length,
            activePlayers: playersResult.rows.filter(p => !p.is_eliminated).length,
            eliminatedPlayers: playersResult.rows.filter(p => p.is_eliminated).length
        };

        res.json({
            success: true,
            round: round,
            players: playersResult.rows,
            votes: votesResult.rows,
            stats: stats
        });

    } catch (error) {
        console.error('❌ خطأ في جلب بيانات الجولة:', error);
        res.status(500).json({
            success: false,
            message: '❌ حدث خطأ في جلب بيانات الجولة'
        });
    }
});

// ==========================================
// 7. الحصول على جميع الجولات
// ==========================================
app.get('/api/rounds', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM voting_rounds ORDER BY created_at DESC'
        );
        res.json({
            success: true,
            rounds: result.rows
        });
    } catch (error) {
        console.error('❌ خطأ في جلب الجولات:', error);
        res.status(500).json({
            success: false,
            message: '❌ حدث خطأ في جلب الجولات'
        });
    }
});

// ==========================================
// 8. إلغاء الجولة
// ==========================================
app.post('/api/rounds/:roundId/cancel', async (req, res) => {
    const { roundId } = req.params;

    try {
        const query = `
            UPDATE voting_rounds 
            SET status = 'cancelled' 
            WHERE id = $1
            RETURNING *
        `;
        
        const result = await pool.query(query, [roundId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '❌ الجولة غير موجودة'
            });
        }

        // إشعار للمشتركين
        await notifyAllPlayers(
            roundId,
            'round_cancelled',
            `❌ تم إلغاء الجولة رقم ${result.rows[0].round_number}`
        );

        // Broadcast للواجهة
        broadcastToRound(roundId, {
            type: 'round_cancelled',
            round: result.rows[0],
            timestamp: new Date().toISOString()
        });

        console.log(`✅ تم إلغاء الجولة ${roundId}`);

        res.json({
            success: true,
            message: '✅ تم إلغاء الجولة بنجاح'
        });

    } catch (error) {
        console.error('❌ خطأ في إلغاء الجولة:', error);
        res.status(500).json({
            success: false,
            message: '❌ حدث خطأ في إلغاء الجولة'
        });
    }
});

// ==========================================
// 9. الحصول على إعدادات اللعبة
// ==========================================
app.get('/api/settings', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM voting_settings'
        );
        
        const settings = {};
        for (const row of result.rows) {
            const value = row.value;
            if (typeof value === 'string') {
                try {
                    settings[row.key] = JSON.parse(value);
                } catch {
                    settings[row.key] = value;
                }
            } else {
                settings[row.key] = value;
            }
        }
        
        res.json({
            success: true,
            settings: settings
        });
    } catch (error) {
        console.error('❌ خطأ في جلب الإعدادات:', error);
        res.status(500).json({
            success: false,
            message: '❌ حدث خطأ في جلب الإعدادات'
        });
    }
});

// ==========================================
// 10. تحديث الإعدادات
// ==========================================
app.post('/api/settings', async (req, res) => {
    const { key, value } = req.body;

    if (!key) {
        return res.status(400).json({
            success: false,
            message: '❌ يجب تحديد المفتاح'
        });
    }

    try {
        await pool.query(
            `INSERT INTO voting_settings (key, value, updated_at)
             VALUES ($1, $2, CURRENT_TIMESTAMP)
             ON CONFLICT (key) 
             DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP`,
            [key, JSON.stringify(value)]
        );

        console.log(`✅ تم تحديث الإعداد ${key} = ${JSON.stringify(value)}`);

        res.json({
            success: true,
            message: '✅ تم تحديث الإعدادات'
        });
    } catch (error) {
        console.error('❌ خطأ في تحديث الإعدادات:', error);
        res.status(500).json({
            success: false,
            message: '❌ حدث خطأ في تحديث الإعدادات'
        });
    }
});

// ==========================================
// 11. الحصول على إشعارات البوت المعلقة
// ==========================================
app.get('/api/notifications/pending', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM voting_notifications 
             WHERE is_sent = FALSE 
             ORDER BY created_at ASC
             LIMIT 100`
        );
        res.json({
            success: true,
            notifications: result.rows
        });
    } catch (error) {
        console.error('❌ خطأ في جلب الإشعارات:', error);
        res.status(500).json({
            success: false,
            message: '❌ حدث خطأ في جلب الإشعارات'
        });
    }
});

// ==========================================
// 12. تحديث حالة الإشعار
// ==========================================
app.post('/api/notifications/:id/mark-sent', async (req, res) => {
    const { id } = req.params;

    try {
        await pool.query(
            `UPDATE voting_notifications 
             SET is_sent = TRUE, sent_at = CURRENT_TIMESTAMP 
             WHERE id = $1`,
            [id]
        );
        res.json({
            success: true,
            message: '✅ تم تحديث حالة الإشعار'
        });
    } catch (error) {
        console.error('❌ خطأ في تحديث الإشعار:', error);
        res.status(500).json({
            success: false,
            message: '❌ حدث خطأ في تحديث الإشعار'
        });
    }
});

// ==========================================
// 13. الحصول على حالة اللعبة (للصحة)
// ==========================================
app.get('/api/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({
            status: 'healthy',
            database: 'connected',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            status: 'unhealthy',
            database: 'disconnected',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// ==========================================
// 14. إحصائيات اللعبة
// ==========================================
app.get('/api/stats', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                (SELECT COUNT(*) FROM voting_rounds) as total_rounds,
                (SELECT COUNT(*) FROM voting_rounds WHERE status = 'active') as active_rounds,
                (SELECT COUNT(*) FROM voting_rounds WHERE status = 'waiting') as waiting_rounds,
                (SELECT COUNT(*) FROM voting_rounds WHERE status = 'ended') as ended_rounds,
                (SELECT COUNT(*) FROM voting_players) as total_players,
                (SELECT COUNT(*) FROM voting_votes) as total_votes,
                (SELECT COUNT(*) FROM voting_notifications WHERE is_sent = FALSE) as pending_notifications
        `);
        
        res.json({
            success: true,
            stats: result.rows[0]
        });
    } catch (error) {
        console.error('❌ خطأ في جلب الإحصائيات:', error);
        res.status(500).json({
            success: false,
            message: '❌ حدث خطأ في جلب الإحصائيات'
        });
    }
});

// ==========================================
// المهام التلقائية (Cron Jobs)
// ==========================================

// فحص الجولات المنتهية كل 30 ثانية
cron.schedule('*/30 * * * * *', async () => {
    try {
        const result = await pool.query(
            `SELECT * FROM voting_rounds 
             WHERE status = 'active' 
             AND end_time < CURRENT_TIMESTAMP`
        );
        
        for (const round of result.rows) {
            console.log(`⏰ إنهاء الجولة ${round.id} تلقائياً...`);
            try {
                // استخدام axios داخلي بدلاً من طلب HTTP
                const response = await axios.post(`http://localhost:${PORT}/api/rounds/${round.id}/end`);
                if (response.data.success) {
                    console.log(`✅ تم إنهاء الجولة ${round.id} تلقائياً`);
                }
            } catch (error) {
                console.error(`❌ فشل إنهاء الجولة ${round.id}:`, error.message);
            }
        }
    } catch (error) {
        console.error('❌ خطأ في المهمة التلقائية:', error);
    }
});

// تنظيف الإشعارات القديمة كل يوم
cron.schedule('0 0 * * *', async () => {
    try {
        const result = await pool.query(
            `DELETE FROM voting_notifications 
             WHERE is_sent = TRUE 
             AND created_at < CURRENT_TIMESTAMP - INTERVAL '7 days'
             RETURNING id`
        );
        console.log(`🧹 تم تنظيف ${result.rows.length} إشعار قديم`);
    } catch (error) {
        console.error('❌ خطأ في تنظيف الإشعارات:', error);
    }
});

// تحديث حالة الجولات المعلقة كل 5 دقائق
cron.schedule('*/5 * * * *', async () => {
    try {
        // التحقق من الجولات التي لم تبدأ رغم انتهاء وقتها
        const result = await pool.query(
            `UPDATE voting_rounds 
             SET status = 'cancelled' 
             WHERE status = 'waiting' 
             AND created_at < CURRENT_TIMESTAMP - INTERVAL '1 hour'`
        );
        if (result.rowCount > 0) {
            console.log(`⏰ تم إلغاء ${result.rowCount} جولة منتهية الصلاحية`);
        }
    } catch (error) {
        console.error('❌ خطأ في تحديث الجولات المعلقة:', error);
    }
});

// ==========================================
// تشغيل الخادم
// ==========================================

const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
    console.log('='.repeat(60));
    console.log('🚀 خادم لعبة التصويت');
    console.log('='.repeat(60));
    console.log(`📡 يعمل على: http://localhost:${PORT}`);
    console.log(`📡 WebSocket: ws://localhost:${PORT}/?roundId=ID`);
    console.log(`📊 قاعدة البيانات: ${process.env.DATABASE_URL ? 'متصلة ✅' : 'غير متصلة ❌'}`);
    console.log(`📅 جدولة المهام: مفعلة ✅`);
    console.log('='.repeat(60));
    console.log('📋 نقاط النهاية المتاحة:');
    console.log(`  GET  /api/rounds         - قائمة الجولات`);
    console.log(`  GET  /api/rounds/:id     - تفاصيل جولة`);
    console.log(`  POST /api/rounds/create  - إنشاء جولة`);
    console.log(`  POST /api/rounds/:id/start - بدء جولة`);
    console.log(`  POST /api/rounds/:id/join  - الاشتراك`);
    console.log(`  POST /api/rounds/:id/vote  - التصويت`);
    console.log(`  POST /api/rounds/:id/end   - إنهاء جولة`);
    console.log(`  POST /api/rounds/:id/cancel - إلغاء جولة`);
    console.log(`  GET  /api/notifications/pending - إشعارات معلقة`);
    console.log(`  POST /api/notifications/:id/mark-sent - تحديث إشعار`);
    console.log(`  GET  /api/settings      - الإعدادات`);
    console.log(`  POST /api/settings      - تحديث إعداد`);
    console.log(`  GET  /api/stats         - إحصائيات`);
    console.log(`  GET  /api/health        - فحص الصحة`);
    console.log('='.repeat(60));
});

// معالجة الإغلاق
process.on('SIGINT', async () => {
    console.log('\n🛑 إيقاف الخادم...');
    await pool.end();
    server.close(() => {
        console.log('✅ تم إيقاف الخادم');
        process.exit(0);
    });
});
