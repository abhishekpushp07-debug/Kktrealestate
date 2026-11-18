"""Payment ledger engine: everything derived from source docs (demands, payments, revisions, cancellation)."""

import asyncio
from datetime import date, timedelta

from db import db
from services import clock
from services.allocation import explode
from services.money import pct_of
from services.numbering import generate_number
from utils import new_id, now_iso

CLEAR_IMMEDIATELY = {"CASH", "UPI", "NEFT_RTGS", "LOAN_DISBURSEMENT"}


def _orders(cash_agreed: int, account_agreed: int, pct: float) -> tuple[int, int]:
    return pct_of(cash_agreed, pct), pct_of(account_agreed, pct)


def is_manual_bill(d: dict) -> bool:
    """A bill raised by hand (Demand register "manual bill"): owed by its own amount per share, outside the plan %."""
    return d.get("trigger_type") == "MANUAL"


def _manual_totals(demands) -> tuple[int, int]:
    """PRE-01 (owner decision A, 2026-11-18): manual bills count in Outstanding — added to the order raised per share."""
    m = [d for d in demands if is_manual_bill(d)]
    return sum(d.get("cash_demand_paise", 0) for d in m), sum(d.get("account_demand_paise", 0) for d in m)


def _oc_totals(lines: list[dict]) -> tuple[int, int]:
    return sum(l.get("demanded_paise", 0) for l in lines), sum(l.get("paid_paise", 0) for l in lines)


def _waiver_events(waivers) -> list[tuple]:
    """REQ-247: approved waiver = Jama credit(s); a cancelled one adds exact reversing rows on its cancel date."""
    out = []
    for w in waivers:
        for e in w.get("entries") or []:
            src = {**e, "cn_number": w["cn_number"], "waiver_number": w["waiver_number"], "reason": w["reason"]}
            out.append((w["approved_at"], 1, "WAIVER", src))
            if w["status"] == "Cancelled":
                out.append((w["cancelled_at"], 2, "WAIVER_REVERSAL", {**src, "reason": w.get("cancel_reason")}))
    return out


def _collect_events(
    b: dict, demands: list[dict], payments: list[dict], lines: dict, refunds: list[dict], waivers: list[dict] = ()
) -> list[tuple]:
    """Chronological ledger events: (at, order, kind, source)."""
    events = _waiver_events(waivers)
    for d in demands:
        events.append((d["posted_at"], 0, "DEMAND", d))
    for l in lines.values():
        if l.get("demand_history"):  # PS.3: stage-proportional lines — one row per increment
            for h in l["demand_history"]:
                events.append((h["at"], 0, "OTHER_CHARGE_DEMAND", {**l, "demanded_paise": h["paise"]}))
        elif l.get("demanded_at"):
            events.append((l["demanded_at"], 0, "OTHER_CHARGE_DEMAND", l))
    for p0 in payments:
        for p in explode(
            p0
        ):  # S3.1: split receipts → one ledger row per allocation; reversal reverses every allocation
            kind = "OTHER_CHARGE_PAYMENT" if p["against"] == "OTHER_CHARGE" else "PAYMENT"
            events.append((p["posted_at"], 1, kind, p))
            if p["status"] == "Reversed":
                events.append((p["reversal"]["at"], 2, "REVERSAL", p))
    for r in b.get("agreement_revisions") or []:
        events.append((r["at"], 0, "AGREEMENT_CHANGE", r))
    if b.get("cancellation"):
        events.append((b["cancellation"]["at"], 3, "CANCELLATION", b["cancellation"]))
    for rf in refunds:
        events.append((rf["paid_at"], 4, "REFUND", rf))
    for t in b.get("transfers") or []:
        events.append((t["at"], 0, "TRANSFER", t))
    events.sort(key=lambda e: (e[0], e[1]))
    return events


