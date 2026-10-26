from services import clock
import hashlib
import asyncio
import base64
import json
import os
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
    return clock.now().isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


def with_price(doc):
    """flats.price_paise is the only stored price; expose derived rupee `price` for display/back-compat."""
    if isinstance(doc, dict) and "price_paise" in doc and doc.get("price_paise") is not None:
        doc["price"] = doc["price_paise"] / 100
    return doc


def request_origin(request: Request) -> str:
    host = request.headers.get("x-forwarded-host", request.headers.get("host", request.url.netloc)).split(",")[0].strip()
    fwd_proto = request.headers.get("x-forwarded-proto")
    local = host.split(":")[0] in ("localhost", "127.0.0.1")
    proto = fwd_proto.split(",")[0].strip() if fwd_proto else (request.url.scheme if local else "https")
    return f"{proto}://{host}"


def public_url(request: Request, configured: str | None, path: str) -> str | None:
    """Configured URL wins on the configured preview hosts (and localhost); on any other real domain use the request's own origin."""
    from urllib.parse import urlparse
    origin = request_origin(request)
    req_host = urlparse(origin).hostname or ""
    known = {urlparse(os.environ.get(k) or "").hostname for k in ("PORTAL_PUBLIC_URL", "ERP_PUBLIC_URL")} - {None}
    if configured:
        cfg_host = urlparse(configured).hostname or ""
        if not req_host or req_host in ("localhost", "127.0.0.1") or cfg_host == req_host or req_host in known:
            return configured
    return f"{origin}{path}"


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
        limit: int | None = Query(None, ge=1, le=100, description="Cursor mode page size (max 100). Walk with next_cursor; the cursor is an opaque keyset token on (sort, id) and must be reused with the same sort."),
        format: str | None = Query(None, description="csv for CSV export"),
        with_total: bool | None = Query(None, description="Compute total (expensive). Default: yes in page mode (legacy UI), no in cursor mode"),
        fields: str | None = Query(None, max_length=400, description="Comma-separated projection to widen/narrow list items"),
        include: str | None = Query(None, max_length=200, description="Comma-separated related docs to embed (see PRD 'API packeting')"),
        exact: bool = Query(False, description="Phase J3: force an exact count above 10,000 rows (default: estimated)"),
    ):
        self.page, self.page_size, self.search, self.sort = page, page_size, search, sort
        self.include_inactive, self.cursor, self.limit, self.format = include_inactive, cursor, limit, format
        self.with_total, self.fields, self.include, self.exact = with_total, fields, include, exact

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


def _enc_cursor(item: dict, key: str) -> str:
    return base64.urlsafe_b64encode(json.dumps([key, item.get(key), item["id"]], default=str).encode()).decode()


def _dec_cursor(cur: str):
    """Returns (key, sort_value, id) for a keyset cursor, or (None, None, id) for a legacy raw-id cursor."""
    try:
        k, v, i = json.loads(base64.urlsafe_b64decode(cur.encode()).decode())
        return k, v, i
    except Exception:
        return None, None, cur


ESTIMATE_ABOVE = 10_000


async def smart_count(coll, query: dict, exact: bool = False, budget_ms: int | None = None) -> tuple[int, bool]:
    """Phase J3: exact counts up to ESTIMATE_ABOVE; beyond that an estimate (bounded count + sampled extrapolation) unless exact=True. Returns (total, estimated)."""
    kw = {"maxTimeMS": budget_ms} if budget_ms else {}
    if exact:
        return await coll.count_documents(query, **kw), False
    n = await coll.count_documents(query, limit=ESTIMATE_ABOVE + 1, **kw)
    if n <= ESTIMATE_ABOVE:
        return n, False
    if not query:
        return await coll.estimated_document_count(), True
    sample = await coll.aggregate([{"$sample": {"size": 2000}}, {"$match": query}, {"$count": "n"}], **kw).to_list(1)
    est_total = await coll.estimated_document_count()
    frac = (sample[0]["n"] / 2000) if sample else 0
    return max(ESTIMATE_ABOVE + 1, int(est_total * frac)), True


