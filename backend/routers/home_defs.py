"""Phase 2D Home Command Center — ONE definition per widget (REQ-91…110). Every number is built from services.definitions
(the same function its report uses) or from the very list query its drill-down opens, and carries a `drill`
{to: screen link, api: [path, params], pick: field} so tests can prove list total == number."""

import asyncio
from datetime import date, timedelta
from urllib.parse import quote

from db import db
from services import clock, definitions
from services.definitions import (
    BANDS,
    LIVE_BOOKING_STATUSES,
    SPLIT_KEYS,
    ageing_for_bookings,
    overdue_of,
    receipt_split,
)
from services.home_filters import STALE_DAYS, hold_expiry_cutoff, stale_part_paid_match, unreplaced_bounced_ids  # noqa: F401

BAND_KEY = dict(zip(BANDS, ("not_due", "d0_30", "d31_60", "d61_90", "d90")))


def period_range(period: str, today: date) -> tuple[str, str, str]:
    """Today / This month / FY (Indian FY Apr–Mar) → (from, to, label)."""
    if period == "today":
        return today.isoformat(), today.isoformat(), "Today"
    if period == "fy":
        y = today.year if today.month >= 4 else today.year - 1
        return f"{y}-04-01", f"{y + 1}-03-31", f"FY {y}-{str(y + 1)[2:]}"
    nxt = (today.replace(day=28) + timedelta(days=4)).replace(day=1)
    return today.replace(day=1).isoformat(), (nxt - timedelta(days=1)).isoformat(), today.strftime("%b %Y")


async def register_totals(user, **kw):
    """Demand register totals for the same filters its screen uses (in-process call, so the tie is by construction)."""
    import json

    from starlette.requests import Request

    from routers.demand_register import register

    args = dict(basis="raised", date_from=None, date_to=None, project_id=None, block_id=None, stage=None, plan=None)
    args |= dict(status=None, source=None, bucket=None, customer=None, include_void=False, per_group=1, format=None)
    args |= dict(stale_days=None) | kw
    req = Request({"type": "http", "headers": [], "query_string": b"", "method": "GET", "path": "/"})
    return json.loads((await register(req, user=user, **args)).body)["totals"]


def _drill(to, api=None, params=None, pick=None):
    to = f"{to}{'&' if '?' in to else '?'}via=home"  # every drill target shows "Filtered from Home · Clear"
    return (
        {"to": to, "api": [api, {k: v for k, v in (params or {}).items() if v not in (None, "")}], "pick": pick}
        if api
        else {"to": to}
    )


def _q(pid):
    return f"&project_id={pid}" if pid else ""


async def _discount_given(user: dict, f: str, t: str, pid: str | None) -> dict:
    """REQ-240 Home: discount given = Σ (list − agreed) on live bookings booked in the period (same rule as the register)."""
    m = {
        "company_id": user["company_id"],
        "status": {"$in": list(LIVE_BOOKING_STATUSES)},
        "booking_date": {"$gte": f, "$lte": t},
        "discount.status": "recorded",
    } | ({"project_id": pid} if pid else {})
    r = await db.bookings.aggregate(
        [
            {"$match": m},
            {
                "$project": {
                    "d": {"$subtract": ["$discount.list_paise", "$agreement_value_paise"]},
                    "l": "$discount.list_paise",
                }
            },
            {
                "$group": {
                    "_id": None,
                    "d": {"$sum": "$d"},
                    "l": {"$sum": "$l"},
                    "n": {"$sum": {"$cond": [{"$gt": ["$d", 0]}, 1, 0]}},
                }
            },
        ]
    ).to_list(1)
    r = r[0] if r else {"d": 0, "l": 0, "n": 0}
    return {
        "amount_paise": r["d"],
        "pct": round(100 * r["d"] / r["l"], 2) if r["l"] else 0,
        "bookings": r["n"],
        "link": f"/reports/discount-register?from_date={f}&to_date={t}{_q(pid)}",
    }


