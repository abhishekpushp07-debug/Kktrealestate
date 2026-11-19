"""SINGLE DEFINITIONS MODULE (Phase G). Every tile, report and projection imports these — never re-derive money concepts elsewhere.

Each definition has a machine form (python / mongo match) and a human form (DEFINITIONS, shown read-only in Settings → Definitions).
"""

from datetime import date, timedelta

from services import clock

LIVE_BOOKING_STATUSES = ["Active", "Completed"]
OPEN_DEMAND_STATUSES = ["Open", "Partially Paid"]
CLEARED = "Cleared"
INSTRUMENT_MODES = ("CHEQUE", "DD")  # money is received on the bank-clearing day (owner decision 1, 3H)


def received_on(p: dict) -> str | None:
    """REQ-319: the India day a receipt's money counts as received — a cheque / DD on its clearing day, everything else
    on its receipt day (the same day its ledger Jama row carries). None = not cleared (in hand / bounced)."""
    if p.get("payment_mode_code") in INSTRUMENT_MODES:
        return clock.day_of(p.get("cleared_at")) if p.get("cleared_at") else None
    return p["payment_date"]


def _valid_day(d: str) -> str:
    """'2026-11-31' (a month-end bound written as day 31) → the month's last real day."""
    y, m, dd = map(int, d.split("-"))
    while True:
        try:
            return date(y, m, dd).isoformat()
        except ValueError:
            dd -= 1


def received_match(f: str | None = None, t: str | None = None, status=CLEARED) -> dict:
    """Mongo twin of received_on(): cleared receipts whose money was received on India days f…t (cheque / DD by
    their clearing time, everything else by receipt day)."""
    days = {**({"$gte": f} if f else {}), **({"$lte": t} if t else {})}
    clear = {
        **({"$gte": clock.day_start_utc(_valid_day(f))} if f else {}),
        **({"$lte": clock.day_end_utc(_valid_day(t))} if t else {}),
    } or {"$exists": True}
    return {
        "status": status,
        "$or": [
            {"payment_mode_code": {"$nin": list(INSTRUMENT_MODES)}, **({"payment_date": days} if days else {})},
            {"payment_mode_code": {"$in": list(INSTRUMENT_MODES)}, "cleared_at": clear},
        ],
    }


def received_day_expr() -> dict:
    """Aggregation expression of received_on() (India day string)."""
    tz = str(clock.business_tz())
    cleared = {
        "$dateToString": {
            "date": {
                "$dateFromString": {
                    "dateString": {"$substrCP": ["$cleared_at", 0, 19]},
                    "timezone": "UTC",
                    "onError": None,
                }
            },
            "timezone": tz,
            "format": "%Y-%m-%d",
        }
    }
    return {"$cond": [{"$in": ["$payment_mode_code", list(INSTRUMENT_MODES)]}, cleared, "$payment_date"]}


def in_hand_on(p: dict, day: str) -> bool:
    """REQ-320/334: a receipt is a cheque in hand on `day` when it was dated on or before the day, had not cleared by it
    and had not bounced by it."""
    if p["payment_date"] > day:
        return False
    if p.get("status") == "Pending":
        return True
    if p.get("status") == "Bounced":
        return (clock.day_of(p.get("bounced_at")) or "9999") > day
    got = received_on(p)
    return bool(got) and got > day


async def cheques_in_hand(match: dict, day: str) -> list[dict]:
    """Receipts in hand at the end of `day` (India): dated ≤ day, not cleared / bounced by then."""
    from db import db

    after = {"$gt": clock.day_end_utc(_valid_day(day))}  # cleared / bounced only after the day ends
    instr = {"$in": list(INSTRUMENT_MODES)}
    q = {
        **match,
        "payment_date": {"$lte": day},
        "$or": [
            {"status": "Pending"},
            {"status": {"$in": ["Cleared", "Reversed"]}, "payment_mode_code": instr, "cleared_at": after},
            {"status": "Bounced", "bounced_at": after},
        ],
    }
    proj = {"_id": 0, "id": 1, "booking_id": 1, "receipt_number": 1, "amount_paise": 1, "payment_date": 1, "status": 1}
    proj |= {"payment_mode_code": 1, "cleared_at": 1, "bounced_at": 1, "instrument": 1, "bank_account_name": 1}
    return [p async for p in db.payments.find(q, proj) if in_hand_on(p, day)]


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
    return (
        d.get("status") in OPEN_DEMAND_STATUSES
        and not d.get("voided")
        and (d.get("due_date") or "9999") < (as_of or clock.today()).isoformat()  # due_date None = not overdue
    )


