import os
import psycopg2
from flask import Flask, jsonify
from datetime import datetime

app = Flask(__name__)

# رابط قاعدة البيانات من متغيرات البيئة
DATABASE_URL = os.environ.get('DATABASE_URL')

@app.route('/')
def home():
    """الصفحة الرئيسية - عرض حالة الخادم"""
    return jsonify({
        "status": "running",
        "service": "PostgreSQL Connection Server",
        "timestamp": datetime.now().isoformat(),
        "database_configured": bool(DATABASE_URL)
    })

@app.route('/test-db')
def test_db():
    """اختبار الاتصال بقاعدة البيانات"""
    if not DATABASE_URL:
        return jsonify({
            "success": False,
            "error": "DATABASE_URL not configured"
        }), 500
    
    try:
        # محاولة الاتصال بقاعدة البيانات
        conn = psycopg2.connect(DATABASE_URL)
        cursor = conn.cursor()
        
        # تنفيذ استعلام بسيط
        cursor.execute("SELECT NOW()")
        result = cursor.fetchone()
        
        cursor.close()
        conn.close()
        
        return jsonify({
            "success": True,
            "message": "✅ Connected to PostgreSQL successfully!",
            "server_time": result[0].isoformat(),
            "database_url": DATABASE_URL.replace(
                DATABASE_URL.split('@')[0].split(':')[0] + ':' + DATABASE_URL.split('@')[0].split(':')[1],
                '********'
            )  # إخفاء كلمة المرور في العرض
        })
        
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500

@app.route('/db-info')
def db_info():
    """عرض معلومات عن قاعدة البيانات"""
    if not DATABASE_URL:
        return jsonify({
            "success": False,
            "error": "DATABASE_URL not configured"
        }), 500
    
    try:
        conn = psycopg2.connect(DATABASE_URL)
        cursor = conn.cursor()
        
        # جلب معلومات الإصدار
        cursor.execute("SELECT version()")
        version = cursor.fetchone()[0]
        
        # جلب قائمة الجداول (إذا كانت موجودة)
        cursor.execute("""
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
            ORDER BY table_name
        """)
        tables = [row[0] for row in cursor.fetchall()]
        
        # جلب عدد السجلات في كل جدول (اختياري)
        table_stats = {}
        for table in tables:
            cursor.execute(f"SELECT COUNT(*) FROM {table}")
            count = cursor.fetchone()[0]
            table_stats[table] = count
        
        cursor.close()
        conn.close()
        
        return jsonify({
            "success": True,
            "database": {
                "version": version,
                "tables": tables,
                "table_stats": table_stats,
                "total_tables": len(tables)
            }
        })
        
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500

if __name__ == '__main__':
    # تشغيل الخادم على المنفذ الذي يوفره Render
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port)