async def _split(match: dict) -> dict:
    rows = await receipt_split(match)
    r = rows[0] if rows else {}
    out = {k.lower(): r.get(f"{k}_paise", 0) for k in SPLIT_KEYS}
    out["total"] = sum(out.values())
    return out


def _lp(sort="-created_at"):
    """ListParams for an in-process call (FastAPI Query defaults are not values)."""
    from utils import ListParams

    return ListParams(
        page=1,
        page_size=1,
        search=None,
        sort=sort,
        include_inactive=False,
        cursor=None,
        limit=None,
        format=None,
        with_total=True,
        fields=None,
        include=None,
        exact=False,
    )


async def _pay_totals(user, pid, status, **extra):
    from routers.payments import list_payments

    t = await list_payments(
        _lp("-payment_date"), pid, None, None, None, status, None, None, None, None, user, summary_only=True, **extra
    )
    x = t.get(status) or {}
    return x.get("count", 0), x.get("amount_paise", 0)


async def _count(fn, user, **kw):
    r = await fn(_lp(), user=user, **kw)
    return r["total"]


# ---------------------------------------------------------------- 1 Money today
async def money_today(user, base, pid, today):
    d = today.isoformat()
    split = await _split({**base, **definitions.received_match(d, d)})
    n, amt = await _pay_totals(user, pid, "Pending")
    col = ("/reports/collections-v2", {"from_date": d, "to_date": d, "project_id": pid})
    to = f"/reports/collections-v2?from_date={d}&to_date={d}{_q(pid)}"
    return {
        **{
            k: {"amount_paise": split[k], "drill": _drill(to, *col, f"totals.{k}_paise")}
            for k in ("cash", "account", "other", "total")
        },
        "cheques": {
            "count": n,
            "amount_paise": amt,
            "drill": _drill(
                f"/payments?status=Pending{_q(pid)}",
                "/payments/summary",
                {"status": "Pending", "project_id": pid},
                "Pending.amount_paise",
            ),
        },
    }


# ---------------------------------------------------------------- 2 Due vs received (period)
async def due_vs_received(user, base, pid, rng):
    f, t, label = rng
    due = 0
    async for x in db.demands.aggregate(
        [
            {
                "$match": {
                    **base,
                    "voided": {"$ne": True},
                    "status": {"$nin": ["Voided", "Cancelled"]},
                    "due_date": {"$gte": f, "$lte": t},
                }
            },
            {"$group": {"_id": None, "s": {"$sum": "$total_demand_paise"}, "n": {"$sum": 1}}},
        ]
    ):
        due = x["s"]
    rec = (await _split({**base, **definitions.received_match(f, t)}))["total"]
    return {
        "label": label,
        "due": {
            "amount_paise": due,
            "drill": _drill(
                f"/demands?basis=due&date_from={f}&date_to={t}{_q(pid)}",
                "/demands/register",
                {"basis": "due", "date_from": f, "date_to": t, "project_id": pid},
                "totals.total_paise",
            ),
        },
        "received": {
            "amount_paise": rec,
            "drill": _drill(
                f"/reports/collections-v2?from_date={f}&to_date={t}{_q(pid)}",
                "/reports/collections-v2",
                {"from_date": f, "to_date": t, "project_id": pid},
                "totals.total_paise",
            ),
        },
        "recovery_pct": round(rec * 100 / due) if due else None,
    }


# ---------------------------------------------------------------- 3 Overdue by age (= Outstanding & ageing)
async def ageing(user, base, pid, today):
    bands, per = await ageing_for_bookings(base, today)
    api = ("/reports/outstanding-v2", {"project_id": pid})
    to = f"/reports/outstanding-v2{('?project_id=' + pid) if pid else ''}"
    out = {
        BAND_KEY[b]: {
            "label": b,
            "amount_paise": bands[b],
            "bookings": sum(1 for p in per.values() if p[b] > 0),
            "drill": _drill(
                f"/reports/outstanding-v2?bucket={quote(b)}{_q(pid)}", *api, f"ageing[bucket={b}].amount_paise"
            ),
        }
        for b in BANDS
    }
    out["total"] = {"amount_paise": sum(bands.values()), "drill": _drill(to, *api, "totals.outstanding_paise")}
    out["overdue"] = {"amount_paise": overdue_of(bands)}
    return out, per


