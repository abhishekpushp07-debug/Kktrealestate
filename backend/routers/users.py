
from fastapi import APIRouter, Depends, Request
from pydantic import EmailStr, field_validator

from db import db
from models_out import UsersOut, UsersOutPage
from deps import require, require_any
from routers.auth import hash_password, set_password, validate_password_policy
from utils import (
    ApiError,
    ListParams,
    StrictModel,
    apply_update,
    base_doc,
    client_ip,
    expected_version,
    get_or_404,
    paginate,
    search_filter,
    strip_private,
    write_audit,
)

router = APIRouter(prefix="/users", tags=["users"])


class UserCreate(StrictModel):
    name: str
    email: EmailStr
    phone: str | None = None
    password: str
    role_id: str | None = None
    role_ids: list[str] | None = None
    project_scope: list[str] = ["*"]
    must_change_password: bool = False

    @field_validator("password")
    @classmethod
    def _policy(cls, v):
        return validate_password_policy(v)


class UserUpdate(StrictModel):
    name: str | None = None
    phone: str | None = None
    role_id: str | None = None
    project_scope: list[str] | None = None
    is_active: bool | None = None
    must_change_password: bool | None = None
    version: int | None = None


class ResetPasswordIn(StrictModel):
    new_password: str

    @field_validator("new_password")
    @classmethod
    def _policy(cls, v):
        return validate_password_policy(v)


async def _validate_role_and_scope(role_id: str | None, scope: list[str] | None):
    if role_id and not await db.roles.find_one({"id": role_id, "is_active": True}):
        raise ApiError(400, "Role not found", "INVALID_ROLE")
    if scope is not None and "*" not in scope:
        count = await db.projects.count_documents({"id": {"$in": scope}})
        if count != len(set(scope)):
            raise ApiError(400, "One or more projects in scope do not exist", "INVALID_SCOPE")


async def _enrich(items: list[dict]) -> list[dict]:
    role_ids = {r for u in items for r in ([u.get("role_id")] + list(u.get("role_ids") or [])) if r}
    roles = {r["id"]: r["name"] for r in await db.roles.find({"id": {"$in": list(role_ids)}}, {"_id": 0, "id": 1, "name": 1}).to_list(None)}
    for u in items:
        u["role_name"] = roles.get(u.get("role_id"))
        u["role_names"] = [roles[r] for r in (u.get("role_ids") or [u.get("role_id")]) if r in roles]
    return items


@router.get("", response_model=UsersOutPage, response_model_exclude_unset=True)
async def list_users(params: ListParams = Depends(), user: dict = Depends(require("admin.user.view"))):
    q = {"company_id": user["company_id"], **search_filter(params.search, ["name", "email", "phone"])}
    if not params.include_inactive:
        q["is_active"] = True
    res = await paginate(db.users, q, params, params.sort_spec(["name", "email", "created_at"]), {"password_hash": 0, "failed_attempts": 0, "mfa_secret": 0, "mfa_temp_secret": 0, "password_history": 0})
    res["items"] = await _enrich(res["items"])
    return res


@router.post("", status_code=201)
async def create_user(body: UserCreate, request: Request, user: dict = Depends(require("admin.user.create"))):
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise ApiError(409, "A user with this email already exists", "DUPLICATE_EMAIL")
    role_ids = body.role_ids or ([body.role_id] if body.role_id else [])
    if not role_ids:  # R1: new users default to Employee (= no access) until granted
        emp = await db.roles.find_one({"name": "Employee", "is_system": True}, {"_id": 0, "id": 1})
        role_ids = [emp["id"]] if emp else []
    for rid in role_ids:
        await _validate_role_and_scope(rid, None)
    await _validate_role_and_scope(None, body.project_scope)
    doc = {**base_doc(user, user["company_id"]), "name": body.name, "email": email, "phone": body.phone,
           "role_id": role_ids[0] if role_ids else None, "role_ids": role_ids, "project_scope": body.project_scope, "password_hash": hash_password(body.password),
           "must_change_password": body.must_change_password, "mfa_enabled": False, "password_history": [],
           "failed_attempts": 0, "locked_until": None}
    await db.users.insert_one(doc)
    out = strip_private(doc)
    await write_audit(user, "user.create", "user", doc["id"], after=out, ip=client_ip(request))
    return (await _enrich([out]))[0]


