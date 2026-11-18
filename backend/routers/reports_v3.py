"""Phase 3F: /api/reports/v3 — hub, report sheet, options, exports. Read-only."""

import json
import math
import re
from datetime import date

from fastapi import APIRouter, Depends, Request, Response

from db import db
from deps import get_current_user
from reports_v3 import engine as E
from reports_v3.registry import CATALOGUE, CONTROL_ROOM, REDIRECTS, REGISTRY, SEGMENTS
from services import clock, ttlcache
from services.pdf import company_for_pdf, inr
from utils import ApiError

router = APIRouter(prefix="/reports/v3", tags=["reports-v3"])
RESERVED = {"as_of", "group", "sort", "dir", "page", "page_size", "cols"}


def can_open(spec: dict, perms) -> bool:
    """The report's own permission, or any of its alternates (e.g. Sales opens display-layer inventory reports)."""
    return spec["permission"] in perms or any(p in perms for p in spec.get("permission_any", ()))


def _spec(key: str, user: dict) -> dict:
    spec = REGISTRY.get(REDIRECTS.get(key, key))
    if not spec:
        raise ApiError(404, "Unknown report", "NOT_FOUND")
    if not can_open(spec, user["permissions"]):
        raise ApiError(
            403, f"Missing permission: {spec['permission']}", "PERMISSION_DENIED", {"missing": spec["permission"]}
        )
    return {**spec, "key": REDIRECTS.get(key, key)}


def _params(spec: dict, request: Request) -> dict:
    """Known filter params only (unknown → 422): multi = comma list; ranges = <key>_min/_max; dates = <key>_from/_to."""
    q = request.query_params
    allowed = set(RESERVED)
    for f in spec["filters"]:
        k = f["key"]
        allowed |= {
            "multi": {k},
            "date_range": {f"{k}_from", f"{k}_to"},
            "range": {f"{k}_min", f"{k}_max"},
        }.get(f["kind"], {k})
    bad = set(q.keys()) - allowed
    if bad:
        raise ApiError(422, f"Unknown filter: {', '.join(sorted(bad))}", "VALIDATION_ERROR")
    p = {k: q[k] for k in q.keys()}
    for f in spec["filters"]:
        if f["kind"] == "multi" and p.get(f["key"]):
            p[f["key"]] = [x for x in p[f["key"]].split(",") if x]
        if f["kind"] in ("bool", "only"):
            p[f["key"]] = p.get(f["key"]) in ("1", "true", "yes")
        if f["kind"] == "choice" and p.get(f["key"]) and p[f["key"]] not in dict(f["options"]):
            raise ApiError(422, f"{f['label']}: unknown choice", "VALIDATION_ERROR")
    groups = [g for g in (p.get("group") or "").split(",") if g]
    known = {g["key"] for g in spec["groups"]}
    if len(groups) > E.MAX_GROUP_LEVELS or any(g not in known for g in groups):
        raise ApiError(422, "Group by up to 5 of the report's levels", "VALIDATION_ERROR")
    p["group"] = groups
    try:
        p["as_of"] = E.parse_date(p.get("as_of"))
    except ValueError:
        raise ApiError(422, "As-of must be a date (YYYY-MM-DD)", "VALIDATION_ERROR")
    if spec.get("default_period") and not (p.get("period_from") or p.get("period_to")):
        t = clock.today()
        fy = date(t.year if t.month >= 4 else t.year - 1, 4, 1)
        p |= {"period_from": fy.isoformat(), "period_to": t.isoformat(), "_default_period": "this_fy"}
    if p["as_of"] > clock.today():
        raise ApiError(422, "As-of can't be after today", "VALIDATION_ERROR")
    nums = ["page", "page_size"] + [f["key"] for f in spec["filters"] if f["kind"] == "min"]
    nums += [f"{f['key']}_{e}" for f in spec["filters"] if f["kind"] == "range" for e in ("min", "max")]
    for k in nums:
        if p.get(k) not in (None, ""):
            try:
                if not math.isfinite(float(p[k])) or (k in ("page", "page_size") and float(p[k]) > 1e6):
                    raise ValueError
            except ValueError:
                raise ApiError(422, f"{k.replace('_', ' ').capitalize()} must be a number", "VALIDATION_ERROR")
    for f in spec["filters"]:
        if f["kind"] == "date_range":
            for e in ("from", "to"):
                v = p.get(f"{f['key']}_{e}")
                try:
                    v and date.fromisoformat(v)
                except ValueError:
                    raise ApiError(422, f"{f['label']} {e} must be a date (YYYY-MM-DD)", "VALIDATION_ERROR")
    return p


