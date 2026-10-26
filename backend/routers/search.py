import asyncio
import re
import time

from fastapi import APIRouter, Depends, Query

from db import db
from utils import with_price
from deps import get_current_user, project_scope_filter

router = APIRouter(tags=["search"])


@router.get("/search")
async def global_search(q: str = Query(min_length=1, max_length=60), limit: int = Query(5, ge=1, le=20), scope: str = Query("all", pattern="^(all|customers|bookings|flats|projects)$"), user: dict = Depends(get_current_user)):
    t0 = time.perf_counter()
    rx = {"$regex": "^" + re.escape(q), "$options": "i"}
    any_rx = {"$regex": re.escape(q), "$options": "i"}
    cid = user["company_id"]
    perms = user["permissions"]
    tasks, keys = [], []
    digits = re.sub(r"\D", "", q)
    if scope in ("all", "customers") and "sales.customer.view" in perms:
        keys.append("customers")
        ors = [{"customer_code": {"$regex": "^" + re.escape(q.upper())}}, {"full_name": rx}]
        if digits:
            ors.append({"phone": {"$regex": "^(\\+91)?" + digits}})
        tasks.append(db.customers.find({"company_id": cid, "is_active": True, "$or": ors}, {"_id": 0, "id": 1, "full_name": 1, "customer_code": 1, "phone": 1, "kyc_status": 1, "lifecycle_stage": 1}).limit(limit).to_list(limit))
    if scope in ("all", "bookings") and "sales.booking.view" in perms:
        keys.append("bookings")
        tasks.append(db.bookings.find({"company_id": cid, **project_scope_filter(user), "$or": [{"booking_number": {"$regex": "^" + re.escape(q.upper())}}, {"customer_name": rx}, {"flat_snapshot.flat_number": rx}]}, {"_id": 0, "id": 1, "booking_number": 1, "customer_name": 1, "status": 1, "project_name": 1, "block_name": 1, "flat_snapshot.flat_number": 1}).limit(limit).to_list(limit))
    if scope in ("all", "projects", "flats") and "masters.project.view" in perms:
        if scope != "flats":
            keys += ["projects", "blocks"]
            tasks.append(db.projects.find({"company_id": cid, "is_active": True, **project_scope_filter(user, "id"), "$or": [{"code": rx}, {"name": any_rx}, {"address.city": rx}]}, {"_id": 0, "id": 1, "name": 1, "code": 1, "status": 1, "address.city": 1}).limit(limit).to_list(limit))
            tasks.append(db.blocks.find({"company_id": cid, "is_active": True, **project_scope_filter(user), "$or": [{"code": rx}, {"name": any_rx}]}, {"_id": 0, "id": 1, "name": 1, "code": 1, "project_id": 1, "status": 1}).limit(limit).to_list(limit))
        keys.append("flats")
        tasks.append(db.flats.find({"company_id": cid, "is_active": True, **project_scope_filter(user), "flat_number": rx}, {"_id": 0, "id": 1, "flat_number": 1, "block_id": 1, "project_id": 1, "status": 1, "price_paise": 1, "flat_type_code": 1}).limit(limit).to_list(limit))
    if scope == "all" and "admin.user.view" in perms:
        keys.append("users")
        tasks.append(db.users.find({"company_id": cid, "is_active": True, "$or": [{"name": any_rx}, {"email": rx}]}, {"_id": 0, "id": 1, "name": 1, "email": 1, "role_id": 1}).limit(limit).to_list(limit))
    if scope == "all" and "masters.flat_type.view" in perms:
        keys.append("flat_types")
        tasks.append(db.flat_types.find({"company_id": cid, "is_active": True, "$or": [{"name": any_rx}, {"code": rx}]}, {"_id": 0, "id": 1, "name": 1, "code": 1, "bhk": 1}).limit(limit).to_list(limit))
    results = await asyncio.gather(*tasks) if tasks else []
    groups = dict(zip(keys, results))
    pids = {x["project_id"] for k in ("blocks", "flats") for x in groups.get(k, [])}
    if pids:
        pm = {p["id"]: p["code"] for p in await db.projects.find({"id": {"$in": list(pids)}}, {"_id": 0, "id": 1, "code": 1}).to_list(None)}
        for k in ("blocks", "flats"):
            for x in groups.get(k, []):
                x["project_code"] = pm.get(x["project_id"])
                with_price(x)
    return {"query": q, "groups": [{"type": k, "items": v} for k, v in groups.items() if v], "took_ms": round((time.perf_counter() - t0) * 1000, 1)}