class _Running:
    """Running ledger state; one handler per event kind returns (amount, category, ref, note) and mutates the running totals."""

    def __init__(self, b: dict, revisions: list[dict], lines: dict):
        # the agreement in force at booking = "before" of the earliest change (revision, or a transfer that re-priced it)
        changes = sorted(
            [r for r in revisions if r.get("before")] + [t for t in b.get("transfers") or [] if t.get("before")],
            key=lambda c: c["at"],
        )
        first = changes[0]["before"] if changes else b
        self.cash_agreed, self.account_agreed = first["cash_agreed_paise"], first["account_agreed_paise"]
        self.pct, self.cash_paid, self.account_paid, self.last_pay = 0, 0, 0, None
        self.closed = False
        self.lines = lines
        self.waived = {"Cash": 0, "Account": 0, "Other": 0}
        self.manual_cash = self.manual_account = 0

    def apply(self, kind: str, src: dict) -> tuple:
        return getattr(self, f"_{kind.lower()}")(src)

    def _bucket(self, category, amount):
        if category == "Cash":
            self.cash_paid += amount
        else:
            self.account_paid += amount

    def _touch_last_pay(self, src):
        if src["status"] != "Reversed":
            self.last_pay = max(self.last_pay or "", src["payment_date"])

    def _demand(self, src):
        if (
            src.get("cumulative_percent") is not None
        ):  # manual/other demands carry no plan %, they add Udhar by amount only
            self.pct = src["cumulative_percent"]
        if is_manual_bill(src):
            self.manual_cash += src.get("cash_demand_paise", 0)
            self.manual_account += src.get("account_demand_paise", 0)
        note = f"{src.get('installment_name') or src['milestone_name']} ({src.get('percent') if src.get('percent') is not None else self.pct}%)"
        return src["total_demand_paise"], None, src["demand_number"], note

    def _payment(self, src):
        amount, category = src["amount_paise"], src["payment_category"]
        self._bucket(category, amount)
        self._touch_last_pay(src)
        return amount, category, src["receipt_number"], src.get("_alloc_note")

    def _other_charge_payment(self, src):
        amount, note = src["amount_paise"], None
        line = self.lines.get(src.get("other_charge_line_id"))
        if line:
            line["paid_paise"] += amount
            note = line["name"]
        self._touch_last_pay(src)
        return amount, None, src["receipt_number"], note

    def _reversal(self, src):
        amount, category = -src["amount_paise"], None
        if src["against"] == "OTHER_CHARGE":
            line = self.lines.get(src.get("other_charge_line_id"))
            if line:
                line["paid_paise"] += amount
        else:
            category = src["payment_category"]
            self._bucket(category, amount)
        return amount, category, src["receipt_number"], src["reversal"].get("reason")

    def _waiver(self, src, sign=1):
        amount = sign * src["amount_paise"]
        if src["bucket"] == "Other":
            line = self.lines.get(src.get("line_id"))
            if line:
                line["paid_paise"] += amount
                line["waived_paise"] = (
                    line.get("waived_paise", 0) + amount
                )  # paid incl. waiver; collected = paid − waived
            category = None
        else:
            category = src["bucket"]
            self._bucket(category, amount)
        self.waived[src["bucket"]] += amount
        label = "Waiver" if sign > 0 else "Waiver cancelled"
        return amount, category, src["cn_number"], f"{label} {src['waiver_number']} · {src.get('reason') or ''}"

    def _waiver_reversal(self, src):
        return self._waiver(src, -1)

    def _other_charge_demand(self, src):
        return src["demanded_paise"], None, None, src["name"]

    def _agreement_change(self, src):
        self.cash_agreed, self.account_agreed = src["after"]["cash_agreed_paise"], src["after"]["account_agreed_paise"]
        amount = (self.cash_agreed + self.account_agreed) - (
            src["before"]["cash_agreed_paise"] + src["before"]["account_agreed_paise"]
        )
        return amount, None, None, src.get("reason")

    def _cancellation(self, src):
        self.closed = True
        return (
            0,
            None,
            None,
            f"{src.get('reason')} · refund payable {src.get('refund_paise', 0) / 100:,.0f} · deduction {src.get('deduction_paise', 0) / 100:,.0f}",
        )

    def _refund(self, src):
        amount, category = -src["amount_paise"], src.get("bucket")
        note = f"Refund paid · {src.get('mode') or ''} {src.get('reference') or ''}".strip()
        if category == "Cash":
            self.cash_paid += amount
        elif category == "Account":
            self.account_paid += amount
        else:
            for line in self.lines.values():
                if line.get("paid_paise", 0) > 0:
                    take = min(line["paid_paise"], -amount)
                    line["paid_paise"] -= take
                    amount += take
                    if amount >= 0:
                        break
            amount = -src["amount_paise"]
        return amount, category, src.get("refund_number"), note

    def _transfer(self, src):
        after = src.get("after") or {}
        if "cash_agreed_paise" in after:  # a transfer with price_handling=revise_agreement re-prices the booking
            self.cash_agreed, self.account_agreed = after["cash_agreed_paise"], after["account_agreed_paise"]
        return 0, None, None, f"Transferred {src.get('from_flat')} → {src.get('to_flat')} · {src.get('reason') or ''}"


