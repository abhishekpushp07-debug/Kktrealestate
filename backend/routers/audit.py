
import csv
import io

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse

from db import db
from deps import get_current_user, require
from services.audit_diff import MODULES
from utils import ListParams, paginate, search_filter

router = APIRouter(prefix="/audit-logs", tags=["audit"])


def _query(user, params, entity_type, entity_id, actor_id, action, date_from, date_to, module, field, record):
    q = {"company_id": user["company_id"], **search_filter(params.search, ["actor_name", "action", "entity_type", "entity_id", "record_label"])}
    for k, v in (("entity_type", entity_type), ("entity_id", entity_id), ("actor_id", actor_id), ("action", action), ("module_name", module), ("changed_fields.field", field)):
        if v:
            q[k] = v
    if record:
        q["$or"] = [{"entity_id": record}, {"record_label": record}]
    if date_from or date_to:
        rng = {}
        if date_from:
            rng["$gte"] = date_from
        if date_to:
            rng["$lte"] = date_to if len(date_to) > 10 else date_to + "T23:59:59.999999+00:00"
        q["created_at"] = rng
    return q


@router.get("")
async def list_audit_logs(
    params: ListParams = Depends(), entity_type: str | None = None, entity_id: str | None = None, actor_id: str | None = None,
    action: str | None = None, date_from: str | None = Query(None), date_to: str | None = Query(None), module: str | None = None, field: str | None = None, record: str | None = None,
    include_archive: bool = False, user: dict = Depends(require("admin.audit.view")),
):
    q = _query(user, params, entity_type, entity_id, actor_id, action, date_from, date_to, module, field, record)
    sort = [("created_at", -1)] if params.sort in ("name", "-created_at") else [("created_at", 1)]
    coll = db.audit_logs_archive if include_archive else db.audit_logs
    return await paginate(coll, q, params, sort, {"before": 0, "after": 0, "propagated": 0, "surfaces": 0})


@router.get("/export.csv")
async def export_csv(params: ListParams = Depends(), entity_type: str | None = None, entity_id: str | None = None, actor_id: str | None = None, action: str | None = None,
                     date_from: str | None = None, date_to: str | None = None, module: str | None = None, field: str | None = None, record: str | None = None, include_archive: bool = False, user: dict = Depends(require("admin.audit.export"))):
    q = _query(user, params, entity_type, entity_id, actor_id, action, date_from, date_to, module, field, record)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["created_at", "user", "action", "module", "entity_type", "record_id", "record", "changes", "ip", "request_id"])
    coll = db.audit_logs_archive if include_archive else db.audit_logs
    async for r in coll.find(q, {"_id": 0}).sort("created_at", -1).limit(10000):
        ch = "; ".join(f"{c['label']}: {c.get('old')} → {c.get('new')}" for c in (r.get("changed_fields") or []))
        w.writerow([r.get("created_at"), r.get("user_name") or r.get("actor_name"), r.get("action"), r.get("module_name"), r.get("entity_type"), r.get("entity_id"), r.get("record_label"), ch, r.get("ip"), r.get("request_id")])
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=audit-logs.csv"})


@router.get("/modules")
async def modules(user: dict = Depends(require("admin.audit.view"))):
    return {"items": sorted(set(MODULES.values()) | set(await db.audit_logs.distinct("module_name", {"company_id": user["company_id"]})) - {None})}


@router.get("/entity-types")
async def entity_types(user: dict = Depends(require("admin.audit.view"))):
    return {"items": sorted(await db.audit_logs.distinct("entity_type", {"company_id": user["company_id"]}))}


@router.get("/login-events")
async def login_events(params: ListParams = Depends(), email: str | None = None, success: bool | None = None, user: dict = Depends(require("admin.audit.view"))):
    q = {**search_filter(params.search, ["email", "ip", "reason"])}
    if email:
        q["email"] = email.lower()
    if success is not None:
        q["success"] = success
    return await paginate(db.login_events, q, params, [("created_at", -1)])


@router.get("/entity/{entity_type}/{entity_id}")
async def entity_history(entity_type: str, entity_id: str, limit: int = Query(100, le=500), include_archive: bool = False, user: dict = Depends(get_current_user)):
    """Per-record timeline (History button) — any authenticated ERP user who can open the record can see its history."""
    from services.audit_diff import changed_fields
    q = {"company_id": user["company_id"], "entity_type": entity_type, "entity_id": entity_id}
    items = await db.audit_logs.find(q, {"_id": 0, "propagated": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    if include_archive:
        items += await db.audit_logs_archive.find(q, {"_id": 0, "propagated": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    for it in items:
        if not it.get("changed_fields"):
            it["changed_fields"] = changed_fields(it.get("before"), it.get("after"))
        it["user_name"] = it.get("user_name") or it.get("actor_name")
        it.pop("before", None)
        it.pop("after", None)
    return {"items": items, "total": len(items)}