# writes that never change report data (reminder runs, generated PDFs, messages, sign-ins) don't bust the cache
_NOISE = re.compile(
    r"^(reminder\.|document\.generated|message\.|notification\.|auth\.|login|report\.|export\.|session\.)"
)


async def _data_stamp() -> str:
    """Changes on every data write: the newest non-noise audit row (every write is audited) + the newest ledger row."""
    a = await db.audit_logs.find_one({"action": {"$not": _NOISE}}, {"_id": 1}, sort=[("_id", -1)])
    l = await db.ledger_entries.find_one({}, {"_id": 1}, sort=[("_id", -1)])
    return f"{a and a['_id']}:{l and l['_id']}"


async def _rows(spec: dict, user: dict, as_of: date, p: dict | None = None) -> list[dict]:
    """Provider rows cached per scope + as-of + pushed-down filters + data stamp (any write anywhere → recompute)."""
    stamp = await _data_stamp()
    push = {k: (p or {}).get(k) for k in spec.get("pushdown", [])}
    push |= {
        f["key"]: (p or {}).get(f["key"])
        for f in spec["filters"]
        if f.get("pushdown") and f["kind"] in ("choice", "multi")
    }
    from services.inventory import can_see_real

    # real vs display inventory layer is part of the key: a Sales viewer never reads a privileged viewer's rows
    layer = "real" if can_see_real(user) else f"display:{user['id']}"
    key = f"rpt3:{spec['key']}:{ttlcache.scope_key(user)}:{layer}:{as_of}:{clock.today()}:{stamp}:{json.dumps(push, default=str)}"
    ctx = {"as_of": as_of, "stamp": stamp, "params": push}
    return await ttlcache.cached(key, 600, lambda: spec["provider"](user, ctx), stamped=True)


async def _run(spec: dict, user: dict, p: dict) -> dict:
    """The filtered / sorted / totalled result is cached per viewer + params + data stamp, so a repeat (or the next page)
    only slices; any write anywhere changes the stamp and recomputes."""
    stamp = await _data_stamp()
    filt = json.dumps({k: v for k, v in p.items() if k not in ("page", "page_size")}, default=str, sort_keys=True)
    key = f"rpt3res:{spec['key']}:{user['id']}:{stamp}:{clock.today()}:{filt}"
    return await ttlcache.cached(key, 600, lambda: _compute(spec, user, p), stamped=True)


async def _compute(spec: dict, user: dict, p: dict) -> dict:
    need = spec.get("needs")
    rows = [] if need and not p.get(need["filter"]) else await _rows(spec, user, p["as_of"], p)
    opts = E.options(spec, rows)
    if spec.get("options_provider"):
        opts |= await spec["options_provider"](user)
    got = E.apply_filters(spec, rows, p)
    cols = E.visible_columns(spec, user, [c for c in (p.get("cols") or "").split(",") if c])
    sort = p.get("sort") if p.get("sort") in {c["key"] for c in spec["columns"]} else None
    desc = p.get("dir") == "desc"
    then = None
    if not sort and spec.get("default_sort"):
        sort, desc, *rest = spec["default_sort"]
        then = rest[0] if rest else None
    got = E.sort_rows(got, sort, desc, then)
    tot = E.totals(spec, got)
    money = E.MONEY_PERM in user["permissions"]
    if money and spec.get("bridge"):  # reconcile with the sibling report that counts on another basis
        tot |= await spec["bridge"](user, p, tot, E.narrowed(spec, p))
    if not money and not spec.get("public_money"):  # no money permission → no money totals either
        plain = {c["key"] for c in spec["columns"] if c["type"] != "money"}
        tot = {k: v for k, v in tot.items() if k in plain}
    return {
        "rows_all": got,
        "cols": cols,
        "totals": tot,
        "options": opts,
        "sentence": E.sentence(spec, p, opts, len(got), p["as_of"] if spec.get("date_mode") == "as_of" else None),
        "formula": spec["formula"](tot) if money or spec.get("public_money") else None,
        "illustration": spec["illustration"](got, tot)
        if money or spec.get("public_money") or spec.get("illus_always")
        else None,
    }