def outstanding(summary: dict) -> dict:
    """Outstanding = Σ over buckets of max(order raised − paid, 0). Negative buckets are advances, never netted against other buckets."""
    s = summary or {}
    c, a, o = (
        max(s.get("cash_due_paise", 0), 0),
        max(s.get("account_due_paise", 0), 0),
        max(s.get("other_charges_due_paise", 0), 0),
    )
    total = s["outstanding_paise"] if "outstanding_paise" in s else c + a + o
    return {"cash_paise": c, "account_paise": a, "other_charges_paise": o, "total_paise": total}


def advance(summary: dict) -> int:
    """Advance = money received beyond what has been raised (negative due), per bucket, summed."""
    s = summary or {}
    return (
        s["advance_paise"]
        if "advance_paise" in s
        else sum(max(-s.get(k, 0), 0) for k in ("cash_due_paise", "account_due_paise", "other_charges_due_paise"))
    )


def two_sided(bill_raised_paise: int, received_paise: int, waived_paise: int = 0) -> dict:
    """English two-sided view used by API, CSV and PDF alike. Sign convention: balance = received − bill raised;
    negative → "due" (shown red with minus), positive → "advance" (green), zero → "settled". Bill raised = Udhar side (demands,
    other-charge demands, agreement increases); Received = Jama side (cleared receipts; reversals/refunds negative)."""
    bal = received_paise + waived_paise - bill_raised_paise  # REQ-253: an approved waiver settles like Jama
    return {
        "bill_raised_paise": bill_raised_paise,
        "received_paise": received_paise,
        **({"waived_paise": waived_paise} if waived_paise else {}),
        "balance_signed_paise": bal,
        "balance_status": "due" if bal < 0 else "advance" if bal > 0 else "settled",
    }


def net_balance(summary: dict) -> int:
    """Net balance = Outstanding − Advance held = Σ bill raised − Σ received (the single two-sided ledger figure; positive = due)."""
    s = summary or {}
    return s["net_balance_paise"] if "net_balance_paise" in s else outstanding(s)["total_paise"] - advance(s)


def age_bucket(due_date: str, as_of: date | None = None) -> str:
    days = ((as_of or clock.today()) - date.fromisoformat(due_date)).days
    return (
        "not_due"
        if days <= 0
        else "d0_30"
        if days <= 30
        else "d31_60"
        if days <= 60
        else "d61_90"
        if days <= 90
        else "d90"
    )


def deduction_for(policy: dict, agreement_value_paise: int, received_paise: int) -> int:
    """Policy deduction: base ∈ {agreement (% of agreement value), received (% of amount received), fixed (₹)}, optional GST 18 %, capped at received."""
    p = {"deduction_base": "agreement", "deduction_value": 10.0, "gst_on_deduction": False, **(policy or {})}
    if p.get("deduction_type") == "fixed":
        p["deduction_base"] = "fixed"
    base_amt = {"agreement": agreement_value_paise, "received": received_paise}.get(p["deduction_base"])
    from services.money import rupees_whole

    ded = (
        int(round(float(p["deduction_value"]) * 100))
        if base_amt is None
        else rupees_whole(base_amt * float(p["deduction_value"]) / 100)
    )
    if p.get("gst_on_deduction"):
        ded += rupees_whole(ded * 0.18)
    return min(ded, received_paise)


def deductible_charges_due(other_charges: list) -> int:
    """Other charges that survive a cancellation and are deducted from the refund: DEMANDED-and-unpaid *penalty* lines (e.g. cheque-bounce
    charges, which are costs already incurred). Service charges (parking, club…) demanded but unpaid are voided with the booking — the
    customer never receives the service — and undemanded charges are never deducted."""
    return sum(
        max((ln.get("demanded_paise") or 0) - (ln.get("paid_paise") or 0), 0)
        for ln in other_charges or []
        if ln.get("source_payment_id")
        or (ln.get("code") or "").upper() in ("BOUNCE", "CHQ_BOUNCE")
        or ln.get("kind") == "penalty"
    )


