"""Payment ledger engine: everything derived from source docs (demands, payments, revisions, cancellation)."""
from datetime import date, timedelta

from db import db
from services.money import pct_of
from services.numbering import generate_number
from utils import new_id, now_iso

CLEAR_IMMEDIATELY = {"CASH", "UPI", "NEFT_RTGS", "LOAN_DISBURSEMENT"}


def _orders(cash_agreed: int, account_agreed: int, pct: float) -> tuple[int, int]:
    return pct_of(cash_agreed, pct), pct_of(account_agreed, pct)


def _oc_totals(lines: list[dict]) -> tuple[int, int]:
    return sum(l.get("demanded_paise", 0) for l in lines), sum(l.get("paid_paise", 0) for l in lines)


async def rebuild(booking_id: str) -> list[dict]:
    b = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not b:
        return []
    demands = await db.demands.find({"booking_id": booking_id, "voided": {"$ne": True}}, {"_id": 0}).to_list(None)
    payments = await db.payments.find({"booking_id": booking_id, "status": {"$in": ["Cleared", "Reversed"]}}, {"_id": 0}).to_list(None)
    revisions = b.get("agreement_revisions") or []
    lines = {l["line_id"]: dict(l, paid_paise=0) for l in (b.get("other_charges") or [])}
    events = []
    for d in demands:
        events.append((d["posted_at"], 0, "DEMAND", d))
    for l in lines.values():
        if l.get("demanded_at"):
            events.append((l["demanded_at"], 0, "OTHER_CHARGE_DEMAND", l))
    for p in payments:
        kind = "OTHER_CHARGE_PAYMENT" if p["against"] == "OTHER_CHARGE" else "PAYMENT"
        events.append((p["posted_at"], 1, kind, p))
        if p["status"] == "Reversed":
            events.append((p["reversal"]["at"], 2, "REVERSAL", p))
    for r in revisions:
        events.append((r["at"], 0, "AGREEMENT_CHANGE", r))
    if b.get("cancellation"):
        events.append((b["cancellation"]["at"], 3, "CANCELLATION", b["cancellation"]))
    events.sort(key=lambda e: (e[0], e[1]))

    cash_agreed = revisions[0]["before"]["cash_agreed_paise"] if revisions else b["cash_agreed_paise"]
    account_agreed = revisions[0]["before"]["account_agreed_paise"] if revisions else b["account_agreed_paise"]
    pct, cash_paid, account_paid, last_pay = 0, 0, 0, None
    rows = []
    for seq, (at, _, kind, src) in enumerate(events, start=1):
        amount, category, ref, note = 0, None, None, None
        if kind == "DEMAND":
            pct = src["cumulative_percent"]
            amount = src["total_demand_paise"]
            ref = src["demand_number"]
            note = f"{src['milestone_name']} ({pct}%)"
        elif kind == "PAYMENT":
            amount = src["amount_paise"]
            category = src["payment_category"]
            ref = src["receipt_number"]
            if category == "Cash":
                cash_paid += amount
            else:
                account_paid += amount
            last_pay = src["payment_date"]
        elif kind == "OTHER_CHARGE_PAYMENT":
            amount = src["amount_paise"]
            ref = src["receipt_number"]
            line = lines.get(src.get("other_charge_line_id"))
            if line:
                line["paid_paise"] += amount
                note = line["name"]
            last_pay = src["payment_date"]
        elif kind == "REVERSAL":
            amount = -src["amount_paise"]
            ref = src["receipt_number"]
            note = src["reversal"].get("reason")
            if src["against"] == "OTHER_CHARGE":
                line = lines.get(src.get("other_charge_line_id"))
                if line:
                    line["paid_paise"] += amount
            else:
                category = src["payment_category"]
                if category == "Cash":
                    cash_paid += amount
                else:
                    account_paid += amount
        elif kind == "OTHER_CHARGE_DEMAND":
            amount = src["demanded_paise"]
            note = src["name"]
        elif kind == "AGREEMENT_CHANGE":
            cash_agreed, account_agreed = src["after"]["cash_agreed_paise"], src["after"]["account_agreed_paise"]
            amount = (cash_agreed + account_agreed) - (src["before"]["cash_agreed_paise"] + src["before"]["account_agreed_paise"])
            note = src.get("reason")
        elif kind == "CANCELLATION":
            amount = -(src.get("refund_paise") or 0)
            note = src.get("reason")
        c_ord, a_ord = _orders(cash_agreed, account_agreed, pct)
        oc_dem, oc_paid = _oc_totals(list(lines.values()))
        rows.append({
            "id": new_id(), "booking_id": booking_id, "seq": seq, "at": at, "date": at[:10], "type": kind, "construction_percent": pct,
            "category": category, "amount_paise": amount, "note": note, "ref": ref,
            "cash_paid_cum_paise": cash_paid, "account_paid_cum_paise": account_paid,
            "cash_order_raised_paise": c_ord, "account_order_raised_paise": a_ord,
            "cash_due_paise": c_ord - cash_paid, "account_due_paise": a_ord - account_paid, "total_due_paise": (c_ord - cash_paid) + (a_ord - account_paid),
            "other_charges_due_paise": oc_dem - oc_paid,
        })
    # final summary
    pct_now = b.get("construction_percent", pct)
    c_ord, a_ord = _orders(b["cash_agreed_paise"], b["account_agreed_paise"], pct_now)
    if b.get("status") == "Cancelled":
        c_ord, a_ord = cash_paid, account_paid  # ledger closed: nothing further due
    oc_dem, oc_paid = _oc_totals(list(lines.values()))
    pending = sum(p["amount_paise"] for p in await db.payments.find({"booking_id": booking_id, "status": "Pending"}, {"_id": 0, "amount_paise": 1}).to_list(None))
    summary = {
        "cash_order_raised_paise": c_ord, "account_order_raised_paise": a_ord, "total_order_raised_paise": c_ord + a_ord,
        "cash_paid_paise": cash_paid, "account_paid_paise": account_paid, "paid_paise": cash_paid + account_paid,
        "cash_due_paise": c_ord - cash_paid, "account_due_paise": a_ord - account_paid, "due_paise": (c_ord - cash_paid) + (a_ord - account_paid),
        "other_charges_demanded_paise": oc_dem, "other_charges_paid_paise": oc_paid, "other_charges_due_paise": oc_dem - oc_paid,
        "pending_cheques_paise": pending, "last_payment_at": last_pay,
    }
    # demand statuses: FIFO per bucket
    cum_c = cum_a = 0
    for d in sorted(demands, key=lambda x: x["posted_at"]):
        prev_c, prev_a = cum_c, cum_a
        cum_c += d["cash_demand_paise"]
        cum_a += d["account_demand_paise"]
        paid_c = min(max(cash_paid - prev_c, 0), d["cash_demand_paise"])
        paid_a = min(max(account_paid - prev_a, 0), d["account_demand_paise"])
        total = d["total_demand_paise"]
        paid = paid_c + paid_a
        status = "Paid" if total and paid >= total else "Partially Paid" if paid > 0 else "Open"
        if (d.get("status") != status) or d.get("paid_paise") != paid:
            await db.demands.update_one({"id": d["id"]}, {"$set": {"status": status, "paid_paise": paid}})
    await db.ledger_entries.delete_many({"booking_id": booking_id})
    if rows:
        await db.ledger_entries.insert_many([dict(r) for r in rows])
    await db.bookings.update_one({"id": booking_id}, {"$set": {"summary": summary, "other_charges": list(lines.values()), "ledger_rebuilt_at": now_iso()}})
    return rows


