"""Phase X.6 — per-user Home widget layout (`GET/PUT /api/me/home-layout`). Validated schema, versioned, permission-aware:
widgets the user cannot see are neither returned as available nor accepted in a layout. Default = today's Home order."""
from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import Field, field_validator

from db import db
from deps import require
from utils import ApiError, StrictModel, client_ip, now_iso, write_audit

router = APIRouter(prefix="/me", tags=["me"])
SCHEMA_VERSION = 1
Size = Literal["S", "M", "L"]
# id → (label, required permission or None, default size)
WIDGETS = {"today": ("Today", None, "L"), "trends": ("12-month trends", "reports.collections.view", "L"), "projects": ("Projects", "masters.project.view", "L"),
           "collections_chart": ("Collections · last 12 months", "finance.payment.view", "M"), "ageing": ("Due ageing", "demands.register.view", "S"),
           "attention": ("Needs attention", None, "M"), "activity": ("Recent activity", "admin.audit.view", "S"),
           "tower_sales": ("Tower sales progress", "masters.project.view", "M")}
DEFAULT_ORDER = ["today", "trends", "projects", "collections_chart", "ageing", "attention", "activity", "tower_sales"]


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


def _allowed(user: dict) -> list[str]:
    perms = set(user["permissions"])
    return [i for i in DEFAULT_ORDER if WIDGETS[i][1] is None or WIDGETS[i][1] in perms]


def _default(user: dict) -> list[dict]:
    return [{"id": i, "size": WIDGETS[i][2], "visible": True} for i in _allowed(user)]


def _present(doc: dict | None, user: dict) -> dict:
    allowed = set(_allowed(user))
    widgets = [w for w in (doc or {}).get("widgets", []) if w["id"] in allowed] if doc else _default(user)
    seen = {w["id"] for w in widgets}
    widgets += [w for w in _default(user) if w["id"] not in seen]  # newly-permitted widgets appear at the end
    return {"schema_version": SCHEMA_VERSION, "version": (doc or {}).get("version", 0), "is_default": doc is None, "updated_at": (doc or {}).get("updated_at"),
            "widgets": widgets, "available": [{"id": i, "label": WIDGETS[i][0], "default_size": WIDGETS[i][2]} for i in _allowed(user)]}


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
    await db.user_home_layouts.update_one(key, {"$set": {**key, "schema_version": SCHEMA_VERSION, "widgets": [w.model_dump() for w in body.widgets], "updated_at": now_iso()}, "$inc": {"version": 1}}, upsert=True)
    after = await db.user_home_layouts.find_one(key, {"_id": 0})
    await write_audit(user, "home_layout.update", "user", user["id"], before=before, after={"widgets": after["widgets"], "version": after["version"]}, ip=client_ip(request))
    return _present(after, user)


@router.delete("/home-layout")
async def reset_layout(request: Request, user: dict = Depends(require("masters.project.view"))):
    key = {"user_id": user["id"], "company_id": user["company_id"]}
    before = await db.user_home_layouts.find_one(key, {"_id": 0, "widgets": 1})
    await db.user_home_layouts.delete_one(key)  # user's own preference row only (not business data)
    await write_audit(user, "home_layout.reset", "user", user["id"], before=before, after=None, ip=client_ip(request))
    return _present(None, user)
