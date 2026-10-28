"""SINGLE DEFINITIONS MODULE (Phase G). Every tile, report and projection imports these — never re-derive money concepts elsewhere.

Each definition has a machine form (python / mongo match) and a human form (DEFINITIONS, shown read-only in Settings → Definitions).
"""
from services import clock
from datetime import date

LIVE_BOOKING_STATUSES = ["Active", "Completed"]
OPEN_DEMAND_STATUSES = ["Open", "Partially Paid"]
CLEARED = "Cleared"


def live_bookings_match(extra: dict | None = None) -> dict:
    return {**(extra or {}), "status": {"$in": LIVE_BOOKING_STATUSES}}


def open_demands_match(extra: dict | None = None) -> dict:
    """Demands that can still be collected. Cancelled bookings' demands carry status Cancelled, so they are excluded by status."""
    return {**(extra or {}), "voided": {"$ne": True}, "status": {"$in": OPEN_DEMAND_STATUSES}}


def overdue_demands_match(as_of: date | None = None, extra: dict | None = None) -> dict:
    return {**open_demands_match(extra), "due_date": {"$lt": (as_of or clock.today()).isoformat()}}


def cleared_payments_match(extra: dict | None = None) -> dict:
    return {**(extra or {}), "status": CLEARED}


def demand_balance(d: dict) -> int:
    return max((d.get("total_demand_paise") or 0) - (d.get("paid_paise") or 0), 0)


def is_overdue(d: dict, as_of: date | None = None) -> bool:
    return d.get("status") in OPEN_DEMAND_STATUSES and not d.get("voided") and d.get("due_date", "9999") < (as_of or clock.today()).isoformat()


def outstanding(summary: dict) -> dict:
    """Outstanding = Σ over buckets of max(order raised − paid, 0). Negative buckets are advances, never netted against other buckets."""
    s = summary or {}
    c, a, o = max(s.get("cash_due_paise", 0), 0), max(s.get("account_due_paise", 0), 0), max(s.get("other_charges_due_paise", 0), 0)
    total = s["outstanding_paise"] if "outstanding_paise" in s else c + a + o
    return {"cash_paise": c, "account_paise": a, "other_charges_paise": o, "total_paise": total}


def advance(summary: dict) -> int:
    """Advance = money received beyond what has been raised (negative due), per bucket, summed."""
    s = summary or {}
    return s["advance_paise"] if "advance_paise" in s else sum(max(-s.get(k, 0), 0) for k in ("cash_due_paise", "account_due_paise", "other_charges_due_paise"))


def two_sided(bill_raised_paise: int, received_paise: int) -> dict:
    """English two-sided view used by API, CSV and PDF alike. Sign convention: balance = received − bill raised;
    negative → "due" (shown red with minus), positive → "advance" (green), zero → "settled". Bill raised = Udhar side (demands,
    other-charge demands, agreement increases); Received = Jama side (cleared receipts; reversals/refunds negative)."""
    bal = received_paise - bill_raised_paise
    return {"bill_raised_paise": bill_raised_paise, "received_paise": received_paise, "balance_signed_paise": bal,
            "balance_status": "due" if bal < 0 else "advance" if bal > 0 else "settled"}


def net_balance(summary: dict) -> int:
    """Net balance = Outstanding − Advance held = Σ bill raised − Σ received (the single two-sided ledger figure; positive = due)."""
    s = summary or {}
    return s["net_balance_paise"] if "net_balance_paise" in s else outstanding(s)["total_paise"] - advance(s)


def age_bucket(due_date: str, as_of: date | None = None) -> str:
    days = ((as_of or clock.today()) - date.fromisoformat(due_date)).days
    return "not_due" if days <= 0 else "d0_30" if days <= 30 else "d31_60" if days <= 60 else "d61_90" if days <= 90 else "d90"


def deduction_for(policy: dict, agreement_value_paise: int, received_paise: int) -> int:
    """Policy deduction: base ∈ {agreement (% of agreement value), received (% of amount received), fixed (₹)}, optional GST 18 %, capped at received."""
    p = {"deduction_base": "agreement", "deduction_value": 10.0, "gst_on_deduction": False, **(policy or {})}
    if p.get("deduction_type") == "fixed":
        p["deduction_base"] = "fixed"
    base_amt = {"agreement": agreement_value_paise, "received": received_paise}.get(p["deduction_base"])
    from services.money import rupees_whole
    ded = int(round(float(p["deduction_value"]) * 100)) if base_amt is None else rupees_whole(base_amt * float(p["deduction_value"]) / 100)
    if p.get("gst_on_deduction"):
        ded += rupees_whole(ded * 0.18)
    return min(ded, received_paise)


