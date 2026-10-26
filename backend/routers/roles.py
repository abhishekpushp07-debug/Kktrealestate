
from fastapi import APIRouter, Depends, Request
from pydantic import field_validator

from db import db
from deps import get_current_user, require, require_any
from permissions import PERMISSION_GROUPS, PERMISSION_SET
from utils import (
    ApiError,
    ListParams,
    StrictModel,
    apply_update,
    base_doc,
    client_ip,
    expected_version,
    get_or_404,
    now_iso,
    paginate,
    search_filter,
    write_audit,
)

router = APIRouter(tags=["roles"])


def _check_perms(v: list[str]):
    bad = [p for p in v if p not in PERMISSION_SET]
    if bad:
        raise ValueError(f"Unknown permission codes: {', '.join(bad)}")
    return sorted(set(v))


class RoleCreate(StrictModel):
    name: str
    description: str | None = None
    permissions: list[str]

    @field_validator("permissions")
    @classmethod
    def _p(cls, v):
        return _check_perms(v)


class RoleUpdate(StrictModel):
    name: str | None = None
    description: str | None = None
    permissions: list[str] | None = None
    is_active: bool | None = None
    version: int | None = None

    @field_validator("permissions")
    @classmethod
    def _p(cls, v):
        return _check_perms(v) if v is not None else v


@router.get("/permissions")
async def list_permissions(user: dict = Depends(get_current_user)):
    return {"groups": [{"group": g, "permissions": [{"code": c, "label": l} for c, l in perms]} for g, perms in PERMISSION_GROUPS]}


@router.get("/roles")
async def list_roles(params: ListParams = Depends(), user: dict = Depends(require_any("admin.role.view", "admin.user.view"))):
    q = {"company_id": user["company_id"], **search_filter(params.search, ["name", "description"])}
    if not params.include_inactive:
        q["is_active"] = True
    res = await paginate(db.roles, q, params, params.sort_spec(["name", "created_at"]))
    ids = [r["id"] for r in res["items"]]
    counts = {c["_id"]: c["n"] for c in await db.users.aggregate([{"$match": {"role_id": {"$in": ids}, "is_active": True}}, {"$group": {"_id": "$role_id", "n": {"$sum": 1}}}]).to_list(None)}
    for r in res["items"]:
        r["user_count"] = counts.get(r["id"], 0)
    return res


@router.post("/roles", status_code=201)
async def create_role(body: RoleCreate, request: Request, user: dict = Depends(require("admin.role.create"))):
    if await db.roles.find_one({"company_id": user["company_id"], "name": body.name}):
        raise ApiError(409, "A role with this name already exists", "DUPLICATE_NAME")
    doc = {**base_doc(user, user["company_id"]), **body.model_dump(), "is_system": False}
    await db.roles.insert_one(doc)
    doc.pop("_id", None)
    await write_audit(user, "role.create", "role", doc["id"], after=doc, ip=client_ip(request))
    return doc


@router.get("/roles/{role_id}")
async def get_role(role_id: str, user: dict = Depends(require("admin.role.view"))):
    return await get_or_404(db.roles, role_id, "Role", {"company_id": user["company_id"]})


@router.patch("/roles/{role_id}")
async def update_role(role_id: str, body: RoleUpdate, request: Request, user: dict = Depends(require("admin.role.edit"))):
    before = await get_or_404(db.roles, role_id, "Role", {"company_id": user["company_id"]})
    changes = body.model_dump(exclude_unset=True)
    changes.pop("version", None)
    if not changes:
        raise ApiError(400, "No changes supplied", "NO_CHANGES")
    if before.get("is_system"):
        if "name" in changes or changes.get("is_active") is False:
            raise ApiError(409, "System roles cannot be renamed or deactivated", "SYSTEM_ROLE")
        if before["name"] == "Super Admin" and "permissions" in changes:
            raise ApiError(409, "Super Admin permissions cannot be changed", "SYSTEM_ROLE")
    if "name" in changes and await db.roles.find_one({"company_id": user["company_id"], "name": changes["name"], "id": {"$ne": role_id}}):
        raise ApiError(409, "A role with this name already exists", "DUPLICATE_NAME")
    if changes.get("is_active") is False:
        n = await db.users.count_documents({"role_id": role_id, "is_active": True})
        if n:
            raise ApiError(409, f"Role is assigned to {n} active user(s); reassign them first", "IN_USE")
    after = await apply_update(db.roles, before, changes, expected_version(request, body.version), "Role")
    await write_audit(user, "role.update", "role", role_id, before=before, after=after, ip=client_ip(request))
    return after


@router.delete("/roles/{role_id}")
async def delete_role(role_id: str, request: Request, user: dict = Depends(require("admin.role.delete"))):
    before = await get_or_404(db.roles, role_id, "Role", {"company_id": user["company_id"]})
    if before.get("is_system"):
        raise ApiError(409, "System roles cannot be deleted", "SYSTEM_ROLE")
    n = await db.users.count_documents({"role_id": role_id, "is_active": True})
    if n:
        raise ApiError(409, f"Role is assigned to {n} active user(s); reassign them first", "IN_USE")
    await db.roles.update_one({"id": role_id}, {"$set": {"is_active": False, "updated_at": now_iso()}})
    after = await db.roles.find_one({"id": role_id}, {"_id": 0})
    await write_audit(user, "role.deactivate", "role", role_id, before=before, after=after, ip=client_ip(request))
    return after
