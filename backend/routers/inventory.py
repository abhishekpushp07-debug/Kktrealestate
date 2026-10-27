"""Phase N — inventory control API: bulk actions (category / hold / extend / release / block / unblock / display override), counters, reports."""
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from db import db
from deps import project_scope_filter, require, require_any
from services import inventory as inv
from utils import ApiError, client_ip, now_iso, write_audit

router = APIRouter(prefix="/inventory", tags=["inventory"])


class BulkIn(BaseModel):
    flat_ids: list[str] = Field(min_length=1, max_length=500)
    action: Literal["set_category", "hold", "extend_hold", "release", "block", "unblock", "set_display", "clear_display"]
    category_id: str | None = None
    reason_id: str | None = None
    reason: str | None = None
    note: str | None = None
    for_customer_id: str | None = None
    for_user_id: str | None = None
    expires_at: str | None = None
    display_state: str | None = None


def _expiry(v: str | None) -> str:
    if not v:
        raise ApiError(422, "Hold expiry date/time is mandatory (no default)", "HOLD_EXPIRY_REQUIRED")
    try:
        dt = datetime.fromisoformat(v.replace("Z", "+00:00"))
    except ValueError:
        raise ApiError(422, "expires_at must be an ISO date-time", "VALIDATION_ERROR")
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    if dt <= datetime.now(timezone.utc):
        raise ApiError(422, "Hold expiry must be in the future", "HOLD_EXPIRY_PAST")
    return dt.isoformat()


_PERM = {"set_category": "inventory.category.set", "hold": "inventory.hold.create", "extend_hold": "inventory.hold.create", "release": "inventory.hold.release", "block": "inventory.block.set", "unblock": "inventory.block.set",
         "set_display": "inventory.display.set", "clear_display": "inventory.display.set"}
_EVENT = {"set_category": "flat.category_changed", "hold": "flat.held", "extend_hold": "flat.hold_extended", "release": "flat.released", "block": "flat.blocked", "unblock": "flat.unblocked", "set_display": "flat.display_changed", "clear_display": "flat.display_changed"}


@router.post("/bulk")
async def bulk(body: BulkIn, request: Request, user: dict = Depends(require_any("inventory.category.set", "inventory.hold.create", "inventory.hold.release", "inventory.block.set", "inventory.display.set"))):
    if _PERM[body.action] not in user["permissions"]:
        raise ApiError(403, f"Missing permission: {_PERM[body.action]}", "PERMISSION_DENIED")
    flats = await db.flats.find({"id": {"$in": body.flat_ids}, "is_active": True, **project_scope_filter(user)}, {"_id": 0}).to_list(None)
    if len(flats) != len(set(body.flat_ids)):
        raise ApiError(404, "One or more flats not found in your projects", "NOT_FOUND")
    now = now_iso()
    done, skipped = [], []
    cat = None
    if body.action == "set_category":
        cat = await db.allocation_categories.find_one({"id": body.category_id, "company_id": user["company_id"], "is_active": True}, {"_id": 0})
        if not cat:
            raise ApiError(422, "Allocation category not found", "VALIDATION_ERROR")
    if body.action == "hold":
        exp = _expiry(body.expires_at)
        if not body.reason_id or not await db.hold_reasons.find_one({"id": body.reason_id, "is_active": True}):
            raise ApiError(422, "Hold reason is required", "VALIDATION_ERROR")
    if body.action == "extend_hold":
        exp = _expiry(body.expires_at)
    if body.action == "set_display" and body.display_state not in inv.DISPLAY_STATES:
        raise ApiError(422, f"display_state must be one of {list(inv.DISPLAY_STATES)}", "VALIDATION_ERROR")
    if body.action in ("set_display", "block") and not (body.reason or "").strip():
        raise ApiError(422, "A reason is required", "VALIDATION_ERROR")
    for f in flats:
        upd, why = None, None
        if body.action == "set_category":
            if f["status"] in ("Booked", "Sold") and not cat["bookable"]:
                why = "booked/sold units stay Builder saleable"
            else:
                upd = {"allocation_category_id": cat["id"], "allocation_category_code": cat["code"], "bookable": bool(cat["bookable"])}
        elif body.action == "hold":
            if f["status"] != "Available":
                why = f"is {f['status']}"
            else:
                upd = {"status": "Hold", "status_changed_at": now, "status_changed_by": user["id"], "status_reason": body.note, "hold": {"reason_id": body.reason_id, "for_customer_id": body.for_customer_id, "for_user_id": body.for_user_id or user["id"], "note": body.note, "expires_at": exp, "created_by": user["id"], "created_at": now}}
        elif body.action == "extend_hold":
            if f["status"] != "Hold":
                why = "not on hold"
            else:
                upd = {"hold.expires_at": exp, "hold.expiry_warned": False, "hold.extended_by": user["id"], "hold.extended_at": now}
        elif body.action == "release":
            if f["status"] != "Hold":
                why = "not on hold"
            elif (f.get("hold") or {}).get("for_user_id") not in (user["id"], None) and "inventory.hold.release" not in user["permissions"]:
                why = "held by another RM"
            else:
                upd = {"status": "Available", "status_changed_at": now, "status_changed_by": user["id"], "status_reason": body.note or "Released", "hold": None}
        elif body.action == "block":
            if f["status"] not in ("Available", "Hold"):
                why = f"is {f['status']}"
            else:
                upd = {"status": "Blocked", "status_changed_at": now, "status_changed_by": user["id"], "status_reason": body.reason, "hold": None, "block": {"reason": body.reason, "note": body.note, "created_by": user["id"], "created_at": now}}
        elif body.action == "unblock":
            if f["status"] != "Blocked":
                why = "not blocked"
            else:
                upd = {"status": "Available", "status_changed_at": now, "status_changed_by": user["id"], "status_reason": body.note or "Unblocked", "block": None}
        elif body.action == "set_display":
            upd = {"display_state": body.display_state, "display_override": True, "display_set_by": user["id"], "display_set_at": now, "display_reason": body.reason}
        elif body.action == "clear_display":
            upd = {"display_state": None, "display_override": False, "display_set_by": user["id"], "display_set_at": now, "display_reason": body.reason}
        if why:
            skipped.append({"flat_id": f["id"], "flat_number": f["flat_number"], "reason": why})
            continue
        await db.flats.update_one({"id": f["id"], "version": f.get("version", 1)}, {"$set": {**upd, "updated_at": now}, "$inc": {"version": 1}})
        after = await db.flats.find_one({"id": f["id"]}, {"_id": 0})
        await write_audit(user, _EVENT[body.action], "flat", f["id"], before=f, after={**after, "flat_number": f["flat_number"], "reason": body.reason or body.note}, ip=client_ip(request))
        done.append(f["id"])
    return {"done": len(done), "skipped": skipped, "flat_ids": done}


