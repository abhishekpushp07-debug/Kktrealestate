import hashlib
import os
import re
import secrets
from datetime import UTC, datetime, timedelta

import pyotp
from fastapi import APIRouter, Depends, Request
from passlib.context import CryptContext
from pydantic import EmailStr, field_validator

from db import db
from deps import (
    ACCESS_MINUTES,
    JWT_ALG,
    JWT_SECRET,
    create_access_token,
    enforce_rate_limit,
    get_current_user,
)
from utils import (
    ApiError,
    StrictModel,
    client_ip,
    new_id,
    now_iso,
    strip_private,
    write_audit,
)

router = APIRouter(prefix="/auth", tags=["auth"])
pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")

REFRESH_DAYS = int(os.environ.get("REFRESH_TOKEN_DAYS", "7"))
MAX_FAILED, LOCK_MINUTES, PASSWORD_HISTORY = 5, 15, 5


def hash_password(pw: str) -> str:
    return pwd_ctx.hash(pw)


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return pwd_ctx.verify(pw, hashed)
    except Exception:
        return False


def validate_password_policy(pw: str) -> str:
    if len(pw) < 8 or not re.search(r"\d", pw) or not re.search(r"[A-Za-z]", pw):
        raise ValueError("Password must be at least 8 characters with at least 1 letter and 1 number")
    return pw


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def _login_event(email: str, ok: bool, request: Request, reason: str = "", user_id: str | None = None):
    await db.login_events.insert_one({"id": new_id(), "email": email, "user_id": user_id, "success": ok, "reason": reason,
                                      "ip": client_ip(request), "user_agent": request.headers.get("user-agent", "")[:300], "created_at": now_iso()})


async def check_password_history(user_id: str, new_pw: str):
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 1, "password_history": 1})
    for h in [u.get("password_hash")] + (u.get("password_history") or []):
        if h and verify_password(new_pw, h):
            raise ApiError(422, f"Password was used recently; choose one not among your last {PASSWORD_HISTORY}", "PASSWORD_REUSED")


async def set_password(user_id: str, new_pw: str, clear_must_change: bool = True):
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 1, "password_history": 1})
    history = ([u["password_hash"]] + (u.get("password_history") or []))[:PASSWORD_HISTORY]
    upd = {"password_hash": hash_password(new_pw), "password_history": history, "failed_attempts": 0, "locked_until": None, "updated_at": now_iso(), "password_changed_at": now_iso()}
    if clear_must_change:
        upd["must_change_password"] = False
    await db.users.update_one({"id": user_id}, {"$set": upd})
    await db.refresh_tokens.update_many({"user_id": user_id, "revoked": False}, {"$set": {"revoked": True, "revoked_at": now_iso(), "reason": "password_change"}})


async def issue_refresh_token(user: dict, request: Request) -> str:
    token = secrets.token_urlsafe(48)
    await db.refresh_tokens.insert_one({
        "id": new_id(), "user_id": user["id"], "company_id": user["company_id"], "token_hash": _hash_token(token), "revoked": False,
        "ip": client_ip(request), "user_agent": request.headers.get("user-agent", "")[:300], "created_at": now_iso(), "last_seen_at": now_iso(),
        "expires_at": (datetime.now(UTC) + timedelta(days=REFRESH_DAYS)).isoformat(),
        "expires_dt": datetime.now(UTC) + timedelta(days=REFRESH_DAYS),
    })
    return token


async def _public_user(user: dict) -> dict:
    from services import rbac
    from deps import _current_roles_version
    u = strip_private(user)
    eff = await rbac.resolve(user, await _current_roles_version(), now_iso())
    u["role_name"] = eff["role_names"][0] if eff["role_names"] else None
    u["role_names"] = eff["role_names"]
    u["permissions"] = sorted(eff["permissions"])
    u["is_super_admin"] = eff["is_super"]
    u["mfa_enabled"] = bool(user.get("mfa_enabled"))
    return u


