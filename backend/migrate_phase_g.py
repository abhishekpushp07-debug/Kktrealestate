"""Phase G migration: close demands on cancelled bookings (definition: cancelled bookings carry no live demands), mark legacy
cancellations' refund payable as `legacy` refund records (Pending, so Accounts can settle them), and backfill outbox fields.
Idempotent. `dry_run=True` only reports. Report saved by the caller to /app/memory/qa/journey/migrations/."""
from db import db
from utils import new_id, now_iso


async def migrate_phase_g(dry_run: bool = False, actor: dict | None = None) -> dict:
    who = actor or {"id": "system", "name": "Phase G migration"}
    cancelled = await db.bookings.find({"status": "Cancelled"}, {"_id": 0, "id": 1, "booking_number": 1, "company_id": 1, "customer_id": 1, "customer_name": 1, "project_id": 1, "project_code": 1, "block_id": 1, "flat_id": 1, "cancellation": 1, "summary": 1}).to_list(None)
    ids = [b["id"] for b in cancelled]
    open_q = {"booking_id": {"$in": ids}, "voided": {"$ne": True}, "status": {"$in": ["Open", "Partially Paid"]}}
    stale = await db.demands.find(open_q, {"_id": 0, "id": 1, "booking_id": 1, "demand_number": 1, "status": 1, "total_demand_paise": 1, "paid_paise": 1}).to_list(None)
    rep = {"at": now_iso(), "dry_run": dry_run, "cancelled_bookings": len(cancelled), "demands_to_close": len(stale), "demands_amount_paise": sum(d["total_demand_paise"] - (d.get("paid_paise") or 0) for d in stale),
           "by_booking": {}, "legacy_refunds": [], "outbox_backfilled": 0}
    for d in stale:
        rep["by_booking"].setdefault(d["booking_id"], []).append(d["demand_number"])
    for b in cancelled:
        c = b.get("cancellation") or {}
        if (c.get("refund_paise") or 0) > 0 and not await db.refunds.find_one({"booking_id": b["id"]}, {"_id": 1}):
            rep["legacy_refunds"].append({"booking_number": b["booking_number"], "refund_paise": c["refund_paise"]})
    rep["outbox_backfilled"] = await db.audit_logs.count_documents({"propagated_complete": {"$exists": False}})
    if dry_run:
        return rep
    ts = now_iso()
    for bid, nums in rep["by_booking"].items():
        await db.demands.update_many({"booking_id": bid, "voided": {"$ne": True}, "status": {"$in": ["Open", "Partially Paid"]}}, {"$set": {"status": "Cancelled", "closed_at": ts, "closed_reason": "Phase G migration: booking cancelled"}})
        from utils import write_audit
        await write_audit({**who, "company_id": next(b["company_id"] for b in cancelled if b["id"] == bid)}, "demand.close", "booking", bid, after={"demands": nums, "reason": "Booking cancelled (migration)"})
    for b in cancelled:
        c = b.get("cancellation") or {}
        if (c.get("refund_paise") or 0) > 0 and not await db.refunds.find_one({"booking_id": b["id"]}, {"_id": 1}):
            s = b.get("summary") or {}
            await db.refunds.insert_one({"id": new_id(), "company_id": b["company_id"], "refund_number": f"RF-LEGACY-{b['booking_number'].split('-')[-1]}", "booking_id": b["id"], "booking_number": b["booking_number"], "customer_id": b["customer_id"], "customer_name": b["customer_name"],
                                         "project_id": b["project_id"], "project_code": b.get("project_code"), "block_id": b["block_id"], "flat_id": b["flat_id"], "amount_paise": c["refund_paise"], "split": {"Cash": min(s.get("cash_paid_paise", 0), c["refund_paise"]), "Account": max(0, c["refund_paise"] - min(s.get("cash_paid_paise", 0), c["refund_paise"])), "Other": 0},
                                         "deduction_paise": c.get("deduction_paise", 0), "received_paise": s.get("paid_paise", 0), "status": "Pending", "legacy": True, "due_by": None, "created_at": ts, "created_by": who["id"], "paid_at": None, "paid_date": None, "mode": None, "version": 1})
    await db.audit_logs.raw("phase G migration").update_many({"propagated_complete": {"$exists": False}}, {"$set": {"propagated_complete": True, "propagated": {"legacy": ts}}})
    from services.ledger import rebuild
    for bid in rep["by_booking"]:
        await rebuild(bid)
    from services.read_models import recompute_all
    await recompute_all()
    await db.settings.update_one({"key": "migration_phase_g"}, {"$set": {"value": ts, "report": {k: v for k, v in rep.items() if k != "by_booking"}}}, upsert=True)
    return rep
