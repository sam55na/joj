from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
import psycopg2
from psycopg2 import pool, extras
from datetime import datetime, timedelta
import logging
import os
import random
import json
import time
from contextlib import contextmanager
import uvicorn

# ==================== إعدادات التسجيل ====================
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("LuckyWheel")

# ==================== إعدادات قاعدة البيانات ====================
POSTGRESQL_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://neondb_owner:npg_1nTX5qHluRfV@ep-summer-moon-ainm3y73-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
)

# ==================== إعدادات العجلة ====================
MIN_DEPOSIT_AMOUNT = 10000
TIME_WINDOW_HOURS = 24

WHEEL_REWARDS = [
    {"label": "🎁 100", "value": 100, "color": "#85C1E9"},
    {"label": "🎁 500", "value": 500, "color": "#98D8C8"},
    {"label": "🎁 1000", "value": 1000, "color": "#4ECDC4"},
    {"label": "🎁 2000", "value": 2000, "color": "#45B7D1"},
    {"label": "🎁 3000", "value": 3000, "color": "#F7DC6F"},
    {"label": "🎁 5000", "value": 5000, "color": "#FF6B6B"},
    {"label": "🎁 10000", "value": 10000, "color": "#FFA07A"},
    {"label": "🎁 15000", "value": 15000, "color": "#F8C471"},
    {"label": "🎁 20000", "value": 20000, "color": "#BB8FCE"},
    {"label": "🎁 25000", "value": 25000, "color": "#D7BDE2"},
    {"label": "🎁 50000", "value": 50000, "color": "#FFD700"},
    {"label": "🎁 100000", "value": 100000, "color": "#FF6B6B"},
]

