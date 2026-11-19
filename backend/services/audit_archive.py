"""Audit retention: rows older than the configured hot window move (never delete) from audit_logs to audit_logs_archive, same schema."""

from datetime import timedelta

from db import db
from services import clock
from services.immutable import GuardedCollection
from utils import now_iso

DEFAULT_RETENTION_MONTHS = 24


async def retention_months() -> int:
    c = await db.companies.find_one({}, {"_id": 0, "audit_retention_months": 1})
    return int((c or {}).get("audit_retention_months") or DEFAULT_RETENTION_MONTHS)


async def ensure_indexes():
    """Hot indexes already exist (db.ensure_indexes); the archive mirrors them by name so lookups cost the same on both collections."""
    coll = db.audit_logs_archive
    await coll.create_index("id", unique=True)
    await coll.create_index([("entity_type", 1), ("entity_id", 1), ("created_at", -1)], name="audit_entity_created")
    await coll.create_index([("company_id", 1), ("created_at", -1)])
    await coll.create_index([("created_at", -1)])
    await coll.create_index("actor_id")
    await coll.create_index("action")


async def _move(name: str, cutoff: str, batch: int, extra: dict | None = None) -> int:
    """Copy rows older than the cutoff into <name>_archive (upsert by id), then remove them from the hot collection
    only after the copy is confirmed — rows move, never get deleted."""
    src, dst = db[name], db[f"{name}_archive"]
    await dst.create_index("id", unique=True)
    await dst.create_index([("created_at", -1)])
    q = {"created_at": {"$lt": cutoff}, **(extra or {})}
    moved = 0
    while True:
        rows = await src.find(q, {"_id": 0}).sort("created_at", 1).limit(batch).to_list(batch)
        if not rows:
            break
        for r in rows:
            await dst.replace_one({"id": r["id"]}, {**r, "archived_at": now_iso()}, upsert=True)
        ids = [r["id"] for r in rows]
        if await dst.count_documents({"id": {"$in": ids}}) != len(ids):
            break
        hot = src.raw("archive to cold storage") if isinstance(src, GuardedCollection) else src
        moved += (await hot.delete_many({"id": {"$in": ids}})).deleted_count
    return moved


async def archive_old_rows(months: int | None = None, batch: int = 1000) -> dict:
    """Idempotent monthly move (M-06 / REQ-381): the activity log, login records and read notifications older than
    the retention window move to their *_archive twins."""
    await ensure_indexes()
    months = months or await retention_months()
    cutoff = (clock.today() - timedelta(days=30 * months)).isoformat()
    moved = await _move("audit_logs", cutoff, batch)
    logins = await _move("login_events", cutoff, batch)
    notes = await _move("notifications", cutoff, batch, {"read": True})  # an unread note stays where it is seen
    await db.settings.update_one(
        {"key": "audit_archive_last_run"},
        {
            "$set": {
                "value": {
                    "at": now_iso(),
                    "cutoff": cutoff,
                    "moved": moved,
                    "logins_moved": logins,
                    "notifications_moved": notes,
                    "months": months,
                }
            }
        },
        upsert=True,
    )
    return {
        "cutoff": cutoff,
        "moved": moved,
        "logins_moved": logins,
        "notifications_moved": notes,
        "months": months,
        "hot": await db.audit_logs.count_documents({}),
        "archived": await db.audit_logs_archive.count_documents({}),
    }