_REBUILD_LOCKS: dict[str, asyncio.Lock] = {}


async def rebuild(booking_id: str) -> list[dict]:
    """Serialised per booking across processes (3G: Mongo lease) and within one (asyncio lock): two overlapping
    rebuilds must not interleave delete + insert (duplicate seqs) or let the older read land last."""
    from services.booking_lock import booking_lock

    lock = _REBUILD_LOCKS.setdefault(booking_id, asyncio.Lock())
    try:
        async with booking_lock(booking_id), lock:
            return await _rebuild(booking_id)
    finally:
        if not lock.locked() and not getattr(lock, "_waiters", None):
            _REBUILD_LOCKS.pop(booking_id, None)


async def _rebuild(booking_id: str) -> list[dict]:
    b = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not b:
        return []
    demands = await db.demands.find({"booking_id": booking_id, "voided": {"$ne": True}}, {"_id": 0}).to_list(None)
    payments = await db.payments.find(
        {"booking_id": booking_id, "status": {"$in": ["Cleared", "Reversed"]}}, {"_id": 0}
    ).to_list(None)
    revisions = b.get("agreement_revisions") or []
    lines = {l["line_id"]: dict(l, paid_paise=0, waived_paise=0) for l in (b.get("other_charges") or [])}
    refunds = await db.refunds.find({"booking_id": booking_id, "status": "Paid"}, {"_id": 0}).to_list(None)
    waivers = await db.waivers.find(
        {"booking_id": booking_id, "status": {"$in": ["Approved", "Cancelled"]}, "approved_at": {"$ne": None}},
        {"_id": 0},
    ).to_list(None)
    events = _collect_events(b, demands, payments, lines, refunds, waivers)
    acc = _Running(b, revisions, lines)
    rows = []
    for seq, (at, _, kind, src) in enumerate(events, start=1):
        amount, category, ref, note = acc.apply(kind, src)
        pct, cash_paid, account_paid, closed, cash_agreed, account_agreed = (
            acc.pct,
            acc.cash_paid,
            acc.account_paid,
            acc.closed,
            acc.cash_agreed,
            acc.account_agreed,
        )
        c_ord, a_ord = (cash_paid, account_paid) if closed else _orders(cash_agreed, account_agreed, pct)
        if not closed:
            c_ord, a_ord = c_ord + acc.manual_cash, a_ord + acc.manual_account
        oc_dem, oc_paid = _oc_totals(list(lines.values()))
        if closed:
            oc_dem = oc_paid
        rows.append(
            {
                "id": new_id(),
                "booking_id": booking_id,
                "seq": seq,
                "at": at,
                "date": clock.day_of(at),
                "type": kind,
                "construction_percent": pct,
                "category": category,
                "amount_paise": amount,
                "note": note,
                "ref": ref,
                "cash_paid_cum_paise": cash_paid,
                "account_paid_cum_paise": account_paid,
                "cash_order_raised_paise": c_ord,
                "account_order_raised_paise": a_ord,
                "cash_due_paise": c_ord - cash_paid,
                "account_due_paise": a_ord - account_paid,
                "total_due_paise": (c_ord - cash_paid) + (a_ord - account_paid),
                "outstanding_paise": max(c_ord - cash_paid, 0)
                + max(a_ord - account_paid, 0)
                + max(oc_dem - oc_paid, 0),
                "advance_paise": max(cash_paid - c_ord, 0) + max(account_paid - a_ord, 0) + max(oc_paid - oc_dem, 0),
                "other_charges_due_paise": oc_dem - oc_paid,
            }
        )
    two_sided(rows, events)
    pct, cash_paid, account_paid, last_pay = acc.pct, acc.cash_paid, acc.account_paid, acc.last_pay
    # final summary
    pct_now = b.get("raised_percent", b.get("construction_percent", pct))
    c_ord, a_ord = _orders(b["cash_agreed_paise"], b["account_agreed_paise"], pct_now)
    m_cash, m_account = _manual_totals(demands)
    c_ord, a_ord = c_ord + m_cash, a_ord + m_account
    if b.get("status") == "Cancelled":
        c_ord, a_ord = cash_paid, account_paid  # ledger closed: nothing further due
        for line in lines.values():
            line["demanded_paise"] = line.get("paid_paise", 0)
    oc_dem, oc_paid = _oc_totals(list(lines.values()))
    pending = sum(
        p["amount_paise"]
        for p in await db.payments.find(
            {"booking_id": booking_id, "status": "Pending"}, {"_id": 0, "amount_paise": 1}
        ).to_list(None)
    )
    summary = {
        "cash_order_raised_paise": c_ord,
        "account_order_raised_paise": a_ord,
        "total_order_raised_paise": c_ord + a_ord,
        "cash_paid_paise": cash_paid,
        "account_paid_paise": account_paid,
        "paid_paise": cash_paid + account_paid,
        "cash_due_paise": c_ord - cash_paid,
        "account_due_paise": a_ord - account_paid,
        "due_paise": (c_ord - cash_paid) + (a_ord - account_paid),
        "other_charges_demanded_paise": oc_dem,
        "other_charges_paid_paise": oc_paid,
        "other_charges_due_paise": oc_dem - oc_paid,
        "pending_cheques_paise": pending,
        "last_payment_at": last_pay,
        # definitions.outstanding / advance — buckets never net against each other (law)
        "outstanding_paise": max(c_ord - cash_paid, 0) + max(a_ord - account_paid, 0) + max(oc_dem - oc_paid, 0),
        "advance_paise": max(cash_paid - c_ord, 0) + max(account_paid - a_ord, 0) + max(oc_paid - oc_dem, 0),
        "other_charges_undemanded_paise": sum(
            line.get("total_paise", 0) - line.get("demanded_paise", 0) for line in lines.values()
        ),
    }
    summary["due_paise"] = summary["outstanding_paise"]
    summary.update(
        total_udhar_paise=sum(r["udhar_paise"] for r in rows),
        total_jama_paise=sum(r["jama_paise"] for r in rows),
        cash_udhar_paise=sum(r["udhar_cash_paise"] for r in rows),
        cash_jama_paise=sum(r["jama_paise"] for r in rows if r["category"] == "Cash"),
        account_udhar_paise=sum(r["udhar_account_paise"] for r in rows),
        account_jama_paise=sum(r["jama_paise"] for r in rows if r["category"] == "Account"),
        other_udhar_paise=sum(r["udhar_paise"] for r in rows if r["type"] == "OTHER_CHARGE_DEMAND"),
        other_jama_paise=sum(r["jama_paise"] for r in rows if r["type"] == "OTHER_CHARGE_PAYMENT"),
        # REQ-249: waivers are Jama but never "received" money
        cash_waived_paise=acc.waived["Cash"],
        account_waived_paise=acc.waived["Account"],
        other_waived_paise=acc.waived["Other"],
        waived_paise=sum(acc.waived.values()),
    )
    summary["balance_paise"] = summary["total_udhar_paise"] - summary["total_jama_paise"]
    summary["net_balance_paise"] = (
        summary["outstanding_paise"] - summary["advance_paise"]
    )  # == balance_paise by the two-sided law
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
        if b.get("status") == "Cancelled" and status != "Paid":
            status = "Cancelled"  # definition: a cancelled booking carries no live demands
        parts = {
            "cash_paid_paise": paid_c,
            "cash_open_paise": d["cash_demand_paise"] - paid_c,
            "account_paid_paise": paid_a,
            "account_open_paise": d["account_demand_paise"] - paid_a,
        }
        if (d.get("status") != status) or d.get("paid_paise") != paid or d.get("paid_parts") != parts:
            await db.demands.update_one(
                {"id": d["id"]}, {"$set": {"status": status, "paid_paise": paid, "paid_parts": parts}}
            )
    await db.ledger_entries.raw("ledger projection rebuild").delete_many({"booking_id": booking_id})
    if rows:
        await db.ledger_entries.insert_many([dict(r) for r in rows])
    await db.bookings.update_one(
        {"id": booking_id},
        {"$set": {"summary": summary, "other_charges": list(lines.values()), "ledger_rebuilt_at": now_iso()}},
    )
    return rows