# ==================== قاعدة البيانات ====================
class DatabaseManager:
    def __init__(self, connection_string: str):
        self.connection_string = connection_string
        self.pool = None
        self._init_pool()
        self._init_tables()
        logger.info("✅ DatabaseManager initialized")

    def _init_pool(self):
        try:
            self.pool = psycopg2.pool.SimpleConnectionPool(
                1, 10, self.connection_string
            )
            logger.info("✅ PostgreSQL connection pool created")
        except Exception as e:
            logger.error(f"❌ Failed to create pool: {e}")
            raise

    @contextmanager
    def get_connection(self):
        conn = None
        try:
            conn = self.pool.getconn()
            yield conn
        except Exception as e:
            logger.error(f"Database connection error: {e}")
            raise
        finally:
            if conn:
                self.pool.putconn(conn)

    def _init_tables(self):
        with self.get_connection() as conn:
            with conn.cursor() as cursor:
                # جدول سجلات العجلة
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS lucky_wheel_logs (
                        id BIGSERIAL PRIMARY KEY,
                        user_id BIGINT NOT NULL,
                        reward_amount DECIMAL(20, 2) DEFAULT 0,
                        status VARCHAR(20) DEFAULT 'pending',
                        spin_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        claimed_at TIMESTAMP,
                        notes TEXT
                    )
                """)

                # جدول حدود الدوران
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS lucky_wheel_limits (
                        user_id BIGINT PRIMARY KEY,
                        last_spin_time TIMESTAMP,
                        spin_count INTEGER DEFAULT 0,
                        total_won DECIMAL(20, 2) DEFAULT 0,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)

                # جدول إعدادات العجلة
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS lucky_wheel_settings (
                        id INTEGER PRIMARY KEY CHECK (id = 1),
                        is_enabled BOOLEAN DEFAULT TRUE,
                        min_deposit DECIMAL(20, 2) DEFAULT 10000,
                        time_window_hours INTEGER DEFAULT 24,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)

                cursor.execute("SELECT 1 FROM lucky_wheel_settings WHERE id = 1")
                if not cursor.fetchone():
                    cursor.execute("""
                        INSERT INTO lucky_wheel_settings (id, is_enabled, min_deposit, time_window_hours)
                        VALUES (1, TRUE, 10000, 24)
                    """)

                cursor.execute("CREATE INDEX IF NOT EXISTS idx_wheel_logs_user ON lucky_wheel_logs(user_id)")
                cursor.execute("CREATE INDEX IF NOT EXISTS idx_wheel_logs_time ON lucky_wheel_logs(spin_time)")
                cursor.execute("CREATE INDEX IF NOT EXISTS idx_wheel_logs_status ON lucky_wheel_logs(status)")
                
                conn.commit()
                logger.info("✅ Lucky wheel tables created")

    def check_user_deposit(self, user_id: int) -> Dict[str, Any]:
        try:
            with self.get_connection() as conn:
                with conn.cursor() as cursor:
                    settings = self.get_settings()
                    min_deposit = settings.get("min_deposit", MIN_DEPOSIT_AMOUNT)
                    time_window = settings.get("time_window_hours", TIME_WINDOW_HOURS)
                    
                    cursor.execute("""
                        SELECT 
                            COUNT(*) as deposit_count,
                            COALESCE(SUM(amount_added_syp), 0) as total_amount
                        FROM external_deposits
                        WHERE user_id = %s
                            AND status = 'completed'
                            AND created_at >= NOW() - INTERVAL '%s HOURS'
                    """, (user_id, time_window))
                    
                    result = cursor.fetchone()
                    
                    if not result or result[0] == 0:
                        return {
                            "eligible": False,
                            "message": "❌ لم تقم بإيداع خلال آخر 24 ساعة",
                            "deposit_count": 0,
                            "total_amount": 0
                        }
                    
                    return {
                        "eligible": result[1] >= min_deposit,
                        "message": f"✅ تم إيداع {result[1]:,.0f} SYP خلال آخر 24 ساعة" if result[1] >= min_deposit else f"⚠️ المبلغ الإجمالي للإيداعات {result[1]:,.0f} SYP، الحد الأدنى المطلوب {min_deposit:,.0f} SYP",
                        "deposit_count": result[0],
                        "total_amount": result[1],
                        "min_required": min_deposit
                    }
        except Exception as e:
            logger.error(f"Error checking deposit: {e}")
            return {"eligible": False, "message": "❌ حدث خطأ في التحقق", "error": str(e)}

    def can_spin(self, user_id: int) -> Dict[str, Any]:
        try:
            with self.get_connection() as conn:
                with conn.cursor() as cursor:
                    settings = self.get_settings()
                    time_window = settings.get("time_window_hours", TIME_WINDOW_HOURS)
                    
                    cursor.execute("""
                        SELECT last_spin_time, spin_count 
                        FROM lucky_wheel_limits 
                        WHERE user_id = %s
                    """, (user_id,))
                    
                    result = cursor.fetchone()
                    
                    if not result:
                        return {"can_spin": True, "message": "✅ يمكنك الدوران الآن!", "last_spin": None}
                    
                    last_spin = result[0]
                    
                    if last_spin:
                        time_diff = datetime.now() - last_spin
                        if time_diff < timedelta(hours=time_window):
                            remaining = timedelta(hours=time_window) - time_diff
                            hours = int(remaining.total_seconds() // 3600)
                            minutes = int((remaining.total_seconds() % 3600) // 60)
                            return {
                                "can_spin": False,
                                "message": f"⏳ يمكنك الدوران بعد {hours} ساعة و {minutes} دقيقة",
                                "last_spin": last_spin.isoformat(),
                                "remaining": remaining.total_seconds()
                            }
                    
                    return {"can_spin": True, "message": "✅ يمكنك الدوران الآن!", "last_spin": last_spin.isoformat() if last_spin else None}
                    
        except Exception as e:
            logger.error(f"Error checking spin limit: {e}")
            return {"can_spin": False, "message": "❌ حدث خطأ في التحقق"}

    def record_spin(self, user_id: int, reward_amount: float) -> bool:
        try:
            with self.get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        INSERT INTO lucky_wheel_logs (user_id, reward_amount, status)
                        VALUES (%s, %s, 'pending')
                        RETURNING id
                    """, (user_id, reward_amount))
                    
                    log_id = cursor.fetchone()[0]
                    
                    cursor.execute("""
                        INSERT INTO lucky_wheel_limits (user_id, last_spin_time, spin_count)
                        VALUES (%s, CURRENT_TIMESTAMP, 1)
                        ON CONFLICT (user_id) DO UPDATE
                        SET last_spin_time = CURRENT_TIMESTAMP,
                            spin_count = lucky_wheel_limits.spin_count + 1,
                            updated_at = CURRENT_TIMESTAMP
                    """, (user_id,))
                    
                    conn.commit()
                    logger.info(f"✅ Spin recorded: user {user_id}, reward {reward_amount}, log_id {log_id}")
                    return True
                    
        except Exception as e:
            logger.error(f"Error recording spin: {e}")
            return False

    def claim_reward(self, user_id: int) -> Dict[str, Any]:
        try:
            with self.get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("""
                        UPDATE lucky_wheel_logs 
                        SET status = 'claimed', claimed_at = CURRENT_TIMESTAMP
                        WHERE user_id = %s AND status = 'pending'
                        ORDER BY spin_time DESC
                        LIMIT 1
                        RETURNING id, reward_amount
                    """, (user_id,))
                    
                    result = cursor.fetchone()
                    if not result:
                        return {"success": False, "message": "❌ لا يوجد سحب معلق"}
                    
                    log_id, amount = result
                    
                    cursor.execute("""
                        UPDATE lucky_wheel_limits 
                        SET total_won = total_won + %s,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE user_id = %s
                    """, (amount, user_id))
                    
                    conn.commit()
                    logger.info(f"✅ Reward claimed: user {user_id}, amount {amount}, log_id {log_id}")
                    
                    return {
                        "success": True,
                        "message": f"✅ تم صرف {amount:,.0f} SYP",
                        "amount": amount,
                        "log_id": log_id
                    }
                    
        except Exception as e:
            logger.error(f"Error claiming reward: {e}")
            return {"success": False, "message": f"❌ حدث خطأ: {str(e)}"}

    def get_user_spins(self, user_id: int, limit: int = 20) -> List[Dict]:
        try:
            with self.get_connection() as conn:
                with conn.cursor(cursor_factory=extras.RealDictCursor) as cursor:
                    cursor.execute("""
                        SELECT id, reward_amount, status, spin_time, claimed_at
                        FROM lucky_wheel_logs
                        WHERE user_id = %s
                        ORDER BY spin_time DESC
                        LIMIT %s
                    """, (user_id, limit))
                    return cursor.fetchall()
        except Exception as e:
            logger.error(f"Error getting user spins: {e}")
            return []

    def get_settings(self) -> Dict[str, Any]:
        try:
            with self.get_connection() as conn:
                with conn.cursor(cursor_factory=extras.RealDictCursor) as cursor:
                    cursor.execute("SELECT * FROM lucky_wheel_settings WHERE id = 1")
                    return cursor.fetchone() or {
                        "is_enabled": True,
                        "min_deposit": MIN_DEPOSIT_AMOUNT,
                        "time_window_hours": TIME_WINDOW_HOURS
                    }
        except Exception as e:
            logger.error(f"Error getting settings: {e}")
            return {"is_enabled": True, "min_deposit": MIN_DEPOSIT_AMOUNT, "time_window_hours": TIME_WINDOW_HOURS}

    def update_settings(self, **kwargs) -> bool:
        try:
            with self.get_connection() as conn:
                with conn.cursor() as cursor:
                    updates = []
                    params = []
                    
                    for key, value in kwargs.items():
                        updates.append(f"{key} = %s")
                        params.append(value)
                    
                    if not updates:
                        return False
                    
                    params.append(1)
                    cursor.execute(f"""
                        UPDATE lucky_wheel_settings 
                        SET {', '.join(updates)}, updated_at = CURRENT_TIMESTAMP
                        WHERE id = %s
                    """, params)
                    
                    conn.commit()
                    logger.info(f"✅ Settings updated: {kwargs}")
                    return True
        except Exception as e:
            logger.error(f"Error updating settings: {e}")
            return False

    def get_stats(self) -> Dict[str, Any]:
        try:
            with self.get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("SELECT COUNT(*) as total_spins FROM lucky_wheel_logs")
                    total_spins = cursor.fetchone()[0]
                    
                    cursor.execute("SELECT COALESCE(SUM(reward_amount), 0) as total_won FROM lucky_wheel_logs WHERE status = 'claimed'")
                    total_won = cursor.fetchone()[0]
                    
                    cursor.execute("SELECT COUNT(DISTINCT user_id) as total_users FROM lucky_wheel_logs")
                    total_users = cursor.fetchone()[0]
                    
                    cursor.execute("SELECT COALESCE(MAX(reward_amount), 0) as max_win FROM lucky_wheel_logs WHERE status = 'claimed'")
                    max_win = cursor.fetchone()[0]
                    
                    return {
                        "total_spins": total_spins,
                        "total_won": total_won,
                        "total_users": total_users,
                        "max_win": max_win
                    }
        except Exception as e:
            logger.error(f"Error getting stats: {e}")
            return {"total_spins": 0, "total_won": 0, "total_users": 0, "max_win": 0}


