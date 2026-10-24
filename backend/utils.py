import re
import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, field_validator

from db import db

_CTRL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


class ApiError(HTTPException):
    def __init__(self, status_code: int, detail: str, code: str = "ERROR", extra: dict | None = None):
        super().__init__(status_code=status_code, detail=detail)
        self.code = code
        self.extra = extra


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    @field_validator("*", mode="before")
    @classmethod
    def _strip_ctrl(cls, v):
        return _CTRL.sub("", v) if isinstance(v, str) else v


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else ""


def base_doc(user: dict | None, company_id: str) -> dict:
    ts = now_iso()
    return {"id": new_id(), "company_id": company_id, "created_at": ts, "updated_at": ts,
            "created_by": user["id"] if user else "system", "is_active": True, "deleted_at": None, "version": 1}


class ListParams:
    def __init__(
        self,
        page: int = Query(1, ge=1),
        page_size: int = Query(20, ge=1, le=200),
        search: str | None = Query(None, max_length=100),
        sort: str = Query("name"),
        include_inactive: bool = Query(False),
        cursor: str | None = Query(None, description="Cursor mode: last seen id from next_cursor"),
        limit: int | None = Query(None, ge=1, le=100, description="Cursor mode page size"),
        format: str | None = Query(None, description="csv for CSV export"),
    ):
        self.page, self.page_size, self.search, self.sort = page, page_size, search, sort
        self.include_inactive, self.cursor, self.limit, self.format = include_inactive, cursor, limit, format

    def sort_spec(self, allowed: list[str], default: str = "name"):
        field = self.sort.lstrip("-")
        direction = -1 if self.sort.startswith("-") else 1
        if field not in allowed:
            field = default
        return [(field, direction), ("id", 1)]


def search_filter(search: str | None, fields: list[str]) -> dict:
    if not search:
        return {}
    rx = {"$regex": re.escape(search), "$options": "i"}
    return {"$or": [{f: rx} for f in fields]}


async def paginate(coll, query: dict, params: ListParams, sort, projection: dict | None = None) -> dict:
    proj = {"_id": 0}
    if projection:
        proj.update(projection)
    if params.cursor is not None or params.limit is not None:
        limit = params.limit or params.page_size
        q = dict(query)
        if params.cursor:
            q["id"] = {"$gt": params.cursor}
        total = await coll.count_documents(query)
        items = await coll.find(q, proj).sort([("id", 1)]).limit(limit + 1).to_list(limit + 1)
        nxt = items[limit]["id"] if len(items) > limit else None
        items = items[:limit]
        return {"items": items, "total": total, "page": None, "page_size": limit, "next_cursor": nxt}
    if params.format == "csv":
        items = await coll.find(query, proj).sort(sort).limit(10000).to_list(10000)
        return {"items": items, "total": len(items), "page": 1, "page_size": len(items), "next_cursor": None, "_csv": True}
    total = await coll.count_documents(query)
    cursor = coll.find(query, proj).sort(sort).skip((params.page - 1) * params.page_size).limit(params.page_size)
    items = await cursor.to_list(params.page_size)
    has_more = params.page * params.page_size < total
    return {"items": items, "total": total, "page": params.page, "page_size": params.page_size, "next_cursor": items[-1]["id"] if has_more and items else None}


def strip_private(doc: dict | None) -> dict | None:
    if doc is None:
        return None
    return {k: v for k, v in doc.items() if k not in ("_id", "password_hash", "failed_attempts", "locked_until", "mfa_secret", "mfa_temp_secret", "password_history")}


async def write_audit(actor: dict | None, action: str, entity_type: str, entity_id: str,
                      before: Any = None, after: Any = None, ip: str = "", company_id: str | None = None):
    from events import bus
    await bus.publish("entity.changed", {"actor": actor, "action": action, "entity_type": entity_type, "entity_id": entity_id,
                                         "before": strip_private(before) if isinstance(before, dict) else before,
                                         "after": strip_private(after) if isinstance(after, dict) else after,
                                         "ip": ip, "company_id": company_id or (actor or {}).get("company_id")})


async def get_or_404(coll, doc_id: str, entity: str, extra: dict | None = None) -> dict:
    q = {"id": doc_id}
    if extra:
        q.update(extra)
    doc = await coll.find_one(q, {"_id": 0})
    if not doc:
        raise ApiError(404, f"{entity} not found", "NOT_FOUND")
    return doc


def expected_version(request: Request, body_version: int | None) -> int | None:
    if body_version is not None:
        return body_version
    im = request.headers.get("if-match")
    if im and im.strip('"').isdigit():
        return int(im.strip('"'))
    return None


async def apply_update(coll, before: dict, changes: dict, version: int | None, entity: str = "Record") -> dict:
    """Versioned update: 409 VERSION_CONFLICT if the caller's version is stale."""
    changes = {k: v for k, v in changes.items() if k != "version"}
    changes["updated_at"] = now_iso()
    q = {"id": before["id"]}
    if version is not None:
        q["version"] = version
    res = await coll.find_one_and_update(q, {"$set": changes, "$inc": {"version": 1}}, projection={"_id": 0}, return_document=True)
    if res is None:
        current = await coll.find_one({"id": before["id"]}, {"_id": 0})
        raise ApiError(409, f"{entity} was modified by someone else (current version {current.get('version') if current else '?'}). Reload and retry.", "VERSION_CONFLICT", {"current": strip_private(current)})
    return res


async def next_number(scope: str, key: str) -> int:
    doc = await db.counters.find_one_and_update({"scope": scope, "key": key}, {"$inc": {"seq": 1}}, upsert=True, return_document=True)
    return doc["seq"]


def to_csv(items: list[dict], fields: list[str] | None = None) -> str:
    import csv
    import io
    import json
    if not items:
        return ""
    fields = fields or [k for k in items[0].keys() if not k.startswith("_")]
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=fields, extrasaction="ignore")
    w.writeheader()
    for it in items:
        w.writerow({k: (json.dumps(v) if isinstance(v, (dict, list)) else v) for k, v in it.items() if k in fields})
    return buf.getvalue()
