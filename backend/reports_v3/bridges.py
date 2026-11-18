"""Phase 3F F7: reconciliation bridges between reports that count the same money on a different basis. Each returns
extra totals for the formula line, only for the unfiltered view (a bridge for a filtered slice would mislead)."""

from db import db
from deps import report_scope_filter
from reports_v3 import legacy as LG
from services import clock


async def _bills_bridge(user: dict) -> dict:
    b = (await LG.call(user, "demand-vs-collection", {})).get("bridge") or {}
    live = b.get("instalment_paise", 0) - b.get("not_live_paise", 0) + b.get("adjust_paise", 0)
    return {"br_instalment": b.get("instalment_paise", 0), "br_not_live": b.get("not_live_paise", 0), "br_adjust": b.get("adjust_paise", 0), "br_live": live}


async def bills(user, p, tot, narrowed):
    return {} if narrowed else await _bills_bridge(user)


async def customer_status(user, p, tot, narrowed):
    if narrowed or p["as_of"] != clock.today():
        return {}
    return await _bills_bridge(user)


async def bank(user, p, tot, narrowed):
    """Bank-wise counts non-cash receipts cleared + pending; Collections counts cleared receipts of every mode, net of
    reversals. Bridge: total − pending + cash-mode receipts − reversals = Collections."""
    if narrowed:
        return {}
    f, t = p.get("period_from") or "2000-01-01", p.get("period_to") or clock.today().isoformat()
    coll = (await LG.call(user, "collections-v2", {"from_date": f, "to_date": t, "group_by": "month"}))["totals"]
    q = {"company_id": user["company_id"], **report_scope_filter(user), "payment_date": {"$gte": f, "$lte": t}, "status": "Cleared", "payment_mode_code": "CASH"}
    cash = await db.payments.aggregate([{"$match": q}, {"$group": {"_id": None, "t": {"$sum": "$amount_paise"}, "n": {"$sum": 1}}}]).to_list(1)
    cash_t, cash_n = (cash[0]["t"], cash[0]["n"]) if cash else (0, 0)
    rev = coll.get("reversal_paise", 0)
    rest = coll["total_paise"] - (tot.get("total_paise", 0) - tot.get("pending_paise", 0) + cash_t + rev)
    return {"br_cash": cash_t, "br_cash_n": cash_n, "br_reversal": rev, "br_rest": rest, "br_collections": coll["total_paise"], "br_collections_n": coll.get("count", 0)}