async def create_demand(
    booking: dict, company: dict, milestone: dict, completed_on: date, due_days: int, posted_at: str
) -> dict | None:
    """Incremental demand for a booking when construction moves to milestone.cumulative_percent."""
    if booking.get("status") != "Active":  # law: no demands on cancelled / transferred-away bookings
        return None
    new_pct = milestone["cumulative_percent"]
    old_pct = booking.get("construction_percent", 0)
    c_old, a_old = _orders(booking["cash_agreed_paise"], booking["account_agreed_paise"], old_pct)
    c_new, a_new = _orders(booking["cash_agreed_paise"], booking["account_agreed_paise"], new_pct)
    cash_d, acc_d = c_new - c_old, a_new - a_old
    if cash_d <= 0 and acc_d <= 0:
        await db.bookings.update_one({"id": booking["id"]}, {"$set": {"construction_percent": new_pct}})
        return None
    d = {
        "id": new_id(),
        "company_id": booking["company_id"],
        "booking_id": booking["id"],
        "customer_id": booking["customer_id"],
        "project_id": booking["project_id"],
        "block_id": booking["block_id"],
        "flat_id": booking["flat_id"],
        "demand_number": await generate_number("demand", company, completed_on),
        "milestone_seq": milestone["seq"],
        "milestone_name": milestone["name"],
        "cumulative_percent": new_pct,
        "cash_demand_paise": cash_d,
        "account_demand_paise": acc_d,
        "total_demand_paise": cash_d + acc_d,
        "demand_date": completed_on.isoformat(),
        "due_date": (completed_on + timedelta(days=due_days)).isoformat(),
        "status": "Open",
        "paid_paise": 0,
        "voided": False,
        "posted_at": posted_at,
        "created_at": now_iso(),
    }
    await db.demands.insert_one(d)
    d.pop("_id", None)
    await db.bookings.update_one(
        {"id": booking["id"]}, {"$set": {"construction_percent": new_pct, "updated_at": now_iso()}}
    )
    return d