@router.get("/{user_id}", response_model=UsersOut, response_model_exclude_unset=True)
async def get_user(user_id: str, user: dict = Depends(require("admin.user.view"))):
    doc = await get_or_404(db.users, user_id, "User", {"company_id": user["company_id"]})
    return (await _enrich([strip_private(doc)]))[0]


@router.patch("/{user_id}")
async def update_user(user_id: str, body: UserUpdate, request: Request, user: dict = Depends(require_any("admin.user.edit", "admin.user.deactivate"))):
    before = await get_or_404(db.users, user_id, "User", {"company_id": user["company_id"]})
    changes = body.model_dump(exclude_unset=True)
    changes.pop("version", None)
    if not changes:
        raise ApiError(400, "No changes supplied", "NO_CHANGES")
    await _validate_role_and_scope(changes.get("role_id"), changes.get("project_scope"))
    from services import access_guard
    if any(k in changes for k in ("role_id", "project_scope")):
        access_guard.no_self_change(user, user_id, "role or project scope")
    await access_guard.guard_target(user, before, [changes["role_id"]] if changes.get("role_id") else None, changes.get("project_scope"))
    if changes.get("role_id") and changes["role_id"] != before["role_id"]:
        await access_guard.guard_grants(user, [], [changes["role_id"]])
    if changes.get("is_active") is False:
        if user_id == user["id"]:
            raise ApiError(409, "You cannot deactivate your own account", "SELF_DEACTIVATE")
        await _guard_last_super_admin(before, None)
    if "role_id" in changes and changes["role_id"] != before["role_id"]:
        await _guard_last_super_admin(before, changes["role_id"])
        changes["role_ids"] = [changes["role_id"]] + [r for r in (before.get("role_ids") or []) if r != before["role_id"]]
    changes.pop("updated_at", None)
    after = await apply_update(db.users, before, changes, expected_version(request, body.version), "User")
    if "role_id" in changes:
        from services import rbac
        await rbac.bump_version()
        rbac.invalidate(user_id)
    if changes.get("is_active") is False:
        await db.refresh_tokens.update_many({"user_id": user_id, "revoked": False}, {"$set": {"revoked": True, "reason": "deactivated"}})
    await write_audit(user, "user.update", "user", user_id, before=before, after=after, ip=client_ip(request))
    return (await _enrich([strip_private(after)]))[0]


async def _guard_last_super_admin(target: dict, new_role_id: str | None):
    sa = await db.roles.find_one({"name": "Super Admin", "is_system": True}, {"_id": 0, "id": 1})
    if not sa or target["role_id"] != sa["id"] or new_role_id == sa["id"]:
        return
    others = await db.users.count_documents({"role_id": sa["id"], "is_active": True, "id": {"$ne": target["id"]}})
    if others == 0:
        raise ApiError(409, "Cannot remove the last active Super Admin", "LAST_SUPER_ADMIN")


@router.post("/{user_id}/reset-password")
async def reset_password(user_id: str, body: ResetPasswordIn, request: Request, user: dict = Depends(require("admin.user.edit"))):
    await get_or_404(db.users, user_id, "User", {"company_id": user["company_id"]})
    from services import access_guard
    access_guard.no_self_change(user, user_id, "password via the admin route (use Change password)")
    await access_guard.guard_target(user, await db.users.find_one({"id": user_id}, {"_id": 0}))
    await set_password(user_id, body.new_password, clear_must_change=False)
    await db.users.update_one({"id": user_id}, {"$set": {"must_change_password": True}})
    await write_audit(user, "user.reset_password", "user", user_id, ip=client_ip(request))
    return {"ok": True}
