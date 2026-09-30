from app.db.database import SessionLocal
from sqlalchemy import text

db = SessionLocal()
res = db.execute(text("SELECT id, operation, model, status, error_type, latency_ms FROM ai_usage_events ORDER BY created_at DESC LIMIT 5")).fetchall()
print('LATEST AI USAGE EVENT:', res)
