"""Phase 1 F-4: one-time paid_parts backfill — rebuild every booking's ledger so each demand carries paid_parts / paid_detail.
A rebuild that would change a booking's outstanding or advance is rolled back and listed instead (REQ-23)."""

from db import db
from services.ledger import rebuild
from utils import now_iso

DEMAND_KEYS = ("status", "paid_paise", "paid_parts")
MONEY_KEYS = ("outstanding_paise", "advance_paise")


async def _restore(bid: str, booking: dict, demands: list[dict], ledger: list[dict]):
    await db.bookings.update_one({"id": bid}, {"$set": {k: booking.get(k) for k in ("summary", "other_charges")}})
    for d in demands:
        await db.demands.update_one({"id": d["id"]}, {"$set": {k: d.get(k) for k in DEMAND_KEYS}})
    await db.ledger_entries.raw("paid_parts backfill rollback").delete_many({"booking_id": bid})
    if ledger:
        await db.ledger_entries.insert_many(ledger)


async def backfill_paid_parts() -> dict:
    """Idempotent: second run reports changed = 0. Returns counts + skipped bookings."""
    before_missing = await db.demands.count_documents({"paid_parts": {"$exists": False}})
    out = {
        "at": now_iso(),
        "bookings": 0,
        "changed": 0,
        "demands_changed": 0,
        "skipped": [],
        "missing_before": before_missing,
    }
    async for b in db.bookings.find({}, {"_id": 0, "id": 1, "booking_number": 1, "summary": 1, "other_charges": 1}):
        bid, s0 = b["id"], b.get("summary") or {}
        dem0 = await db.demands.find({"booking_id": bid}, {"_id": 0, "id": 1, **dict.fromkeys(DEMAND_KEYS, 1)}).to_list(
            None
        )
        led0 = await db.ledger_entries.find({"booking_id": bid}, {"_id": 0}).to_list(None)
        await rebuild(bid)
        out["bookings"] += 1
        s1 = (await db.bookings.find_one({"id": bid}, {"_id": 0, "summary": 1}) or {}).get("summary") or {}
        if any(s0.get(k, 0) != s1.get(k, 0) for k in MONEY_KEYS):
            await _restore(bid, b, dem0, led0)
            out["skipped"].append(
                {"booking_number": b.get("booking_number"), **{k: [s0.get(k), s1.get(k)] for k in MONEY_KEYS}}
            )
            continue
        dem1 = {
            d["id"]: d
            for d in await db.demands.find(
                {"booking_id": bid}, {"_id": 0, "id": 1, **dict.fromkeys(DEMAND_KEYS, 1)}
            ).to_list(None)
        }
        n = sum(1 for d in dem0 if any(d.get(k) != dem1.get(d["id"], {}).get(k) for k in DEMAND_KEYS))
        if n:
            out["changed"] += 1
            out["demands_changed"] += n
    zero = dict.fromkeys(("cash_paid_paise", "cash_open_paise", "account_paid_paise", "account_open_paise"), 0)
    voided = await db.demands.update_many(
        {"voided": True, "paid_parts": {"$exists": False}}, {"$set": {"paid_parts": zero}}
    )
    out["voided_filled"] = voided.modified_count  # voided bills sit outside the ledger: nothing paid, nothing open
    out["missing_after"] = await db.demands.count_documents({"paid_parts": {"$exists": False}})
    await db.migrations.update_one({"step": "backfill_paid_parts"}, {"$set": {"last_report": out}}, upsert=True)
    return out
