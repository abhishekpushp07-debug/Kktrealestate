"""Customers segment providers. Read-only: every money figure comes from services.definitions."""

from datetime import date

from db import db
from deps import report_scope_filter
from services import clock
from services import definitions as D
from services.cards import _stages, plan_status

_BOOKING = {
    "_id": 0,
    "id": 1,
    "customer_id": 1,
    "customer_name": 1,
    "customer_phone": 1,
    "booking_number": 1,
    "booking_date": 1,
    "status": 1,
    "cancellation.at": 1,
    "project_id": 1,
    "project_code": 1,
    "block_id": 1,
    "block_name": 1,
    "flat_id": 1,
    "flat_snapshot.flat_number": 1,
    "agreement_value_paise": 1,
    "cash_agreed_paise": 1,
    "account_agreed_paise": 1,
    "sales_user_id": 1,
    "payment_plan_snapshot.id": 1,
    "payment_plan_snapshot.name": 1,
    "payment_plan_snapshot.installments.seq": 1,
    "payment_plan_snapshot.installments.name": 1,
    "payment_plan_snapshot.installments.percent": 1,
    "payment_plan_snapshot.installments.trigger_type": 1,
    "payment_plan_snapshot.installments.trigger_stage_id": 1,
    "payment_plan_snapshot.installments.trigger_stage_name": 1,
    "summary": 1,
    "lead_id": 1,
    "plan_acceptance.accepted_on": 1,
    "other_charges.demanded_at": 1,
    "other_charges.demanded_paise": 1,
    "other_charges.demand_history": 1,
    "other_charges.due_on": 1,
}
_DEMAND = {
    "_id": 0,
    "booking_id": 1,
    "installment_seq": 1,
    "status": 1,
    "total_demand_paise": 1,
    "cash_demand_paise": 1,
    "account_demand_paise": 1,
    "paid_paise": 1,
    "due_date": 1,
    "demand_date": 1,
    "posted_at": 1,
    "voided": 1,
}


def _live_at(b: dict, as_of: date) -> str:
    """Booking status on the as-of day: a booking cancelled after that day was still live on it."""
    if b["status"] in D.LIVE_BOOKING_STATUSES:
        return "Active"
    if b["status"] == "Cancelled":  # REQ-337 (owner): a cancelled booking is not a sale on any date
        return "Cancelled"
    gone = clock.day_of((b.get("cancellation") or {}).get("at")) or ""
    return "Active" if gone and gone > as_of.isoformat() else b["status"]


async def booking_universe(user: dict, as_of: date) -> list[dict]:
    q = {
        "company_id": user["company_id"],
        **report_scope_filter(user),
        "booking_date": {"$lte": as_of.isoformat()},
        "status": {"$in": [*D.LIVE_BOOKING_STATUSES, "Cancelled", "Transferred"]},
    }
    return await db.bookings.find(q, _BOOKING).to_list(None)


async def _lookups(user: dict, as_of: date):
    """Bookings + their bills, floors, sales names and tower stages, read in parallel (REQ-271)."""
    import asyncio

    cid = user["company_id"]

    async def demands():
        dem: dict = {}
        q = {"company_id": cid, "voided": {"$ne": True}, **report_scope_filter(user)}
        async for d in db.demands.find(q, _DEMAND).batch_size(5000):
            dem.setdefault(d["booking_id"], []).append(d)
        return dem

    async def floors():
        return {
            f["id"]: f.get("floor") async for f in db.flats.find({"company_id": cid}, {"_id": 0, "id": 1, "floor": 1})
        }

    async def users():
        return {
            u["id"]: u.get("name") or u.get("email")
            async for u in db.users.find({}, {"_id": 0, "id": 1, "name": 1, "email": 1})
        }

    async def stages():
        blocks = await db.blocks.distinct("id", {"company_id": cid})
        return await _stages(set(blocks))

    async def last_paid():
        q = {"company_id": cid, "status": {"$in": ["Cleared", "Pending"]}, "payment_date": {"$lte": as_of.isoformat()}}
        agg = [{"$match": q}, {"$group": {"_id": "$booking_id", "d": {"$max": "$payment_date"}}}]
        return {x["_id"]: x["d"] async for x in db.payments.aggregate(agg)}

    return await asyncio.gather(booking_universe(user, as_of), demands(), floors(), users(), stages(), last_paid())


