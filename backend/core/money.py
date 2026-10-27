"""Leaf: scope money aggregates shared by events (propagation snapshots) and read models. Imports nothing above services.definitions."""
from db import db
from services import clock
from services.definitions import (
    ageing_for_bookings,
    cleared_payments_match,
    live_bookings_match,
    overdue_demands_match,
    overdue_of,
)


async def money_snapshot(match: dict) -> dict:
    """Raw money aggregates for a scope (company / project / customer). Never reads read models (they lag)."""
    today = clock.today().isoformat()
    month = today[:7]
    agg = await db.bookings.aggregate([{"$match": live_bookings_match(match)}, {"$group": {"_id": None, "n": {"$sum": 1}, "agreed": {"$sum": "$agreement_value_paise"}, "paid": {"$sum": "$summary.paid_paise"},
                                                                                                             "cash_due": {"$sum": {"$max": ["$summary.cash_due_paise", 0]}}, "acc_due": {"$sum": {"$max": ["$summary.account_due_paise", 0]}}, "oc_due": {"$sum": {"$max": ["$summary.other_charges_due_paise", 0]}},
                                                                                                             "outstanding": {"$sum": {"$ifNull": ["$summary.outstanding_paise", {"$add": [{"$max": ["$summary.cash_due_paise", 0]}, {"$max": ["$summary.account_due_paise", 0]}, {"$max": ["$summary.other_charges_due_paise", 0]}]}]}},
                                                                                                             "advance": {"$sum": {"$ifNull": ["$summary.advance_paise", 0]}},
                                                                                                             "oc_paid": {"$sum": "$summary.other_charges_paid_paise"}, "pending": {"$sum": "$summary.pending_cheques_paise"}}}]).to_list(1)
    a = agg[0] if agg else {}
    col = await db.payments.aggregate([{"$match": cleared_payments_match(match)}, {"$group": {"_id": None, "total": {"$sum": "$amount_paise"}, "mtd": {"$sum": {"$cond": [{"$eq": [{"$substr": ["$payment_date", 0, 7]}, month]}, "$amount_paise", 0]}}}}]).to_list(1)
    c = col[0] if col else {}
    od = await db.demands.aggregate([{"$match": overdue_demands_match(extra=match)}, {"$group": {"_id": None, "n": {"$sum": 1}}}]).to_list(1)
    bands, _ = await ageing_for_bookings(match)
    o = {"n": od[0]["n"] if od else 0, "amt": overdue_of(bands)}
    rf = await db.refunds.aggregate([{"$match": {**match, "status": "Paid"}}, {"$group": {"_id": None, "s": {"$sum": "$amount_paise"}}}]).to_list(1)
    return {"bookings": a.get("n", 0), "agreement_paise": a.get("agreed", 0), "paid_paise": a.get("paid", 0) + a.get("oc_paid", 0), "collections_total_paise": c.get("total", 0), "collections_mtd_paise": c.get("mtd", 0),
            "outstanding": {"cash_paise": a.get("cash_due", 0), "account_paise": a.get("acc_due", 0), "other_charges_paise": a.get("oc_due", 0), "total_paise": a.get("outstanding", 0)},
            "advance_paise": a.get("advance", 0), "refunds_paid_paise": (rf[0]["s"] if rf else 0),
            "overdue": {"count": o.get("n", 0), "amount_paise": o.get("amt", 0)}, "pending_cheques_paise": a.get("pending", 0)}

