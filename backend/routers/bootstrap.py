"""Bootstrap (one call to open the ERP), read-model endpoints, admin recompute."""
from fastapi import APIRouter, Depends, Request, Response

from db import db
from deps import get_current_user, project_scope_filter, require
from routers.catalogues import current_version, etag_response
from services.money import present_money
from services.read_models import get_dashboard, recompute_all
from utils import now_iso, strip_private

router = APIRouter(tags=["bootstrap"])


@router.get("/bootstrap")
async def bootstrap(request: Request, user: dict = Depends(get_current_user)):
    cid = user["company_id"]
    pf = project_scope_filter(user)
    company = await db.companies.find_one({"id": cid}, {"_id": 0, "id": 1, "name": 1, "legal_name": 1, "gstin": 1, "rera_number": 1, "logo_url": 1, "address": 1, "financial_year_start_month": 1, "demand_due_days": 1, "receipt_prefix": 1})
    role = await db.roles.find_one({"id": user["role_id"]}, {"_id": 0, "id": 1, "name": 1, "description": 1})
    site = await db.site_settings.find_one({"company_id": cid}, {"_id": 0, "brand_name": 1, "portal_url": 1, "phone": 1, "whatsapp": 1, "email": 1}) or {}
    sla = await db.settings.find_one({"key": "sla_hours"}, {"_id": 0, "value": 1})
    today = now_iso()[:10]
    counts = {"unread_notifications": await db.notifications.count_documents({"user_id": user["id"], "read": False, "withdrawn": {"$ne": True}}),
              "new_enquiries": await db.leads.count_documents({"company_id": cid, **pf, "source": {"$in": ["Website", "Brochure", "Site Visit"]}, "is_read": {"$ne": True}}),
              "cheques_pending": await db.payments.count_documents({"company_id": cid, **pf, "status": "Pending"}),
              "visits_today": await db.site_visits.count_documents({"company_id": cid, **pf, "date": today, "status": {"$in": ["Confirmed", "Rescheduled"]}}),
              "followups_due": await db.leads.count_documents({"company_id": cid, **pf, "next_follow_up_at": {"$lte": now_iso()}, "status": {"$nin": ["Lost", "Converted"]}})}
    me = strip_private(user)
    me["permissions"] = sorted(user["permissions"])
    payload = {"me": {k: me[k] for k in me if k not in ("permissions",)}, "permissions": me["permissions"], "role": role, "project_scope": user.get("project_scope") or [], "company": company,
               "settings_public": {"portal_url": site.get("portal_url"), "brand_name": site.get("brand_name"), "sla_hours": (sla or {}).get("value"), "demand_due_days": (company or {}).get("demand_due_days", 15)},
               "catalogues_version": await current_version(), "counts": counts}
    r = etag_response(request, payload, max_age=30)
    r.headers["X-Server-Time"] = now_iso()
    return r


@router.get("/dashboard/snapshot")
async def dashboard_snapshot(request: Request, response: Response, user: dict = Depends(require("project.read"))):
    snap = await get_dashboard(user["company_id"], user.get("project_scope"))
    from datetime import UTC, datetime
    age = int((datetime.now(UTC) - datetime.fromisoformat(snap["computed_at"])).total_seconds())
    r = etag_response(request, present_money({"computed_at": snap["computed_at"], "age_s": age, **snap["payload"]}), max_age=15)
    r.headers["X-Data-Age"] = str(age)
    return r


@router.get("/projects/{project_id}/summary")
async def project_summary(project_id: str, response: Response, user: dict = Depends(require("project.read"))):
    from deps import ensure_project_access
    from services.read_models import refresh_project
    ensure_project_access(user, project_id)
    s = await db.project_summaries.find_one({"project_id": project_id}, {"_id": 0}) or await refresh_project(project_id)
    if not s:
        from utils import ApiError
        raise ApiError(404, "Project not found", "NOT_FOUND")
    response.headers["X-Data-Age"] = s["computed_at"]
    return present_money(s)


@router.get("/blocks/{block_id}/summary")
async def block_summary(block_id: str, response: Response, user: dict = Depends(require("project.read"))):
    from deps import ensure_project_access
    from services.read_models import refresh_block
    s = await db.block_summaries.find_one({"block_id": block_id}, {"_id": 0}) or await refresh_block(block_id)
    if not s:
        from utils import ApiError
        raise ApiError(404, "Block not found", "NOT_FOUND")
    ensure_project_access(user, s["project_id"])
    response.headers["X-Data-Age"] = s["computed_at"]
    return present_money(s)


@router.get("/customers/{customer_id}/summary")
async def customer_summary(customer_id: str, response: Response, user: dict = Depends(require("customer.read"))):
    from services.read_models import refresh_customer
    s = await db.customer_summaries.find_one({"customer_id": customer_id, "company_id": user["company_id"]}, {"_id": 0}) or await refresh_customer(customer_id)
    if not s:
        from utils import ApiError
        raise ApiError(404, "Customer not found", "NOT_FOUND")
    response.headers["X-Data-Age"] = s["computed_at"]
    return present_money(s)


@router.post("/admin/recompute-read-models")
async def recompute(user: dict = Depends(require("settings.manage"))):
    return await recompute_all()
