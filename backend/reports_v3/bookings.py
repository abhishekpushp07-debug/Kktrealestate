"""Phase 3F F4 Bookings providers. Read-only: money comes from the Customer status base rows (services.definitions);
this module only adds booking facts (area, list price, discount, agreement, transfers) for filtering and grouping."""

from datetime import date

from db import db
from deps import report_scope_filter
from reports_v3.customers import customer_status
from services import clock, ttlcache
from services import discount as DSC
from services.pdf import fmt_date, inr

_EXTRA = {"_id": 0, "id": 1, "status": 1, "broker_name": 1, "flat_snapshot": 1, "discount": 1, "plan_acceptance": 1}
_EXTRA |= {
    "agreement_value_paise": 1,
    "transfers": 1,
    "agreement_revisions": 1,
    "discount_events": 1,
    "cancellation": 1,
    "rate_per_sqft": 1,
}


async def _extras(user: dict, ctx: dict) -> dict:
    async def load():
        q = {"company_id": user["company_id"], **report_scope_filter(user)}
        return {b["id"]: b async for b in db.bookings.find(q, _EXTRA)}

    return await ttlcache.cached(f"rpt3:bkx:{ttlcache.scope_key(user)}:{ctx.get('stamp')}", 600, load, stamped=True)


def _days(a: str | None, b: date) -> int | None:
    return (b - date.fromisoformat(a[:10])).days if a else None


async def base(user: dict, ctx: dict) -> list[dict]:
    """Every booking row with booking facts added (one place for all F4 booking-grain reports)."""
    rows, ex = await customer_status(user, ctx), await _extras(user, ctx)
    out = []
    for r in rows:
        b = ex.get(r["booking_id"]) or {}
        fs, disc = b.get("flat_snapshot") or {}, b.get("discount") or {}
        area = fs.get("saleable_sqft") or 0
        signed = (b.get("plan_acceptance") or {}).get("accepted_on")
        received = r["account_received"] + r["cash_received"]
        av = r["agreement_value"]
        out.append(
            r
            | {
                "booking_status": b.get("status") or "—",
                "flat_type": fs.get("flat_type_code") or "—",
                "area": area,
                "list_value": disc.get("list_paise") or av,
                "discount": DSC.total_given(b),
                "discount_pct": round(100 * DSC.total_given(b) / disc["list_paise"], 2)
                if disc.get("list_paise")
                else 0,
                "broker": b.get("broker_name") or "Direct",
                "agreement_state": "Signed" if signed else "Pending",
                "signed_on": signed,
                "days_to_sign": _days(r["booking_date"], date.fromisoformat(signed)) if signed else None,
                "days_pending": None if signed else _days(r["booking_date"], ctx["as_of"]),
                "age_days": _days(r["booking_date"], ctx["as_of"]),
                "received": received,
                "pct_billed": round(100 * r["bills_raised"] / av, 1) if av else 0,
                "pct_received": round(100 * received / av, 1) if av else 0,
                "month": (r["booking_date"] or "")[:7],
            }
        )
    return out


async def register(user, ctx):
    return await base(user, ctx)


async def live(user, ctx):
    return [r for r in await base(user, ctx) if r["live"]]


def register_formula(t):
    rate = f" = {inr(t['agreement_value'] / t['area'])} per sq ft" if t.get("area") else ""
    return (
        f"List {inr(t.get('list_value', 0))} − discount {inr(t.get('discount', 0))} = agreement value {inr(t.get('agreement_value', 0))} "
        f"over {t.get('area', 0):,.0f} sq ft{rate}"
    )


def register_lines(rows, p=None):
    """REQ-348: headline "N live · M cancelled" (live = Active + Completed); each part opens its list."""
    live = sum(1 for r in rows if r["booking_status"] in ("Active", "Completed"))
    gone = sum(1 for r in rows if r["booking_status"] == "Cancelled")
    base = "/reports/v3/booking-register?booking_status="
    return [
        {"key": "live", "text": f"{live:,} live", "link": base + "Active,Completed", "tone": None},
        {"key": "cancelled", "text": f"{gone:,} cancelled", "link": base + "Cancelled", "tone": None},
    ]