def raise_other_charges(
    booking: dict, trigger: str, at: str, due: str | None, bill_day: str | None = None
) -> list[dict]:
    from services.definitions import bill_part

    lines = booking.get("other_charges") or []
    changed = False
    for l in lines:
        if l.get("demand_at") == trigger and not l.get("demanded_at"):
            l["demanded_at"] = at
            l["demanded_paise"] = l["total_paise"]
            bill_part(
                l, at, l["total_paise"], due, bill_day=bill_day if at != "preview" else None
            )  # REQ-205/206: one part, due = bill day + days-to-pay
            changed = True
    return lines if changed else []


async def _cleared_parts(booking_id: str) -> list[dict]:
    docs = await db.payments.find(
        {"booking_id": booking_id, "status": "Cleared"},
        {"_id": 0, "against": 1, "payment_category": 1, "other_charge_line_id": 1, "amount_paise": 1, "allocations": 1},
    ).to_list(None)
    return [p for d in docs for p in explode(d)]


async def bucket_paid(booking_id: str, category: str) -> int:
    return sum(
        p["amount_paise"]
        for p in await _cleared_parts(booking_id)
        if p["against"] == "FLAT_VALUE" and p["payment_category"] == category
    )


async def line_paid(booking_id: str, line_id: str) -> int:
    return sum(
        p["amount_paise"]
        for p in await _cleared_parts(booking_id)
        if p["against"] == "OTHER_CHARGE" and p.get("other_charge_line_id") == line_id
    )


UDHAR_TYPES = ("DEMAND", "OTHER_CHARGE_DEMAND", "AGREEMENT_CHANGE")
JAMA_TYPES = ("PAYMENT", "OTHER_CHARGE_PAYMENT", "REVERSAL", "REFUND", "WAIVER", "WAIVER_REVERSAL")


