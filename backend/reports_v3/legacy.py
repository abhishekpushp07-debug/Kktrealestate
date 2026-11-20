"""Phase 3F F3: an existing report becomes an engine provider. The provider calls the existing report route in-process
(same code, same numbers — nothing re-derived) at its finest grouping, then adds the booking's location / customer /
sales dimensions so the engine can filter, group and link rows."""

import uuid
from contextvars import ContextVar

import httpx

from db import db
from deps import create_access_token, report_scope_filter

_TYPE = {"str": "text", "money": "money", "num": "num", "pct": "pct", "date": "date"}


LAST: ContextVar[dict | None] = ContextVar("legacy_totals", default=None)  # this request's legacy totals, by path


def last(path: str) -> dict | None:
    return (LAST.get() or {}).get(path)


async def call(user: dict, path: str, params: dict) -> dict:
    from routers.reports import HANDOFF, INTERNAL_KEY
    from server import app

    tok = uuid.uuid4().hex
    h = {"Authorization": f"Bearer {create_access_token(user, minutes=2)}", "x-report-internal": INTERNAL_KEY}
    h["x-report-handoff"] = tok
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://internal") as c:
        r = await c.get(f"/api/reports/{path}", params={k: v for k, v in params.items() if v}, headers=h, timeout=120)
    r.raise_for_status()
    return HANDOFF.pop(tok, None) or r.json()


async def _booking_dims(user: dict) -> tuple[dict, dict]:
    q = {"company_id": user["company_id"], **report_scope_filter(user)}
    proj = {"_id": 0, "id": 1, "booking_number": 1, "customer_id": 1, "project_id": 1, "project_code": 1, "block_id": 1}
    proj |= {"block_name": 1, "flat_id": 1, "flat_snapshot.flat_number": 1, "sales_user_id": 1, "customer_name": 1}
    bks = await db.bookings.find(q, proj).to_list(None)
    users = {u["id"]: u.get("name") async for u in db.users.find({}, {"_id": 0, "id": 1, "name": 1})}
    floors = {
        f["id"]: f.get("floor")
        async for f in db.flats.find({"company_id": user["company_id"]}, {"_id": 0, "id": 1, "floor": 1})
    }
    by_no, by_id = {}, {}
    for b in bks:
        flat = (b.get("flat_snapshot") or {}).get("flat_number") or ""
        fl = floors.get(b.get("flat_id"))
        fname = "Ground" if fl == 0 else f"Floor {fl}" if fl is not None else "—"
        d = {
            "floor_id": f"{b.get('block_id')}:{fl}",
            "floor": fname,
            "floor_label": f"{b.get('block_name')} · {fname}",
            "flat": flat,
            "customer_label": b.get("customer_name"),
            "booking_id": b["id"],
            "customer_id": b.get("customer_id"),
            "project_id": b.get("project_id"),
            "project": b.get("project_code"),
            "tower_id": b.get("block_id"),
            "tower": b.get("block_name"),
            "flat_id": b.get("flat_id"),
            "flat_code": f"{b.get('project_code')} · {b.get('block_name')} · {flat}",
            "sales_id": b.get("sales_user_id") or "-",
            "sales_person": users.get(b.get("sales_user_id")) or "Unassigned",
        }
        by_no[b.get("booking_number")] = d
        by_id[b["id"]] = d
    return by_no, by_id


def provider(path: str, fixed: dict | None = None, period: bool = False, push: tuple = (), enrich=None):
    """Rows of the existing report at its finest grouping, plus booking dimensions where the row names a booking."""

    async def run(user: dict, ctx: dict) -> list[dict]:
        p = dict(fixed or {})
        if period:
            p |= {"from_date": ctx["params"].get("period_from"), "to_date": ctx["params"].get("period_to")}
        for ours, theirs in push:
            v = ctx["params"].get(ours) or p.get(theirs)
            p[theirs] = v[0] if isinstance(v, list) else v
        data = await call(user, path, p)
        LAST.set({**(LAST.get() or {}), path: data.get("totals") or {}})
        by_no, by_id = await _booking_dims(user)
        out = []
        for r in data["rows"]:
            if r.get("_subtotal"):  # the engine makes its own subtotals
                continue
            d = by_id.get(r.get("booking_id")) or by_no.get(r.get("booking_number")) or {}
            if not d and (r.get("_link") or "").startswith("/bookings/"):
                d = by_id.get(r["_link"].split("/")[2].split("?")[0]) or {}
            row = {k: v for k, v in r.items() if not k.startswith("_")}
            if r.get("project_id") and not d:
                row["project_id"] = r["project_id"]
            out.append(row | d | {"_legacy_link": r.get("_link")})
        return await enrich(user, out, ctx) if enrich else out

    return run


def columns(cols: list[tuple], hide: tuple = ()) -> list[dict]:
    """(key, label, legacy type[, width]) → engine columns; keys stay the existing report's keys."""
    return [
        {
            "key": c[0],
            "label": c[1],
            "type": _TYPE.get(c[2], c[2]),
            "default": c[0] not in hide,
            "width": c[3] if len(c) > 3 else 12,
        }
        for c in cols
    ]
