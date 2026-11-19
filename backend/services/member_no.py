"""REQ-187: member № = booking's place within its project (1, 2, 3 … in booking order), display only.
Fixed once given, never reused (max + 1), cancelled bookings keep theirs. No money / numbering / booking rule involved."""

from db import db


async def ensure_member_nos(project_ids: set) -> None:
    """3I: numbers come from an atomic per-project counter that starts above the current max (two screens or bookings
    at the same moment can no longer hand out the same №). Existing numbers are never renumbered."""
    from pymongo.errors import DuplicateKeyError

    for pid in {p for p in project_ids if p}:
        if not await db.bookings.count_documents({"project_id": pid, "member_no": {"$exists": False}}, limit=1):
            continue
        top = await db.bookings.find_one(
            {"project_id": pid, "member_no": {"$exists": True}}, {"member_no": 1}, sort=[("member_no", -1)]
        )
        key = {"scope": "member_no", "key": pid}
        await db.counters.update_one(key, {"$max": {"seq": (top or {}).get("member_no") or 0}}, upsert=True)
        async for b in db.bookings.find({"project_id": pid, "member_no": {"$exists": False}}, {"_id": 0, "id": 1}).sort(
            [("booking_date", 1), ("created_at", 1), ("booking_number", 1)]
        ):
            n = (await db.counters.find_one_and_update(key, {"$inc": {"seq": 1}}, return_document=True))["seq"]
            try:
                await db.bookings.update_one({"id": b["id"], "member_no": {"$exists": False}}, {"$set": {"member_no": n}})
            except DuplicateKeyError:  # a number given before the counter existed: the next one is free
                continue


async def record_check() -> dict:
    """Startup + nightly: System Health "Member numbers" — duplicates listed for the owner, nothing renumbered."""
    from utils import now_iso

    rows = await duplicates()
    res = {"name": "member_numbers", "duplicates": len(rows), "rows": rows, "checked_at": now_iso()}
    await db.system_checks.update_one({"name": "member_numbers"}, {"$set": res}, upsert=True)
    return res


async def duplicates() -> list[dict]:
    """Existing (project, member №) pairs held by more than one booking — shown on System Health, never renumbered."""
    rows = await db.bookings.aggregate(
        [
            {"$match": {"member_no": {"$type": "number"}}},
            {
                "$group": {
                    "_id": {"p": "$project_id", "m": "$member_no"},
                    "n": {"$sum": 1},
                    "bookings": {"$push": "$booking_number"},
                }
            },
            {"$match": {"n": {"$gt": 1}}},
            {"$sort": {"_id.p": 1, "_id.m": 1}},
            {"$limit": 200},
        ]
    ).to_list(None)
    names = {
        p["id"]: p.get("name")
        async for p in db.projects.find({"id": {"$in": [r["_id"]["p"] for r in rows]}}, {"_id": 0, "id": 1, "name": 1})
    }
    return [
        {"project": names.get(r["_id"]["p"], r["_id"]["p"]), "member_no": r["_id"]["m"], "bookings": r["bookings"]}
        for r in rows
    ]


async def project_units(project_ids: set) -> dict:
    return {
        p["id"]: ((p.get("unit_counts") or {}).get("total") or 0)
        async for p in db.projects.find({"id": {"$in": list(project_ids)}}, {"_id": 0, "id": 1, "unit_counts.total": 1})
    }
