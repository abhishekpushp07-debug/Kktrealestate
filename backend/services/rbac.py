"""Phase R1 — effective permissions = ∪ roles' permissions ∪ direct allows − direct denies. Super Admin → all (denies ignored).
Cached per user, invalidated by the roles_version bump (any role / grant / user-role change)."""
import logging
import time

from db import db
from permissions import ALL_PERMISSIONS, canonical, expand, registry_rows

logger = logging.getLogger("rbac")
_cache: dict[str, tuple[float, int, dict]] = {}
TTL = 60
SUPER = "Super Admin"


def user_role_ids(user: dict) -> list[str]:
    ids = list(user.get("role_ids") or [])
    if user.get("role_id") and user["role_id"] not in ids:
        ids.insert(0, user["role_id"])
    return ids


async def bump_version():
    await db.settings.update_one({"key": "roles_version"}, {"$inc": {"value": 1}}, upsert=True)


async def resolve(user: dict, roles_version: int, now_iso: str) -> dict:
    """Returns {permissions:set, role_names:[], is_super:bool, sources:{code:[...]}}."""
    hit = _cache.get(user["id"])
    if hit and hit[0] > time.time() and hit[1] == roles_version:
        return hit[2]
    ids = user_role_ids(user)
    roles = await db.roles.find({"id": {"$in": ids}, "is_active": True}, {"_id": 0, "id": 1, "name": 1, "permissions": 1}).to_list(None) if ids else []
    roles.sort(key=lambda r: ids.index(r["id"]))
    is_super = any(r["name"] == SUPER for r in roles)
    sources: dict[str, list] = {}
    perms: set[str] = set()
    for r in roles:
        for c in expand(r["permissions"]):
            perms.add(c)
            sources.setdefault(c, []).append({"type": "role", "role": r["name"]})
    direct = await db.user_direct_permissions.find({"user_id": user["id"], "$or": [{"expires_at": None}, {"expires_at": {"$gt": now_iso}}]}, {"_id": 0}).to_list(None)
    for g in direct:
        c = canonical(g["code"])
        if g["effect"] == "allow":
            perms.add(c)
            sources.setdefault(c, []).append({"type": "allow", "reason": g.get("reason")})
        elif not is_super:
            perms.discard(c)
            sources.setdefault(c, []).append({"type": "deny", "reason": g.get("reason")})
    if is_super:
        perms = set(ALL_PERMISSIONS)
    out = {"permissions": perms, "role_names": [r["name"] for r in roles], "role_ids": [r["id"] for r in roles], "is_super": is_super, "sources": sources}
    _cache[user["id"]] = (time.time() + TTL, roles_version, out)
    return out


def invalidate(user_id: str | None = None):
    if user_id:
        _cache.pop(user_id, None)
    else:
        _cache.clear()


# ---------- registry auto-registration ----------
async def register_routes(app) -> list[str]:
    """Walk the router; every require(code) guard upserts its code into `permissions` with route_refs. Unknown codes → warning."""
    refs: dict[str, set] = {}
    for r in app.routes:
        dep = getattr(r, "dependant", None)
        if not dep:
            continue
        stack = list(dep.dependencies)
        while stack:
            d = stack.pop()
            for code in getattr(d.call, "perm_codes", None) or ([d.call.perm_code] if getattr(d.call, "perm_code", None) else []):
                refs.setdefault(canonical(code), set()).add(f"{'/'.join(sorted(r.methods))} {r.path}")
                if code.startswith("reports.") and code.endswith(".view"):  # format=csv|pdf on the same route is gated by the sibling export code (reports.respond)
                    refs.setdefault(code.rsplit(".", 1)[0] + ".export", set()).add(f"{'/'.join(sorted(r.methods))} {r.path}?format=csv|pdf")
            stack.extend(d.dependencies)
    known = {row["code"]: row for row in registry_rows()}
    unknown = sorted(c for c in refs if c not in known)
    for c in unknown:
        logger.warning("[rbac] guarded route uses unregistered permission code %s (%s)", c, sorted(refs[c]))
    for code, row in known.items():
        await db.permissions.update_one({"code": code}, {"$set": {**row, "route_refs": sorted(refs.get(code, set()))}}, upsert=True)
    for c in unknown:
        await db.permissions.update_one({"code": c}, {"$set": {"code": c, "hcode": c, "module": c.split(".")[0], "module_label": c.split(".")[0].title(), "feature": c.split(".")[0], "feature_label": c.split(".")[0].title(), "action": "custom", "label": c, "ui_only": False, "unregistered": True, "route_refs": sorted(refs[c])}}, upsert=True)
    await db.permissions.delete_many({"code": {"$nin": list(known) + unknown}})  # drop retired coarse codes from the registry
    await db.user_direct_permissions.create_index([("user_id", 1), ("code", 1)], unique=True)
    await db.users.create_index("role_ids")
    return unknown


async def migrate_legacy_codes() -> int:
    """Idempotent: roles / direct grants still holding coarse codes get the equivalent specific set (behavioural equivalence)."""
    from permissions import LEGACY_EXPANSION, PERMISSION_SET
    n = 0
    async for r in db.roles.find({}, {"_id": 0, "id": 1, "permissions": 1, "name": 1, "is_system": 1}).batch_size(500):
        perms = r.get("permissions") or []
        if r.get("name") == SUPER and r.get("is_system"):
            new = sorted(PERMISSION_SET)
        elif any(c in LEGACY_EXPANSION for c in perms):
            new = expand(perms)
        else:
            continue
        if new != perms:
            await db.roles.update_one({"id": r["id"]}, {"$set": {"permissions": new}})
            n += 1
    async for g in db.user_direct_permissions.find({"code": {"$in": list(LEGACY_EXPANSION)}}, {"_id": 0}).batch_size(500):
        await db.user_direct_permissions.delete_one({"user_id": g["user_id"], "code": g["code"]})
        for c in expand([g["code"]]):
            await db.user_direct_permissions.update_one({"user_id": g["user_id"], "code": c}, {"$setOnInsert": {**g, "code": c}}, upsert=True)
        n += 1
    if n:
        await bump_version()
        invalidate()
    return n