async def create_demand(booking: dict, company: dict, milestone: dict, completed_on: date, due_days: int, posted_at: str) -> dict | None:
    """Incremental demand for a booking when construction moves to milestone.cumulative_percent."""
    new_pct = milestone["cumulative_percent"]
    old_pct = booking.get("construction_percent", 0)
    c_old, a_old = _orders(booking["cash_agreed_paise"], booking["account_agreed_paise"], old_pct)
    c_new, a_new = _orders(booking["cash_agreed_paise"], booking["account_agreed_paise"], new_pct)
    cash_d, acc_d = c_new - c_old, a_new - a_old
    if cash_d <= 0 and acc_d <= 0:
        await db.bookings.update_one({"id": booking["id"]}, {"$set": {"construction_percent": new_pct}})
        return None
    d = {
        "id": new_id(), "company_id": booking["company_id"], "booking_id": booking["id"], "customer_id": booking["customer_id"],
        "project_id": booking["project_id"], "block_id": booking["block_id"], "flat_id": booking["flat_id"],
        "demand_number": await generate_number("demand", company, completed_on),
        "milestone_seq": milestone["seq"], "milestone_name": milestone["name"], "cumulative_percent": new_pct,
        "cash_demand_paise": cash_d, "account_demand_paise": acc_d, "total_demand_paise": cash_d + acc_d,
        "demand_date": completed_on.isoformat(), "due_date": (completed_on + timedelta(days=due_days)).isoformat(),
        "status": "Open", "paid_paise": 0, "voided": False, "posted_at": posted_at, "created_at": now_iso(),
    }
    await db.demands.insert_one(d)
    d.pop("_id", None)
    await db.bookings.update_one({"id": booking["id"]}, {"$set": {"construction_percent": new_pct, "updated_at": now_iso()}})
    return d


def raise_other_charges(booking: dict, trigger: str, at: str) -> list[dict]:
    lines = booking.get("other_charges") or []
    changed = False
    for l in lines:
        if l.get("demand_at") == trigger and not l.get("demanded_at"):
            l["demanded_at"] = at
            l["demanded_paise"] = l["total_paise"]
            changed = True
    return lines if changed else []


async def bucket_paid(booking_id: str, category: str) -> int:
    rows = await db.payments.aggregate([{"$match": {"booking_id": booking_id, "against": "FLAT_VALUE", "payment_category": category, "status": "Cleared"}},
                                        {"$group": {"_id": None, "s": {"$sum": "$amount_paise"}}}]).to_list(1)
    return rows[0]["s"] if rows else 0


async def line_paid(booking_id: str, line_id: str) -> int:
    rows = await db.payments.aggregate([{"$match": {"booking_id": booking_id, "against": "OTHER_CHARGE", "other_charge_line_id": line_id, "status": "Cleared"}},
                                        {"$group": {"_id": None, "s": {"$sum": "$amount_paise"}}}]).to_list(1)
    return rows[0]["s"] if rows else 0