# ---------------------------------------------------------------- 4 Call today
async def call_today(user, base, pid, today, per):
    from routers.leads import list_leads
    from routers.visits import list_visits

    perms = set(user["permissions"])
    top = []
    if per is not None:
        ov = sorted(((overdue_of(b), bid) for bid, b in per.items() if overdue_of(b) > 0), reverse=True)[:6]
        bk = {
            b["id"]: b
            for b in await db.bookings.find(
                {"id": {"$in": [i for _, i in ov]}},
                {
                    "_id": 0,
                    "id": 1,
                    "customer_id": 1,
                    "customer_name": 1,
                    "booking_number": 1,
                    "block_name": 1,
                    "flat_snapshot.flat_number": 1,
                },
            ).to_list(None)
        }
        from services.definitions import overdue_days

        full = {
            b["id"]: b
            for b in await db.bookings.find(
                {"id": {"$in": [i for _, i in ov]}}, {"_id": 0, "id": 1, "summary": 1, "other_charges": 1}
            ).to_list(None)
        }
        dem = {}
        async for dm in db.demands.find(
            {"booking_id": {"$in": [i for _, i in ov]}, "voided": {"$ne": True}},
            {"_id": 0, "booking_id": 1, "due_date": 1, "cash_demand_paise": 1, "account_demand_paise": 1, "status": 1},
        ):
            dem.setdefault(dm["booking_id"], []).append(dm)
        days = {  # REQ-209: the same "overdue N days" as the card / customer page / booking page
            bid: overdue_days(f.get("summary") or {}, dem.get(bid, []), f.get("other_charges") or [], today)
            for bid, f in full.items()
        }
        cust = {
            c["id"]: c
            for c in await db.customers.find(
                {"id": {"$in": [b["customer_id"] for b in bk.values()]}},
                {"_id": 0, "id": 1, "phone": 1, "full_name": 1},
            ).to_list(None)
        }
        for amt, bid in ov:
            b = bk.get(bid, {})
            c = cust.get(b.get("customer_id"), {})
            top.append(
                {
                    "customer_id": b.get("customer_id"),
                    "name": c.get("full_name") or b.get("customer_name"),
                    "phone": c.get("phone"),
                    "booking_number": b.get("booking_number"),
                    "booking_id": bid,
                    "overdue_paise": amt,
                    "flat": " · ".join(
                        x for x in (b.get("block_name"), (b.get("flat_snapshot") or {}).get("flat_number")) if x
                    ),
                    "overdue_days": days.get(bid),
                }
            )
    fu = (
        await _count(
            list_leads, user, status=None, assigned_to=None, project_id=pid, due_today=True, source=None, unread=False
        )
        if "sales.lead.view" in perms
        else None
    )
    d = today.isoformat()
    vis = (
        await _count(
            list_visits,
            user,
            project_id=pid,
            status="Confirmed",
            assigned_to=None,
            date_from=d,
            date_to=d,
            lead_id=None,
        )
        if "sales.site_visit.view" in perms
        else None
    )
    return {
        "overdue_customers": top,
        "followups": None
        if fu is None
        else {
            "count": fu,
            "drill": _drill(
                f"/leads?tab=list&due_today=1{_q(pid)}", "/leads", {"due_today": True, "project_id": pid}, "total"
            ),
        },
        "visits_today": None
        if vis is None
        else {
            "count": vis,
            "drill": _drill(
                f"/leads?tab=visits&date={d}{_q(pid)}",
                "/site-visits",
                {"date_from": d, "date_to": d, "status": "Confirmed", "project_id": pid},
                "total",
            ),
        },
        "messaging": "not_configured",  # MOCKED: tel: / wa.me links only
    }