def register_illus(rows, t):
    kinds = {}
    for r in rows:
        kinds[r["booking_status"]] = kinds.get(r["booking_status"], 0) + 1
    tone = {"Active": "sapphire", "Completed": "graphite", "Cancelled": "steel"}
    return {
        "type": "split_bar",
        "title": "Bookings by status",
        "count": True,
        "parts": [{"label": k, "value": v, "tone": tone.get(k, "steel")} for k, v in sorted(kinds.items())],
    }


async def sales_summary(user, ctx):
    """One row per month × project × flat type from the live + cancelled booking rows of the period."""
    agg = {}
    for r in await base(user, ctx):
        if r["booking_status"] == "Cancelled":
            continue
        k = (r["month"], r["project_id"], r["flat_type"])
        a = agg.setdefault(
            k,
            {
                "month": r["month"],
                "month_start": f"{r['month']}-01",
                "project_id": r["project_id"],
                "project": r["project"],
                "flat_type": r["flat_type"],
                "bookings": 0,
                "agreement_value": 0,
                "list_value": 0,
                "discount": 0,
                "area": 0,
            },
        )
        a["bookings"] += 1
        for f in ("agreement_value", "list_value", "discount", "area"):
            a[f] += r[f]
    for a in agg.values():
        a["avg_rate"] = round(a["agreement_value"] / a["area"]) if a["area"] else 0
        a["month_label"] = date.fromisoformat(a["month_start"]).strftime("%b %Y")
    return list(agg.values())


def rate_totals(t, rows=None):
    return {"avg_rate": round(t["agreement_value"] / t["area"]) if t.get("area") else 0}


def sales_formula(t):
    return (
        f"{t.get('bookings', 0):,} bookings · agreement value {inr(t.get('agreement_value', 0))} ÷ {t.get('area', 0):,.0f} "
        f"sq ft = average {inr(t.get('avg_rate', 0))} per sq ft (discount given {inr(t.get('discount', 0))})"
    )


def sales_illus(rows, t):
    by = {}
    for r in rows:
        by[r["month_label"], r["month"]] = by.get((r["month_label"], r["month"]), 0) + r["agreement_value"]
    return {
        "type": "bars",
        "title": "Agreement value by month",
        "bars": [
            {"label": l, "value": v, "tone": "sapphire"} for (l, _), v in sorted(by.items(), key=lambda x: x[0][1])
        ],
    }


def plan_formula(t):
    av = t.get("agreement_value", 0)
    pb = f" = {100 * t['bills_raised'] / av:.1f}% billed" if av else ""
    pr = f" = {100 * t['received'] / av:.1f}% received" if av else ""
    return f"Agreement value {inr(av)} · bills raised {inr(t.get('bills_raised', 0))}{pb} · received (Account + Cash) {inr(t.get('received', 0))}{pr}"


def plan_illus(rows, t):
    av = t.get("agreement_value", 0)
    return {
        "type": "split_bar",
        "title": "Agreement value — billed and received",
        "parts": [
            {"label": "Received", "value": t.get("received", 0), "tone": "sapphire"},
            {
                "label": "Billed, not received",
                "value": max(t.get("bills_raised", 0) - t.get("received", 0), 0),
                "tone": "coral",
            },
            {"label": "Not billed yet", "value": max(av - t.get("bills_raised", 0), 0), "tone": "steel"},
        ],
    }


def agreements_formula(t):
    return (
        f"{t.get('signed', 0):,} signed + {t.get('pending', 0):,} pending = {t.get('bookings', 0):,} live bookings "
        f"· agreement value pending signature {inr(t.get('pending_value', 0))}"
    )


def agreements_totals(t, rows):
    pend = [r for r in rows if r["agreement_state"] == "Pending"]
    return {
        "bookings": len(rows),
        "pending": len(pend),
        "signed": len(rows) - len(pend),
        "pending_value": sum(r["agreement_value"] for r in pend),
    }