def deductible_charges_due(other_charges: list) -> int:
    """Other charges that survive a cancellation and are deducted from the refund: DEMANDED-and-unpaid *penalty* lines (e.g. cheque-bounce
    charges, which are costs already incurred). Service charges (parking, club…) demanded but unpaid are voided with the booking — the
    customer never receives the service — and undemanded charges are never deducted."""
    return sum(max((ln.get("demanded_paise") or 0) - (ln.get("paid_paise") or 0), 0) for ln in other_charges or []
               if ln.get("source_payment_id") or (ln.get("code") or "").upper() in ("BOUNCE", "CHQ_BOUNCE") or ln.get("kind") == "penalty")


def refund_payable(summary: dict, deduction_paise: int, charges_due_paise: int) -> int:
    """Refund payable = Σ cleared receipts (flat value + other charges) − deductions − DEMANDED-and-unpaid penalty charges. Never below zero."""
    s = summary or {}
    return max(s.get("paid_paise", 0) + s.get("other_charges_paid_paise", 0) - deduction_paise - charges_due_paise, 0)


DEFINITIONS = [
    {"key": "live_booking", "name": "Live booking", "formula": "booking.status ∈ {Active, Completed}", "note": "Cancelled bookings are excluded from every money figure; their demands are closed (status Cancelled) at cancellation.", "used_by": ["Home tiles", "Project/Block/Customer summaries", "Outstanding report", "Advances report"]},
    {"key": "collected", "name": "Collected / Collections", "formula": "Σ payments.amount where status = Cleared (by payment_date for a period)", "note": "Pending cheques and bounced/reversed receipts are never collections. A reversal removes the receipt from the day it was posted; the contra appears as a dated line in the Roznamcha on the reversal day.", "used_by": ["Collections report", "Roznamcha", "Bank receipts", "Home collections MTD / 12-month chart", "Widgets"]},
    {"key": "outstanding", "name": "Outstanding (Due)", "formula": "Σ over live bookings of [max(cash order raised − cash paid, 0) + max(account order raised − account paid, 0) + max(other charges demanded − paid, 0)]", "note": "Order raised = agreed amount × raised construction %. Negative buckets are advances and are never netted.", "used_by": ["Home outstanding tile", "Outstanding report total", "Customer 360 due", "Project workspace"]},
    {"key": "overdue", "name": "Overdue", "formula": "Σ over demands with status ∈ {Open, Partially Paid}, not voided, due_date < as-of date of (total_demand − paid)", "note": "Ageing buckets: not due · 0-30 · 31-60 · 61-90 · 90+ days past due.", "used_by": ["Home overdue tile & ageing", "Outstanding report ageing", "Widgets top overdue", "Overdue notifications"]},
    {"key": "advance", "name": "Advance", "formula": "Σ over live bookings of max(paid − order raised, 0) per bucket", "note": "Money received ahead of demands; shown separately, never reduces another booking's due.", "used_by": ["Advances report"]},
    {"key": "receivable_forecast", "name": "Receivable forecast", "formula": "Σ of not-yet-raised installments from each live booking's plan snapshot, dated by trigger (stage ETA / days after booking / date), + open demands by due date", "note": "Phase I report; definition fixed here so projections and the report agree.", "used_by": ["Receivables forecast (Phase I)"]},
    {"key": "refund_payable", "name": "Refund payable (cancellation)", "formula": "Σ cleared receipts − deduction (project policy base: % of agreement value | % of amount received | fixed ₹, ± GST 18 %, capped at received) − penalty charges DEMANDED and unpaid (e.g. cheque-bounce; service charges such as parking/club demanded but unpaid are voided with the booking; undemanded charges are never deducted)", "note": "Refund records are Pending until Accounts marks them Paid; a paid refund posts a negative (contra) ledger row in the bucket it came from and a cash-out line in the Roznamcha.", "used_by": ["Cancellation", "Refunds", "Cancellations report", "Roznamcha"]},
    {"key": "forfeiture", "name": "Forfeiture", "formula": "deduction + demanded-unpaid charges recovered when refund payable = 0 → forfeiture record (no refund)", "note": "Shown in the cancellations report as amount received vs refund vs forfeiture.", "used_by": ["Cancellation", "Cancellations report"]},
    {"key": "cash_in_hand", "name": "Cash in hand (Roznamcha)", "formula": "opening balance (cash book) + Σ cash receipts cleared − bank deposits + cash withdrawals − cash refunds, up to the date (a reversed receipt is a correction: it is excluded from receipts on its own date, never subtracted again)", "note": "A CASH refund/payout cannot exceed cash in hand on its date (CASH_INSUFFICIENT). Legacy (pre-ERP) refunds are flagged `legacy` and excluded from the cash book.", "used_by": ["Roznamcha", "Refund payout"]},
    {"key": "pending_cheques", "name": "Cheques in hand", "formula": "Σ payments.amount where status = Pending (cheque/DD not yet cleared)", "note": "Not part of collections or paid until cleared.", "used_by": ["Home tile", "Cheque register", "Booking summary"]},
]