# ---------------------------------------------------------------- 5 Next 30 days inflow
async def inflow_30(user, base, pid, today):
    f, t = (today + timedelta(days=1)).isoformat(), (today + timedelta(days=30)).isoformat()
    bal = 0
    async for x in db.demands.aggregate(
        [
            {
                "$match": {
                    **base,
                    "voided": {"$ne": True},
                    "status": {"$nin": ["Voided", "Cancelled"]},
                    "due_date": {"$gte": f, "$lte": t},
                }
            },
            {
                "$group": {
                    "_id": None,
                    "s": {
                        "$sum": {"$max": [{"$subtract": ["$total_demand_paise", {"$ifNull": ["$paid_paise", 0]}]}, 0]}
                    },
                }
            },
        ]
    ):
        bal = x["s"]
    n, amt = await _pay_totals(user, pid, "Pending")
    done = {
        b["id"]: {s["stage_id"] for s in b.get("construction_stages") or [] if s.get("status") == "Completed"}
        async for b in db.blocks.find(
            {k: v for k, v in base.items() if k != "project_id"}
            | ({"project_id": base["project_id"]} if "project_id" in base else {}),
            {"_id": 0, "id": 1, "construction_stages": 1},
        )
    }
    awaiting = 0
    seqs = {
        r["_id"]: set(r["s"])
        for r in await db.demands.aggregate(
            [
                {"$match": {**base, "voided": {"$ne": True}}},
                {"$group": {"_id": "$booking_id", "s": {"$addToSet": "$installment_seq"}}},
            ]
        ).to_list(None)
    }
    async for b in db.bookings.find(
        {**base, "status": {"$in": LIVE_BOOKING_STATUSES}},
        {"_id": 0, "id": 1, "block_id": 1, "payment_plan_snapshot.installments": 1},
    ):
        raised = seqs.get(b["id"], set())
        awaiting += sum(
            1
            for i in (b.get("payment_plan_snapshot") or {}).get("installments", [])
            if i.get("trigger_type") == "ON_STAGE"
            and i["seq"] not in raised
            and i.get("trigger_stage_id") not in done.get(b["block_id"], set())
        )
    return {
        "bills": {
            "amount_paise": bal,
            "drill": _drill(
                f"/demands?basis=due&date_from={f}&date_to={t}{_q(pid)}",
                "/demands/register",
                {"basis": "due", "date_from": f, "date_to": t, "project_id": pid},
                "totals.balance_paise",
            ),
        },
        "cheques": {
            "count": n,
            "amount_paise": amt,
            "drill": _drill(
                f"/payments?status=Pending{_q(pid)}",
                "/payments/summary",
                {"status": "Pending", "project_id": pid},
                "Pending.amount_paise",
            ),
        },
        "total_paise": bal + amt,
        "awaiting_stage": {"count": awaiting, "drill": _drill("/construction")},
    }


async def _blocks(base):
    q = {"company_id": base["company_id"], "is_active": {"$ne": False}}
    if "project_id" in base:
        q["project_id"] = base["project_id"]
    blocks = (
        await db.blocks.find(q, {"_id": 0, "id": 1, "name": 1, "code": 1, "project_id": 1, "construction_stages": 1})
        .sort("name", 1)
        .to_list(60)
    )
    pn = {
        p["id"]: p["name"]
        for p in await db.projects.find(
            {"id": {"$in": list({b["project_id"] for b in blocks})}}, {"_id": 0, "id": 1, "name": 1}
        ).to_list(None)
    }
    for b in blocks:
        b["project_name"] = pn.get(b["project_id"])
    return [b for b in blocks if b["project_name"]]


