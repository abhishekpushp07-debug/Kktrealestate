"""Phase R1/R2 — access-control API: permission tree, per-user roles + direct grants with effective preview, role clone."""
from fastapi import APIRouter, Depends, Request
from pydantic import Field

from db import db
from deps import get_current_user, require
from permissions import canonical, registry_rows
from services import rbac
from utils import ApiError, StrictModel, client_ip, get_or_404, new_id, now_iso, write_audit

router = APIRouter(prefix="/admin/access", tags=["access-control"])


class DirectGrant(StrictModel):
    code: str
    effect: str = Field(pattern="^(allow|deny)$")
    reason: str | None = None
    expires_at: str | None = None


class AccessUpdate(StrictModel):
    role_ids: list[str]
    project_scope: list[str] | None = None
    direct: list[DirectGrant] = []
    version: int | None = None


class CloneIn(StrictModel):
    name: str


@router.get("/tree")
async def tree(user: dict = Depends(get_current_user)):
    rows = await db.permissions.find({}, {"_id": 0}).to_list(None) or registry_rows()
    mods: dict[str, dict] = {}
    for r in sorted(rows, key=lambda x: (x["module_label"], x["feature_label"], x["action"])):
        m = mods.setdefault(r["module"], {"module": r["module"], "label": r["module_label"], "features": {}})
        f = m["features"].setdefault(r["feature"], {"feature": r["feature"], "label": r["feature_label"], "actions": []})
        f["actions"].append({k: r.get(k) for k in ("code", "hcode", "action", "label", "ui_only", "route_refs", "unregistered")})
    return {"modules": [{**m, "features": list(m["features"].values())} for m in mods.values()]}


async def _effective(u: dict) -> dict:
    rbac.invalidate(u["id"])
    eff = await rbac.resolve(u, -1, now_iso())
    rbac.invalidate(u["id"])
    direct = await db.user_direct_permissions.find({"user_id": u["id"]}, {"_id": 0}).to_list(None)
    return {"user": {k: u.get(k) for k in ("id", "name", "email", "role_id", "role_ids", "project_scope", "is_active", "version")}, "role_ids": eff["role_ids"], "role_names": eff["role_names"],
            "is_super": eff["is_super"], "effective": sorted(eff["permissions"]), "sources": eff["sources"], "direct": direct}


@router.get("/users/{user_id}")
async def get_access(user_id: str, user: dict = Depends(require("admin.access_control.manage"))):
    u = await get_or_404(db.users, user_id, "User", {"company_id": user["company_id"]})
    return await _effective(u)


