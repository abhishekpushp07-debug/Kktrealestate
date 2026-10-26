"""Phase K.9: access-control anti-escalation rules (shared by users.py and access.py).
R1 nobody changes their own roles / direct grants / scope, or resets their own password via admin routes
R2 nobody grants a permission they do not hold (Super Admin exempt)
R3 project-scoped admins cannot touch accounts with wider scope
R4 only Super Admin manages Super Admin (assign/remove the role, or edit a Super Admin account)."""
from db import db
from services import rbac
from utils import ApiError


def _is_super(user: dict) -> bool:
    return rbac.SUPER in (user.get("role_names") or []) or user.get("role_name") == rbac.SUPER or "*" in (user.get("permissions") or [])


async def _super_role_id() -> str | None:
    sa = await db.roles.find_one({"name": rbac.SUPER, "is_system": True}, {"_id": 0, "id": 1})
    return sa["id"] if sa else None


def _scope(u: dict) -> set | None:
    s = u.get("project_scope")
    return None if not s or "*" in s else set(s)


def no_self_change(actor: dict, target_id: str, what: str):
    if actor["id"] == target_id:
        raise ApiError(409, f"You cannot change your own {what}; ask another administrator", "SELF_ACCESS_CHANGE", {"rule": "R1", "field": what})


async def guard_target(actor: dict, target: dict, new_role_ids: list[str] | None = None, new_scope: list[str] | None = None):
    """R3 + R4 for any admin edit of another account."""
    if _is_super(actor):
        return
    sa = await _super_role_id()
    if sa and (sa in rbac.user_role_ids(target) or (new_role_ids and sa in new_role_ids)):
        raise ApiError(403, "Only a Super Admin can manage Super Admin accounts", "SUPER_ADMIN_ONLY", {"rule": "R4"})
    mine = _scope(actor)
    if mine is not None:
        theirs = _scope(target)
        if theirs is None or not theirs <= mine:
            raise ApiError(403, "You cannot manage an account whose project scope is wider than yours", "SCOPE_ESCALATION", {"rule": "R3"})
        if new_scope is not None and ("*" in new_scope or not set(new_scope) <= mine):
            raise ApiError(403, "You cannot grant a project scope wider than your own", "SCOPE_ESCALATION", {"rule": "R3"})


async def guard_grants(actor: dict, codes: list[str], role_ids: list[str] | None = None):
    """R2: every permission being granted (direct allow or via a role) must already be held by the actor."""
    if _is_super(actor):
        return
    held = set(actor.get("permissions") or [])
    want = set(codes)
    if role_ids:
        for r in await db.roles.find({"id": {"$in": role_ids}}, {"_id": 0, "permissions": 1}).to_list(None):
            want |= set(r.get("permissions") or [])
    missing = sorted(want - held)
    if missing:
        raise ApiError(403, f"You cannot grant permissions you do not hold: {', '.join(missing[:5])}", "GRANT_ESCALATION", {"rule": "R2", "missing": missing[:20]})
