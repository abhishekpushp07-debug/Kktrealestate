"""Audit retention: rows older than the configured hot window move (never delete) from audit_logs to audit_logs_archive, same schema."""
from datetime import timedelta

from db import db
from services import clock
from utils import now_iso

DEFAULT_RETENTION_MONTHS = 24


async def retention_months() -> int:
    c = await db.companies.find_one({}, {"_id": 0, "audit_retention_months": 1})
    return int((c or {}).get("audit_retention_months") or DEFAULT_RETENTION_MONTHS)


async def ensure_indexes():
    for coll in (db.audit_logs, db.audit_logs_archive):
        await coll.create_index("id", unique=True)
        await coll.create_index([("company_id", 1), ("created_at", -1)])
        await coll.create_index([("entity_type", 1), ("entity_id", 1), ("created_at", -1)])
        await coll.create_index([("actor_id", 1), ("created_at", -1)])
        await coll.create_index("action")


async def archive_old_rows(months: int | None = None, batch: int = 1000) -> dict:
    """Idempotent: copy rows with created_at < cutoff into the archive (upsert by id), then remove them from the hot collection only after the copy is confirmed."""
    await ensure_indexes()
    months = months or await retention_months()
    cutoff = (clock.today() - timedelta(days=30 * months)).isoformat()
    moved = 0
    while True:
        rows = await db.audit_logs.find({"created_at": {"$lt": cutoff}}, {"_id": 0}).sort("created_at", 1).limit(batch).to_list(batch)
        if not rows:
            break
        for r in rows:
            await db.audit_logs_archive.replace_one({"id": r["id"]}, {**r, "archived_at": now_iso()}, upsert=True)
        ids = [r["id"] for r in rows]
        confirmed = await db.audit_logs_archive.count_documents({"id": {"$in": ids}})
        if confirmed != len(ids):
            break
        res = await db.audit_logs.delete_many({"id": {"$in": ids}})
        moved += res.deleted_count
    await db.settings.update_one({"key": "audit_archive_last_run"}, {"$set": {"value": {"at": now_iso(), "cutoff": cutoff, "moved": moved, "months": months}}}, upsert=True)
    return {"cutoff": cutoff, "moved": moved, "months": months, "hot": await db.audit_logs.count_documents({}), "archived": await db.audit_logs_archive.count_documents({})}
