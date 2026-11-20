"""Reconciliation bridges between reports that must agree (3F F7, 3H REQ-323/324/330). Each returns extra totals for
the named lines, only for the unfiltered view (a bridge for a filtered slice would mislead)."""

from reports_v3 import legacy as LG
from services import clock


async def customer_status(user, p, tot, narrowed):
    if narrowed or p["as_of"] != clock.today():
        return {}
    b = (await LG.call(user, "demand-vs-collection", {})).get("bridge") or {}
    return {"br_bvc": b.get("live_paise", 0)}


customer_status.independent = True  # reads only Demand vs collection — may run beside the provider


async def _coll(user, p) -> dict:
    f, t = p.get("period_from") or "2000-01-01", p.get("period_to") or clock.today().isoformat()
    return (await LG.call(user, "collections-v2", {"from_date": f, "to_date": t, "group_by": "month"}))["totals"]


async def collections(user, p, tot, narrowed):
    """Cheques in hand at the period end and refunds paid out in the period — named lines, never inside Received."""
    if narrowed or p.get("basis") not in (None, "", "cleared"):
        return {}
    c = LG.last("collections-v2") or await _coll(user, p)  # the provider's own totals, no second read
    return {k: c[k] for k in ("in_hand_paise", "in_hand_n", "refunds_paid_paise", "refunds_paid_n")}


async def bank(user, p, tot, narrowed):
    """REQ-323: Bank-wise ₹A + Cash ₹B = Collections ₹C on the same cleared rows; any remainder is a named line."""
    if narrowed:
        return {}
    b = LG.last("bank-receipts") or {}  # the route read Collections' own rows: cash + Collections total ride along
    if "collections_paise" not in b:
        c = await _coll(user, p)
        b = {"cash_mode_paise": c["cash_mode_paise"], "collections_paise": c["total_paise"]} | c
    rest = b["collections_paise"] - tot.get("total_paise", 0) - b["cash_mode_paise"]
    return {
        "br_cash": b["cash_mode_paise"],
        "br_collections": b["collections_paise"],
        "br_rest": rest,
        "in_hand_paise": b["in_hand_paise"],
        "in_hand_n": b["in_hand_n"],
    }


async def forfeits(user, p, tot, narrowed):
    """REQ-332: a cancellation deduction kept is other income — shown beside Cash vs Account, never inside a share."""
    if narrowed:
        return {}
    from db import db
    from deps import report_scope_filter

    q = {"company_id": user["company_id"], **report_scope_filter(user), "status": "Cancelled"}
    got = await db.bookings.aggregate(
        [{"$match": q}, {"$group": {"_id": None, "t": {"$sum": "$cancellation.deduction_paise"}}}]
    ).to_list(1)
    return {"br_forfeit": got[0]["t"] if got else 0}