# ---------------------------------------------------------------- 6 Next billing milestone
async def next_milestone(user, base, blocks):
    from routers.masters_plus import preview_stage_completion

    async def one(b):
        st = sorted(b.get("construction_stages") or [], key=lambda s: s["seq"])
        nxt = next((s for s in st if s.get("status") != "Completed"), None)
        row = {
            "block_id": b["id"],
            "tower": b["name"],
            "project": b["project_name"],
            "stage": nxt and nxt["name"],
            "stages_total": len(st),
        }
        if nxt:
            pv = await preview_stage_completion(b["id"], nxt["stage_id"], user)
            row |= {
                "bookings": pv["bookings_count"],
                "active_bookings": pv["active_bookings"],
                "expected": {
                    "amount_paise": pv["total_paise"],
                    "drill": _drill(
                        f"/construction?project={b['project_id']}&tower={b['id']}",
                        f"/blocks/{b['id']}/stages/{nxt['stage_id']}/preview",
                        {},
                        "total_paise",
                    ),
                },
            }
        return row

    return {"towers": list(await asyncio.gather(*(one(b) for b in blocks)))}  # 3I: towers in parallel


# ---------------------------------------------------------------- 7 Inventory by tower / 8 Flat status
async def inventory(user, base, blocks):
    from routers.flats import list_flats
    from services import inventory as inv

    real = inv.can_see_real(user)
    states = ("Available", "Hold", "Booked", "Sold", "Blocked") if real else ("Available", "Hold", "Sold")
    ids = [b["id"] for b in blocks]
    rows = await db.flats.aggregate(
        [
            {"$match": {"block_id": {"$in": ids}, "is_active": {"$ne": False}}},
            {
                "$group": {
                    "_id": {"b": "$block_id", "s": "$status"},
                    "n": {"$sum": 1},
                    "v": {"$sum": {"$ifNull": ["$price_paise", 0]}},
                }
            },
        ]
    ).to_list(None)
    by = {}
    for r in rows:
        by.setdefault(r["_id"]["b"], {})[r["_id"]["s"]] = (r["n"], r["v"])

    async def n(bid, st):
        if real:
            return by.get(bid, {}).get(st, (0, 0))[0]
        kw = dict(project_id=None, floor=None, flat_type_id=None, bookable_for=None, category=None, display=None)
        return await _count(list_flats, user, block_id=bid, status=st, hold_expiring=None, **kw)

    out = []
    for b in blocks:
        s = by.get(b["id"], {})
        row = {"block_id": b["id"], "tower": b["name"], "project": b["project_name"], "states": list(states)}
        counts = await asyncio.gather(*(n(b["id"], st) for st in states))
        for st, c in zip(states, counts):
            row[st.lower()] = {
                "count": c,
                "drill": _drill(
                    f"/flats?block_id={b['id']}&status={st}", "/flats", {"block_id": b["id"], "status": st}, "total"
                ),
            }
        row["unsold_paise"] = sum(s.get(st, (0, 0))[1] for st in ("Available", "Hold", "Blocked")) if real else None
        row["total"] = sum(v[0] for v in s.values()) if real else sum(counts)
        out.append(row)
    return {"towers": out}


async def flat_status(user, base, blocks):
    """Same statuses as Inventory / the Flats list: roles without the real-status permission see the display layer."""
    from services import inventory as inv

    real = inv.can_see_real(user)
    ids = [b["id"] for b in blocks][:12]
    grid = {}
    proj = {
        "_id": 0,
        "id": 1,
        "block_id": 1,
        "floor": 1,
        "flat_number": 1,
        "status": 1,
        "display_state": 1,
        "display_override": 1,
    }
    async for f in db.flats.find({"block_id": {"$in": ids}, "is_active": {"$ne": False}}, proj).sort(
        [("floor", -1), ("flat_number", 1)]
    ):
        st = f["status"] if real else inv.DISPLAY_TO_STATUS[inv.effective_display(f)]
        if st is None:  # Hidden from this role
            continue
        grid.setdefault(f["block_id"], {}).setdefault(f.get("floor") or 0, []).append(
            {"id": f["id"], "n": f["flat_number"], "s": st}
        )
    return {
        "towers": [
            {
                "block_id": b["id"],
                "tower": b["name"],
                "project": b["project_name"],
                "floors": [{"floor": k, "flats": v} for k, v in grid.get(b["id"], {}).items()],
            }
            for b in blocks
            if b["id"] in ids
        ],
        "states": ["Available", "Hold", "Booked", "Sold", "Blocked"] if real else ["Available", "Hold", "Sold"],
    }