def dims(b: dict, floors: dict, users: dict) -> dict:
    flat = (b.get("flat_snapshot") or {}).get("flat_number") or ""
    plan = b.get("payment_plan_snapshot") or {}
    fl = floors.get(b["flat_id"])
    return {
        "booking_id": b["id"],
        "customer_id": b.get("customer_id"),
        "customer_name": b.get("customer_name"),
        "customer_label": b.get("customer_name"),
        "phone": b.get("customer_phone"),
        "booking_number": b.get("booking_number"),
        "booking_date": b.get("booking_date"),
        "project_id": b.get("project_id"),
        "project": b.get("project_code"),
        "tower_id": b.get("block_id"),
        "tower": b.get("block_name"),
        "floor_id": f"{b.get('block_id')}:{fl}",
        "floor": (fl_name := "Ground" if fl == 0 else f"Floor {fl}" if fl is not None else "—"),
        "floor_label": f"{b.get('block_name')} · {fl_name}",
        "flat_id": b.get("flat_id"),
        "flat": flat,
        "flat_code": f"{b.get('project_code')} · {b.get('block_name')} · {flat}",
        "sales_id": b.get("sales_user_id") or "-",
        "sales_person": users.get(b.get("sales_user_id")) or "Unassigned",
        "plan_id": plan.get("id") or "-",
        "plan": plan.get("name") or "—",
    }


BAND_KEYS = {
    "Not due": "band_not_due",
    "0-30": "band_0_30",
    "31-60": "band_31_60",
    "61-90": "band_61_90",
    "90+": "band_90p",
}
STATUS_GROUP = {
    "overdue": "Overdue",
    "due": "Due, not late",
    "clear": "All clear",
    "advance": "Advance",
    "cancelled": "Cancelled",
    "transferred": "Transferred",
}


def status_label(fs: dict) -> str:
    from services.pdf import fmt_date, inr

    k = fs["kind"]
    if k == "overdue":
        return f"Overdue {fs['days']} day{'s' if fs['days'] != 1 else ''}"
    if k == "due":
        return f"Due on {fmt_date(fs['due_on'])}" if fs.get("due_on") else "Due"
    if k == "advance":
        return f"Advance {inr(fs['advance_paise'])}"
    return {"clear": "All clear", "cancelled": "Cancelled", "transferred": "Transferred"}[k]


async def customer_status(user: dict, ctx: dict) -> list[dict]:
    """The booking rows every booking-grain Customers report reads (cached once per scope + as-of + data stamp)."""
    from services import ttlcache

    key = f"rpt3:base:{ttlcache.scope_key(user)}:{ctx['as_of']}:{clock.today()}:{ctx.get('stamp')}"
    return await ttlcache.cached(key, 600, lambda: _booking_rows(user, ctx["as_of"]), stamped=True)


