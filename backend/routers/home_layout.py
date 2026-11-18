"""Phase X.6 — per-user Home widget layout (`GET/PUT /api/me/home-layout`). Validated schema, versioned, permission-aware:
widgets the user cannot see are neither returned as available nor accepted in a layout. Default = today's Home order."""

from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import Field, field_validator

from db import db
from deps import require
from services import ttlcache
from utils import ApiError, StrictModel, client_ip, now_iso, write_audit

router = APIRouter(prefix="/me", tags=["me"])
SCHEMA_VERSION = 1
Size = Literal["S", "M", "L"]
# Phase 2D: id → (label, permissions ALL required, default size). Server-side: a widget whose data the role can't see is
# never offered, never accepted in a layout and never computed by /api/home/bundle.
WIDGETS = {
    "money_today": ("Money today", ["reports.collections.view", "finance.payment.view"], "M"),
    "due_vs_received": ("Due vs received", ["demands.register.view", "reports.collections.view"], "M"),
    "ageing": ("Overdue by age", ["reports.outstanding.view"], "M"),
    "call_today": ("Call today", ["sales.customer.view"], "M"),
    "inflow_30": ("Next 30 days inflow", ["demands.register.view", "finance.payment.view"], "M"),
    "next_milestone": ("Next billing milestone", ["construction.update.view"], "M"),
    "inventory": ("Inventory by tower", ["masters.project.view"], "L"),
    "flat_status": ("Flat status", ["masters.project.view"], "L"),
    "construction": ("Construction progress", ["masters.project.view"], "M"),
    "pipeline": ("Sales pipeline", ["sales.lead.view"], "M"),
    "attention": ("Needs attention", ["masters.project.view"], "M"),
}
DEFAULT_ORDER = list(WIDGETS)
# owner decisions: role → default widgets; Sales may ONLY have these four
ROLE_DEFAULTS = {
    "Accounts": ["money_today", "due_vs_received", "ageing", "call_today", "inflow_30", "attention"],
    "Sales": ["call_today", "pipeline", "inventory", "flat_status"],
    "Site Engineer": ["next_milestone", "construction", "flat_status"],
}
ROLE_ONLY = {"Sales"}
# Phase X.6 ids → their 2D successor (existing Customize preferences keep their order / visibility)
LEGACY = {
    "today": "money_today",
    "collections_chart": "due_vs_received",
    "ageing": "ageing",
    "attention": "attention",
    "tower_sales": "inventory",
    "projects": "construction",
}
SCHEMA_VERSION = 2


class Widget(StrictModel):
    id: str
    size: Size = "M"
    visible: bool = True


class LayoutIn(StrictModel):
    widgets: list[Widget] = Field(min_length=1, max_length=20)
    version: int | None = None

    @field_validator("widgets")
    @classmethod
    def _ids(cls, v):
        ids = [w.id for w in v]
        bad = [i for i in ids if i not in WIDGETS]
        if bad:
            raise ValueError(f"Unknown widget id(s): {', '.join(bad)}")
        if len(set(ids)) != len(ids):
            raise ValueError("Duplicate widget ids")
        return v


def allowed_widgets(user: dict) -> list[str]:
    perms = set(user["permissions"])
    ok = [i for i in DEFAULT_ORDER if all(p in perms for p in WIDGETS[i][1])]
    role = user.get("role_name")
    return [i for i in ok if i in ROLE_DEFAULTS[role]] if role in ROLE_ONLY else ok


def _default(user: dict) -> list[dict]:
    allowed = allowed_widgets(user)
    ids = [i for i in ROLE_DEFAULTS.get(user.get("role_name"), allowed) if i in allowed]
    return [{"id": i, "size": WIDGETS[i][2], "visible": i in ids} for i in ids + [i for i in allowed if i not in ids]]


def _migrate(widgets: list[dict]) -> list[dict]:
    out, seen = [], set()
    for w in widgets:
        i = w["id"] if w["id"] in WIDGETS and w["id"] not in LEGACY else LEGACY.get(w["id"])
        if i and i not in seen:
            seen.add(i)
            out.append({**w, "id": i, "size": w.get("size") or WIDGETS[i][2]})
    return out


def present_layout(doc: dict | None, user: dict) -> dict:
    allowed = set(allowed_widgets(user))
    saved = _migrate(doc.get("widgets", [])) if doc else []
    widgets = [w for w in saved if w["id"] in allowed] if doc else _default(user)
    seen = {w["id"] for w in widgets}
    widgets += [{**w, "visible": False} if doc else w for w in _default(user) if w["id"] not in seen]
    return {
        "schema_version": SCHEMA_VERSION,
        "version": (doc or {}).get("version", 0),
        "is_default": doc is None,
        "updated_at": (doc or {}).get("updated_at"),
        "widgets": widgets,
        "available": [{"id": i, "label": WIDGETS[i][0], "default_size": WIDGETS[i][2]} for i in allowed_widgets(user)],
    }


_present = present_layout
_allowed = allowed_widgets


@router.get("/home-layout")
async def get_layout(user: dict = Depends(require("masters.project.view"))):
    doc = await db.user_home_layouts.find_one({"user_id": user["id"], "company_id": user["company_id"]}, {"_id": 0})
    return _present(doc, user)


@router.put("/home-layout")
async def put_layout(body: LayoutIn, request: Request, user: dict = Depends(require("masters.project.view"))):
    allowed = set(_allowed(user))
    denied = [w.id for w in body.widgets if w.id not in allowed]
    if denied:
        raise ApiError(403, f"Widget(s) not permitted: {', '.join(denied)}", "PERMISSION_DENIED")
    key = {"user_id": user["id"], "company_id": user["company_id"]}
    cur = await db.user_home_layouts.find_one(key, {"_id": 0, "version": 1})
    if body.version is not None and cur and cur.get("version") != body.version:
        raise ApiError(409, "Layout changed elsewhere — reload and try again", "VERSION_CONFLICT")
    before = await db.user_home_layouts.find_one(key, {"_id": 0, "widgets": 1})
    await db.user_home_layouts.update_one(
        key,
        {
            "$set": {
                **key,
                "schema_version": SCHEMA_VERSION,
                "widgets": [w.model_dump() for w in body.widgets],
                "updated_at": now_iso(),
            },
            "$inc": {"version": 1},
        },
        upsert=True,
    )
    after = await db.user_home_layouts.find_one(key, {"_id": 0})
    ttlcache.invalidate(f"home:bundle:{user['id']}:")
    await write_audit(
        user,
        "home_layout.update",
        "user",
        user["id"],
        before=before,
        after={"widgets": after["widgets"], "version": after["version"]},
        ip=client_ip(request),
    )
    return _present(after, user)


@router.delete("/home-layout")
async def reset_layout(request: Request, user: dict = Depends(require("masters.project.view"))):
    key = {"user_id": user["id"], "company_id": user["company_id"]}
    before = await db.user_home_layouts.find_one(key, {"_id": 0, "widgets": 1})
    await db.user_home_layouts.delete_one(key)  # user's own preference row only (not business data)
    ttlcache.invalidate(f"home:bundle:{user['id']}:")
    await write_audit(user, "home_layout.reset", "user", user["id"], before=before, after=None, ip=client_ip(request))
    return _present(None, user)