def _meta(spec: dict, user: dict) -> dict:
    return {
        "key": spec["key"],
        "segment": spec["segment"],
        "title": spec["title"],
        "purpose": spec["purpose"],
        "unit": spec["unit"],
        "date_mode": spec.get("date_mode"),
        "row_link": spec.get("row_link"),
        "needs": spec.get("needs"),
        "tieout": spec.get("tieout"),
        "columns": E.allowed_columns(spec, user),
        "filters": [{k: v for k, v in f.items() if k not in ("field", "label_field")} for f in spec["filters"]],
        "groups": [{"key": g["key"], "label": g["label"]} for g in spec["groups"]],
        "can_export": spec["export_permission"] in user["permissions"]
        or any(p in user["permissions"] for p in spec.get("export_any", ())),
    }


def _strip(r: dict, cols: list[dict]) -> dict:
    keep = {c["key"] for c in cols} | {"booking_id", "customer_id", "status_kind", "_legacy_link"}
    return {k: v for k, v in r.items() if k in keep}


def _strip_tree(tree: list[dict], cols) -> list[dict]:
    out = []
    for g in tree:
        n = {k: v for k, v in g.items() if k not in ("children", "rows")}
        n |= (
            {"children": _strip_tree(g["children"], cols)}
            if "children" in g
            else {"rows": [_strip(r, cols) for r in g["rows"]]}
        )
        out.append(n)
    return out


@router.get("")
async def hub(user: dict = Depends(get_current_user)):
    """REQ-274: 5 segments × 10 tiles in order, live headline for engine reports, plus the control-room row."""
    perms = set(user["permissions"])
    today = clock.today()

    async def tile(t):
        key, title, purpose, legacy, perm = t
        if not (can_open(REGISTRY[key], perms) if key in REGISTRY else perm in perms):
            return None
        out = {"key": key, "title": title, "purpose": purpose, "legacy": legacy, "live": key in REGISTRY}
        spec = REGISTRY.get(key)
        if spec and spec.get("needs"):
            out |= {"headline": "—", "caption": spec["needs"]["message"].lower()}
        elif key == "customer-status" and E.MONEY_PERM in perms:
            rows = [r for r in await _rows({**spec, "key": key}, user, today) if r.get("live")]
            due = sum(r["account_dues"] + r["cash_dues"] for r in rows)
            out |= {
                "headline": inr(due),
                "headline_paise": due,
                "caption": f"instalment dues · {len(rows):,} live bookings · today",
            }
        elif spec:
            sp = {**spec, "key": key}
            dp = {}
            if spec.get("default_period"):  # the tile shows what the report opens on (This FY)
                fy = date(today.year if today.month >= 4 else today.year - 1, 4, 1)
                dp = {"period_from": fy.isoformat(), "period_to": today.isoformat()}
            rows = E.apply_filters(sp, await _rows(sp, user, today, dp), dp)
            h = spec.get("headline")
            key_, cap = h if isinstance(h, tuple) else (h, None)
            col = next((c for c in spec["columns"] if c["key"] == key_), None)
            if col and (col["type"] != "money" or E.MONEY_PERM in perms or col.get("public")):
                v = E.totals(sp, rows).get(key_)
                if col["type"] == "money":
                    out["headline_paise"] = v or 0
                fig = (
                    inr(v or 0)
                    if col["type"] == "money"
                    else f"{v}%"
                    if col["type"] == "pct" and v is not None
                    else f"{v or 0:,}"
                )
                out |= {
                    "headline": fig,
                    "caption": f"{cap or col['label'].lower()} · {len(rows):,} {spec['unit'][1]}"
                    + (" · this FY" if dp else ""),
                }
            else:
                out |= {
                    "headline": f"{len(rows):,}",
                    "caption": f"{spec['unit'][1]} · " + ("this FY" if dp else "today"),
                }
        return out

    segs = []
    for s in SEGMENTS:
        tiles = [x for x in [await tile(t) for t in CATALOGUE[s]] if x]
        if tiles:
            fig = next((t for t in tiles if t.get("headline_paise") is not None), None)
            segs.append(
                {
                    "segment": s,
                    "tiles": tiles,
                    "summary": f"{len(tiles)} reports"
                    + (f" · {fig['caption'].split(' · ')[0]} {fig['headline']}" if fig else ""),
                    "figure": fig and {"label": fig["caption"].split(" · ")[0], "amount_paise": fig["headline_paise"]},
                }
            )
    ctrl = [x for x in [await tile(t) for t in CONTROL_ROOM] if x]
    views = (
        await db.report_presets.find(
            {
                "$or": [{"user_id": user["id"]}, {"shared": True, "company_id": user["company_id"]}],
                "report_key": {"$in": list(REGISTRY)},
            },
            {"_id": 0},
        )
        .sort("name", 1)
        .to_list(200)
    )
    return {
        "segments": segs,
        "control_room": ctrl,
        "views": views,
        "as_of": today.isoformat(),
        "count": sum(len(s["tiles"]) for s in segs),
        "one_click": "customer-status" if "customer-status" in {t["key"] for s in segs for t in s["tiles"]} else None,
    }


