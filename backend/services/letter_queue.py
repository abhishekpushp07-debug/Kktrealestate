"""M-09 (REQ-380): auto demand letters queued after a save survive a server stop. A marker row is written inside the
save; the after-commit task marks it done; the outbox sweep re-runs markers left undone for over a minute."""

from datetime import UTC, datetime, timedelta

from db import db
from utils import now_iso


async def mark(booking_id: str, demand_ids: list[str], actor: dict):
    await db.letter_queue.insert_one(
        {
            "booking_id": booking_id,
            "demand_ids": demand_ids,
            "actor": {k: actor.get(k) for k in ("id", "name", "company_id", "role", "project_scope")},
            "created_at": now_iso(),
            "done_at": None,
        }
    )


async def run(booking_id: str, demand_ids: list[str], actor: dict, auto_register):
    out = await auto_register(booking_id, ["demand"], actor, demand_ids=demand_ids)
    await db.letter_queue.update_many(
        {"booking_id": booking_id, "demand_ids": {"$in": demand_ids}, "done_at": None}, {"$set": {"done_at": now_iso()}}
    )
    return out


async def reconcile(auto_register, max_age_s: int = 60, limit: int = 50) -> int:
    cutoff = (datetime.now(UTC) - timedelta(seconds=max_age_s)).isoformat()
    rows = await db.letter_queue.find({"done_at": None, "created_at": {"$lt": cutoff}}).limit(limit).to_list(None)
    for r in rows:
        have = set(
            await db.generated_documents.distinct(
                "params.demand_ids", {"type": "demand", "booking_id": r["booking_id"]}
            )
        )
        todo = [i for i in r["demand_ids"] if i not in have]
        if todo:
            await auto_register(r["booking_id"], ["demand"], r["actor"], demand_ids=todo)
        await db.letter_queue.update_one({"_id": r["_id"]}, {"$set": {"done_at": now_iso(), "replayed": bool(todo)}})
    return len(rows)
