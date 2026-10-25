"""Three ledgers per booking (Cash / Account / Other charges) + combined, derived from `ledger_entries` (which `ledger.rebuild`
derives from demands/payments/revisions). Pure read model: nothing here is stored."""
from db import db
from services.money import present_money

BUCKETS = ("cash", "account", "other_charges")


def _row(e: dict, bucket: str) -> dict | None:
    """Project one ledger_entries row onto a bucket, with that bucket's running balances. None if it does not touch the bucket."""
    t = e["type"]
    if bucket == "cash":
        if t in ("DEMAND", "AGREEMENT_CHANGE", "CANCELLATION") or (t in ("PAYMENT", "REVERSAL") and e.get("category") == "Cash"):
            raised, paid = e["cash_order_raised_paise"], e["cash_paid_cum_paise"]
        else:
            return None
    elif bucket == "account":
        if t in ("DEMAND", "AGREEMENT_CHANGE", "CANCELLATION") or (t in ("PAYMENT", "REVERSAL") and e.get("category") == "Account"):
            raised, paid = e["account_order_raised_paise"], e["account_paid_cum_paise"]
        else:
            return None
    else:
        if t not in ("OTHER_CHARGE_DEMAND", "OTHER_CHARGE_PAYMENT") and not (t == "REVERSAL" and e.get("category") is None):
            return None
        raised, paid = None, None
    amount = e["amount_paise"]
    if t == "DEMAND" and bucket in ("cash", "account"):
        amount = None  # the row's own demand split is shown via raised delta below
    return {"seq": e["seq"], "at": e["at"], "date": e["date"], "type": t, "ref": e.get("ref"), "note": e.get("note"), "amount_paise": amount,
            "raised_cum_paise": raised, "paid_cum_paise": paid, "due_paise": (raised - paid) if raised is not None else e.get("other_charges_due_paise"),
            "advance_paise": max(paid - raised, 0) if raised is not None else 0}


def _fill_demand_amounts(rows: list[dict]):
    prev = 0
    for r in rows:
        if r["type"] == "DEMAND":
            r["amount_paise"] = r["raised_cum_paise"] - prev
        if r["raised_cum_paise"] is not None:
            prev = r["raised_cum_paise"]


def _summary(b: dict, bucket: str, pending: int) -> dict:
    s = b.get("summary") or {}
    if bucket == "other_charges":
        agreed = sum(l.get("total_paise", 0) for l in b.get("other_charges") or [])
        raised, paid = s.get("other_charges_demanded_paise", 0), s.get("other_charges_paid_paise", 0)
    else:
        agreed = b[f"{bucket}_agreed_paise"]
        raised, paid = s.get(f"{bucket}_order_raised_paise", 0), s.get(f"{bucket}_paid_paise", 0)
    return {"agreed_paise": agreed, "raised_paise": raised, "paid_paise": paid, "due_paise": max(raised - paid, 0), "advance_paise": max(paid - raised, 0),
            "balance_paise": agreed - paid, "pending_cheques_paise": pending}


async def booking_ledgers(booking: dict) -> dict:
    entries = await db.ledger_entries.find({"booking_id": booking["id"]}, {"_id": 0}).sort("seq", 1).to_list(None)
    pend = await db.payments.aggregate([{"$match": {"booking_id": booking["id"], "status": "Pending"}}, {"$group": {"_id": {"a": "$against", "c": "$payment_category"}, "s": {"$sum": "$amount_paise"}}}]).to_list(None)
    pending = {"cash": 0, "account": 0, "other_charges": 0}
    for x in pend:
        k = "other_charges" if x["_id"]["a"] == "OTHER_CHARGE" else ("cash" if x["_id"]["c"] == "Cash" else "account")
        pending[k] += x["s"]
    out = {}
    for bucket in BUCKETS:
        rows = [r for r in (_row(e, bucket) for e in entries) if r]
        _fill_demand_amounts(rows)
        out[bucket] = {"summary": _summary(booking, bucket, pending[bucket]), "rows": rows}
    s = booking.get("summary") or {}
    out["combined"] = {"summary": {"agreed_paise": booking["agreement_value_paise"] + out["other_charges"]["summary"]["agreed_paise"],
                                   "raised_paise": s.get("total_order_raised_paise", 0) + s.get("other_charges_demanded_paise", 0),
                                   "paid_paise": s.get("paid_paise", 0) + s.get("other_charges_paid_paise", 0),
                                   "due_paise": max(s.get("due_paise", 0), 0) + max(s.get("other_charges_due_paise", 0), 0),
                                   "advance_paise": out["cash"]["summary"]["advance_paise"] + out["account"]["summary"]["advance_paise"],
                                   "pending_cheques_paise": sum(pending.values()), "last_payment_at": s.get("last_payment_at")},
                       "rows": entries}
    return present_money({"booking_id": booking["id"], "booking_number": booking["booking_number"], "status": booking["status"], **out})


async def customer_ledgers(customer_id: str, company_id: str) -> dict:
    bookings = await db.bookings.find({"customer_id": customer_id, "company_id": company_id}, {"_id": 0, "agreement_revisions": 0, "milestone_template_snapshot": 0, "payment_plan_snapshot": 0}).to_list(None)
    per = [await booking_ledgers(b) for b in bookings]
    grand = {k: {"agreed_paise": 0, "raised_paise": 0, "paid_paise": 0, "due_paise": 0, "advance_paise": 0, "pending_cheques_paise": 0} for k in (*BUCKETS, "combined")}
    for pl in per:
        for k in grand:
            for f in grand[k]:
                grand[k][f] += pl[k]["summary"].get(f, 0) or 0
    return present_money({"customer_id": customer_id, "bookings": [{"booking_id": p["booking_id"], "booking_number": p["booking_number"], "status": p["status"], **{k: p[k]["summary"] for k in (*BUCKETS, "combined")}} for p in per],
                          "ledgers": per, "totals": grand})