@router.get("/{key}")
async def report(key: str, request: Request, user: dict = Depends(get_current_user)):
    spec = _spec(key, user)
    p = _params(spec, request)
    out = dict(await _run(spec, user, p))  # the cached result is shared; never mutate it
    rows, cols = out.pop("rows_all"), out["cols"]
    page, size = max(int(float(p.get("page") or 1)), 1), min(max(int(float(p.get("page_size") or 100)), 10), 500)
    body = {
        "meta": _meta(spec, user),
        "as_of": p["as_of"].isoformat(),
        "defaults": {
            k: p[k] for k in ("period_from", "period_to", "_default_period") if p.get("_default_period") and k in p
        },
        "count": len(rows),
        "page": page,
        "page_size": size,
        **out,
    }
    if p["group"]:
        body["groups"] = _strip_tree(E.group_tree(spec, rows, p["group"]), cols)
    else:
        body["rows"] = [_strip(r, cols) for r in rows[(page - 1) * size : page * size]]
    return Response(
        json.dumps(body, default=str), media_type="application/json", headers={"Cache-Control": "private, no-cache"}
    )


async def _export(key: str, request: Request, user: dict, fmt: str) -> Response:
    spec = _spec(key, user)
    if spec["export_permission"] not in user["permissions"] and not any(
        p in user["permissions"] for p in spec.get("export_any", ())
    ):
        raise ApiError(
            403,
            f"Missing permission: {spec['export_permission']}",
            "PERMISSION_DENIED",
            {"missing": spec["export_permission"]},
        )
    p = _params(spec, request)
    out = dict(await _run(spec, user, p))  # the cached result is shared; never mutate it
    rows, cols = out["rows_all"], out["cols"]
    lines = list(E._flat(E.group_tree(spec, rows, p["group"]), cols)) if p["group"] else [("row", r) for r in rows]
    head = [spec["title"], out["sentence"]] + ([out["formula"]] if out["formula"] else [])
    name = f"{spec['key']}-{p['as_of']}"
    if fmt == "xlsx":
        data = E.to_xlsx(spec, cols, lines, out["totals"], head)
        mt = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    else:
        data = await E.to_pdf(spec, cols, lines, out["totals"], head, await company_for_pdf(user["company_id"]))
        mt = "application/pdf"
    disp = "inline" if fmt == "pdf" else "attachment"
    return Response(data, media_type=mt, headers={"Content-Disposition": f'{disp}; filename="{name}.{fmt}"'})


@router.get("/{key}/export.xlsx")
async def export_xlsx(key: str, request: Request, user: dict = Depends(get_current_user)):
    return await _export(key, request, user, "xlsx")


@router.get("/{key}/export.pdf")
async def export_pdf(key: str, request: Request, user: dict = Depends(get_current_user)):
    return await _export(key, request, user, "pdf")