@router.get("/summary")
async def summary(project_id: str | None = None, block_id: str | None = None, user: dict = Depends(require("masters.project.view"))):
    match = project_scope_filter(user)
    if project_id:
        match["project_id"] = project_id
    if block_id:
        match["block_id"] = block_id
    return {"counters": await inv.counters(match, inv.can_see_real(user)), "privileged": inv.can_see_real(user)}


@router.get("/definitions")
async def definitions(user: dict = Depends(require("masters.project.view"))):
    return {"real_states": list(inv.REAL_STATES), "display_states": list(inv.DISPLAY_STATES), "mirror": inv.MIRROR}


# ---- reports (tie-outs vs flats) --------------------------------------------------------------------------------------
async def _flats(user, project_id, block_id):
    match = {**project_scope_filter(user), "is_active": True}
    if project_id:
        match["project_id"] = project_id
    if block_id:
        match["block_id"] = block_id
    rows = await db.flats.find(match, {"_id": 0, "id": 1, "flat_number": 1, "project_id": 1, "block_id": 1, "status": 1, "display_state": 1, "display_override": 1, "display_reason": 1, "display_set_at": 1, "allocation_category_code": 1, "bookable": 1, "super_builtup_sqft": 1, "price_paise": 1, "hold": 1, "block": 1}).to_list(None)
    bl = {b["id"]: b for b in await db.blocks.find({"id": {"$in": list({r["block_id"] for r in rows})}}, {"_id": 0, "id": 1, "name": 1, "code": 1}).to_list(None)}
    return rows, bl


@router.get("/reports/by-category")
async def report_by_category(project_id: str | None = None, block_id: str | None = None, user: dict = Depends(require("reports.inventory_control.view"))):
    rows, _ = await _flats(user, project_id, block_id)
    priv = inv.can_see_real(user)
    out: dict = {}
    for r in rows:
        shown = inv.effective_display(r)
        real = r["status"] if priv else inv.DISPLAY_TO_STATUS.get(shown) or "Hidden"
        e = out.setdefault(r.get("allocation_category_code") or "BUILDER", {"category": r.get("allocation_category_code") or "BUILDER", "total": 0, "by_status": {}, "by_display": {}})
        e["total"] += 1
        e["by_status"][real] = e["by_status"].get(real, 0) + 1
        e["by_display"][shown] = e["by_display"].get(shown, 0) + 1
    return {"items": sorted(out.values(), key=lambda x: -x["total"]), "tie_out": {"flats": len(rows), "rows_total": sum(e["total"] for e in out.values())}, "privileged": priv}