async def _booking_rows(user: dict, as_of: date) -> list[dict]:
    """REQ-276…278: one row per booking; past dates read the ledger's share state of that day (definitions.shares_as_of)."""
    past = as_of < clock.today()
    bks, dem, floors, users, stages, paid_on = await _lookups(user, as_of)
    snap = await D.shares_as_of([b["id"] for b in bks], as_of) if past else {}
    rows = []
    for b in bks:
        st = _live_at(b, as_of)
        s = snap.get(b["id"], {}) if past else (b.get("summary") or {})
        cut = as_of if past else None
        ds, oc = dem.get(b["id"], []), b.get("other_charges") or []
        fs = D.final_status(s, ds, oc, as_of, st, cut)
        live = fs["kind"] not in ("cancelled", "transferred")
        shown = [d for d in ds if not cut or (d.get("demand_date") or "") <= cut.isoformat()]
        plan = plan_status(b, shown, stages.get(b["block_id"], []), as_of)
        cw, aw = s.get("cash_waived_paise", 0), s.get("account_waived_paise", 0)
        cash_due, acc_due = s.get("cash_due_paise", 0), s.get("account_due_paise", 0)
        bands = D.ageing_bands(s, ds, oc, as_of, cut) if live else dict.fromkeys(D.BANDS, 0)
        rows.append(
            dims(b, floors, users)
            | {
                "agreement_value": b.get("agreement_value_paise") or 0,
                "cash_component": b.get("cash_agreed_paise") or 0,
                "account_component": b.get("account_agreed_paise") or 0,
                "bills_raised": s.get("cash_order_raised_paise", 0) + s.get("account_order_raised_paise", 0),
                "account_received": s.get("account_paid_paise", 0) - aw,
                "cash_received": s.get("cash_paid_paise", 0) - cw,
                "waived": cw + aw,
                "account_dues": max(acc_due, 0),
                "cash_dues": max(cash_due, 0),
                "instalment_advance": max(-acc_due, 0) + max(-cash_due, 0),
                "other_charges_due": max(s.get("other_charges_due_paise", 0), 0),
                "overdue_amount": D.overdue_of(bands),
                **{BAND_KEYS[k]: v for k, v in bands.items()},
                "total_due": D.outstanding(s)["total_paise"] if live else 0,
                "advance_total": D.advance(s) if live else 0,
                "last_payment": paid_on.get(b["id"]),
                "lead_id": b.get("lead_id"),
                "plan_accepted_on": (b.get("plan_acceptance") or {}).get("accepted_on"),
                "next_due_date": fs.get("due_on"),
                "days_overdue": fs["days"],
                "stage": f"{plan['stage_k']} of {plan['stage_n']}",
                "status_kind": fs["kind"],
                "status_group": STATUS_GROUP[fs["kind"]],
                "final_status": status_label(fs)
                + (
                    " · other charges"
                    if fs["kind"] in ("overdue", "due") and max(acc_due, 0) + max(cash_due, 0) == 0
                    else ""
                ),
                "live": live,
            }
        )
    return rows


def customer_status_formula(t: dict) -> str:
    from services.pdf import inr

    adv = f" + advance held {inr(t.get('instalment_advance', 0))}" if t.get("instalment_advance") else ""
    return (
        f"Bills raised {inr(t.get('bills_raised', 0))} − Account received {inr(t.get('account_received', 0))} − "
        f"Cash received {inr(t.get('cash_received', 0))} − waived {inr(t.get('waived', 0))}{adv} = dues "
        f"{inr(t.get('account_dues', 0) + t.get('cash_dues', 0))} (Account {inr(t.get('account_dues', 0))} + "
        f"Cash {inr(t.get('cash_dues', 0))}) + other charges due "
        f"{inr(t.get('total_due', 0) - t.get('account_dues', 0) - t.get('cash_dues', 0))} = total due "
        f"{inr(t.get('total_due', 0))} (as in Overdue & ageing)"
        + (f" · bills raised = Bills vs Collection (live bookings) {inr(t['br_bvc'])}" if "br_bvc" in t else "")
    )


def customer_status_illustration(rows: list[dict], t: dict) -> dict:
    kinds = {}
    for r in rows:
        kinds[r["status_kind"]] = kinds.get(r["status_kind"], 0) + 1
    return {
        "type": "split_bar",
        "title": "Where the bills raised stand",
        "parts": [
            {"label": "Account received", "value": t.get("account_received", 0), "tone": "sapphire"},
            {"label": "Cash received", "value": t.get("cash_received", 0), "tone": "graphite"},
            {"label": "Waived", "value": t.get("waived", 0), "tone": "muted"},
            {"label": "Account dues", "value": t.get("account_dues", 0), "tone": "coral"},
            {"label": "Cash dues", "value": t.get("cash_dues", 0), "tone": "coral-soft"},
        ],
        "counts": kinds,
    }
