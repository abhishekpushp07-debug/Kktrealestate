from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import Field

from db import db
from deps import ensure_project_access, project_scope_filter, require, require_any
from models_out import FlatsOut, FlatsOutPage
from services import inventory as inv
from services.flat_generation import resnapshot_flat
from utils import (
    ApiError,
    ListParams,
    StrictModel,
    apply_update,
    client_ip,
    expected_version,
    get_or_404,
    now_iso,
    paginate,
    search_filter,
    with_price,
    write_audit,
)

router = APIRouter(prefix="/flats", tags=["flats"])

MANUAL_STATUSES = {"Available", "Hold", "Blocked"}


class FlatUpdate(StrictModel):
    flat_number: str | None = Field(default=None, min_length=1, max_length=20)
    flat_type_id: str | None = None
    facing: Literal["N", "S", "E", "W", "NE", "NW", "SE", "SW"] | None = None
    rate_per_sqft: float | None = Field(default=None, ge=0)
    price: float | None = Field(default=None, ge=0)
    notes: str | None = None
    version: int | None = None


class FlatStatusIn(StrictModel):
    status: Literal["Available", "Hold", "Blocked", "Booked", "Sold"]
    reason: str | None = None
    version: int | None = None

async def _enrich(items: list[dict]):
    bids = list({f["block_id"] for f in items})
    pids = list({f["project_id"] for f in items})
    bmap = {b["id"]: b for b in await db.blocks.find({"id": {"$in": bids}}, {"_id": 0, "id": 1, "name": 1, "code": 1}).to_list(None)}
    pmap = {p["id"]: p for p in await db.projects.find({"id": {"$in": pids}}, {"_id": 0, "id": 1, "name": 1, "code": 1}).to_list(None)}
    for f in items:
        f["block_name"] = bmap.get(f["block_id"], {}).get("name")
        f["block_code"] = bmap.get(f["block_id"], {}).get("code")
        f["project_name"] = pmap.get(f["project_id"], {}).get("name")
        f["project_code"] = pmap.get(f["project_id"], {}).get("code")
    return [with_price(i) for i in items]


