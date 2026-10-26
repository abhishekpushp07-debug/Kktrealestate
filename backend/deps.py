import os
from contextvars import ContextVar
import time
from datetime import UTC, datetime, timedelta

import jwt
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from db import db
from utils import ApiError

bearer = HTTPBearer(auto_error=False)

JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALG = os.environ.get("JWT_ALGORITHM", "HS256")
ACCESS_MINUTES = int(os.environ.get("ACCESS_TOKEN_MINUTES", "15"))
PERM_TTL = 30
_perm_cache: dict[str, tuple[float, int, dict]] = {}
_roles_version = {"value": -1, "checked": 0.0}


def create_access_token(user: dict, token_type: str = "access", minutes: int | None = None) -> str:
    now = datetime.now(UTC)
    payload = {"sub": user["id"], "cid": user["company_id"], "type": token_type, "aud": "erp", "iat": int(now.timestamp()),
               "exp": int((now + timedelta(minutes=minutes or ACCESS_MINUTES)).timestamp())}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


async def _current_roles_version() -> int:
    now = time.time()
    if now - _roles_version["checked"] > 2:
        doc = await db.settings.find_one({"key": "roles_version"}, {"_id": 0, "value": 1})
        _roles_version["value"] = doc["value"] if doc else 0
        _roles_version["checked"] = now
    return _roles_version["value"]


async def _resolve_role(role_id: str) -> dict:
    rv = await _current_roles_version()
    hit = _perm_cache.get(role_id)
    if hit and hit[0] > time.time() and hit[1] == rv:
        return hit[2]
    role = await db.roles.find_one({"id": role_id}, {"_id": 0, "permissions": 1, "name": 1}) or {"permissions": [], "name": None}
    _perm_cache[role_id] = (time.time() + PERM_TTL, rv, role)
    return role


async def get_current_user(request: Request, creds: HTTPAuthorizationCredentials | None = Depends(bearer)) -> dict:
    if creds is None or creds.scheme.lower() != "bearer":
        raise ApiError(401, "Not authenticated", "UNAUTHENTICATED")
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALG], leeway=30, options={"verify_aud": False})
        if payload.get("aud") not in (None, "erp"):
            raise ApiError(401, "Token not valid for ERP", "INVALID_AUDIENCE")
    except jwt.ExpiredSignatureError:
        raise ApiError(401, "Access token expired", "TOKEN_EXPIRED")
    except jwt.PyJWTError:
        raise ApiError(401, "Invalid token", "INVALID_TOKEN")
    if payload.get("type") != "access":
        raise ApiError(401, "Invalid token type", "INVALID_TOKEN")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0, "mfa_secret": 0, "password_history": 0})
    if not user or not user.get("is_active", False):
        raise ApiError(401, "User inactive or not found", "USER_INACTIVE")
    from services import rbac
    from utils import now_iso
    eff = await rbac.resolve(user, await _current_roles_version(), now_iso())
    user["permissions"] = set(eff["permissions"])
    user["role_name"] = eff["role_names"][0] if eff["role_names"] else None
    user["role_names"] = eff["role_names"]
    user["role_ids"] = eff["role_ids"]
    user["is_super_admin"] = eff["is_super"]
    request.state.user_id = user["id"]
    if request.method in ("POST", "PATCH", "PUT", "DELETE"):
        await enforce_rate_limit(f"write:{user['id']}", 120, 60)
    return user


def require(permission: str):
    return require_any(permission)


def require_any(*permissions: str):
    """Route guard: the user needs ANY of the listed specific codes. Codes are recorded on the dependency for registry auto-registration."""
    from permissions import canonical
    codes = [canonical(p) for p in permissions]

    async def dep(request: Request, user: dict = Depends(get_current_user)) -> dict:
        if not any(c in user["permissions"] for c in codes):
            raise ApiError(403, f"Missing permission: {' or '.join(codes)}", "PERMISSION_DENIED", {"missing": codes[0], "any_of": codes})
        request.state.perm_code = codes[0]
        request.state.perms = user["permissions"]
        return user
    dep.perm_code = codes[0]
    dep.perm_codes = codes
    return dep


_BYPASS_HDR: ContextVar[str | None] = ContextVar("rl_bypass", default=None)


def _bypass_active() -> bool:
    """Test-only: when LOGIN_RATE_LIMIT_BYPASS_TOKEN is set in the *process* env (never in .env) and the request carries it, skip limits."""
    tok = os.environ.get("LOGIN_RATE_LIMIT_BYPASS_TOKEN")
    return bool(tok) and _BYPASS_HDR.get() == tok


async def enforce_rate_limit(bucket: str, limit: int, window_s: int):
    """Multi-worker safe sliding window in Mongo (TTL-indexed)."""
    if bucket.split(":")[0] in ("login", "portal-login", "write", "portal-write", "public") and _bypass_active():
        return
    now = datetime.now(UTC)
    slot = int(now.timestamp() // window_s)
    doc = await db.rate_limits.find_one_and_update(
        {"bucket": bucket, "slot": slot}, {"$inc": {"count": 1}, "$setOnInsert": {"expires_at": now + timedelta(seconds=window_s * 2)}},
        upsert=True, return_document=True)
    if doc["count"] > limit:
        retry = window_s - int(now.timestamp() % window_s)
        raise ApiError(429, f"Rate limit exceeded ({limit}/{window_s}s). Retry in {retry}s.", "RATE_LIMITED", {"retry_after": retry})


def has_full_scope(user: dict) -> bool:
    return "*" in (user.get("project_scope") or [])


def project_scope_filter(user: dict, field: str = "project_id") -> dict:
    if has_full_scope(user):
        return {}
    return {field: {"$in": user.get("project_scope") or []}}


def ensure_project_access(user: dict, project_id: str):
    if not has_full_scope(user) and project_id not in (user.get("project_scope") or []):
        raise ApiError(404, "Project not found", "NOT_FOUND")


async def require_idempotency_key(request: Request):
    """Payments must carry Idempotency-Key; checked before body validation so clients get a clear 428."""
    if not request.headers.get("idempotency-key"):
        raise ApiError(428, "Idempotency-Key header is required when posting payments", "IDEMPOTENCY_KEY_REQUIRED")