# ---------------------------------------------------------------- 9 Construction progress
async def construction(user, base, blocks):
    out = []
    for b in blocks:
        st = sorted(b.get("construction_stages") or [], key=lambda s: s["seq"])
        done = [s for s in st if s.get("status") == "Completed"]
        last = done[-1] if done else None
        out.append(
            {
                "block_id": b["id"],
                "tower": b["name"],
                "project": b["project_name"],
                "done": len(done),
                "total": len(st),
                "pct": round(len(done) * 100 / len(st)) if st else None,
                "last_stage": last and last["name"],
                "last_date": last and (last.get("completed_on") or clock.day_of(last.get("completed_at"))),
                "drill": _drill(f"/construction?project={b['project_id']}&tower={b['id']}"),
            }
        )
    return {"towers": out}


# ---------------------------------------------------------------- 10 Sales pipeline (period)
async def pipeline(user, base, pid, rng):
    from routers.bookings import list_bookings
    from routers.leads import list_leads
    from routers.visits import list_visits

    f, t, label = rng
    perms = set(user["permissions"])
    lk = dict(
        status=None,
        assigned_to=None,
        project_id=pid,
        due_today=False,
        source=None,
        unread=False,
        created_from=f,
        created_to=t,
    )
    leads = await _count(list_leads, user, **lk)
    visits = (
        await _count(
            list_visits,
            user,
            project_id=pid,
            status="Completed",
            assigned_to=None,
            date_from=f,
            date_to=t,
            lead_id=None,
        )
        if "sales.site_visit.view" in perms
        else None
    )
    bookings = (
        await _count(
            list_bookings,
            user,
            project_id=pid,
            block_id=None,
            status=",".join(LIVE_BOOKING_STATUSES),
            customer_id=None,
            date_from=f,
            date_to=t,
        )
        if "sales.booking.view" in perms
        else None
    )
    lost_q = {
        "company_id": user["company_id"],
        "status": "Lost",
        "created_at": {"$gte": clock.day_start_utc(f), "$lte": clock.day_end_utc(t)},
    } | ({"project_id": pid} if pid else {})
    reasons = await db.leads.aggregate(
        [{"$match": lost_q}, {"$group": {"_id": "$lost_reason", "n": {"$sum": 1}}}, {"$sort": {"n": -1}}]
    ).to_list(8)
    lost = await _count(list_leads, user, **(lk | {"status": "Lost"}))
    lp = {"created_from": f, "created_to": t, "project_id": pid}
    return {
        "label": label,
        "leads": {
            "count": leads,
            "drill": _drill(f"/leads?tab=list&created_from={f}&created_to={t}{_q(pid)}", "/leads", lp, "total"),
        },
        "visits": None
        if visits is None
        else {
            "count": visits,
            "drill": _drill(
                f"/leads?tab=visits&view=list&from={f}&to={t}&status=Completed{_q(pid)}",
                "/site-visits",
                {"date_from": f, "date_to": t, "status": "Completed", "project_id": pid},
                "total",
            ),
        },
        "bookings": None
        if bookings is None
        else {
            "count": bookings,
            "drill": _drill(
                f"/bookings?date_from={f}&date_to={t}&status={','.join(LIVE_BOOKING_STATUSES)}{_q(pid)}",
                "/bookings",
                {"date_from": f, "date_to": t, "status": ",".join(LIVE_BOOKING_STATUSES), "project_id": pid},
                "total",
            ),
        },
        "conversion_pct": round(bookings * 100 / leads) if leads and bookings is not None else None,
        "discount": await _discount_given(user, f, t, pid) if "reports.discount_register.view" in perms else None,
        "lost": {
            "count": lost,
            "reasons": [{"reason": r["_id"] or "No reason given", "count": r["n"]} for r in reasons],
            "drill": _drill(
                f"/leads?tab=list&status=Lost&created_from={f}&created_to={t}{_q(pid)}",
                "/leads",
                lp | {"status": "Lost"},
                "total",
            ),
        },
    }