# ==================== FastAPI Application ====================
app = FastAPI(
    title="🎡 Lucky Wheel API",
    description="عجلة الحظ - نظام الجوائز اليومي",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

db = DatabaseManager(POSTGRESQL_URL)

# ==================== Pydantic Models ====================
class SpinRequest(BaseModel):
    user_id: int

class SpinResponse(BaseModel):
    success: bool
    message: str
    reward: Optional[float] = None
    reward_index: Optional[int] = None
    can_spin: bool = False
    deposit_check: Optional[Dict] = None
    spin_check: Optional[Dict] = None

class ClaimRequest(BaseModel):
    user_id: int

class AdminSettings(BaseModel):
    is_enabled: Optional[bool] = None
    min_deposit: Optional[float] = None
    time_window_hours: Optional[int] = None

# ==================== API Endpoints ====================

@app.get("/")
async def root():
    return FileResponse("static/index.html")

@app.get("/api/rewards")
async def get_rewards():
    return {
        "success": True,
        "rewards": WHEEL_REWARDS,
        "settings": db.get_settings()
    }

@app.post("/api/spin")
async def spin_wheel(request: SpinRequest):
    user_id = request.user_id
    
    if user_id <= 0:
        return SpinResponse(
            success=False,
            message="❌ معرف مستخدم غير صالح",
            reward=0,
            can_spin=False
        )
    
    settings = db.get_settings()
    if not settings.get("is_enabled", True):
        return SpinResponse(
            success=False,
            message="⛔ عجلة الحظ معطلة حالياً",
            reward=0,
            can_spin=False
        )
    
    deposit_check = db.check_user_deposit(user_id)
    if not deposit_check.get("eligible", False):
        return SpinResponse(
            success=False,
            message=deposit_check.get("message", "غير مؤهل للدوران"),
            reward=0,
            can_spin=False,
            deposit_check=deposit_check
        )
    
    spin_check = db.can_spin(user_id)
    if not spin_check.get("can_spin", False):
        return SpinResponse(
            success=False,
            message=spin_check.get("message", "لا يمكن الدوران حالياً"),
            reward=0,
            can_spin=False,
            deposit_check=deposit_check,
            spin_check=spin_check
        )
    
    reward_index = random.randint(0, len(WHEEL_REWARDS) - 1)
    reward = WHEEL_REWARDS[reward_index]
    
    success = db.record_spin(user_id, reward["value"])
    
    if not success:
        return SpinResponse(
            success=False,
            message="❌ حدث خطأ في تسجيل الدوران",
            reward=0,
            can_spin=False
        )
    
    return SpinResponse(
        success=True,
        message="🎉 تم الدوران بنجاح!",
        reward=reward["value"],
        reward_index=reward_index,
        can_spin=False,
        deposit_check=deposit_check,
        spin_check=spin_check
    )

@app.post("/api/claim")
async def claim_reward(request: ClaimRequest):
    user_id = request.user_id
    
    if user_id <= 0:
        return {"success": False, "message": "❌ معرف مستخدم غير صالح"}
    
    result = db.claim_reward(user_id)
    return result

@app.get("/api/history/{user_id}")
async def get_history(user_id: int):
    if user_id <= 0:
        return {"success": False, "message": "❌ معرف مستخدم غير صالح", "spins": []}
    
    spins = db.get_user_spins(user_id)
    return {
        "success": True,
        "spins": spins
    }

@app.get("/api/status/{user_id}")
async def get_status(user_id: int):
    if user_id <= 0:
        return {
            "success": False,
            "message": "❌ معرف مستخدم غير صالح"
        }
    
    deposit_check = db.check_user_deposit(user_id)
    spin_check = db.can_spin(user_id)
    spins = db.get_user_spins(user_id, 5)
    stats = db.get_stats()
    
    return {
        "success": True,
        "deposit_check": deposit_check,
        "spin_check": spin_check,
        "recent_spins": spins,
        "settings": db.get_settings(),
        "stats": stats
    }

@app.post("/api/admin/settings")
async def update_settings(settings: AdminSettings):
    updates = {}
    
    if settings.is_enabled is not None:
        updates["is_enabled"] = settings.is_enabled
    if settings.min_deposit is not None and settings.min_deposit > 0:
        updates["min_deposit"] = settings.min_deposit
    if settings.time_window_hours is not None and settings.time_window_hours > 0:
        updates["time_window_hours"] = settings.time_window_hours
    
    if not updates:
        return {"success": False, "message": "❌ لا توجد تحديثات"}
    
    success = db.update_settings(**updates)
    
    return {
        "success": success,
        "message": "✅ تم تحديث الإعدادات" if success else "❌ فشل التحديث"
    }

@app.get("/api/admin/stats")
async def get_admin_stats():
    stats = db.get_stats()
    settings = db.get_settings()
    
    return {
        "success": True,
        "stats": stats,
        "settings": settings
    }

# ==================== تشغيل الخادم ====================
if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    os.makedirs("static", exist_ok=True)
    logger.info(f"🚀 Starting Lucky Wheel Server on port {port}")
    uvicorn.run(app, host="0.0.0.0", port=port)