async def _token_response(user: dict, request: Request) -> dict:
    return {"access_token": create_access_token(user), "refresh_token": await issue_refresh_token(user, request), "token_type": "bearer",
            "expires_in": ACCESS_MINUTES * 60, "user": await _public_user(user), "must_change_password": bool(user.get("must_change_password"))}


async def _mfa_policy_requires(user: dict) -> bool:
    s = await db.settings.find_one({"key": "mfa_required_for_admin_roles"}, {"_id": 0, "value": 1})
    if not (s and s.get("value")):
        return False
    from permissions import expand
    roles = await db.roles.find({"id": {"$in": list(dict.fromkeys([*(user.get("role_ids") or []), *([user["role_id"]] if user.get("role_id") else [])]))}}, {"_id": 0, "permissions": 1}).to_list(None)
    perms = {c for r in roles for c in expand(r.get("permissions") or [])}
    return bool({"admin.user.edit", "admin.role.edit", "admin.settings.edit", "admin.access_control.manage"} & perms)


class LoginIn(StrictModel):
    email: EmailStr
    password: str


class MfaLoginIn(StrictModel):
    mfa_token: str
    code: str


class RefreshIn(StrictModel):
    refresh_token: str


class LogoutIn(StrictModel):
    refresh_token: str | None = None


class ChangePasswordIn(StrictModel):
    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def _policy(cls, v):
        return validate_password_policy(v)


class MfaVerifyIn(StrictModel):
    code: str


class MfaDisableIn(StrictModel):
    password: str
    code: str | None = None


@router.get("/login-options")
async def login_options(request: Request):
    from services.owner_bootstrap import demo_login_allowed
    c = await db.companies.find_one({}, {"_id": 0, "name": 1})
    return {"demo_accounts": demo_login_allowed(request), "company": (c or {}).get("name")}


@router.post("/login")
async def login(body: LoginIn, request: Request):
    ip = client_ip(request)
    await enforce_rate_limit(f"login:{ip}", 10, 60)
    email = body.email.lower()
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or not user.get("is_active"):
        await _login_event(email, False, request, "invalid_credentials")
        raise ApiError(401, "Invalid email or password", "INVALID_CREDENTIALS")
    from services.owner_bootstrap import demo_login_allowed
    if user.get("is_demo") and not demo_login_allowed(request):
        await _login_event(email, False, request, "demo_disabled", user["id"])
        raise ApiError(401, "Demo accounts are not available on this host", "DEMO_LOGIN_DISABLED")
    locked_until = user.get("locked_until")
    if locked_until and datetime.fromisoformat(locked_until) > datetime.now(UTC):
        await _login_event(email, False, request, "locked", user["id"])
        raise ApiError(423, f"Account locked due to repeated failed attempts. Try again after {LOCK_MINUTES} minutes.", "ACCOUNT_LOCKED")
    if not verify_password(body.password, user["password_hash"]):
        res = await db.users.find_one_and_update({"id": user["id"]}, {"$inc": {"failed_attempts": 1}}, projection={"failed_attempts": 1}, return_document=True)
        if res["failed_attempts"] >= MAX_FAILED:
            await db.users.update_one({"id": user["id"]}, {"$set": {"locked_until": (datetime.now(UTC) + timedelta(minutes=LOCK_MINUTES)).isoformat(), "failed_attempts": 0}})
            await write_audit(None, "auth.locked", "user", user["id"], ip=ip, company_id=user["company_id"])
            await _login_event(email, False, request, "locked_now", user["id"])
            raise ApiError(423, f"Account locked for {LOCK_MINUTES} minutes after {MAX_FAILED} failed attempts.", "ACCOUNT_LOCKED")
        await _login_event(email, False, request, "wrong_password", user["id"])
        raise ApiError(401, "Invalid email or password", "INVALID_CREDENTIALS")
    await db.users.update_one({"id": user["id"]}, {"$set": {"failed_attempts": 0, "locked_until": None, "last_login_at": now_iso()}})
    if user.get("mfa_enabled"):
        await _login_event(email, True, request, "password_ok_mfa_pending", user["id"])
        return {"mfa_required": True, "mfa_token": create_access_token(user, "mfa", 5), "user": {"name": user["name"], "email": user["email"]}}
    await _login_event(email, True, request, "ok", user["id"])
    out = await _token_response(user, request)
    out["mfa_setup_required"] = await _mfa_policy_requires(user)
    return out


