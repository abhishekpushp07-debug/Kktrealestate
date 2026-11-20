"""Owner Super Admin bootstrap (env-driven, idempotent) + demo-account login gating."""

import fnmatch
import logging
import os
from datetime import UTC, datetime

from fastapi import Request

from core.passwords import hash_password, validate_password_policy
from db import db
from utils import base_doc, now_iso

logger = logging.getLogger("kkt.owner")

DEMO_EMAILS = [
    "admin@kkt.in",
    "projectadmin@kkt.in",
    "accounts@kkt.in",
    "sales@kkt.in",
    "employee@kkt.in",
    "marketing@kkt.in",
    "siteengineer@kkt.in",
]
_DEFAULT_DEMO_HOSTS = ["localhost", "127.0.0.1", "*.preview.emergentagent.com"]


def request_host(request: Request) -> str:
    h = request.headers.get("x-forwarded-host") or request.headers.get("host") or ""
    return h.split(",")[0].strip().split(":")[0].lower()


def demo_host_allowed(host: str) -> bool:
    extra = [x.strip().lower() for x in os.environ.get("DEMO_LOGIN_HOSTS", "").split(",") if x.strip()]
    return any(fnmatch.fnmatch(host, pat) for pat in _DEFAULT_DEMO_HOSTS + extra)


def demo_login_allowed(request: Request) -> bool:
    return demo_host_allowed(request_host(request))


_SEEN_HOSTS: set[str] = set()


async def note_served_host(request: Request) -> None:
    """Remember every public host (ingress `x-forwarded-host`) this database has served — the demo-refresh host guard."""
    host = (request.headers.get("x-forwarded-host") or "").split(",")[0].strip().split(":")[0].lower()
    if host and host not in _SEEN_HOSTS:
        _SEEN_HOSTS.add(host)
        await db.served_hosts.update_one(
            {"host": host}, {"$setOnInsert": {"host": host, "first_seen": datetime.now(UTC).isoformat()}}, upsert=True
        )


async def ensure_site_engineer_demo() -> str:
    """Phase 2D: the Site Engineer system role, plus its demo login only where the demo accounts exist (never in prod)."""
    from permissions import SYSTEM_ROLES

    demo = await db.users.find_one(
        {"email": "admin@kkt.in", "is_demo": True}, {"_id": 0, "company_id": 1, "password_hash": 1}
    )
    company = await db.companies.find_one({}, {"_id": 0, "id": 1})
    if not company:
        return "deferred"
    spec = SYSTEM_ROLES["Site Engineer"]
    role = await db.roles.find_one({"name": "Site Engineer"}, {"_id": 0, "id": 1})
    if not role:
        role = {**base_doc(None, company["id"]), "name": "Site Engineer", "description": spec["description"]}
        role |= {"permissions": spec["permissions"], "is_system": True}
        await db.roles.insert_one(dict(role))
    await db.roles.update_one(  # Phase 2D grant (idempotent): Accounts opens the Bills raised register from Home
        {"name": "Accounts", "is_system": True}, {"$addToSet": {"permissions": "demands.register.view"}}
    )
    if not demo or await db.users.find_one({"email": "siteengineer@kkt.in"}, {"_id": 1}):
        return "ok"
    doc = {**base_doc(None, demo["company_id"]), "name": "Ravi Teja", "email": "siteengineer@kkt.in", "phone": None}
    doc |= {"role_id": role["id"], "project_scope": ["*"], "password_hash": demo["password_hash"], "is_demo": True}
    doc |= {"failed_attempts": 0, "locked_until": None, "is_active": True}
    await db.users.insert_one(doc)
    return "created"


async def mark_demo_accounts() -> int:
    r = await db.users.update_many(
        {"email": {"$in": DEMO_EMAILS}, "is_demo": {"$ne": True}}, {"$set": {"is_demo": True}}
    )
    await db.portal_accounts.update_many(
        {"created_by": {"$in": [None, "system"]}, "is_demo": {"$exists": False}}, {"$set": {"is_demo": True}}
    )
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
    try:
        validate_password_policy(password)
    except ValueError as e:
        logger.warning(
            "[owner-bootstrap] %s: password does not meet the global policy (%s); bootstrap account bypasses policy by owner request",
            email,
            e,
        )
    doc = {
        **base_doc(None, company["id"]),
        "name": os.environ.get("OWNER_BOOTSTRAP_NAME") or email.split("@")[0].title(),
        "email": email,
        "phone": None,
        "role_id": role["id"],
        "project_scope": ["*"],
        "password_hash": hash_password(password),
        "failed_attempts": 0,
        "locked_until": None,
        "is_active": True,
        "is_demo": False,
        "must_change_password": False,
        "mfa_enabled": False,
        "password_history": [],
        "created_by": "owner_bootstrap",
        "created_at": now_iso(),
    }
    try:
        await db.users.insert_one(doc)
    except Exception as e:  # noqa: BLE001 — duplicate on a concurrent replica is fine
        logger.info("[owner-bootstrap] insert skipped: %s", e)
        return "exists"
    logger.info("[owner-bootstrap] created Super Admin %s", email)
    return "created"