@router.get("/reports/landowner-share")
async def report_landowner(project_id: str | None = None, block_id: str | None = None, user: dict = Depends(require("reports.inventory_control.view"))):
    rows, bl = await _flats(user, project_id, block_id)
    lo = [r for r in rows if r.get("allocation_category_code") == "LANDOWNER"]
    per: dict = {}
    for r in lo:
        e = per.setdefault(r["block_id"], {"block_id": r["block_id"], "tower": bl.get(r["block_id"], {}).get("name"), "units": 0, "area_sqft": 0.0, "notional_value_paise": 0, "flats": []})
        e["units"] += 1
        e["area_sqft"] += float(r.get("super_builtup_sqft") or 0)
        e["notional_value_paise"] += int(r.get("price_paise") or 0)
        e["flats"].append(r["flat_number"])
    return {"items": list(per.values()), "totals": {"units": len(lo), "area_sqft": sum(e["area_sqft"] for e in per.values()), "notional_value_paise": sum(e["notional_value_paise"] for e in per.values())}, "tie_out": {"landowner_flats": len(lo)}}


@router.get("/reports/hold-register")
async def report_holds(project_id: str | None = None, block_id: str | None = None, user: dict = Depends(require("reports.inventory_control.view"))):
    rows, bl = await _flats(user, project_id, block_id)
    now = now_iso()
    soon = (datetime.now(timezone.utc).replace(microsecond=0) + __import__("datetime").timedelta(hours=48)).isoformat()
    active = [{**r, "hold": r.get("hold") or {"expires_at": None, "legacy": True}} for r in rows if r["status"] == "Hold"]  # legacy holds (pre-Phase N, no expiry) are listed too
    hist = await db.audit_logs.find({"action": {"$in": ["flat.hold_expired", "flat.released", "flat.held"]}, "entity_type": "flat"}, {"_id": 0, "action": 1, "entity_id": 1, "created_at": 1, "actor_name": 1}).sort("created_at", -1).limit(500).to_list(500)
    held, released, expired = sum(1 for h in hist if h["action"] == "flat.held"), sum(1 for h in hist if h["action"] == "flat.released"), sum(1 for h in hist if h["action"] == "flat.hold_expired")
    booked_from_hold = await db.bookings.count_documents({"from_hold": True})
    users = {u["id"]: u.get("name") or u.get("full_name") for u in await db.users.find({"id": {"$in": list({(r["hold"] or {}).get("for_user_id") for r in active} - {None})}}, {"_id": 0, "id": 1, "name": 1, "full_name": 1}).to_list(None)}
    custs = {c["id"]: c.get("full_name") for c in await db.customers.find({"id": {"$in": list({(r["hold"] or {}).get("for_customer_id") for r in active} - {None})}}, {"_id": 0, "id": 1, "full_name": 1}).to_list(None)}
    items = [{"flat_id": r["id"], "flat_number": r["flat_number"], "tower": bl.get(r["block_id"], {}).get("name"), "expires_at": r["hold"]["expires_at"], "state": "legacy (no expiry)" if not r["hold"]["expires_at"] else "expiring" if r["hold"]["expires_at"] <= soon else "active",
              "hours_left": round((datetime.fromisoformat(r["hold"]["expires_at"]) - datetime.now(timezone.utc)).total_seconds() / 3600, 1) if r["hold"]["expires_at"] else None,
              "rm": users.get(r["hold"].get("for_user_id")), "rm_user_id": r["hold"].get("for_user_id"), "customer": custs.get(r["hold"].get("for_customer_id")), "reason_id": r["hold"].get("reason_id"), "note": r["hold"].get("note")} for r in sorted(active, key=lambda r: r["hold"]["expires_at"] or "")]
    return {"items": items, "history": hist[:50], "totals": {"active": len(items), "expiring_48h": sum(1 for i in items if i["state"] == "expiring"), "expired_released": expired, "released_manually": released, "held_total": held,
            "conversion_rate_pct": round(100 * booked_from_hold / held, 1) if held else None}, "as_of": now, "tie_out": {"flats_on_hold": sum(1 for r in rows if r["status"] == "Hold")}}


@router.get("/reports/masked")
async def report_masked(project_id: str | None = None, block_id: str | None = None, user: dict = Depends(require("inventory.real_status.view"))):
    rows, bl = await _flats(user, project_id, block_id)
    masked = [r for r in rows if r.get("display_override") and inv.effective_display(r) != inv.MIRROR.get(r["status"])]
    return {"items": [{"flat_id": r["id"], "flat_number": r["flat_number"], "tower": bl.get(r["block_id"], {}).get("name"), "real": r["status"], "displayed": r["display_state"], "reason": r.get("display_reason"), "since": r.get("display_set_at")} for r in masked],
            "totals": {"masked": len(masked), "shown_as_sold": sum(1 for r in masked if r["display_state"] == "Show as Sold"), "hidden": sum(1 for r in masked if r["display_state"] == "Hidden")}, "tie_out": {"overrides": sum(1 for r in rows if r.get("display_override"))}}