@router.put("/users/{user_id}")
async def put_access(user_id: str, body: AccessUpdate, request: Request, user: dict = Depends(require("admin.access_control.manage"))):
    u = await get_or_404(db.users, user_id, "User", {"company_id": user["company_id"]})
    from services import access_guard
    access_guard.no_self_change(user, user_id, "roles, direct grants or project scope")
    await access_guard.guard_target(user, u, body.role_ids, body.project_scope)
    await access_guard.guard_grants(user, [canonical(d.code) for d in body.direct if d.effect == "allow"], [r for r in body.role_ids if r not in rbac.user_role_ids(u)])
    if body.version is not None and body.version != u.get("version", 1):
        raise ApiError(409, "User was changed by someone else; reload and retry", "VERSION_CONFLICT", {"current_version": u.get("version", 1)})
    roles = await db.roles.find({"id": {"$in": body.role_ids}, "is_active": True}, {"_id": 0, "id": 1, "name": 1}).to_list(None)
    if len(roles) != len(set(body.role_ids)):
        raise ApiError(400, "Role not found", "INVALID_ROLE")
    if not body.role_ids:
        raise ApiError(400, "At least one role is required (use Employee for no access)", "NO_ROLE")
    sa = await db.roles.find_one({"name": rbac.SUPER, "is_system": True}, {"_id": 0, "id": 1})
    was_super, is_super = sa["id"] in rbac.user_role_ids(u), sa["id"] in body.role_ids
    if was_super and not is_super and not await db.users.count_documents({"is_active": True, "id": {"$ne": user_id}, "$or": [{"role_id": sa["id"]}, {"role_ids": sa["id"]}]}):
        raise ApiError(409, "Cannot remove the last active Super Admin", "LAST_SUPER_ADMIN")
    if is_super and any(d.effect == "deny" for d in body.direct):
        raise ApiError(409, "Super Admin cannot be restricted: direct denies are not allowed", "SUPER_ADMIN_UNRESTRICTABLE")
    if body.project_scope is not None and "*" not in body.project_scope and await db.projects.count_documents({"id": {"$in": body.project_scope}}) != len(set(body.project_scope)):
        raise ApiError(400, "One or more projects in scope do not exist", "INVALID_SCOPE")
    known = {r["code"] for r in registry_rows()}
    bad = [d.code for d in body.direct if canonical(d.code) not in known]
    if bad:
        raise ApiError(400, f"Unknown permission codes: {', '.join(bad)}", "INVALID_PERMISSION")
    before = await _effective(u)
    sets = {"role_ids": body.role_ids, "role_id": body.role_ids[0], "updated_at": now_iso()}
    if body.project_scope is not None:
        sets["project_scope"] = body.project_scope
    await db.users.update_one({"id": user_id}, {"$set": sets, "$inc": {"version": 1}})
    await db.user_direct_permissions.delete_many({"user_id": user_id})
    if body.direct:
        await db.user_direct_permissions.insert_many([{"id": new_id(), "user_id": user_id, "code": canonical(d.code), "effect": d.effect, "reason": d.reason, "expires_at": d.expires_at, "granted_by": user["id"], "granted_by_name": user["name"], "created_at": now_iso()} for d in body.direct])
    await rbac.bump_version()
    rbac.invalidate(user_id)
    after = await _effective(await db.users.find_one({"id": user_id}, {"_id": 0}))
    await write_audit(user, "user.access_update", "user", user_id, before={"name": u["name"], "roles": before["role_names"], "direct": [{k: d[k] for k in ("code", "effect")} for d in before["direct"]], "effective_count": len(before["effective"]), "project_scope": u.get("project_scope")},
                      after={"name": u["name"], "roles": after["role_names"], "direct": [{k: d[k] for k in ("code", "effect")} for d in after["direct"]], "effective_count": len(after["effective"]), "project_scope": sets.get("project_scope", u.get("project_scope"))}, ip=client_ip(request))
    return after


@router.post("/roles/{role_id}/clone", status_code=201)
async def clone_role(role_id: str, body: CloneIn, request: Request, user: dict = Depends(require("admin.role.create"))):
    src = await get_or_404(db.roles, role_id, "Role", {"company_id": user["company_id"]})
    if await db.roles.find_one({"company_id": user["company_id"], "name": body.name}):
        raise ApiError(409, "A role with this name already exists", "DUPLICATE_NAME")
    from utils import base_doc
    doc = {**base_doc(user, user["company_id"]), "name": body.name, "description": f"Cloned from {src['name']}", "permissions": src["permissions"], "is_system": False, "cloned_from": src["id"]}
    await db.roles.insert_one(doc)
    doc.pop("_id", None)
    await write_audit(user, "role.create", "role", doc["id"], after=doc, ip=client_ip(request))
    return doc


@router.get("/roles/{role_id}/users")
async def role_users(role_id: str, user: dict = Depends(require("admin.role.view"))):
    items = await db.users.find({"company_id": user["company_id"], "is_active": True, "$or": [{"role_id": role_id}, {"role_ids": role_id}]}, {"_id": 0, "id": 1, "name": 1, "email": 1}).to_list(None)
    return {"items": items, "total": len(items)}


@router.get("/registry")
async def registry(user: dict = Depends(require("admin.access_control.manage"))):
    rows = await db.permissions.find({}, {"_id": 0}).to_list(None)
    return {"items": rows, "total": len(rows), "unregistered": [r["code"] for r in rows if r.get("unregistered")]}
