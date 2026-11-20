"""REQ-187: member № = booking's place within its project (1, 2, 3 … in booking order), display only.
Fixed once given, never reused (max + 1), cancelled bookings keep theirs. No money / numbering / booking rule involved."""

from db import db


async def ensure_member_nos(project_ids: set) -> None:
    for pid in {p for p in project_ids if p}:
        if not await db.bookings.count_documents({"project_id": pid, "member_no": {"$exists": False}}, limit=1):
            continue
        top = await db.bookings.find_one(
            {"project_id": pid, "member_no": {"$exists": True}}, {"member_no": 1}, sort=[("member_no", -1)]
        )
        n = (top or {}).get("member_no") or 0
        async for b in db.bookings.find({"project_id": pid, "member_no": {"$exists": False}}, {"_id": 0, "id": 1}).sort(
            [("booking_date", 1), ("created_at", 1), ("booking_number", 1)]
        ):
            n += 1
            await db.bookings.update_one({"id": b["id"], "member_no": {"$exists": False}}, {"$set": {"member_no": n}})


async def project_units(project_ids: set) -> dict:
    return {
        p["id"]: ((p.get("unit_counts") or {}).get("total") or 0)
        async for p in db.projects.find({"id": {"$in": list(project_ids)}}, {"_id": 0, "id": 1, "unit_counts.total": 1})
    }
