"""Phase N story data (idempotent): in one SGH tower ~40% flats Landowner share, 6 active holds (2 expiring soon), 1 expired+released in history,
3 blocked (legal), 8 "Show as Sold" overrides on Available flats. Run: python tools/story_inventory.py"""
import asyncio
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))


async def main():
    from db import db
    from services import inventory as inv
    from utils import now_iso, write_audit
    proj = await db.projects.find_one({"name": {"$regex": "Shree Ganesh"}}, {"_id": 0, "id": 1, "company_id": 1})
    block = await db.blocks.find_one({"project_id": proj["id"], "is_active": True, "code": "C"}, {"_id": 0, "id": 1, "name": 1})  # Tower C: most open units
    await inv.ensure_masters(proj["company_id"])
    await inv.backfill(proj["company_id"])
    if await db.settings.find_one({"key": "story_inventory_v1"}):
        print("story inventory already applied"); return
    lo = await db.allocation_categories.find_one({"company_id": proj["company_id"], "code": "LANDOWNER"}, {"_id": 0})
    reason = await db.hold_reasons.find_one({"company_id": proj["company_id"], "code": "INTEREST"}, {"_id": 0})
    admin = await db.users.find_one({"email": "admin@kkt.in"}, {"_id": 0}) or {"id": None, "company_id": proj["company_id"], "full_name": "Story seed"}
    sales = await db.users.find_one({"role_names": "Sales"}, {"_id": 0, "id": 1}) or admin
    flats = await db.flats.find({"block_id": block["id"], "is_active": True}, {"_id": 0}).sort("flat_number", 1).to_list(None)
    avail = [f for f in flats if f["status"] == "Available"]
    now = datetime.now(timezone.utc)
    n_lo = min(round(len(flats) * 0.4), max(0, len(avail) - 18))  # booked/sold units cannot become landowner share; keep 18 open units for holds/blocks/masks
    lo_ids = [f["id"] for f in avail][:n_lo]
    await db.flats.update_many({"id": {"$in": lo_ids}}, {"$set": {"allocation_category_id": lo["id"], "allocation_category_code": "LANDOWNER", "bookable": False, "updated_at": now_iso()}, "$inc": {"version": 1}})
    for fid in lo_ids:
        await write_audit(admin, "flat.category_changed", "flat", fid, after={"allocation_category_code": "LANDOWNER", "reason": "Landowner share per JDA"})
    rest = [f for f in avail if f["id"] not in set(lo_ids)]
    cust = await db.customers.find({"is_active": True}, {"_id": 0, "id": 1}).limit(6).to_list(6)
    holds, blocked, masked = rest[:6], rest[6:9], rest[9:17]
    for i, f in enumerate(holds):
        exp = (now + timedelta(hours=20 if i < 2 else 24 * (3 + i))).isoformat()
        h = {"reason_id": reason["id"], "for_customer_id": cust[i % len(cust)]["id"] if cust else None, "for_user_id": sales["id"], "note": "Story: customer interest", "expires_at": exp, "created_by": admin["id"], "created_at": now_iso()}
        await db.flats.update_one({"id": f["id"]}, {"$set": {"status": "Hold", "hold": h, "status_changed_at": now_iso(), "status_changed_by": admin["id"], "status_reason": "Customer interest"}, "$inc": {"version": 1}})
        await write_audit(admin, "flat.held", "flat", f["id"], after={"status": "Hold", "hold": h, "flat_number": f["flat_number"]})
    for f in blocked:
        b = {"reason": "Legal/documentation", "note": "Story: title clearance pending", "created_by": admin["id"], "created_at": now_iso()}
        await db.flats.update_one({"id": f["id"]}, {"$set": {"status": "Blocked", "block": b, "status_changed_at": now_iso(), "status_changed_by": admin["id"], "status_reason": "Legal"}, "$inc": {"version": 1}})
        await write_audit(admin, "flat.blocked", "flat", f["id"], after={"status": "Blocked", "block": b, "flat_number": f["flat_number"]})
    for f in masked:
        await db.flats.update_one({"id": f["id"]}, {"$set": {"display_state": "Show as Sold", "display_override": True, "display_set_by": admin["id"], "display_set_at": now_iso(), "display_reason": "Management: hold back from market"}, "$inc": {"version": 1}})
        await write_audit(admin, "flat.display_changed", "flat", f["id"], after={"display_state": "Show as Sold", "display_override": True, "reason": "Management: hold back from market", "flat_number": f["flat_number"]})
    # one expired-and-released hold in history (flat is Available now)
    hist = rest[17] if len(rest) > 17 else rest[-1]
    old = {"reason_id": reason["id"], "for_user_id": sales["id"], "expires_at": (now - timedelta(days=2)).isoformat(), "created_by": admin["id"], "created_at": (now - timedelta(days=9)).isoformat()}
    await write_audit(admin, "flat.held", "flat", hist["id"], after={"status": "Hold", "hold": old, "flat_number": hist["flat_number"]})
    await write_audit({"id": None, "company_id": proj["company_id"], "full_name": "Hold expiry sweep"}, "flat.hold_expired", "flat", hist["id"], before={"status": "Hold", "hold": old}, after={"status": "Available", "flat_number": hist["flat_number"]})
    await db.settings.update_one({"key": "story_inventory_v1"}, {"$set": {"value": {"block_id": block["id"], "landowner": len(lo_ids), "holds": len(holds), "blocked": len(blocked), "masked": len(masked), "applied_at": now_iso(), "id": str(uuid.uuid4())}}}, upsert=True)
    print({"tower": block["name"], "flats": len(flats), "landowner": len(lo_ids), "holds": len(holds), "blocked": len(blocked), "masked": len(masked)})

asyncio.run(main())