def two_sided(rows: list[dict], events: list) -> None:
    """Owner's ledger law: Udhar (dues raised) | Jama (money received; reversals/refunds negative) | Mode | running Balance = Σ Udhar − Σ Jama."""
    bal = cum_flat = cum_cash = cum_acct = cum_other = oc_jama = 0
    for r, (_, _p, kind, src) in zip(rows, events):
        amt = r["amount_paise"]
        udhar = amt if kind in UDHAR_TYPES else 0
        jama = amt if kind in JAMA_TYPES else 0
        u_cash = src.get("cash_demand_paise", 0) if kind == "DEMAND" else 0
        u_acct = src.get("account_demand_paise", 0) if kind == "DEMAND" else 0
        if kind in ("TRANSFER", "AGREEMENT_CHANGE", "CANCELLATION", "REFUND"):
            # re-basing rows: Udhar adjusts so that Σ flat-value Udhar == order raised (definitions) at this point
            u_cash = r["cash_order_raised_paise"] - cum_cash
            u_acct = r["account_order_raised_paise"] - cum_acct
            udhar = u_cash + u_acct
            if kind == "CANCELLATION":
                udhar += oc_jama - cum_other  # undemanded/unpaid other charges are written off with the booking
        u_other = jama if kind == "REFUND" and r.get("category") in (None, "Other") else 0
        udhar += u_other  # other-charge money refunded: its Udhar is rebased by the refunded amount
        if kind == "OTHER_CHARGE_PAYMENT" or (
            kind in ("REVERSAL", "REFUND", "WAIVER", "WAIVER_REVERSAL") and r.get("category") in (None, "Other")
        ):
            oc_jama += jama
        if kind == "PAYMENT" and src.get("status") == "Reversed":
            r["tag"] = "REVERSED"
        elif kind == "REVERSAL":
            r["tag"] = "REVERSED"
        elif kind == "REFUND":
            r["tag"] = "REFUND"
        elif kind == "CANCELLATION":
            r["tag"] = "CANCELLED"
        elif kind in ("WAIVER", "WAIVER_REVERSAL"):
            r["tag"] = "WAIVER" if kind == "WAIVER" else "WAIVER CANCELLED"
        elif kind == "PAYMENT" and src.get("status") == "Bounced":
            r["tag"] = "BOUNCED"
        else:
            r["tag"] = None
        mode = (
            "Waiver (credit note)"
            if kind in ("WAIVER", "WAIVER_REVERSAL")
            else src.get("payment_mode_name")
            or src.get("payment_mode")
            or src.get("mode")
            or ("Due" if udhar else None)
        )
        inst = (
            (src.get("instrument") or {}).get("number")
            if isinstance(src.get("instrument"), dict)
            else (src.get("instrument_number") or src.get("cheque_number") or src.get("reference") or src.get("utr"))
        )
        bal += udhar - jama
        if kind != "OTHER_CHARGE_DEMAND":
            cum_flat += udhar - u_other
            cum_cash += u_cash
            cum_acct += u_acct
            cum_other += u_other
        else:
            cum_other += udhar
        r.update(
            udhar_paise=udhar,
            jama_paise=jama,
            mode=mode,
            instrument=inst,
            balance_paise=bal,
            udhar_cash_paise=u_cash,
            udhar_account_paise=u_acct,
        )


def paid_detail(d: dict) -> str | None:
    """Plain-English detail for a Partially Paid bill: which share is settled and what is still open."""
    if d.get("status") != "Partially Paid" or not d.get("paid_parts"):
        return None
    pp, bits = d["paid_parts"], []
    for label, dem, paid, open_ in (
        ("Cash", d.get("cash_demand_paise", 0), pp["cash_paid_paise"], pp["cash_open_paise"]),
        ("Account", d.get("account_demand_paise", 0), pp["account_paid_paise"], pp["account_open_paise"]),
    ):
        if not dem:
            continue
        bits.append(
            f"{label} part paid"
            if open_ <= 0
            else f"{label} {_inr(open_)} open"
            if paid <= 0
            else f"{label} {_inr(paid)} paid · {_inr(open_)} open"
        )
    return " · ".join(bits) or None


def _inr(paise: int) -> str:
    from services.money import inr

    return inr(paise)
