"""Owner Super Admin bootstrap (env-driven, idempotent) + demo-account login gating."""
import fnmatch
import logging
import os

from fastapi import Request

from db import db
from utils import base_doc, now_iso

logger = logging.getLogger("kkt.owner")

DEMO_EMAILS = ["admin@kkt.in", "projectadmin@kkt.in", "accounts@kkt.in", "sales@kkt.in", "employee@kkt.in", "marketing@kkt.in"]
_DEFAULT_DEMO_HOSTS = ["localhost", "127.0.0.1", "*.preview.emergentagent.com"]


def request_host(request: Request) -> str:
    h = request.headers.get("x-forwarded-host") or request.headers.get("host") or ""
    return h.split(",")[0].strip().split(":")[0].lower()


def demo_login_allowed(request: Request) -> bool:
    host = request_host(request)
    extra = [x.strip().lower() for x in os.environ.get("DEMO_LOGIN_HOSTS", "").split(",") if x.strip()]
    return any(fnmatch.fnmatch(host, pat) for pat in _DEFAULT_DEMO_HOSTS + extra)


async def mark_demo_accounts() -> int:
    r = await db.users.update_many({"email": {"$in": DEMO_EMAILS}, "is_demo": {"$ne": True}}, {"$set": {"is_demo": True}})
    await db.portal_accounts.update_many({"created_by": {"$in": [None, "system"]}, "is_demo": {"$exists": False}}, {"$set": {"is_demo": True}})
    return r.modified_count


async def ensure_owner() -> str:
    """Create the owner Super Admin from OWNER_BOOTSTRAP_* once. Never touches an existing user (password/role preserved)."""
    email = (os.environ.get("OWNER_BOOTSTRAP_EMAIL") or "").strip().lower()
    password = os.environ.get("OWNER_BOOTSTRAP_PASSWORD") or ""
    if not email or not password:
        return "unset"
    if await db.users.find_one({"email": email}, {"_id": 0, "id": 1}):
        return "exists"
    company = await db.companies.find_one({}, {"_id": 0, "id": 1})
    role = await db.roles.find_one({"name": "Super Admin", "is_system": True}, {"_id": 0, "id": 1})
    if not company or not role:
        return "deferred"  # fresh DB: seed_if_empty has not run yet; retried after seeding
    from routers.auth import hash_password, validate_password_policy
    try:
        validate_password_policy(password)
    except ValueError as e:
        logger.warning("[owner-bootstrap] %s: password does not meet the global policy (%s); bootstrap account bypasses policy by owner request", email, e)
    doc = {**base_doc(None, company["id"]), "name": os.environ.get("OWNER_BOOTSTRAP_NAME") or email.split("@")[0].title(), "email": email, "phone": None,
           "role_id": role["id"], "project_scope": ["*"], "password_hash": hash_password(password), "failed_attempts": 0, "locked_until": None,
           "is_active": True, "is_demo": False, "must_change_password": False, "mfa_enabled": False, "password_history": [], "created_by": "owner_bootstrap",
           "created_at": now_iso()}
    try:
        await db.users.insert_one(doc)
    except Exception as e:  # noqa: BLE001 — duplicate on a concurrent replica is fine
        logger.info("[owner-bootstrap] insert skipped: %s", e)
        return "exists"
    logger.info("[owner-bootstrap] created Super Admin %s", email)
    return "created"
