import asyncio
import re
import time

from fastapi import APIRouter, Depends, Query

from db import db
from deps import get_current_user, project_scope_filter

router = APIRouter(tags=["search"])


@router.get("/search")
async def global_search(q: str = Query(min_length=1, max_length=60), limit: int = Query(5, ge=1, le=20), user: dict = Depends(get_current_user)):
    t0 = time.perf_counter()
    rx = {"$regex": "^" + re.escape(q), "$options": "i"}
    any_rx = {"$regex": re.escape(q), "$options": "i"}
    cid = user["company_id"]
    perms = user["permissions"]
    tasks, keys = [], []
    if "project.read" in perms:
        keys += ["projects", "blocks", "flats"]
        tasks.append(db.projects.find({"company_id": cid, "is_active": True, **project_scope_filter(user, "id"), "$or": [{"code": rx}, {"name": any_rx}, {"address.city": rx}]}, {"_id": 0, "id": 1, "name": 1, "code": 1, "status": 1, "address.city": 1}).limit(limit).to_list(limit))
        tasks.append(db.blocks.find({"company_id": cid, "is_active": True, **project_scope_filter(user), "$or": [{"code": rx}, {"name": any_rx}]}, {"_id": 0, "id": 1, "name": 1, "code": 1, "project_id": 1, "status": 1}).limit(limit).to_list(limit))
        tasks.append(db.flats.find({"company_id": cid, "is_active": True, **project_scope_filter(user), "flat_number": rx}, {"_id": 0, "id": 1, "flat_number": 1, "block_id": 1, "project_id": 1, "status": 1, "price": 1, "flat_type_code": 1}).limit(limit).to_list(limit))
    if "users.manage" in perms:
        keys.append("users")
        tasks.append(db.users.find({"company_id": cid, "is_active": True, "$or": [{"name": any_rx}, {"email": rx}]}, {"_id": 0, "id": 1, "name": 1, "email": 1, "role_id": 1}).limit(limit).to_list(limit))
    if "master.read" in perms:
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
    return {"query": q, "groups": [{"type": k, "items": v} for k, v in groups.items() if v], "took_ms": round((time.perf_counter() - t0) * 1000, 1)}