@router.post("/login/mfa")
async def login_mfa(body: MfaLoginIn, request: Request):
    import jwt
    try:
        payload = jwt.decode(body.mfa_token, JWT_SECRET, algorithms=[JWT_ALG], audience="erp")
        assert payload.get("type") == "mfa"
    except Exception:
        raise ApiError(401, "Invalid or expired MFA token", "INVALID_TOKEN")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0})
    if not user or not user.get("mfa_enabled") or not pyotp.TOTP(user["mfa_secret"]).verify(body.code, valid_window=1):
        await _login_event(user["email"] if user else "?", False, request, "mfa_failed", payload["sub"])
        raise ApiError(401, "Invalid authentication code", "MFA_INVALID")
    await _login_event(user["email"], True, request, "ok_mfa", user["id"])
    return await _token_response(user, request)


@router.post("/refresh")
async def refresh(body: RefreshIn, request: Request):
    th = _hash_token(body.refresh_token)
    stored = await db.refresh_tokens.find_one({"token_hash": th}, {"_id": 0})
    if not stored:
        raise ApiError(401, "Invalid refresh token", "INVALID_REFRESH_TOKEN")
    if stored["revoked"]:
        await db.refresh_tokens.update_many({"user_id": stored["user_id"], "revoked": False}, {"$set": {"revoked": True, "revoked_at": now_iso(), "reason": "reuse_detected"}})
        raise ApiError(401, "Refresh token reuse detected; all sessions revoked", "REFRESH_TOKEN_REUSED")
    if datetime.fromisoformat(stored["expires_at"]) < datetime.now(UTC):
        raise ApiError(401, "Refresh token expired", "REFRESH_TOKEN_EXPIRED")
    user = await db.users.find_one({"id": stored["user_id"]}, {"_id": 0})
    if not user or not user.get("is_active"):
        raise ApiError(401, "User inactive", "USER_INACTIVE")
    rotated = await db.refresh_tokens.find_one_and_update({"id": stored["id"], "revoked": False}, {"$set": {"revoked": True, "revoked_at": now_iso(), "reason": "rotated"}})
    if rotated is None:
        raise ApiError(401, "Refresh token already used", "REFRESH_TOKEN_REUSED")
    return await _token_response(user, request)


@router.post("/logout")
async def logout(body: LogoutIn, user: dict = Depends(get_current_user)):
    if body.refresh_token:
        await db.refresh_tokens.update_one({"token_hash": _hash_token(body.refresh_token), "user_id": user["id"]}, {"$set": {"revoked": True, "revoked_at": now_iso(), "reason": "logout"}})
    else:
        await db.refresh_tokens.update_many({"user_id": user["id"], "revoked": False}, {"$set": {"revoked": True, "revoked_at": now_iso(), "reason": "logout_all"}})
    return {"ok": True}


@router.get("/me")
async def me(user: dict = Depends(get_current_user)):
    u = strip_private(user)
    u["permissions"] = sorted(user["permissions"])
    u["is_super_admin"] = user.get("is_super_admin", False)
    u["role_names"] = user.get("role_names", [])
    u["mfa_enabled"] = bool(user.get("mfa_enabled"))
    u["mfa_setup_required"] = await _mfa_policy_requires(user) and not user.get("mfa_enabled")
    return u


