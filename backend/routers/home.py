"""Home v2 payload: snapshot + 12-month collections + due ageing + needs-attention + recent activity in ONE call."""
from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, Depends, Request

from db import db
from deps import project_scope_filter, require
from routers.catalogues import etag_response
from services.money import present_money
from services.read_models import get_dashboard

router = APIRouter(tags=["home"])


def _months(n=12):
    d = date.today().replace(day=1)
    out = []
    for _ in range(n):
        out.append(d.isoformat()[:7])
        d = (d - timedelta(days=1)).replace(day=1)
    return list(reversed(out))


@router.get("/dashboard/home")
async def home(request: Request, user: dict = Depends(require("masters.project.view"))):
    from services import ttlcache
    out = await ttlcache.cached(f"home:{ttlcache.scope_key(user)}:{date.today().isoformat()}", 10, lambda: _home(user))
    return etag_response(request, out, max_age=15)


async def _home(user: dict):
    cid, pf = user["company_id"], project_scope_filter(user)
    today = date.today().isoformat()
    snap = await get_dashboard(cid, user.get("project_scope"))
    months = _months()
    rows = await db.payments.aggregate([{"$match": {"company_id": cid, **pf, "status": "Cleared", "payment_date": {"$gte": months[0] + "-01"}}},
                                        {"$group": {"_id": {"m": {"$substr": ["$payment_date", 0, 7]}, "c": {"$cond": [{"$eq": ["$against", "OTHER_CHARGE"]}, "Other", "$payment_category"]}}, "s": {"$sum": "$amount_paise"}}}]).to_list(None)
    by = {m: {"month": m, "Cash": 0, "Account": 0, "Other": 0} for m in months}
    for r in rows:
        if r["_id"]["m"] in by:
            by[r["_id"]["m"]][r["_id"]["c"]] = r["s"] / 100
    open_dem = await db.demands.find({"company_id": cid, **pf, "voided": {"$ne": True}, "status": {"$in": ["Open", "Partially Paid"]}}, {"_id": 0, "id": 1, "booking_id": 1, "customer_name": 1, "due_date": 1, "total_demand_paise": 1, "paid_paise": 1, "installment_name": 1, "milestone_name": 1, "demand_number": 1, "project_name": 1}).to_list(2000)
    ageing = {"not_due": 0, "d0_30": 0, "d31_60": 0, "d61_90": 0, "d90": 0}
    ageing_counts = {k: 0 for k in ageing}
    overdue = []
    for d in open_dem:
        bal = d["total_demand_paise"] - (d.get("paid_paise") or 0)
        days = (date.today() - date.fromisoformat(d["due_date"])).days
        k = "not_due" if days <= 0 else "d0_30" if days <= 30 else "d31_60" if days <= 60 else "d61_90" if days <= 90 else "d90"
        ageing[k] += bal
        ageing_counts[k] += 1
        if days > 0:
            overdue.append({**d, "balance_paise": bal, "days": days})
    overdue.sort(key=lambda x: -x["balance_paise"])
    missing = {d["booking_id"] for d in overdue[:8] if not d.get("customer_name")}
    if missing:
        names = {b["id"]: b for b in await db.bookings.find({"id": {"$in": list(missing)}}, {"_id": 0, "id": 1, "customer_name": 1, "booking_number": 1}).to_list(None)}
        for d in overdue[:8]:
            b = names.get(d["booking_id"], {})
            d["customer_name"] = d.get("customer_name") or b.get("customer_name") or b.get("booking_number") or "Customer"
    bounced = await db.payments.find({"company_id": cid, **pf, "status": "Bounced", "payment_date": {"$gte": (date.today() - timedelta(days=30)).isoformat()}}, {"_id": 0, "id": 1, "booking_id": 1, "receipt_number": 1, "amount_paise": 1, "customer_name": 1, "payment_mode_name": 1}).limit(10).to_list(10)
    unassigned = await db.leads.find({"company_id": cid, **pf, "status": {"$nin": ["Lost", "Converted"]}, "$or": [{"assigned_to": None}, {"assigned_to": {"$exists": False}}]}, {"_id": 0, "id": 1, "name": 1, "phone": 1, "source": 1, "project_name": 1, "created_at": 1}).sort("created_at", -1).limit(10).to_list(10)
    visits = await db.site_visits.find({"company_id": cid, **pf, "date": today, "status": {"$in": ["Confirmed", "Rescheduled"]}}, {"_id": 0, "id": 1, "visit_number": 1, "name": 1, "slot_start": 1, "project_name": 1, "assigned_name": 1}).sort("slot_start", 1).to_list(20)
    recent = await db.audit_logs.find({"company_id": cid, "action": {"$regex": "^(booking|payment|demand|stage|lead|visit|customer)\\."}}, {"_id": 0, "id": 1, "action": 1, "entity_type": 1, "entity_id": 1, "created_at": 1, "user_name": 1, "after": 1}).sort("created_at", -1).limit(12).to_list(12)
    for r in recent:
        r["after"] = {k: v for k, v in (r.get("after") or {}).items() if k in ("booking_number", "receipt_number", "amount", "stage", "name", "status", "customer_name", "demand_number")}
    demands_today = await db.demands.count_documents({"company_id": cid, **pf, "posted_at": {"$gte": today}})
    spark = {"collections": [by[m]["Cash"] + by[m]["Account"] + by[m]["Other"] for m in months[-8:]]}
    out = {"computed_at": snap["computed_at"], **snap["payload"], "collections_12m": [by[m] for m in months], "ageing_paise": ageing, "ageing_counts": ageing_counts, "attention": {"overdue": overdue[:8], "bounced": bounced, "unassigned": unassigned},
           "visits_today_list": visits, "recent": recent, "today": {"demands_raised": demands_today}, "spark": spark, "greeting_date": datetime.now(UTC).isoformat()}
    return present_money(out)