# ---------- Ageing (Phase R0a) ----------
BANDS = ("Not due", "0-30", "31-60", "61-90", "90+")


def band_of(due_date: str | None, as_of: date) -> str:
    """Band = f(due_date, as_of). Due today or later = Not due; overdue = bands > 0 days."""
    try:
        d = (as_of - date.fromisoformat(due_date)).days
    except (TypeError, ValueError):
        return "Not due"
    return "Not due" if d <= 0 else "0-30" if d <= 30 else "31-60" if d <= 60 else "61-90" if d <= 90 else "90+"


def _allocate(lines: list[tuple[str, int]], bucket_outstanding: int, as_of: date, bands: dict) -> None:
    """Oldest lines are considered paid first; whatever remains unpaid (= bucket outstanding) sits on the newest lines."""
    lines = sorted(lines, key=lambda x: x[0] or "")
    paid = max(sum(a for _, a in lines) - bucket_outstanding, 0)
    left = bucket_outstanding
    for due, amt in lines:
        take = max(amt - paid, 0)
        paid = max(paid - amt, 0)
        take = min(take, left)
        bands[band_of(due, as_of)] += take
        left -= take
    if left > 0:
        bands["Not due"] += left


def ageing_bands(summary: dict, demands: list[dict], other_charges: list[dict], as_of: date) -> dict:
    """Per-booking bands incl. other charges. Σ bands == outstanding(summary)['total_paise'] to the paisa."""
    out = outstanding(summary)
    bands = {k: 0 for k in BANDS}
    live = [d for d in demands if not d.get("voided") and d.get("status") != "Cancelled"]
    _allocate([(d.get("due_date"), d.get("cash_demand_paise", 0)) for d in live], out["cash_paise"], as_of, bands)
    _allocate([(d.get("due_date"), d.get("account_demand_paise", 0)) for d in live], out["account_paise"], as_of, bands)
    _allocate([((l.get("demanded_at") or "")[:10], l.get("demanded_paise") or 0) for l in other_charges or [] if l.get("demanded_at")], out["other_charges_paise"], as_of, bands)
    return bands


def overdue_of(bands: dict) -> int:
    return sum(v for k, v in bands.items() if k != "Not due")


async def ageing_for_bookings(booking_match: dict, as_of: date | None = None) -> tuple[dict, dict]:
    """Returns (total bands, {booking_id: bands}) for live bookings matching booking_match."""
    from db import db
    as_of = as_of or clock.today()
    proj = {"_id": 0, "id": 1, "summary": 1, "other_charges": 1}
    per, chunk = {}, []

    async def flush():  # O(chunk) memory: demands for ≤500 bookings at a time, bands kept (6 ints per booking), demand rows dropped
        dem = {}
        async for d in db.demands.find({"booking_id": {"$in": [b["id"] for b in chunk]}, "voided": {"$ne": True}}, {"_id": 0, "booking_id": 1, "due_date": 1, "cash_demand_paise": 1, "account_demand_paise": 1, "status": 1}).batch_size(500):
            dem.setdefault(d["booking_id"], []).append(d)
        for b in chunk:
            per[b["id"]] = ageing_bands(b.get("summary") or {}, dem.get(b["id"], []), b.get("other_charges") or [], as_of)
        chunk.clear()
    async for b in db.bookings.find(live_bookings_match(booking_match), proj).batch_size(500):
        chunk.append(b)
        if len(chunk) >= 500:
            await flush()
    if chunk:
        await flush()
    total = {k: sum(p[k] for p in per.values()) for k in BANDS}
    return total, per
