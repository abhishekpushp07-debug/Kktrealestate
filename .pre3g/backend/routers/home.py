"""Home v2 payload: snapshot + 12-month collections + due ageing + needs-attention + recent activity in ONE call."""

from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, Depends, Request

from db import db
from deps import report_scope_filter, require
from routers.catalogues import etag_response
from services import clock
from services.money import present_money
from services.read_models import get_dashboard

router = APIRouter(tags=["home"])


def _months(n=12):
    d = clock.today().replace(day=1)
    out = []
    for _ in range(n):
        out.append(d.isoformat()[:7])
        d = (d - timedelta(days=1)).replace(day=1)
    return list(reversed(out))


@router.get("/dashboard/home")
async def home(request: Request, user: dict = Depends(require("masters.project.view"))):
    from services import ttlcache

    out = await ttlcache.cached(f"home:{ttlcache.scope_key(user)}:{clock.today().isoformat()}", 10, lambda: _home(user))
    return etag_response(request, out, max_age=15)


async def _home(user: dict):
    cid, pf = user["company_id"], report_scope_filter(user)
    today = clock.today().isoformat()
    snap = await get_dashboard(cid, user.get("project_scope"))
    months = _months()
    from services.definitions import BANDS, SPLIT_KEYS, ageing_for_bookings, receipt_split

    rows = await receipt_split(
        {"company_id": cid, **pf, "status": "Cleared", "payment_date": {"$gte": months[0] + "-01"}},
        {"$substr": ["$payment_date", 0, 7]},
    )
    by = {m: {"month": m, "Cash": 0, "Account": 0, "Other": 0} for m in months}
    for r in rows:
        if r["_id"] in by:
            by[r["_id"]].update({c: r[f"{c}_paise"] / 100 for c in SPLIT_KEYS})
    open_dem = await db.demands.find(
        {"company_id": cid, **pf, "voided": {"$ne": True}, "status": {"$in": ["Open", "Partially Paid"]}},
        {
            "_id": 0,
            "id": 1,
            "booking_id": 1,
            "customer_name": 1,
            "due_date": 1,
            "total_demand_paise": 1,
            "paid_paise": 1,
            "installment_name": 1,
            "milestone_name": 1,
            "demand_number": 1,
            "project_name": 1,
        },
    ).to_list(2000)
    # E1: ONE outstanding number — the same function (bills + demanded other charges) the Outstanding report uses
    keys = dict(zip(BANDS, ("not_due", "d0_30", "d31_60", "d61_90", "d90")))
    bands, per_bk = await ageing_for_bookings({"company_id": cid, **pf}, clock.today())
    ageing = {keys[b]: v for b, v in bands.items()}
    ageing_counts = {keys[b]: sum(1 for p in per_bk.values() if p[b] > 0) for b in BANDS}  # bookings per band
    overdue = []
    for d in open_dem:
        bal = d["total_demand_paise"] - (d.get("paid_paise") or 0)
        days = (clock.today() - date.fromisoformat(d["due_date"])).days
        if days > 0:
            overdue.append({**d, "balance_paise": bal, "days": days})
    overdue.sort(key=lambda x: -x["balance_paise"])
    missing = {d["booking_id"] for d in overdue[:8] if not d.get("customer_name")}
    if missing:
        names = {
            b["id"]: b
            for b in await db.bookings.find(
                {"id": {"$in": list(missing)}}, {"_id": 0, "id": 1, "customer_name": 1, "booking_number": 1}
            ).to_list(None)
        }
        for d in overdue[:8]:
            b = names.get(d["booking_id"], {})
            d["customer_name"] = (
                d.get("customer_name") or b.get("customer_name") or b.get("booking_number") or "Customer"
            )
    bounced = (
        await db.payments.find(
            {
                "company_id": cid,
                **pf,
                "status": "Bounced",
                "payment_date": {"$gte": (clock.today() - timedelta(days=30)).isoformat()},
            },
            {
                "_id": 0,
                "id": 1,
                "booking_id": 1,
                "receipt_number": 1,
                "amount_paise": 1,
                "customer_name": 1,
                "payment_mode_name": 1,
            },
        )
        .limit(10)
        .to_list(10)
    )
    unassigned = (
        await db.leads.find(
            {
                "company_id": cid,
                **pf,
                "status": {"$nin": ["Lost", "Converted"]},
                "$or": [{"assigned_to": None}, {"assigned_to": {"$exists": False}}],
            },
            {"_id": 0, "id": 1, "name": 1, "phone": 1, "source": 1, "project_name": 1, "created_at": 1},
        )
        .sort("created_at", -1)
        .limit(10)
        .to_list(10)
    )
    visits = (
        await db.site_visits.find(
            {"company_id": cid, **pf, "date": today, "status": {"$in": ["Confirmed", "Rescheduled"]}},
            {"_id": 0, "id": 1, "visit_number": 1, "name": 1, "slot_start": 1, "project_name": 1, "assigned_name": 1},
        )
        .sort("slot_start", 1)
        .to_list(20)
    )
    recent = (
        await db.audit_logs.find(
            {"company_id": cid, "action": {"$regex": "^(booking|payment|demand|stage|lead|visit|customer)\\."}},
            {
                "_id": 0,
                "id": 1,
                "action": 1,
                "entity_type": 1,
                "entity_id": 1,
                "created_at": 1,
                "user_name": 1,
                "after": 1,
            },
        )
        .sort("created_at", -1)
        .limit(12)
        .to_list(12)
    )
    for r in recent:
        r["after"] = {
            k: v
            for k, v in (r.get("after") or {}).items()
            if k
            in (
                "booking_number",
                "receipt_number",
                "amount",
                "stage",
                "name",
                "status",
                "customer_name",
                "demand_number",
            )
        }
    demands_today = await db.demands.count_documents(
        {"company_id": cid, **pf, "posted_at": {"$gte": clock.day_start_utc(today)}}
    )
    spark = {"collections": [by[m]["Cash"] + by[m]["Account"] + by[m]["Other"] for m in months[-8:]]}
    out = {
        "computed_at": snap["computed_at"],
        **snap["payload"],
        "collections_12m": [by[m] for m in months],
        "ageing_paise": ageing,
        "ageing_counts": ageing_counts,
        "attention": {"overdue": overdue[:8], "bounced": bounced, "unassigned": unassigned},
        "visits_today_list": visits,
        "recent": recent,
        "today": {"demands_raised": demands_today},
        "spark": spark,
        "greeting_date": datetime.now(UTC).isoformat(),
        "business_day": today,  # D3: the Home date/greeting follow the company time zone, not the browser
        "business_hour": clock.now(clock.business_tz()).hour,
    }
    return present_money(out)