async def paginate(coll, query: dict, params: ListParams, sort, projection: dict | None = None, budget_ms: int | None = None) -> dict:
    """budget_ms: Phase K.8/J3 query budget (maxTimeMS) for the page + count; ExecutionTimeout → 503 QUERY_TIMEOUT via the global handler."""
    proj = {"_id": 0}
    if projection:
        proj.update(projection)
    if params.fields:
        proj = {"_id": 0, "id": 1, **{f.strip(): 1 for f in params.fields.split(",") if f.strip()}}
    if params.cursor is not None or params.limit is not None:
        # Keyset pagination on (sort_key, id) — stable under equal sort values; the cursor encodes the LAST item returned.
        limit = params.limit or params.page_size
        key, direction = (sort[0] if sort else ("id", 1))
        id_dir = next((d for f, d in (sort or []) if f == "id"), direction)
        q = query
        if params.cursor:
            ck, v, last_id = _dec_cursor(params.cursor)
            if ck is None or ck != key:
                key, direction, id_dir = "id", 1, 1  # legacy raw-id cursor (or sort changed mid-walk): fall back to id keyset
            op, op_id = ("$gt" if direction == 1 else "$lt"), ("$gt" if id_dir == 1 else "$lt")
            after = {"id": {op_id: last_id}} if key == "id" else {"$or": [{key: {op: v}}, {key: v, "id": {op_id: last_id}}]}
            q = {"$and": [query, after]}
        ks_sort = [("id", id_dir)] if key == "id" else [(key, direction), ("id", id_dir)]
        if proj.get("id") and key not in proj:
            proj = {**proj, key: 1}
        total, est = (await smart_count(coll, query, params.exact, budget_ms)) if params.with_total else (None, False)
        cur = coll.find(q, proj).sort(ks_sort).limit(limit + 1)
        if budget_ms:
            cur = cur.max_time_ms(budget_ms)
        items = await cur.to_list(limit + 1)
        has_more = len(items) > limit
        items = items[:limit]
        nxt = _enc_cursor(items[-1], key) if has_more and items else None
        return {"items": items, "total": total, "total_estimated": est, "page": None, "page_size": limit, "next_cursor": nxt}
    if params.format == "csv":
        items = await coll.find(query, proj).sort(sort).limit(10000).to_list(10000)
        return {"items": items, "total": len(items), "page": 1, "page_size": len(items), "next_cursor": None, "_csv": True}
    if params.page == 1 and not params.search:
        from services import ttlcache
        ck = f"list:{coll.name}:{hashlib.md5(repr((query, sort, proj, params.page_size, params.with_total)).encode()).hexdigest()}"
        return await ttlcache.cached(ck, 5, lambda: _page(coll, query, params, sort, proj, budget_ms))
    return await _page(coll, query, params, sort, proj, budget_ms)


async def _page(coll, query: dict, params: ListParams, sort, proj: dict, budget_ms: int | None = None) -> dict:
    cursor = coll.find(query, proj).sort(sort).skip((params.page - 1) * params.page_size).limit(params.page_size + 1)
    if budget_ms:
        cursor = cursor.max_time_ms(budget_ms)
    est = False
    if params.with_total is not False:
        (total, est), items = await asyncio.gather(smart_count(coll, query, params.exact, budget_ms), cursor.to_list(params.page_size + 1))  # count and page in parallel
    else:
        total, items = None, await cursor.to_list(params.page_size + 1)
    if total is not None:
        items = items[: params.page_size]
    has_more = (params.page * params.page_size < total) if total is not None else len(items) > params.page_size
    items = items[:params.page_size]
    return {"items": items, "total": total, "total_estimated": est, "page": params.page, "page_size": params.page_size, "next_cursor": _enc_cursor(items[-1], sort[0][0] if sort else "id") if has_more and items else None}


def strip_private(doc: dict | None) -> dict | None:
    if doc is None:
        return None
    return {k: v for k, v in doc.items() if k not in ("_id", "password_hash", "failed_attempts", "locked_until", "mfa_secret", "mfa_temp_secret", "password_history")}


async def write_audit(actor: dict | None, action: str, entity_type: str, entity_id: str,
                      before: Any = None, after: Any = None, ip: str = "", company_id: str | None = None):
    from events import bus
    return await bus.publish("entity.changed", {"actor": actor, "action": action, "entity_type": entity_type, "entity_id": entity_id,
                                         "before": strip_private(before) if isinstance(before, dict) else before,
                                         "after": strip_private(after) if isinstance(after, dict) else after,
                                         "ip": ip, "company_id": company_id or (actor or {}).get("company_id"), **(clock.REQ_CTX.get() or {}), **({"as_of": clock.as_of_iso()} if clock.as_of_iso() else {})})


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


def csv_safe(v):
    """Phase K.16: neutralise spreadsheet formulas — cells starting with = + - @ (or tab/CR) get a leading apostrophe."""
    if isinstance(v, str) and v[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + v
    return v


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
        w.writerow({k: csv_safe(json.dumps(v) if isinstance(v, (dict, list)) else v) for k, v in it.items() if k in fields})
    return buf.getvalue()
