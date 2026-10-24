
from fastapi import APIRouter, Depends, Query

from db import db
from deps import require
from utils import ListParams, paginate, search_filter

router = APIRouter(prefix="/audit-logs", tags=["audit"])


@router.get("")
async def list_audit_logs(
    params: ListParams = Depends(), entity_type: str | None = None, entity_id: str | None = None, actor_id: str | None = None,
    action: str | None = None, date_from: str | None = Query(None), date_to: str | None = Query(None),
    user: dict = Depends(require("audit.view")),
):
    q = {"company_id": user["company_id"], **search_filter(params.search, ["actor_name", "action", "entity_type", "entity_id"])}
    for k, v in (("entity_type", entity_type), ("entity_id", entity_id), ("actor_id", actor_id), ("action", action)):
        if v:
            q[k] = v
    if date_from or date_to:
        rng = {}
        if date_from:
            rng["$gte"] = date_from
        if date_to:
            rng["$lte"] = date_to if len(date_to) > 10 else date_to + "T23:59:59.999999+00:00"
        q["created_at"] = rng
    sort = [("created_at", -1)] if params.sort in ("name", "-created_at") else [("created_at", 1)]
    return await paginate(db.audit_logs, q, params, sort)


@router.get("/entity-types")
async def entity_types(user: dict = Depends(require("audit.view"))):
    return {"items": sorted(await db.audit_logs.distinct("entity_type", {"company_id": user["company_id"]}))}


@router.get("/login-events")
async def login_events(params: ListParams = Depends(), email: str | None = None, success: bool | None = None, user: dict = Depends(require("audit.view"))):
    q = {**search_filter(params.search, ["email", "ip", "reason"])}
    if email:
        q["email"] = email.lower()
    if success is not None:
        q["success"] = success
    return await paginate(db.login_events, q, params, [("created_at", -1)])


@router.get("/entity/{entity_type}/{entity_id}")
async def entity_history(entity_type: str, entity_id: str, limit: int = Query(100, le=500), user: dict = Depends(require("project.read"))):
    """Per-record timeline; available to any authenticated reader of that entity (not only audit.view)."""
    items = await db.audit_logs.find({"company_id": user["company_id"], "entity_type": entity_type, "entity_id": entity_id}, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    for it in items:
        b, a = it.get("before") or {}, it.get("after") or {}
        if isinstance(b, dict) and isinstance(a, dict):
            it["changed_fields"] = sorted(k for k in set(b) | set(a) if k not in ("updated_at", "version") and b.get(k) != a.get(k))
    return {"items": items, "total": len(items)}