def agreements_illus(rows, t):
    return {
        "type": "split_bar",
        "title": "Agreements",
        "count": True,
        "parts": [
            {"label": "Signed", "value": t.get("signed", 0), "tone": "sapphire"},
            {"label": "Pending", "value": t.get("pending", 0), "tone": "steel"},
        ],
    }


async def changes(user, ctx):
    """Every change after booking: flat transfers, agreement revisions, price/discount events, plan changes (audit)."""
    rows = {r["booking_id"]: r for r in await base(user, ctx)}
    ex = await _extras(user, ctx)
    flats = {
        f["id"]: f.get("flat_number")
        async for f in db.flats.find({"company_id": user["company_id"]}, {"_id": 0, "id": 1, "flat_number": 1})
    }
    out = []

    def add(bid, on, kind, frm, to, change, by, reason):
        r = rows.get(bid)
        if r:
            keep = (
                "booking_id",
                "booking_number",
                "customer_id",
                "customer_name",
                "customer_label",
                "project_id",
                "project",
                "tower_id",
                "tower",
                "floor_id",
                "floor",
                "floor_label",
                "flat_id",
                "flat",
                "flat_code",
                "sales_id",
                "sales_person",
            )
            out.append(
                {k: r[k] for k in keep}
                | {
                    "on": clock.day_of(on) or "",
                    "kind": kind,
                    "from": frm,
                    "to": to,
                    "change": change,
                    "by": by or "—",
                    "reason": reason or "—",
                }
            )

    for bid, b in ex.items():
        for t in b.get("transfers") or []:
            bv, av = (
                (t.get("before") or {}).get("agreement_value_paise"),
                (t.get("after") or {}).get("agreement_value_paise"),
            )
            add(
                bid,
                t.get("at"),
                "Flat transfer",
                t.get("from_flat") or flats.get(t.get("from_flat_id")) or "—",
                t.get("to_flat") or flats.get(t.get("to_flat_id")) or "—",
                (av - bv) if av is not None and bv is not None else 0,
                t.get("by_name"),
                t.get("reason"),
            )
        for v in b.get("agreement_revisions") or []:
            bf, af = v.get("before") or {}, v.get("after") or {}
            split = lambda x: (
                f"Cash {inr(x.get('cash_agreed_paise', 0))} · Account {inr(x.get('account_agreed_paise', 0))}"
            )
            add(
                bid,
                v.get("at"),
                "Agreement revision",
                split(bf),
                split(af),
                (af.get("agreement_value_paise") or 0) - (bf.get("agreement_value_paise") or 0),
                v.get("by_name"),
                v.get("reason"),
            )
        for e in b.get("discount_events") or []:
            add(
                bid,
                e.get("on"),
                f"Price — {e.get('kind') or 'change'}",
                inr(e.get("before_paise") or 0),
                inr(e.get("after_paise") or 0),
                (e.get("after_paise") or 0) - (e.get("before_paise") or 0),
                e.get("by_name"),
                e.get("reason"),
            )
    q = {"company_id": user["company_id"], "action": "booking.plan_change", "entity_id": {"$in": list(rows)}}
    async for a in db.audit_logs.find(
        q,
        {"_id": 0, "entity_id": 1, "at": 1, "created_at": 1, "before": 1, "after": 1, "user_name": 1, "actor_name": 1},
    ):
        aft = a.get("after") or {}
        add(
            a["entity_id"],
            a.get("at") or a.get("created_at"),
            "Plan change",
            (a.get("before") or {}).get("plan") or "—",
            aft.get("plan") or "—",
            0,
            a.get("user_name") or a.get("actor_name"),
            aft.get("reason"),
        )
    return out


def changes_totals(t, rows):
    kinds = {}
    for r in rows:
        kinds[r["kind"]] = kinds.get(r["kind"], 0) + 1
    return {"changes": len(rows), "kinds": kinds}


def changes_formula(t):
    parts = " + ".join(f"{v:,} {k.lower()}" for k, v in sorted((t.get("kinds") or {}).items())) or "no changes"
    return f"{parts} = {t.get('changes', 0):,} changes · net agreement change {'−' if t.get('change', 0) < 0 else ''}{inr(abs(t.get('change', 0)))}"