@router.get("", response_model=FlatsOutPage, response_model_exclude_unset=True)
async def list_flats(
    params: ListParams = Depends(), project_id: str | None = None, block_id: str | None = None,
    floor: int | None = None, status: str | None = None, flat_type_id: str | None = None, bookable_for: str | None = None, category: str | None = None, display: str | None = None, hold_expiring: bool | None = None,
    user: dict = Depends(require("masters.project.view")),
):
    q = {"company_id": user["company_id"], **project_scope_filter(user), **search_filter(params.search, ["flat_number", "flat_type_code"])}
    if project_id:
        ensure_project_access(user, project_id)
        q["project_id"] = project_id
    if block_id:
        q["block_id"] = block_id
    if floor is not None:
        q["floor"] = floor
    if status:
        wanted = status.split(",")
        if inv.can_see_real(user):
            q["status"] = {"$in": wanted}
        else:  # display layer: a masked Available flat must not surface under status=Available (and vice-versa)
            disp = [d for d, s in inv.DISPLAY_TO_STATUS.items() if s in wanted]
            q["$or"] = [{"display_override": True, "display_state": {"$in": disp}}, {"display_override": {"$ne": True}, "status": {"$in": [k for k, v in inv.MIRROR.items() if v in disp]}}]
    if bookable_for is not None:  # booking wizard: saleable + (Available or Hold for this customer / RM), never masked-as-sold/hidden
        q.update(inv.bookable_filter(bookable_for or None, user))
    if category:
        q["allocation_category_code"] = {"$in": category.split(",")}
    if display and inv.can_see_real(user):
        q["$or"] = [{"display_override": True, "display_state": {"$in": display.split(",")}}] + ([{"display_override": {"$ne": True}, "status": {"$in": [k for k, v in inv.MIRROR.items() if v in display.split(",")]}}])
    if hold_expiring:
        q["status"] = "Hold"
        q["hold.expires_at"] = {"$lte": (__import__("datetime").datetime.now(__import__("datetime").timezone.utc) + __import__("datetime").timedelta(hours=48)).isoformat()}
    if flat_type_id:
        q["flat_type_id"] = flat_type_id
    if not params.include_inactive:
        q["is_active"] = True
    sort = params.sort_spec(["flat_number", "floor", "status", "price_paise", "super_builtup_sqft", "created_at"], "floor")
    if params.sort in ("name", "floor"):
        sort = [("block_id", 1), ("floor", 1), ("position", 1)]
    res = await paginate(db.flats, q, params, sort, {"rooms_snapshot": 0, "areas_snapshot": 0})
    if res.pop("_csv", False):
        from fastapi import Response

        from utils import to_csv
        await _enrich(res["items"])
        res["items"] = inv.shape_list(res["items"], user)
        return Response(to_csv([with_price(i) for i in res["items"]], ["flat_number", "project_code", "block_code", "floor", "position", "flat_type_code", "facing", "status", "carpet_sqft", "builtup_sqft", "super_builtup_sqft", "rate_per_sqft", "price"]), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=flats.csv"})
    res["items"] = await _enrich(res["items"])
    res["items"] = inv.shape_list([with_price(i) for i in res["items"]], user)
    return res


async def _load_flat(flat_id: str, user: dict) -> dict:
    flat = await get_or_404(db.flats, flat_id, "Flat", {"company_id": user["company_id"]})
    ensure_project_access(user, flat["project_id"])
    shaped = inv.shape(flat, user)
    if shaped is None:
        raise ApiError(404, "Flat not found", "NOT_FOUND")
    return with_price(shaped)


@router.get("/{flat_id}", response_model=FlatsOut, response_model_exclude_unset=True)
async def get_flat(flat_id: str, user: dict = Depends(require("masters.project.view"))):
    flat = await _load_flat(flat_id, user)
    flat = (await _enrich([flat]))[0]
    ft = await db.flat_types.find_one({"id": flat["flat_type_id"]}, {"_id": 0, "id": 1, "name": 1, "code": 1, "bhk": 1})
    flat["flat_type"] = ft
    if flat.get("flat_type_id"):
        ftd = await db.flat_types.find_one({"id": flat["flat_type_id"]}, {"_id": 0, "spec_item_ids": 1})
        specs = await db.spec_items.find({"id": {"$in": (ftd or {}).get("spec_item_ids") or []}}, {"_id": 0, "id": 1, "name": 1, "brand": 1, "spec_category_id": 1}).to_list(None)
        cats = {c["id"]: c["name"] for c in await db.spec_categories.find({"id": {"$in": [s["spec_category_id"] for s in specs]}}, {"_id": 0, "id": 1, "name": 1}).to_list(None)}
        flat["specifications"] = [{**s, "category": cats.get(s["spec_category_id"])} for s in specs]
    if flat.get("rate_card_id"):
        flat["rate_card"] = await db.rate_cards.find_one({"id": flat["rate_card_id"]}, {"_id": 0, "id": 1, "name": 1, "status": 1})
    return with_price(flat)


@router.patch("/{flat_id}")
async def update_flat(flat_id: str, body: FlatUpdate, request: Request, user: dict = Depends(require("masters.flat.edit"))):
    before = await _load_flat(flat_id, user)
    changes = body.model_dump(exclude_unset=True)
    changes.pop("version", None)
    if not changes:
        raise ApiError(400, "No changes supplied", "NO_CHANGES")
    if "flat_number" in changes:
        changes["flat_number"] = changes["flat_number"].strip()
        if changes["flat_number"] != before["flat_number"] and await db.flats.find_one({"block_id": before["block_id"], "flat_number": changes["flat_number"], "id": {"$ne": flat_id}}, {"_id": 0, "id": 1}):
            raise ApiError(409, f"Duplicate: flat number {changes['flat_number']} already exists in this tower", "DUPLICATE_FLAT")
    if "flat_type_id" in changes and changes["flat_type_id"] != before["flat_type_id"]:
        if before["status"] != "Available":
            raise ApiError(409, "Flat type can only be changed while the flat is Available", "NOT_AVAILABLE")
        block = await db.blocks.find_one({"id": before["block_id"]}, {"_id": 0})
        changes.update(await resnapshot_flat(before, changes["flat_type_id"], block))
    if "rate_per_sqft" in changes and changes["rate_per_sqft"] is not None and "price" not in changes:
        changes["price_paise"] = round(changes["rate_per_sqft"] * (before.get("super_builtup_sqft") or 0) * 100)
        changes["price_breakup"] = [{"label": f"Rate ₹{changes['rate_per_sqft']:g}/sq.ft × {before.get('super_builtup_sqft') or 0:g}", "amount": changes["price_paise"] / 100}]
    elif "price" in changes and changes["price"] is not None:
        changes["price_paise"] = round(changes["price"] * 100)
        rc_breakup = before.get("rate_card_breakup") or (before.get("price_breakup") if before.get("price_source", "rate_card") == "rate_card" and not any(b.get("label") == "Manual price" for b in before.get("price_breakup") or []) else None)
        formula_paise = round((before.get("rate_per_sqft") or 0) * (before.get("super_builtup_sqft") or 0) * 100)
        if rc_breakup is None and formula_paise:  # legacy manual rows kept no breakup: the rate-card formula is the source of truth
            rc_breakup, rc_price = [{"label": f"Base ₹{before.get('rate_per_sqft'):g}/sq.ft × {before.get('super_builtup_sqft'):g}", "amount": formula_paise / 100}], formula_paise
        else:
            rc_price = before.get("rate_card_price_paise") if before.get("rate_card_price_paise") is not None else (before.get("price_paise") if before.get("price_source", "rate_card") == "rate_card" else None)
        if rc_breakup is not None and rc_price is not None and changes["price_paise"] == rc_price:
            # reverting to the exact rate-card value restores the original breakup
            changes.update({"price_breakup": rc_breakup, "price_source": "rate_card", "rate_card_breakup": None, "rate_card_price_paise": None})
        else:
            changes.update({"price_breakup": [{"label": "Manual price", "amount": changes["price"]}], "price_source": "manual"})
            if rc_breakup is not None and before.get("rate_card_breakup") is None:  # first override: retain the rate-card breakup
                changes.update({"rate_card_breakup": rc_breakup, "rate_card_price_paise": rc_price})
    changes.pop("price", None)
    after = await apply_update(db.flats, before, changes, expected_version(request, body.version), "Flat")
    await write_audit(user, "flat.update", "flat", flat_id, before=before, after=after, ip=client_ip(request))
    return with_price((await _enrich([after]))[0])


@router.patch("/{flat_id}/status")
async def change_status(flat_id: str, body: FlatStatusIn, request: Request, user: dict = Depends(require_any("sales.hold.create", "sales.hold.release"))):
    before = await _load_flat(flat_id, user)
    if body.status not in MANUAL_STATUSES:
        raise ApiError(409, f"Status {body.status} is set by the booking engine and cannot be set manually", "STATUS_NOT_MANUAL")
    if before["status"] not in MANUAL_STATUSES:
        raise ApiError(409, f"Flat is {before['status']}; status is controlled by the booking", "STATUS_LOCKED")
    if before["status"] == body.status:
        raise ApiError(409, f"Flat is already {body.status}", "NO_CHANGE")
    await db.flats.update_one({"id": flat_id}, {"$set": {"status": body.status, "status_reason": body.reason, "status_changed_at": now_iso(), "status_changed_by": user["id"], "updated_at": now_iso()}, "$inc": {"version": 1}})
    from services.counters import apply_status_delta
    await apply_status_delta(before["block_id"], before["project_id"], before["status"], body.status)
    after = await db.flats.find_one({"id": flat_id}, {"_id": 0})
    await write_audit(user, "flat.status", "flat", flat_id,
                      before={"id": flat_id, "flat_number": before["flat_number"], "status": before["status"]},
                      after={"id": flat_id, "flat_number": after["flat_number"], "status": after["status"], "reason": body.reason},
                      ip=client_ip(request))
    return with_price((await _enrich([after]))[0])
