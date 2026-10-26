from datetime import UTC

from fastapi import APIRouter, Depends

from db import db
from deps import project_scope_filter, require
from routers.projects import STATUSES, status_counts

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("")
async def dashboard(user: dict = Depends(require("project.read"))):
    from services import ttlcache
    ck = f"dash:{user['company_id']}:{','.join(sorted(user.get('project_scope') or []))}"
    hit = ttlcache.get(ck)
    if hit is not None:
        return hit
    res = await _dashboard(user)
    ttlcache.put(ck, res, 10)
    return res


async def _dashboard(user: dict):
    scope = project_scope_filter(user)
    base = {"company_id": user["company_id"], **scope}
    inventory = await status_counts(base)
    projects = await db.projects.find({"company_id": user["company_id"], "is_active": True, **project_scope_filter(user, "id")}, {"_id": 0, "id": 1, "name": 1, "code": 1, "status": 1, "project_type": 1, "address.city": 1}).sort("name", 1).to_list(50)
    pids = [p["id"] for p in projects]
    rows = await db.flats.aggregate([{"$match": {"project_id": {"$in": pids}, "is_active": True}}, {"$group": {"_id": {"p": "$project_id", "s": "$status"}, "n": {"$sum": 1}, "v": {"$sum": {"$divide": [{"$ifNull": ["$price_paise", 0]}, 100]}}}}]).to_list(None)
    cmap = {pid: {s: 0 for s in STATUSES} for pid in pids}
    vmap = {pid: 0 for pid in pids}
    for r in rows:
        cmap[r["_id"]["p"]][r["_id"]["s"]] = r["n"]
        vmap[r["_id"]["p"]] += r["v"]
    for p in projects:
        c = cmap[p["id"]]
        c["total"] = sum(c[s] for s in STATUSES)
        p["inventory"] = c
        p["inventory_value"] = round(vmap[p["id"]], 2)
    blocks = await db.blocks.find({"company_id": user["company_id"], "is_active": True, **scope}, {"_id": 0, "id": 1, "name": 1, "code": 1, "project_id": 1, "floors": 1, "flats_per_floor": 1, "construction_percent": 1, "status": 1}).sort("code", 1).to_list(100)
    pname = {p["id"]: p["name"] for p in projects}
    brows = await db.flats.aggregate([{"$match": {"block_id": {"$in": [b["id"] for b in blocks]}, "is_active": True}}, {"$group": {"_id": {"b": "$block_id", "s": "$status"}, "n": {"$sum": 1}}}]).to_list(None)
    bmap = {b["id"]: {s: 0 for s in STATUSES} for b in blocks}
    for r in brows:
        bmap[r["_id"]["b"]][r["_id"]["s"]] = r["n"]
    for b in blocks:
        b["project_name"] = pname.get(b["project_id"])
        c = bmap[b["id"]]
        c["total"] = sum(c[s] for s in STATUSES)
        b["inventory"] = c
    recent = []
    if "audit.view" in user["permissions"]:
        recent = await db.audit_logs.find({"company_id": user["company_id"]}, {"_id": 0, "before": 0, "after": 0}).sort("created_at", -1).limit(10).to_list(10)
    users_count = await db.users.count_documents({"company_id": user["company_id"], "is_active": True}) if "users.manage" in user["permissions"] else None
    out = {"inventory": inventory, "projects": projects, "blocks": blocks, "recent_audit": recent, "active_users": users_count}
    if "payment.read" in user["permissions"]:
        out["collections"] = await collections_widget(user)
        from routers.dashboard_widgets import widgets as _widgets
        w = await _widgets(user)
        out["collections"].update({k: w[k] for k in ("dues_raised_month", "upcoming_installments") if k in w})
    if "lead.read" in user["permissions"]:
        out["follow_ups_due"] = await followups_widget(user)
    return out


async def collections_widget(user: dict) -> dict:
    from datetime import datetime

    from services.money import present_money
    today = datetime.now(UTC).date()
    month_start = today.replace(day=1).isoformat()
    base = {"company_id": user["company_id"], "status": "Cleared", **project_scope_filter(user)}

    async def grouped(match):
        rows = await db.payments.aggregate([{"$match": match}, {"$group": {"_id": {"$cond": [{"$eq": ["$against", "OTHER_CHARGE"]}, "Other", "$payment_category"]}, "s": {"$sum": "$amount_paise"}, "n": {"$sum": 1}}}]).to_list(None)
        out = {"Cash": 0, "Account": 0, "Other": 0, "total": 0, "count": 0}
        for r in rows:
            out[r["_id"]] = r["s"]
            out["total"] += r["s"]
            out["count"] += r["n"]
        return {f"{k}_paise" if k != "count" else k: v for k, v in out.items()}

    pending = await db.payments.aggregate([{"$match": {"company_id": user["company_id"], "status": "Pending", **project_scope_filter(user)}}, {"$group": {"_id": None, "s": {"$sum": "$amount_paise"}, "n": {"$sum": 1}}}]).to_list(1)
    overdue = await db.demands.count_documents({"company_id": user["company_id"], "status": {"$in": ["Open", "Partially Paid"]}, "due_date": {"$lt": today.isoformat()}, **project_scope_filter(user)})
    due = await db.bookings.aggregate([{"$match": {"company_id": user["company_id"], "status": "Active", **project_scope_filter(user)}}, {"$group": {"_id": None, "d": {"$sum": {"$max": ["$summary.due_paise", 0]}}, "n": {"$sum": 1}}}]).to_list(1)
    return present_money({"today": await grouped({**base, "payment_date": today.isoformat()}), "month": await grouped({**base, "payment_date": {"$gte": month_start}}),
                          "pending_cheques": {"count": pending[0]["n"] if pending else 0, "amount_paise": pending[0]["s"] if pending else 0}, "overdue_demands": overdue,
                          "active_bookings": due[0]["n"] if due else 0, "outstanding_due_paise": due[0]["d"] if due else 0})


async def followups_widget(user: dict) -> dict:
    from datetime import datetime
    end = datetime.now(UTC).replace(hour=23, minute=59, second=59).isoformat()
    q = {"company_id": user["company_id"], "next_follow_up_at": {"$lte": end}, "status": {"$nin": ["Converted", "Lost"]}}
    if "users.manage" not in user["permissions"]:
        q["assigned_to"] = user["id"]
    items = await db.leads.find(q, {"_id": 0, "id": 1, "lead_number": 1, "name": 1, "phone": 1, "status": 1, "next_follow_up_at": 1}).sort("next_follow_up_at", 1).to_list(20)
    return {"items": items, "count": len(items)}
