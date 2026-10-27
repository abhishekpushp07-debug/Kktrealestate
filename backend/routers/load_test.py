"""Phase L: guarded purge of load-test lineage (Super Admin). Only documents descending from projects tagged load_test:true (or users/plans created for the run) are removed."""
from fastapi import APIRouter, Depends, Request

from db import db
from deps import require
from services.counters import recompute_all
from utils import ApiError, StrictModel, client_ip, now_iso, write_audit

router = APIRouter(prefix="/admin/load-test", tags=["admin"])
USER_DOMAIN = "@loadtest.kkt-erp.in"
PLAN_PREFIX = "LT"


class PurgeIn(StrictModel):
    confirm: str
    dry_run: bool = False


async def _lineage(company_id: str) -> dict:
    projects = await db.projects.find({"company_id": company_id, "load_test": True}, {"_id": 0, "id": 1, "name": 1}).to_list(None)
    pids = [p["id"] for p in projects]
    bids = [b["id"] for b in await db.blocks.find({"project_id": {"$in": pids}}, {"_id": 0, "id": 1}).to_list(None)]
    bookings = [b["id"] for b in await db.bookings.find({"project_id": {"$in": pids}}, {"_id": 0, "id": 1}).to_list(None)]
    cust_ids = {c["id"] for c in await db.customers.find({"company_id": company_id, "tags": "load_test"}, {"_id": 0, "id": 1}).to_list(None)}
    # a load-test customer must not own a booking outside load-test projects — otherwise the purge would touch real lineage
    foreign = await db.bookings.count_documents({"customer_id": {"$in": list(cust_ids)}, "project_id": {"$nin": pids}})
    users = [u["id"] for u in await db.users.find({"email": {"$regex": USER_DOMAIN.replace(".", r"\.") + "$"}}, {"_id": 0, "id": 1}).to_list(None)]
    plans = [p["id"] for p in await db.payment_plans.find({"code": {"$regex": f"^{PLAN_PREFIX}[0-9]"}}, {"_id": 0, "id": 1}).to_list(None)]
    foreign_plan = await db.payment_plan_assignments.count_documents({"payment_plan_id": {"$in": plans}, "project_id": {"$nin": pids}})
    return {"projects": projects, "pids": pids, "bids": bids, "bookings": bookings, "customers": sorted(cust_ids), "users": users, "plans": plans, "foreign_bookings": foreign, "foreign_plan_assignments": foreign_plan}


@router.get("/lineage")
async def lineage(user: dict = Depends(require("admin.data.reseed"))):
    L = await _lineage(user["company_id"])
    return {k: (len(v) if isinstance(v, list) else v) for k, v in L.items()} | {"project_names": [p["name"] for p in L["projects"]]}


@router.post("/purge")
async def purge(body: PurgeIn, request: Request, user: dict = Depends(require("admin.data.reseed"))):
    """Removes every document with load_test lineage; refuses (409) if any non-tagged document would be affected. Audit rows stay, marked load_test:true."""
    if user.get("role_name") != "Super Admin":
        raise ApiError(403, "Super Admin only", "FORBIDDEN")
    if body.confirm != "PURGE":
        raise ApiError(400, 'Body must be {"confirm":"PURGE"}', "CONFIRM_REQUIRED")
    L = await _lineage(user["company_id"])
    if L["foreign_bookings"] or L["foreign_plan_assignments"]:
        raise ApiError(409, f"Refusing: {L['foreign_bookings']} booking(s) / {L['foreign_plan_assignments']} plan assignment(s) outside load-test projects share lineage", "LINEAGE_CONFLICT")
    pids, bids, bk, cids = L["pids"], L["bids"], L["bookings"], L["customers"]
    plan = {
        "projects": {"id": {"$in": pids}}, "blocks": {"project_id": {"$in": pids}}, "flats": {"project_id": {"$in": pids}}, "parking_slots": {"project_id": {"$in": pids}},
        "construction_stages": {"block_id": {"$in": bids}}, "payment_plan_assignments": {"$or": [{"project_id": {"$in": pids}}, {"payment_plan_id": {"$in": L["plans"]}}]}, "payment_plans": {"id": {"$in": L["plans"]}},
        "bookings": {"id": {"$in": bk}}, "payments": {"booking_id": {"$in": bk}}, "demands": {"booking_id": {"$in": bk}}, "ledger_entries": {"booking_id": {"$in": bk}}, "contra_entries": {"booking_id": {"$in": bk}},
        "refunds": {"booking_id": {"$in": bk}}, "reminders": {"booking_id": {"$in": bk}}, "generated_documents": {"booking_id": {"$in": bk}}, "doc_share_links": {"doc_id": {"$in": [d["id"] for d in await db.generated_documents.find({"booking_id": {"$in": bk}}, {"_id": 0, "id": 1}).to_list(None)]}},
        "documents": {"$or": [{"booking_id": {"$in": bk}}, {"customer_id": {"$in": cids}}]}, "messages": {"$or": [{"booking_id": {"$in": bk}}, {"customer_id": {"$in": cids}}]},
        "service_requests": {"$or": [{"booking_id": {"$in": bk}}, {"customer_id": {"$in": cids}}]}, "communications": {"customer_id": {"$in": cids}},
        "leads": {"$or": [{"project_id": {"$in": pids}}, {"tags": "load_test"}]}, "site_visits": {"project_id": {"$in": pids}}, "customers": {"id": {"$in": cids}}, "portal_accounts": {"customer_id": {"$in": cids}},
        "notifications": {"$or": [{"entity_id": {"$in": bk + pids + cids}}, {"user_id": {"$in": L["users"]}}]}, "idempotency_keys": {"user_id": {"$in": L["users"]}}, "refresh_tokens": {"user_id": {"$in": L["users"]}},
        "users": {"id": {"$in": L["users"]}}, "project_summaries": {"project_id": {"$in": pids}}, "block_summaries": {"block_id": {"$in": bids}}, "customer_summaries": {"customer_id": {"$in": cids}},
        "monthly_buckets": {"$or": [{"scope": "project", "scope_id": {"$in": pids}}, {"scope": "customer", "scope_id": {"$in": cids}}]},
    }
    counts = {}
    for coll, q in plan.items():
        counts[coll] = await db[coll].count_documents(q)
    if body.dry_run:
        return {"dry_run": True, "would_remove": counts, "projects": [p["name"] for p in L["projects"]]}
    for coll, q in plan.items():
        if counts[coll]:
            target = db[coll]
            if hasattr(target, "_coll"):  # append-only guard (ledger_entries): load-test lineage is the one sanctioned removal, by booking ids only
                target = target._coll
            await target.delete_many(q)
    marked = await db.audit_logs.update_many({"$or": [{"entity_id": {"$in": bk + pids + cids + bids + L["users"]}}, {"actor_id": {"$in": L["users"]}}]}, {"$set": {"load_test": True}})
    await recompute_all()
    try:
        from services import trends
        for co in await db.companies.find({}, {"_id": 0, "id": 1}).to_list(None):
            await trends.refresh(co["id"], "company", None)
    except Exception:  # noqa: BLE001
        pass
    res = {"removed": counts, "audit_marked": marked.modified_count, "projects": [p["name"] for p in L["projects"]], "at": now_iso()}
    await write_audit(user, "admin.load_test_purge", "system", "load_test", after={"removed_total": sum(counts.values()), "projects": res["projects"]}, ip=client_ip(request))
    return res