# ---------------------------------------------------------------- 11 Needs attention
async def attention(user, base, pid):
    from routers.flats import list_flats

    perms = set(user["permissions"])

    async def holds():
        return await _count(
            list_flats,
            user,
            project_id=pid,
            block_id=None,
            floor=None,
            status=None,
            flat_type_id=None,
            bookable_for=None,
            category=None,
            display=None,
            hold_expiring=True,
        )

    async def bounced():
        return await _pay_totals(user, pid, "Bounced", unreplaced=True) if "finance.payment.view" in perms else None

    async def waivers():
        if "finance.waiver.approve" not in perms:  # REQ-254: Needs attention · waivers to approve
            return None
        q = {"company_id": user["company_id"], "status": "Pending"} | ({"project_id": pid} if pid else {})
        return await db.waivers.aggregate(
            [{"$match": q}, {"$group": {"_id": None, "n": {"$sum": 1}, "s": {"$sum": "$amount_paise"}}}]
        ).to_list(1)

    async def stale():
        if "demands.register.view" not in perms:
            return None
        return await register_totals(user, stale_days=STALE_DAYS, project_id=pid)

    nh, bo, wv, st = await asyncio.gather(holds(), bounced(), waivers(), stale())  # 3I: in parallel
    out = {
        "holds_expiring": {
            "count": nh,
            "drill": _drill(
                f"/flats?hold_expiring=1{_q(pid)}", "/flats", {"hold_expiring": True, "project_id": pid}, "total"
            ),
        }
    }
    if bo is not None:
        n, amt = bo
        out["bounced"] = {
            "count": n,
            "amount_paise": amt,
            "drill": _drill(
                f"/payments?status=Bounced&unreplaced=1{_q(pid)}",
                "/payments/summary",
                {"status": "Bounced", "unreplaced": True, "project_id": pid},
                "Bounced.count",
            ),
        }
    if wv is not None:
        out["waivers_to_approve"] = {
            "count": wv[0]["n"] if wv else 0,
            "amount_paise": wv[0]["s"] if wv else 0,
            "drill": _drill(f"/reports/waiver-register?status=Pending{_q(pid)}"),
        }
    if st is not None:
        out["stale_part_paid"] = {
            "count": st["count"],
            "drill": _drill(
                f"/demands?stale_days={STALE_DAYS}{_q(pid)}",
                "/demands/register",
                {"stale_days": STALE_DAYS, "project_id": pid},
                "totals.count",
            ),
        }
    return out


WIDGET_MS: dict = {}  # 3I dev: last compute time per widget (System Health / profiling)


async def guarded(fn, *a):
    t0 = __import__("time").perf_counter()
    try:
        return {"ok": True, "data": await fn(*a)}
    except Exception as e:  # noqa: BLE001 — one widget failing must never blank the others
        __import__("logging").getLogger("kkt").exception("home widget %s", getattr(fn, "__name__", fn))
        return {"ok": False, "error": "Couldn't load", "detail": type(e).__name__}
    finally:
        WIDGET_MS[getattr(fn, "__name__", "?")] = round(1000 * (__import__("time").perf_counter() - t0))