def refund_payable(summary: dict, deduction_paise: int, charges_due_paise: int) -> int:
    """Refund payable = Σ cleared receipts (flat value + other charges) − deductions − DEMANDED-and-unpaid penalty charges. Never below zero."""
    s = summary or {}
    received = s.get("paid_paise", 0) + s.get("other_charges_paid_paise", 0) - s.get("waived_paise", 0)  # REQ-253
    return max(received - deduction_paise - charges_due_paise, 0)


DEFINITIONS = [
    {
        "key": "live_booking",
        "name": "Live booking",
        "formula": "booking.status ∈ {Active, Completed}",
        "note": "Cancelled bookings are excluded from every money figure; their demands are closed (status Cancelled) at cancellation.",
        "used_by": ["Home tiles", "Project/Block/Customer summaries", "Outstanding report", "Advances report"],
    },
    {
        "key": "collected",
        "name": "Collected / Collections",
        "formula": "Σ payments.amount where status = Cleared (by payment_date for a period)",
        "note": (
            "Pending cheques and bounced/reversed receipts are never collections. A reversal removes the receipt from the day it was posted; the "
            "contra appears "
            "as a dated "
            "line in the "
            "Roznamcha on the "
            "reversal day."
        ),
        "used_by": [
            "Collections report",
            "Roznamcha",
            "Bank receipts",
            "Home collections MTD / 12-month chart",
            "Widgets",
        ],
    },
    {
        "key": "outstanding",
        "name": "Outstanding (Due)",
        "formula": (
            "Σ over live bookings of [max(cash order raised − cash paid, 0) + max(account order raised − account paid, 0) + max(other charges "
            "demanded − "
            "paid, 0)]"
        ),
        "note": "Order raised = agreed amount × raised construction %. Negative buckets are advances and are never netted.",
        "used_by": ["Home outstanding tile", "Outstanding report total", "Customer 360 due", "Project workspace"],
    },
    {
        "key": "overdue",
        "name": "Overdue",
        "formula": "Σ over demands with status ∈ {Open, Partially Paid}, not voided, due_date < as-of date of (total_demand − paid)",
        "note": "Ageing buckets: not due · 0-30 · 31-60 · 61-90 · 90+ days past due.",
        "used_by": [
            "Home overdue tile & ageing",
            "Outstanding report ageing",
            "Widgets top overdue",
            "Overdue notifications",
        ],
    },
    {
        "key": "advance",
        "name": "Advance",
        "formula": "Σ over live bookings of max(paid − order raised, 0) per bucket",
        "note": "Money received ahead of demands; shown separately, never reduces another booking's due.",
        "used_by": ["Advances report"],
    },
    {
        "key": "receivable_forecast",
        "name": "Receivable forecast",
        "formula": (
            "Σ of not-yet-raised installments from each live booking's plan snapshot, dated by trigger (stage ETA / days after booking / date), + "
            "open demands "
            "by due date"
        ),
        "note": "Phase I report; definition fixed here so projections and the report agree.",
        "used_by": ["Receivables forecast (Phase I)"],
    },
    {
        "key": "refund_payable",
        "name": "Refund payable (cancellation)",
        "formula": (
            "Σ cleared receipts − deduction (project policy base: % of agreement value | % of amount received | fixed ₹, ± GST 18 %, capped at "
            "received) − "
            "penalty charges "
            "DEMANDED and "
            "unpaid (e.g. "
            "cheque-bounce; service "
            "charges such as "
            "parking/club "
            "demanded "
            "but unpaid "
            "are voided "
            "with the "
            "booking; "
            "undemanded charges "
            "are never "
            "deducted)"
        ),
        "note": (
            "Refund records are Pending until Accounts marks them Paid; a paid refund posts a negative (contra) ledger row in the bucket it came "
            "from and a "
            "cash-out "
            "line in the "
            "Roznamcha."
        ),
        "used_by": ["Cancellation", "Refunds", "Cancellations report", "Roznamcha"],
    },
    {
        "key": "forfeiture",
        "name": "Forfeiture",
        "formula": "deduction + demanded-unpaid charges recovered when refund payable = 0 → forfeiture record (no refund)",
        "note": "Shown in the cancellations report as amount received vs refund vs forfeiture.",
        "used_by": ["Cancellation", "Cancellations report"],
    },
    {
        "key": "cash_in_hand",
        "name": "Cash in hand (Roznamcha)",
        "formula": (
            "opening balance (cash book) + Σ cash receipts cleared − bank deposits + cash withdrawals − cash refunds, up to the date (a reversed "
            "receipt is a "
            "correction: it is "
            "excluded from "
            "receipts "
            "on its own "
            "date, never "
            "subtracted again)"
        ),
        "note": (
            "A CASH refund/payout cannot exceed cash in hand on its date (CASH_INSUFFICIENT). Legacy (pre-ERP) refunds are flagged `legacy` and "
            "excluded "
            "from the "
            "cash book."
        ),
        "used_by": ["Roznamcha", "Refund payout"],
    },
    {
        "key": "pending_cheques",
        "name": "Cheques in hand",
        "formula": "Σ payments.amount where status = Pending (cheque/DD not yet cleared)",
        "note": "Not part of collections or paid until cleared.",
        "used_by": ["Home tile", "Cheque register", "Booking summary"],
    },
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


def days_to_pay(company: dict | None, ins: dict | None = None) -> int:
    """REQ-206: the one days-to-pay rule (instalment's own due_days, else the company's demand_due_days, else 15)."""
    return int((ins or {}).get("due_days") or (company or {}).get("demand_due_days") or 15)


def due_on(bill_day: str, days: int) -> str:
    """Bill day (India business date) + days-to-pay, calendar days — exactly how instalment due dates are set."""
    return (date.fromisoformat(bill_day) + timedelta(days=int(days))).isoformat()


def oc_parts(other_charges: list[dict] | None, billed_by: date | None = None) -> list[tuple[str, int]]:
    """REQ-205: every billed part of an other-charge line as (due_on, paise). Parts come from demand_history; a line
    billed before parts existed (not yet migrated) ages from its first billed date, as before.
    billed_by (REQ-278): only parts billed on or before that India day."""
    out, cut = [], billed_by.isoformat() if billed_by else None
    for l in other_charges or []:
        if not l.get("demanded_at"):
            continue
        hist, first = l.get("demand_history") or [], clock.day_of(l["demanded_at"])
        for h in hist:
            if cut and (h.get("bill_day") or clock.day_of(h.get("at")) or first) > cut:
                continue
            out.append((h.get("due_on") or clock.day_of(h.get("at")) or first, h.get("paise") or 0))
        rest = (l.get("demanded_paise") or 0) - sum(h.get("paise") or 0 for h in hist)
        if rest > 0 and not (cut and first > cut):
            out.append((l.get("due_on") or first, rest))
    return out


def oc_part_rows(l: dict, today: date) -> list[dict]:
    """One other-charge line's billed parts for display: the line's paid amount covers its oldest parts first; an open part
    is overdue from the India day after its due date (same band_of as everywhere)."""
    if not l.get("demanded_at"):
        return []
    hist = l.get("demand_history") or []
    first = clock.day_of(l["demanded_at"])
    parts = [
        (h.get("bill_day") or clock.day_of(h.get("at")) or first, h.get("due_on") or first, h.get("paise") or 0)
        for h in hist
    ]
    rest = (l.get("demanded_paise") or 0) - sum(p[2] for p in parts)
    if rest > 0:
        parts.append((first, l.get("due_on") or first, rest))
    left, out = l.get("paid_paise") or 0, []
    for bill, due, amt in parts:
        paid = min(left, amt)
        left -= paid
        late = (today - date.fromisoformat(due)).days if amt - paid and band_of(due, today) != "Not due" else 0
        out.append(
            {
                "bill_day": bill,
                "due_on": due,
                "amount_paise": amt,
                "paid_paise": paid,
                "open_paise": amt - paid,
                "status": "paid" if paid == amt else ("overdue" if late else "open"),
                "days_overdue": late,
            }
        )
    return out


def bill_part(
    l: dict,
    at: str,
    paise: int,
    due: str,
    stage_id: str | None = None,
    cum: float | None = None,
    bill_day: str | None = None,
) -> None:
    """Record one billed part on an other-charge line (amount/timing decided by the caller — billing law unchanged).
    `at` = posting timestamp; `bill_day` = India business date of the bill (defaults to the posting day)."""
    h = {"at": at, "bill_day": bill_day or clock.day_of(at), "paise": paise, "due_on": due}
    if stage_id is not None or cum is not None:
        h |= {"stage_id": stage_id, "cum_percent": cum}
    l.setdefault("demand_history", []).append(h)


def _oldest_late(lines: list[tuple], unpaid: int, today: date, late_only: bool = True):
    """Same oldest-paid-first order as _allocate: the oldest line still unpaid (and, if late_only, past its due date)."""
    paid = max(sum(a for _, a in lines) - unpaid, 0)
    for due, amt in sorted(lines, key=lambda x: x[0] or ""):
        take, paid = max(amt - paid, 0), max(paid - amt, 0)
        if take > 0 and (not late_only or band_of(due, today) != "Not due"):
            return due
    return None


def _live_demands(demands: list[dict], billed_by: date | None) -> list[dict]:
    cut = billed_by.isoformat() if billed_by else None
    return [
        d
        for d in demands
        if not d.get("voided")
        and d.get("status") != "Cancelled"
        and not (cut and (d.get("demand_date") or clock.day_of(d.get("posted_at")) or "") > cut)
    ]


def _share_lines(summary: dict, demands: list[dict], other_charges: list[dict], billed_by: date | None):
    """(lines, unpaid) per share — Cash, Account, other-charge parts — billed on or before billed_by (None = all)."""
    out, live = outstanding(summary), _live_demands(demands, billed_by)
    return [
        ([(d.get("due_date"), d.get("cash_demand_paise", 0)) for d in live], out["cash_paise"]),
        ([(d.get("due_date"), d.get("account_demand_paise", 0)) for d in live], out["account_paise"]),
        (oc_parts(other_charges, billed_by), out["other_charges_paise"]),
    ]


def overdue_days(
    summary: dict, demands: list[dict], other_charges: list[dict], as_of: date, billed_by: date | None = None
) -> int:
    """REQ-209: days past due of the oldest unpaid overdue line (instalment share or other-charge part) — the one
    'overdue N days' figure for card, customer page, booking page, Call today and reminders.
    REQ-278: for a past date pass the share state of that date as `summary` and billed_by=as_of."""
    late = [
        _oldest_late(lines, unpaid, as_of) for lines, unpaid in _share_lines(summary, demands, other_charges, billed_by)
    ]
    return max(((as_of - date.fromisoformat(x[:10])).days for x in late if x), default=0)


def ageing_bands(
    summary: dict, demands: list[dict], other_charges: list[dict], as_of: date, billed_by: date | None = None
) -> dict:
    """Per-booking bands incl. other charges. Σ bands == outstanding(summary)['total_paise'] to the paisa."""
    bands = {k: 0 for k in BANDS}
    for lines, unpaid in _share_lines(summary, demands, other_charges, billed_by):
        _allocate(lines, unpaid, as_of, bands)
    return bands


def final_status(
    summary: dict,
    demands: list[dict],
    other_charges: list[dict],
    as_of: date,
    booking_status: str = "Active",
    billed_by: date | None = None,
) -> dict:
    """REQ-277: the one Final status — Overdue N days · Due on <date> · All clear · Advance ₹X · Cancelled ·
    Transferred. Same Due / Advance / Clear order and overdue days as the customer card (cards.balance)."""
    if booking_status in ("Cancelled", "Transferred"):
        return {"kind": booking_status.lower(), "days": 0, "due_on": None, "advance_paise": 0, "due_paise": 0}
    due, adv = outstanding(summary)["total_paise"], advance(summary)
    lines = _share_lines(summary, demands, other_charges, billed_by)
    if due > 0:
        days = overdue_days(summary, demands, other_charges, as_of, billed_by)
        nxt = min((x for x in (_oldest_late(l, u, as_of, False) for l, u in lines) if x), default=None)
        return {
            "kind": "overdue" if days else "due",
            "days": days,
            "due_on": nxt,
            "advance_paise": adv,
            "due_paise": due,
        }
    return {"kind": "advance" if adv > 0 else "clear", "days": 0, "due_on": None, "advance_paise": adv, "due_paise": 0}


SHARE_KEYS = ("cash_due_paise", "account_due_paise", "other_charges_due_paise", "outstanding_paise", "advance_paise")


_LINEAR = ("cash_due_paise", "account_due_paise", "other_charges_due_paise")
_OC_ROWS = ("OTHER_CHARGE_DEMAND", "OTHER_CHARGE_PAYMENT")
_LINEAR += ("cash_order_raised_paise", "account_order_raised_paise", "cash_paid_cum_paise", "account_paid_cum_paise")


async def shares_as_of(booking_ids: list[str], as_of: date) -> dict:
    """REQ-278/335/336: each booking's share state on India day `as_of` = the sum of the steps of every ledger row
    dated on or before that day (a row's step = its running raised / paid-to-date / due minus the row posted before
    it). A row posted earlier but dated after the day (a back-dated bill, a later price revision or waiver) never
    leaks in. Waived-to-date per share from the waiver rows' paid-to-date steps. Received = paid − waived."""
    from db import db

    out, prev = {}, {}
    day = as_of.isoformat()
    proj = {
        "_id": 0,
        "booking_id": 1,
        "type": 1,
        "date": 1,
        "udhar_paise": 1,
        "jama_paise": 1,
        **{k: 1 for k in _LINEAR},
    }
    cur = db.ledger_entries.find({"booking_id": {"$in": booking_ids}}, proj)
    async for e in cur.sort([("booking_id", 1), ("seq", 1)]).batch_size(2000):
        b = e["booking_id"]
        p = prev.get(b) or {}
        prev[b] = e
        if (e.get("date") or "") > day:
            continue
        s = out.setdefault(b, {"cash_waived_paise": 0, "account_waived_paise": 0, **dict.fromkeys(_LINEAR, 0)})
        step = {k: (e.get(k) or 0) - (p.get(k) or 0) for k in _LINEAR}
        # the running other_charges_due on a row counts every other-charge line agreed (billed or not); as of a past
        # day only other-charge bills raised by then count (Udhar − Jama of the other-charge rows) — REQ-338
        if e.get("type") in _OC_ROWS:
            step["other_charges_due_paise"] = (e.get("udhar_paise") or 0) - (e.get("jama_paise") or 0)
        elif e.get("type") not in ("WAIVER", "WAIVER_REVERSAL"):  # a waiver on an other charge steps it down
            step["other_charges_due_paise"] = 0
        for k, v in step.items():
            s[k] += v
        if e.get("type") in ("WAIVER", "WAIVER_REVERSAL"):
            for k in ("cash", "account"):
                s[f"{k}_waived_paise"] += step[f"{k}_paid_cum_paise"]
    for s in out.values():
        for k in ("cash", "account"):
            s[f"{k}_paid_paise"] = s[f"{k}_paid_cum_paise"]
        dues = [s[k] for k in ("cash_due_paise", "account_due_paise", "other_charges_due_paise")]
        s["outstanding_paise"] = sum(max(v, 0) for v in dues)
        s["advance_paise"] = sum(max(-v, 0) for v in dues)
    return out


def overdue_of(bands: dict) -> int:
    return sum(v for k, v in bands.items() if k != "Not due")


async def ageing_for_bookings(booking_match: dict, as_of: date | None = None) -> tuple[dict, dict]:
    """Returns (total bands, {booking_id: bands}) for live bookings matching booking_match."""
    from db import db

    as_of = as_of or clock.today()
    from services.money_snapshot import bills_for

    proj = {"_id": 0, "id": 1, "summary": 1, "other_charges": 1, "money_rev": 1, "money_snapshot": 1}
    bks = await db.bookings.find(live_bookings_match(booking_match), proj).to_list(None)
    dem = await bills_for(bks)  # 3I REQ-355: kept-ready bills per booking (bills read only for out-of-date ones)
    per = {
        b["id"]: ageing_bands(b.get("summary") or {}, dem.get(b["id"], []), b.get("other_charges") or [], as_of)
        for b in bks
    }
    total = {k: sum(p[k] for p in per.values()) for k in BANDS}
    return total, per


# ---------- Cash / Account / Other split of receipts (Phase 1 F-3) ----------
SPLIT_KEYS = ("Cash", "Account", "Other")


def receipt_parts_stages() -> list[dict]:
    """Aggregation stages that turn each receipt into its allocation parts `_part {cat, amt}` (+ `_pi` part index).
    A receipt with `allocations[]` counts each part in its own category (charge lines → Other); a receipt without it
    counts wholly in its single target's category (Other charge → Other, else its payment_category)."""
    whole = {
        "cat": {"$cond": [{"$ne": ["$against", "FLAT_VALUE"]}, "Other", "$payment_category"]},
        "amt": "$amount_paise",
    }
    part = {
        "cat": {"$cond": [{"$eq": ["$$a.kind", "OTHER_CHARGE"]}, "Other", "$$a.category"]},
        "amt": "$$a.amount_paise",
    }
    return [
        {
            "$addFields": {
                "_part": {
                    "$cond": [
                        {"$gt": [{"$size": {"$ifNull": ["$allocations", []]}}, 0]},
                        {"$map": {"input": "$allocations", "as": "a", "in": part}},
                        [whole],
                    ]
                }
            }
        },
        {"$unwind": {"path": "$_part", "includeArrayIndex": "_pi"}},
    ]


def receipt_split_group(key) -> dict:
    """$group stage over receipt_parts_stages(): per key → Cash/Account/Other paise, total paise, receipt count."""
    grp = {
        "_id": key,
        "count": {"$sum": {"$cond": [{"$eq": ["$_pi", 0]}, 1, 0]}},
        "total_paise": {"$sum": "$_part.amt"},
    }
    for c in SPLIT_KEYS:
        grp[f"{c}_paise"] = {"$sum": {"$cond": [{"$eq": ["$_part.cat", c]}, "$_part.amt", 0]}}
    return {"$group": grp}


def receipt_parts(p: dict) -> dict:
    """Python twin of receipt_parts_stages() for one receipt: {Cash, Account, Other} paise."""
    out = dict.fromkeys(SPLIT_KEYS, 0)
    if p.get("allocations"):
        for a in p["allocations"]:
            out["Other" if a["kind"] == "OTHER_CHARGE" else a["category"]] += a["amount_paise"]
    else:
        out["Other" if p.get("against") != "FLAT_VALUE" else p["payment_category"]] += p["amount_paise"]
    return out


async def receipt_split(match: dict, key=None) -> list[dict]:
    """THE Cash / Account / Other split of the receipts matching `match` (callers add status Cleared), grouped by `key`."""
    from db import db

    tail = [*receipt_parts_stages(), receipt_split_group(key)]
    ors = match.get("$or") or []
    if len(ors) != 2 or not all("payment_mode_code" in b for b in ors):
        return await db.payments.aggregate([{"$match": match}, *tail]).to_list(None)
    # 3I: received_match's two branches (receipt day / clearing time) run as two index-led pipelines — the planner
    # picked a full scan for the combined $or. The group fields are sums, so the halves add up exactly.
    rest = {k: v for k, v in match.items() if k != "$or"}
    out: dict = {}
    for br, ix in zip(ors, ("received_mode_day", "received_instrument")):
        hint = {"hint": ix} if "company_id" in rest and "status" in rest else {}
        for r in await db.payments.aggregate([{"$match": {**rest, **br}}, *tail], **hint).to_list(None):
            k = json_key(r["_id"])
            if k in out:
                for f, v in r.items():
                    if f != "_id":
                        out[k][f] = out[k].get(f, 0) + v
            else:
                out[k] = r
    return list(out.values())


def json_key(v) -> str:
    import json

    return json.dumps(v, sort_keys=True, default=str)


async def carried(booking_ids: list[str], from_date: str, to_date: str) -> dict:
    """Carried from before (ledger, two-sided, clearance basis): net balance at From + bills raised in the period − received
    in the period = net balance at To. Net balance = Σ bill raised − Σ received (the ledger's running balance), so one
    server-side aggregation gives all four numbers (REQ-211: no per-entry scan)."""
    from db import db

    def s(cond, f):
        return {"$sum": {"$cond": [cond, {"$ifNull": [f"${f}", 0]}, 0]}}

    before = {"$lt": ["$date", from_date]}
    rows = await db.ledger_entries.aggregate(
        [
            {"$match": {"booking_id": {"$in": booking_ids}, "date": {"$lte": to_date}}},
            {
                "$group": {
                    "_id": None,
                    "ou": s(before, "udhar_paise"),
                    "oj": s(before, "jama_paise"),
                    "bu": s({"$not": [before]}, "udhar_paise"),
                    "bj": s({"$not": [before]}, "jama_paise"),
                    "bw": s(
                        {"$and": [{"$not": [before]}, {"$in": ["$type", ["WAIVER", "WAIVER_REVERSAL"]]}]}, "jama_paise"
                    ),
                }
            },
        ]
    ).to_list(1)
    r = rows[0] if rows else {"ou": 0, "oj": 0, "bu": 0, "bj": 0, "bw": 0}
    # REQ-250: waivers are Jama but not money received — billed − received − waived
    opening, billed, waived = r["ou"] - r["oj"], r["bu"], r["bw"]
    received = r["bj"] - waived
    closing = opening + billed - received - waived
    return {
        "from_date": from_date,
        "to_date": to_date,
        "opening_paise": opening,
        "billed_paise": billed,
        "received_paise": received,
        "waived_paise": waived,
        "closing_paise": closing,
        "ties": True,
    }


def receipts_bridge(receipts: list[dict], ledger_day: dict, live: set, f: str, t: str, refunds_paise: int) -> dict:
    """Collections (receipt date) → received by clearance (ledger), exact (iteration 12):
    A by receipt date − X on not-live bookings − B dated in period, cleared after + C dated outside, cleared in period
    + refunds (negative jama) = D. `receipts`: Cleared/Reversed receipts; `ledger_day`: receipt number → ledger day."""
    a = x = b = c = 0
    for p in receipts:
        amt, rd = p["amount_paise"], p["payment_date"]
        rev = (
            clock.day_of((p.get("reversal") or {}).get("at") or p.get("updated_at"))
            if p["status"] == "Reversed"
            else None
        )
        net_in = (amt if f <= rd <= t else 0) - (amt if rev and f <= rev <= t else 0)
        a += net_in
        if p["booking_id"] not in live:
            x += net_in
            continue
        ld = ledger_day.get(p.get("receipt_number"))
        if f <= rd <= t and not (ld and f <= ld <= t):
            b += amt
        if ld and f <= ld <= t and not (f <= rd <= t):
            c += amt
    return {
        "by_receipt_date_paise": a,
        "not_live_paise": x,
        "dated_in_cleared_after_paise": b,
        "dated_before_cleared_in_paise": c,
        "refunds_paise": refunds_paise,
        "by_clearance_paise": a - x - b + c + refunds_paise,
    }


async def bill_settle_days(booking_ids: list[str], as_of: date) -> dict:
    """Payment behaviour (REQ-279): per booking, days late for each instalment bill raised by `as_of` that is either
    settled or past due (a bill paid ahead of its due date counts as on time). A bill is settled
    on the first ledger day the paid-to-date total (receipts + waivers, oldest-first) covers it and all older bills;
    ≤ 0 = on time. A bill still open past its due date counts as late up to `as_of`."""
    from db import db

    cut = as_of.isoformat()
    bills: dict = {}
    q = {"booking_id": {"$in": booking_ids}, "voided": {"$ne": True}, "status": {"$ne": "Cancelled"}}
    async for d in db.demands.find(
        q, {"_id": 0, "booking_id": 1, "due_date": 1, "demand_date": 1, "total_demand_paise": 1}
    ):
        if (d.get("demand_date") or "") <= cut and d.get("due_date"):
            bills.setdefault(d["booking_id"], []).append((d["due_date"][:10], d.get("total_demand_paise") or 0))
    paid: dict = {}
    proj = {"_id": 0, "booking_id": 1, "date": 1, "cash_paid_cum_paise": 1, "account_paid_cum_paise": 1}
    cur = db.ledger_entries.find({"booking_id": {"$in": list(bills)}, "date": {"$lte": cut}}, proj)
    async for e in cur.sort([("booking_id", 1), ("seq", 1)]).batch_size(5000):
        paid.setdefault(e["booking_id"], []).append(
            (e["date"], (e.get("cash_paid_cum_paise") or 0) + (e.get("account_paid_cum_paise") or 0))
        )
    out = {}
    for bid, bl in bills.items():
        rows, cum, i, late = paid.get(bid, []), 0, 0, []
        for due, amt in sorted(bl):
            cum += amt
            while i < len(rows) and rows[i][1] < cum:
                i += 1
            if i < len(rows):
                late.append((date.fromisoformat(rows[i][0][:10]) - date.fromisoformat(due)).days)
            elif due < cut:
                late.append((as_of - date.fromisoformat(due)).days)
        out[bid] = late
    return out
