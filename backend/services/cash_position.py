"""Cash-in-hand position (leaf service: no routers imports)."""

from datetime import date as Date
from datetime import timedelta

from db import db
from services import clock

# REQ-227: an undone opening (and its reversing record) never anchors the cash book
LIVE_OPENING = {"reversed_at": None, "reverses_id": None}


async def _cash_refunds(company_id: str, q: dict) -> int:
    r = await db.refunds.aggregate(
        [
            {"$match": {"company_id": company_id, "status": "Paid", "mode": "CASH", "parent_refund_id": None, **q}},
            {"$group": {"_id": None, "s": {"$sum": {"$ifNull": ["$amount_total_paise", "$amount_paise"]}}}},
        ]
    ).to_list(1)
    return r[0]["s"] if r else 0


async def _cash_in_hand_before(company_id: str, day: Date, scope: dict) -> int:
    """Opening cash = latest opening-balance entry on/before the day + cash receipts − deposits + withdrawals − cash refunds since that entry."""
    before = day.isoformat()
    ob = await db.cash_openings.find_one(
        {"company_id": company_id, "date": {"$lte": before}, **LIVE_OPENING}, {"_id": 0}, sort=[("date", -1)]
    )
    lo = {"$gte": ob["date"]} if ob else {}
    rec = await db.payments.aggregate(
        [
            {
                "$match": {
                    "company_id": company_id,
                    "payment_mode_code": "CASH",
                    "status": {"$in": ["Cleared", "Reversed"]},
                    "payment_date": {**lo, "$lt": before},
                    **scope,
                }
            },
            {"$group": {"_id": None, "s": {"$sum": "$amount_paise"}}},
        ]
    ).to_list(1)
    rev = await db.payments.aggregate(
        [
            {
                "$match": {
                    "company_id": company_id,
                    "payment_mode_code": "CASH",
                    "status": "Reversed",
                    "reversal.at": {
                        **({"$gte": clock.day_start_utc(ob["date"])} if ob else {}),
                        "$lt": clock.day_start_utc(before),
                    },  # reversal.at is a UTC timestamp: compare on business-day bounds
                    **scope,
                }
            },
            {"$group": {"_id": None, "s": {"$sum": "$amount_paise"}}},
        ]
    ).to_list(1)
    contra = await db.contra_entries.aggregate(
        [
            {"$match": {"company_id": company_id, "date": {**lo, "$lt": before}}},
            {"$group": {"_id": "$kind", "s": {"$sum": "$amount_paise"}}},
        ]
    ).to_list(None)
    cmap = {c["_id"]: c["s"] for c in contra}
    return (
        (ob["amount_paise"] if ob else 0)
        + (rec[0]["s"] if rec else 0)
        - (rev[0]["s"] if rev else 0)
        - cmap.get("DEPOSIT", 0)
        + cmap.get("WITHDRAWAL", 0)
        - await _cash_refunds(company_id, {"paid_date": {**lo, "$lt": before}})
    )


async def cash_in_hand_on(company_id: str, day: Date, scope: dict) -> int:
    """Closing cash of `day` (used by the cash payout guard)."""
    return await _cash_in_hand_before(company_id, day + timedelta(days=1), scope)