@router.post("/change-password")
async def change_password(body: ChangePasswordIn, request: Request, user: dict = Depends(get_current_user)):
    full = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 1})
    if not verify_password(body.current_password, full["password_hash"]):
        raise ApiError(400, "Current password is incorrect", "INVALID_CREDENTIALS")
    await check_password_history(user["id"], body.new_password)
    await set_password(user["id"], body.new_password)
    await write_audit(user, "user.change_password", "user", user["id"], ip=client_ip(request))
    return {"ok": True}


@router.get("/sessions")
async def sessions(user: dict = Depends(get_current_user)):
    items = await db.refresh_tokens.find({"user_id": user["id"], "revoked": False, "expires_at": {"$gt": now_iso()}},
                                         {"_id": 0, "token_hash": 0}).sort("created_at", -1).to_list(50)
    return {"items": items, "total": len(items)}


@router.delete("/sessions/{session_id}")
async def revoke_session(session_id: str, user: dict = Depends(get_current_user)):
    r = await db.refresh_tokens.update_one({"id": session_id, "user_id": user["id"], "revoked": False}, {"$set": {"revoked": True, "revoked_at": now_iso(), "reason": "user_revoked"}})
    if not r.matched_count:
        raise ApiError(404, "Session not found", "NOT_FOUND")
    return {"ok": True}


@router.delete("/sessions")
async def revoke_all_sessions(user: dict = Depends(get_current_user)):
    r = await db.refresh_tokens.update_many({"user_id": user["id"], "revoked": False}, {"$set": {"revoked": True, "revoked_at": now_iso(), "reason": "user_revoked_all"}})
    return {"ok": True, "revoked": r.modified_count}


@router.post("/mfa/enroll")
async def mfa_enroll(user: dict = Depends(get_current_user)):
    if user.get("mfa_enabled"):
        raise ApiError(409, "MFA is already enabled", "MFA_ENABLED")
    secret = pyotp.random_base32()
    await db.users.update_one({"id": user["id"]}, {"$set": {"mfa_temp_secret": secret}})
    company = await db.companies.find_one({"id": user["company_id"]}, {"_id": 0, "brand": 1})
    uri = pyotp.TOTP(secret).provisioning_uri(name=user["email"], issuer_name=(company or {}).get("brand") or "KKT")
    return {"secret": secret, "otpauth_url": uri}


@router.post("/mfa/verify")
async def mfa_verify(body: MfaVerifyIn, request: Request, user: dict = Depends(get_current_user)):
    full = await db.users.find_one({"id": user["id"]}, {"_id": 0, "mfa_temp_secret": 1})
    secret = (full or {}).get("mfa_temp_secret")
    if not secret or not pyotp.TOTP(secret).verify(body.code, valid_window=1):
        raise ApiError(400, "Invalid authentication code", "MFA_INVALID")
    await db.users.update_one({"id": user["id"]}, {"$set": {"mfa_enabled": True, "mfa_secret": secret, "mfa_enabled_at": now_iso()}, "$unset": {"mfa_temp_secret": ""}})
    await write_audit(user, "user.mfa_enabled", "user", user["id"], ip=client_ip(request))
    return {"ok": True, "mfa_enabled": True}


@router.post("/mfa/disable")
async def mfa_disable(body: MfaDisableIn, request: Request, user: dict = Depends(get_current_user)):
    full = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 1, "mfa_secret": 1, "mfa_enabled": 1})
    if not verify_password(body.password, full["password_hash"]):
        raise ApiError(400, "Password is incorrect", "INVALID_CREDENTIALS")
    if full.get("mfa_enabled") and not (body.code and pyotp.TOTP(full["mfa_secret"]).verify(body.code, valid_window=1)):
        raise ApiError(400, "Valid authentication code required", "MFA_INVALID")
    await db.users.update_one({"id": user["id"]}, {"$set": {"mfa_enabled": False}, "$unset": {"mfa_secret": "", "mfa_temp_secret": ""}})
    await write_audit(user, "user.mfa_disabled", "user", user["id"], ip=client_ip(request))
    return {"ok": True, "mfa_enabled": False}
