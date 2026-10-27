"""Phase N reports hub screens: Inventory by Category/Status/Display, Landowner Share, Hold Register, Masked Inventory. Every row ties out to flats."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Request

from db import db
from deps import require
from routers.inventory import _flats
from routers.reports import _company, _strict_params, respond
from routers.reports_i import etag_respond
from services import inventory as inv
from utils import ApiError, now_iso

router = APIRouter(prefix="/reports", tags=["reports"])
VIEW = "reports.inventory_control.view"
CAT_LABEL = {"BUILDER": "Builder saleable", "LANDOWNER": "Landowner share", "INVESTOR": "Investor share", "BANK": "Bank/mortgage", "RESERVE": "Management reserve", "SAMPLE": "Sample/show flat", "SOCIETY": "Society/common"}


def _link(r):
    return f"/blocks/{r['block_id']}?flat={r['id']}"


@router.get("/inventory-control")
async def inventory_control(request: Request, project_id: str | None = None, block_id: str | None = None, format: str | None = None, user: dict = Depends(require(VIEW))):
    _strict_params(request, {"project_id", "block_id"})
    rows, bl = await _flats(user, project_id, block_id)
    priv = inv.can_see_real(user)
    out: dict = {}
    for r in rows:
        shown = inv.effective_display(r)
        if shown == "Hidden" and not priv:
            continue
        code = r.get("allocation_category_code") or "BUILDER"
        e = out.setdefault(code, {"group": CAT_LABEL.get(code, code), "total": 0, "available": 0, "hold": 0, "blocked": 0, "booked": 0, "sold": 0, "show_available": 0, "show_sold": 0, "show_hold": 0, "hidden": 0, "masked": 0, "value_paise": 0, "_link": f"/masters/flats?category={code}"})
        e["total"] += 1
        e["value_paise"] += int(r.get("price_paise") or 0)
        real = r["status"] if priv else inv.DISPLAY_TO_STATUS.get(shown)
        if real and real.lower() in e:
            e[real.lower()] += 1
        e[{"Show as Available": "show_available", "Show as Sold": "show_sold", "Show as Hold": "show_hold", "Hidden": "hidden"}[shown]] += 1
        if priv and r.get("display_override") and shown != inv.MIRROR.get(r["status"]):
            e["masked"] += 1
    items = sorted(out.values(), key=lambda x: -x["total"])
    cols = [("group", "Category", "str", 1.6), ("total", "Units", "num", 0.5), ("available", "Available", "num", 0.7), ("hold", "Hold", "num", 0.5), ("blocked", "Blocked", "num", 0.6), ("booked", "Booked", "num", 0.6), ("sold", "Sold", "num", 0.5),
            ("show_available", "Shown Avail.", "num", 0.8), ("show_sold", "Shown Sold", "num", 0.8), ("show_hold", "Shown Hold", "num", 0.8), ("value_paise", "Notional value", "money")]
    if priv:
        cols.insert(10, ("masked", "Masked", "num", 0.6))
    totals = {c[0]: sum(e[c[0]] for e in items) for c in cols if c[0] != "group"}
    saleable = out.get("BUILDER", {})
    kpis = [{"label": "Units", "value": totals["total"], "kind": "num", "hint": f"{len(items)} categories"}, {"label": "Builder saleable", "value": saleable.get("total", 0), "kind": "num", "hint": f"{saleable.get('available', 0)} available"},
            {"label": "Non-saleable", "value": totals["total"] - saleable.get("total", 0), "kind": "num", "hint": "landowner / investor / bank / reserve / sample / society"},
            {"label": "Masked" if priv else "Shown as Sold", "value": totals.get("masked", totals["show_sold"]), "kind": "num", "tone": "brick" if priv and totals.get("masked") else "sage"}]
    payload = {"as_of": now_iso()[:10], "privileged": priv, "kpis": kpis, "tie_out": {"flats": len(rows) if priv else sum(e["total"] for e in items), "rows_total": totals["total"]}}
    return etag_respond(request, await respond(request, format, payload, "Inventory by Category / Status / Display", await _company(user), cols, items, totals, "inventory-control", landscape=True))


@router.get("/landowner-share")
async def landowner_share(request: Request, project_id: str | None = None, block_id: str | None = None, format: str | None = None, user: dict = Depends(require(VIEW))):
    _strict_params(request, {"project_id", "block_id"})
    rows, bl = await _flats(user, project_id, block_id)
    per: dict = {}
    for r in rows:
        e = per.setdefault(r["block_id"], {"group": bl.get(r["block_id"], {}).get("name") or r["block_id"], "total": 0, "landowner": 0, "share_pct": 0, "area_sqft": 0.0, "notional_value_paise": 0, "flats": [], "_link": f"/blocks/{r['block_id']}"})
        e["total"] += 1
        if r.get("allocation_category_code") == "LANDOWNER":
            e["landowner"] += 1
            e["area_sqft"] += float(r.get("super_builtup_sqft") or 0)
            e["notional_value_paise"] += int(r.get("price_paise") or 0)
            e["flats"].append(r["flat_number"])
    items = [{**e, "share_pct": round(100 * e["landowner"] / e["total"], 1), "flats": ", ".join(e["flats"][:12]) + (" …" if len(e["flats"]) > 12 else "")} for e in per.values() if e["landowner"]]
    items.sort(key=lambda x: -x["share_pct"])
    cols = [("group", "Tower", "str", 1.4), ("total", "Units", "num", 0.5), ("landowner", "Landowner", "num", 0.7), ("share_pct", "Share", "pct", 0.5), ("area_sqft", "Area sq.ft", "num", 0.8), ("notional_value_paise", "Notional value", "money"), ("flats", "Flats", "str", 2.2)]
    lo = sum(e["landowner"] for e in items)
    tot = sum(e["total"] for e in per.values())
    totals = {"total": tot, "landowner": lo, "share_pct": round(100 * lo / tot, 1) if tot else 0, "area_sqft": round(sum(e["area_sqft"] for e in items), 1), "notional_value_paise": sum(e["notional_value_paise"] for e in items)}
    kpis = [{"label": "Landowner units", "value": lo, "kind": "num", "hint": f"of {tot} units"}, {"label": "Share", "value": f"{totals['share_pct']}%", "kind": "num"}, {"label": "Area", "value": f"{totals['area_sqft']:,.0f} sq.ft", "kind": "num"}, {"label": "Notional value", "value_paise": totals["notional_value_paise"], "kind": "money", "hint": "at list price · never booked by Builder"}]
    payload = {"as_of": now_iso()[:10], "kpis": kpis, "tie_out": {"landowner_flats": sum(1 for r in rows if r.get("allocation_category_code") == "LANDOWNER"), "rows_landowner": lo}}
    return etag_respond(request, await respond(request, format, payload, "Landowner Share", await _company(user), cols, items, totals, "landowner-share"))


@router.get("/hold-register")
async def hold_register(request: Request, project_id: str | None = None, block_id: str | None = None, group_by: str = "active", format: str | None = None, user: dict = Depends(require(VIEW))):
    _strict_params(request, {"project_id", "block_id", "group_by"})
    if group_by not in ("active", "expiring", "expired"):
        raise ApiError(400, "group_by must be active | expiring | expired", "UNKNOWN_PARAM")
    rows, bl = await _flats(user, project_id, block_id)
    now = datetime.now(timezone.utc)
    soon = (now + timedelta(hours=48)).isoformat()
    reasons = {r["id"]: r["name"] for r in await db.hold_reasons.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(None)}
    held = [r for r in rows if r["status"] == "Hold"]
    uids = {(r.get("hold") or {}).get("for_user_id") for r in held} - {None}
    cids = {(r.get("hold") or {}).get("for_customer_id") for r in held} - {None}
    users = {u["id"]: u.get("name") or u.get("full_name") for u in await db.users.find({"id": {"$in": list(uids)}}, {"_id": 0, "id": 1, "name": 1, "full_name": 1}).to_list(None)}
    custs = {c["id"]: c.get("full_name") for c in await db.customers.find({"id": {"$in": list(cids)}}, {"_id": 0, "id": 1, "full_name": 1}).to_list(None)}
    active = []
    for r in sorted(held, key=lambda r: (r.get("hold") or {}).get("expires_at") or ""):
        h = r.get("hold") or {}
        exp = h.get("expires_at")
        left_h = round((datetime.fromisoformat(exp) - now).total_seconds() / 3600, 1) if exp else None
        active.append({"group": r["flat_number"], "tower": bl.get(r["block_id"], {}).get("name"), "state": "legacy (no expiry)" if not exp else "expiring" if exp <= soon else "active", "expires_at": exp, "hours_left": left_h, "reason": reasons.get(h.get("reason_id")) or "—",
                       "customer": custs.get(h.get("for_customer_id")) or "—", "rm": users.get(h.get("for_user_id")) or "—", "note": h.get("note") or "", "_link": _link(r)})
    fids = [r["id"] for r in rows]
    hist_q = {"entity_type": "flat", "entity_id": {"$in": fids}, "action": {"$in": ["flat.held", "flat.released", "flat.hold_expired"]}}
    hist = await db.audit_logs.find(hist_q, {"_id": 0, "action": 1, "entity_id": 1, "created_at": 1, "actor_name": 1, "after.flat_number": 1, "after.reason": 1}).sort("created_at", -1).limit(1000).to_list(1000)
    n_held = sum(1 for h in hist if h["action"] == "flat.held")
    n_rel = sum(1 for h in hist if h["action"] == "flat.released")
    n_exp = sum(1 for h in hist if h["action"] == "flat.hold_expired")
    converted = await db.bookings.count_documents({"from_hold": True, "flat_id": {"$in": fids}})
    fl_by_id = {r["id"]: r for r in rows}
    expired = [{"group": (h.get("after") or {}).get("flat_number") or fl_by_id.get(h["entity_id"], {}).get("flat_number", "?"), "tower": bl.get(fl_by_id.get(h["entity_id"], {}).get("block_id"), {}).get("name"), "state": "expired → released" if h["action"] == "flat.hold_expired" else "released", "expires_at": h["created_at"], "hours_left": None,
                "reason": (h.get("after") or {}).get("reason") or "—", "customer": "—", "rm": h.get("actor_name") or "sweep", "note": "", "_link": _link(fl_by_id[h["entity_id"]]) if h["entity_id"] in fl_by_id else None} for h in hist if h["action"] in ("flat.hold_expired", "flat.released")]
    items = {"active": active, "expiring": [a for a in active if a["state"] == "expiring"], "expired": expired}[group_by]
    cols = [("group", "Flat", "str", 0.8), ("tower", "Tower", "str", 1.0), ("state", "State", "str", 1.0), ("expires_at", "Expires / event", "date", 1.0), ("hours_left", "Hours left", "num", 0.7), ("reason", "Reason", "str", 1.2), ("customer", "Customer", "str", 1.3), ("rm", "RM", "str", 1.1), ("note", "Note", "str", 1.5)]
    totals = {"hours_left": None}
    conv = round(100 * converted / n_held, 1) if n_held else None
    kpis = [{"label": "Active holds", "value": len(active), "kind": "num", "hint": f"{sum(1 for a in active if a['state'] == 'legacy (no expiry)')} legacy without expiry"}, {"label": "Expiring < 48 h", "value": sum(1 for a in active if a["state"] == "expiring"), "kind": "num", "tone": "brick" if any(a["state"] == "expiring" for a in active) else "sage"},
            {"label": "Expired → released", "value": n_exp, "kind": "num", "hint": f"{n_rel} released manually"}, {"label": "Hold → booking", "value": f"{conv}%" if conv is not None else "—", "kind": "num", "hint": f"{converted} of {n_held} holds converted", "tone": "sage"}]
    payload = {"as_of": now_iso()[:10], "group_by": group_by, "group_options": ["active", "expiring", "expired"], "kpis": kpis, "totals_extra": {"active": len(active), "expiring_48h": kpis[1]["value"], "expired_released": n_exp, "released_manually": n_rel, "held_total": n_held, "converted": converted, "conversion_rate_pct": conv},
               "tie_out": {"flats_on_hold": len(held), "rows_active": len(active)}}
    return etag_respond(request, await respond(request, format, payload, f"Hold Register · {group_by}", await _company(user), cols, items, totals, "hold-register", landscape=True))


@router.get("/masked-inventory")
async def masked_inventory(request: Request, project_id: str | None = None, block_id: str | None = None, format: str | None = None, user: dict = Depends(require(VIEW))):
    _strict_params(request, {"project_id", "block_id"})
    if not inv.can_see_real(user):
        raise ApiError(403, "Missing permission: inventory.real_status.view", "PERMISSION_DENIED", {"missing": inv.REAL_STATUS_PERM, "any_of": [inv.REAL_STATUS_PERM]})
    rows, bl = await _flats(user, project_id, block_id)
    masked = [r for r in rows if r.get("display_override") and inv.effective_display(r) != inv.MIRROR.get(r["status"])]
    uids = {r.get("display_set_by") for r in rows if r.get("display_override")} - {None}
    users = {u["id"]: u.get("name") or u.get("full_name") for u in await db.users.find({"id": {"$in": list(uids)}}, {"_id": 0, "id": 1, "name": 1, "full_name": 1}).to_list(None)}
    items = [{"group": r["flat_number"], "tower": bl.get(r["block_id"], {}).get("name"), "real": r["status"], "displayed": r["display_state"], "reason": r.get("display_reason") or "—", "since": r.get("display_set_at"), "by": users.get(r.get("display_set_by")) or "—", "value_paise": int(r.get("price_paise") or 0), "_link": _link(r)} for r in sorted(masked, key=lambda r: (r["block_id"], r["flat_number"]))]
    cols = [("group", "Flat", "str", 0.8), ("tower", "Tower", "str", 1.0), ("real", "Real status", "str", 0.9), ("displayed", "Displayed as", "str", 1.1), ("reason", "Reason", "str", 1.6), ("since", "Since", "date", 0.9), ("by", "Set by", "str", 1.1), ("value_paise", "List value", "money")]
    totals = {"value_paise": sum(i["value_paise"] for i in items)}
    kpis = [{"label": "Masked units", "value": len(items), "kind": "num", "tone": "brick" if items else "sage"}, {"label": "Shown as Sold", "value": sum(1 for r in masked if r["display_state"] == "Show as Sold"), "kind": "num"}, {"label": "Hidden", "value": sum(1 for r in masked if r["display_state"] == "Hidden"), "kind": "num"}, {"label": "List value masked", "value_paise": totals["value_paise"], "kind": "money"}]
    payload = {"as_of": now_iso()[:10], "kpis": kpis, "tie_out": {"overrides": sum(1 for r in rows if r.get("display_override")), "masked": len(items)}}
    return etag_respond(request, await respond(request, format, payload, "Masked Inventory (privileged)", await _company(user), cols, items, totals, "masked-inventory"))