def changes_illus(rows, t):
    return {
        "type": "split_bar",
        "title": "What changed",
        "count": True,
        "parts": [
            {
                "label": k,
                "value": v,
                "tone": "sapphire" if "transfer" in k.lower() else "graphite" if "revision" in k.lower() else "steel",
            }
            for k, v in sorted((t.get("kinds") or {}).items())
        ],
    }


def rate_formula(t):
    if not t.get("area"):
        return "No area recorded"
    lr, ar = t["list_value"] / t["area"], t["agreement_value"] / t["area"]
    pct = f" ({100 * (ar - lr) / lr:+.2f}%)" if lr else ""
    return (
        f"Agreement value {inr(t['agreement_value'])} ÷ {t['area']:,.0f} sq ft = realised {inr(ar)} per sq ft vs "
        f"list {inr(t['list_value'])} ÷ {t['area']:,.0f} = {inr(lr)}{pct}"
    )


async def realised(user, ctx):
    out = []
    for r in await live(user, ctx):
        a = r["area"]
        out.append(
            r
            | {
                "list_rate": round(r["list_value"] / a) if a else 0,
                "agreed_rate": round(r["agreement_value"] / a) if a else 0,
                "rate_gap": round((r["agreement_value"] - r["list_value"]) / a) if a else 0,
            }
        )
    return out


def rate_illus(rows, t):
    return {
        "type": "split_bar",
        "title": "List value — discount = agreement",
        "parts": [
            {"label": "Agreement value", "value": t.get("agreement_value", 0), "tone": "sapphire"},
            {"label": "Discount", "value": t.get("discount", 0), "tone": "steel"},
        ],
    }


HEALTH = ("Healthy", "Watch", "At risk")


async def health(user, ctx):
    """Watch: anything overdue or received trails billed by more than 5 points; At risk: overdue > 60 days or gap > 20."""
    out = []
    for r in await live(user, ctx):
        billed_pct = round(100 * r["bills_raised"] / r["agreement_value"], 1) if r["agreement_value"] else 0
        recv_pct = min(r["pct_received"], billed_pct) if r["bills_raised"] else r["pct_received"]
        gap = round(billed_pct - recv_pct, 1)
        h = (
            "At risk"
            if r["days_overdue"] > 60 or gap > 20
            else "Watch"
            if r["days_overdue"] > 0 or gap > 5
            else "Healthy"
        )
        why = []
        if r["days_overdue"] > 0:
            what = "other charges" if r["account_dues"] + r["cash_dues"] == 0 else "instalments"
            why.append(f"{what} overdue {r['days_overdue']} day{'s' if r['days_overdue'] != 1 else ''}")
        if gap > 5:
            why.append(f"received {gap:g} pts behind billed")
        out.append(r | {"gap": gap, "health": h, "why": " · ".join(why) or "on track"})
    return out


def health_totals(t, rows):
    c = {h: 0 for h in HEALTH}
    for r in rows:
        c[r["health"]] += 1
    return {"health_counts": c}


def health_formula(t):
    c = t.get("health_counts") or {}
    return (
        f"{c.get('Healthy', 0):,} healthy + {c.get('Watch', 0):,} to watch + {c.get('At risk', 0):,} at risk · "
        f"overdue {inr(t.get('overdue_amount', 0))} of total due {inr(t.get('total_due', 0))}"
    )


def health_illus(rows, t):
    c = t.get("health_counts") or {}
    tone = {"Healthy": "sapphire", "Watch": "steel", "At risk": "coral"}
    note = "Watch: anything overdue, or % received more than 5 pts behind % billed · At risk: overdue more than 60 days, or more than 20 pts behind"
    return {
        "type": "split_bar",
        "title": "Booking health",
        "count": True,
        "note": note,
        "parts": [{"label": h, "value": c.get(h, 0), "tone": tone[h]} for h in HEALTH],
    }


async def cancellations_enrich(user, rows, ctx):
    for r in rows:
        r["cancelled_on"] = clock.day_of(r.get("cancelled_at")) if r.get("cancelled_at") else None
    return rows


def label_date(d):
    return fmt_date(d) if d else "—"
