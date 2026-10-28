from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import Field, field_validator, model_validator
from pymongo import UpdateOne

from db import db
from deps import ensure_project_access, project_scope_filter, require, require_any
from models_out import BlocksOut, BlocksOutPage
from routers.projects import STATUSES
from services.flat_generation import floor_labels, generate_flats, unit_floors
from utils import (
    ApiError,
    ListParams,
    StrictModel,
    apply_update,
    base_doc,
    client_ip,
    expected_version,
    get_or_404,
    now_iso,
    paginate,
    search_filter,
    with_price,
    write_audit,
)

router = APIRouter(prefix="/blocks", tags=["blocks"])

Pattern = Literal["{block}-{floor}{pos2}", "{floor}{pos2}", "{block}{seq}"]
BlockStatus = Literal["Planning", "Under Construction", "Ready", "Completed"]
Facing = Literal["N", "S", "E", "W", "NE", "NW", "SE", "SW"]


class PositionFlatType(StrictModel):
    position: int = Field(ge=1)
    flat_type_id: str
    facing: Facing | None = None
    is_corner: bool = False


class FloorPlanRange(StrictModel):
    from_floor: int = Field(ge=0)
    to_floor: int = Field(ge=0)
    floor_plan_template_id: str | None = None
    positions: list[PositionFlatType] | None = None

    @model_validator(mode="after")
    def _check(self):
        if self.to_floor < self.from_floor:
            raise ValueError("to_floor must be >= from_floor")
        if not self.floor_plan_template_id and not self.positions:
            raise ValueError("Provide floor_plan_template_id or inline positions")
        return self


class BlockCreate(StrictModel):
    project_id: str
    block_type_id: str
    name: str = Field(min_length=1, max_length=80)
    code: str = Field(min_length=1, max_length=10)
    floors: int = Field(ge=1, le=200)
    flats_per_floor: int | None = Field(default=None, ge=1, le=50)
    floor_start: int = Field(default=1, ge=0)
    ground_floor_label: str | None = Field(default=None, max_length=5)
    skip_floors: list[int] = []
    refuge_floors: list[int] = []
    podium_floors: list[int] = []
    numbering_pattern: Pattern = "{block}-{floor}{pos2}"
    position_flat_types: list[PositionFlatType] | None = None
    floor_plans: list[FloorPlanRange] | None = None
    milestone_template_id: str | None = None
    rate_per_sqft: float | None = Field(default=None, ge=0)
    default_cash_percent: float | None = Field(default=None, ge=0, le=100)
    floor_rise_per_sqft: float | None = Field(default=None, ge=0)
    status: BlockStatus = "Planning"

    @field_validator("name")
    @classmethod
    def _trim_name(cls, v):
        v = (v or "").strip()
        if not v:
            raise ValueError("name is required")
        return v

    @field_validator("code")
    @classmethod
    def _code(cls, v):
        return v.upper()

    @model_validator(mode="after")
    def _plans(self):
        if not self.position_flat_types and not self.floor_plans:
            raise ValueError("Provide position_flat_types or floor_plans")
        return self


class BlockUpdate(StrictModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)

    @field_validator("name")
    @classmethod
    def _trim_name(cls, v):
        return v.strip() if isinstance(v, str) and v.strip() else v
    block_type_id: str | None = None
    milestone_template_id: str | None = None
    rate_per_sqft: float | None = Field(default=None, ge=0)
    default_cash_percent: float | None = Field(default=None, ge=0, le=100)
    floor_rise_per_sqft: float | None = Field(default=None, ge=0)
    status: BlockStatus | None = None
    floor_plans: list[FloorPlanRange] | None = None
    refuge_floors: list[int] | None = None
    podium_floors: list[int] | None = None
    is_active: bool | None = None
    version: int | None = None


class AddFloorsIn(StrictModel):
    count: int = Field(ge=1, le=50)
    floor_plan_template_id: str | None = None
    flats_per_floor: int | None = Field(default=None, ge=1, le=50)  # X.3: inline positions (N flats of one type per floor)
    flat_type_id: str | None = None


class BulkPriceIn(StrictModel):
    rate_per_sqft: float | None = Field(default=None, ge=0)
    price: float | None = Field(default=None, ge=0)
    floor_rise_per_sqft: float | None = Field(default=None, ge=0)
    floors: list[int] | None = None
    only_available: bool = True
    include_non_saleable: bool = False
    preview: bool = False


class BulkStatusIn(StrictModel):
    flat_ids: list[str] = Field(min_length=1, max_length=500)
    status: Literal["Available", "Hold", "Blocked"]
    reason: str | None = None


def _normalize_plans(data: dict) -> list[dict]:
    plans = data.get("floor_plans")
    if not plans:
        pfts = data["position_flat_types"]
        positions = sorted(p["position"] for p in pfts)
        if positions != list(range(1, len(positions) + 1)):
            raise ApiError(422, "position_flat_types must cover positions 1..N exactly once", "INVALID_POSITIONS")
        labels = floor_labels(data)
        plans = [{"from_floor": labels[0], "to_floor": labels[-1], "floor_plan_template_id": None, "positions": pfts}]
    for p in plans:
        if p.get("positions"):
            pos = sorted(x["position"] for x in p["positions"])
            if pos != list(range(1, len(pos) + 1)):
                raise ApiError(422, "Inline positions must be 1..N exactly once", "INVALID_POSITIONS")
    for f in unit_floors(data):
        if not any(p["from_floor"] <= f <= p["to_floor"] for p in plans):
            raise ApiError(422, f"No floor plan range covers floor {f}", "FLOOR_PLAN_GAP")
    return plans


async def _validate_block_refs(block_type_id: str | None, mt_id: str | None):
    if block_type_id and not await db.block_types.find_one({"id": block_type_id, "is_active": True}):
        raise ApiError(400, "Block type not found", "INVALID_BLOCK_TYPE")
    if mt_id and not await db.milestone_templates.find_one({"id": mt_id, "is_active": True}):
        raise ApiError(400, "Milestone template not found", "INVALID_MILESTONE_TEMPLATE")


async def _attach_counts(blocks: list[dict], user: dict | None = None):
    from services import inventory as _inv
    from services.counters import present_counts
    await _inv.display_unit_counts(blocks, "block_id", user)
    pids = list({b["project_id"] for b in blocks})
    pmap = {p["id"]: p for p in await db.projects.find({"id": {"$in": pids}}, {"_id": 0, "id": 1, "name": 1, "code": 1}).to_list(None)}
    btids = list({b["block_type_id"] for b in blocks})
    btmap = {t["id"]: t["name"] for t in await db.block_types.find({"id": {"$in": btids}}, {"_id": 0, "id": 1, "name": 1}).to_list(None)}
    for b in blocks:
        present_counts(b)
        p = pmap.get(b["project_id"], {})
        b["project_name"], b["project_code"] = p.get("name"), p.get("code")
        b["block_type_name"] = btmap.get(b["block_type_id"])
    return blocks


async def _load_block(block_id: str, user: dict) -> dict:
    block = await get_or_404(db.blocks, block_id, "Block", {"company_id": user["company_id"]})
    ensure_project_access(user, block["project_id"])
    return block


@router.get("", response_model=BlocksOutPage, response_model_exclude_unset=True)
async def list_blocks(params: ListParams = Depends(), project_id: str | None = None, user: dict = Depends(require("masters.project.view"))):
    q = {"company_id": user["company_id"], **project_scope_filter(user), **search_filter(params.search, ["name", "code"])}
    if project_id:
        ensure_project_access(user, project_id)
        q["project_id"] = project_id
    if not params.include_inactive:
        q["is_active"] = True
    res = await paginate(db.blocks, q, params, params.sort_spec(["name", "code", "status", "created_at"]), {"floor_plans": 0, "position_flat_types": 0})
    res["items"] = await _attach_counts(res["items"], user)
    return res


@router.post("", status_code=201)
async def create_block(body: BlockCreate, request: Request, user: dict = Depends(require("masters.tower.create"))):
    ensure_project_access(user, body.project_id)
    project = await get_or_404(db.projects, body.project_id, "Project", {"company_id": user["company_id"], "is_active": True})
    if await db.blocks.find_one({"project_id": body.project_id, "code": body.code}):
        raise ApiError(409, f"Block code {body.code} already exists in this project", "DUPLICATE_CODE")
    bt = await db.block_types.find_one({"id": body.block_type_id, "is_active": True}, {"_id": 0})
    if not bt:
        raise ApiError(400, "Block type not found", "INVALID_BLOCK_TYPE")
    await _validate_block_refs(None, body.milestone_template_id)
    data = body.model_dump()
    if not bt["has_floors"]:
        data["floors"], data["skip_floors"], data["refuge_floors"], data["podium_floors"] = 1, [], [], []
    data["floor_plans"] = _normalize_plans(data)
    fpf = max(len(p["positions"]) if p.get("positions") else 0 for p in data["floor_plans"])
    if not fpf:
        tm = await db.floor_plan_templates.find({"id": {"$in": [p["floor_plan_template_id"] for p in data["floor_plans"]]}}, {"_id": 0, "flats_per_floor": 1}).to_list(None)
        fpf = max([t["flats_per_floor"] for t in tm] or [0])
    data["flats_per_floor"] = fpf
    data["position_flat_types"] = data.get("position_flat_types") or []
    data["milestone_template_id"] = data["milestone_template_id"] or project.get("milestone_template_id")
    doc = {**base_doc(user, user["company_id"]), **data, "construction_percent": 0}
    await db.blocks.insert_one(doc)
    doc.pop("_id", None)
    try:
        flats = await generate_flats(doc, None, user)
    except Exception:
        await db.blocks.delete_one({"id": doc["id"]})
        raise
    await write_audit(user, "block.create", "block", doc["id"], after={**doc, "flats_generated": len(flats)}, ip=client_ip(request))
    doc["flats_generated"] = len(flats)
    return (await _attach_counts([doc], user))[0]


@router.get("/{block_id}", response_model=BlocksOut, response_model_exclude_unset=True)
async def get_block(block_id: str, user: dict = Depends(require("masters.project.view"))):
    block = await _load_block(block_id, user)
    block = (await _attach_counts([block], user))[0]
    tids = [p["floor_plan_template_id"] for p in block.get("floor_plans") or [] if p.get("floor_plan_template_id")]
    tmap = {t["id"]: t for t in await db.floor_plan_templates.find({"id": {"$in": tids}}, {"_id": 0}).to_list(None)}
    ftids = {x["flat_type_id"] for p in block.get("floor_plans") or [] for x in (p.get("positions") or tmap.get(p.get("floor_plan_template_id"), {}).get("positions", []))}
    fts = {f["id"]: f for f in await db.flat_types.find({"id": {"$in": list(ftids)}}, {"_id": 0, "id": 1, "name": 1, "code": 1, "bhk": 1}).to_list(None)}
    for p in block.get("floor_plans") or []:
        t = tmap.get(p.get("floor_plan_template_id"))
        p["template_name"] = t["name"] if t else None
        p["resolved_positions"] = [{**x, "flat_type": fts.get(x["flat_type_id"])} for x in (p.get("positions") or (t or {}).get("positions", []))]
    block["position_flat_types"] = [{**x, "flat_type": fts.get(x["flat_type_id"])} for x in (block.get("floor_plans") or [{}])[0].get("resolved_positions", [])]
    block["floor_labels"] = floor_labels(block)
    block["unit_floors"] = unit_floors(block)
    if block.get("milestone_template_id"):
        block["milestone_template"] = await db.milestone_templates.find_one({"id": block["milestone_template_id"]}, {"_id": 0})
    return block


@router.patch("/{block_id}")
async def update_block(block_id: str, body: BlockUpdate, request: Request, user: dict = Depends(require("masters.tower.edit"))):
    before = await _load_block(block_id, user)
    changes = body.model_dump(exclude_unset=True)
    changes.pop("version", None)
    if not changes:
        raise ApiError(400, "No changes supplied", "NO_CHANGES")
    await _validate_block_refs(changes.get("block_type_id"), changes.get("milestone_template_id"))
    if any(k in changes for k in ("floor_plans", "refuge_floors", "podium_floors")):
        n = await db.flats.count_documents({"block_id": block_id, "status": {"$ne": "Available"}})
        if n:
            raise ApiError(409, f"Cannot change floor plans: {n} flat(s) are not Available", "FLATS_NOT_AVAILABLE")
        merged = {**before, **changes}
        changes["floor_plans"] = _normalize_plans(merged)
    if changes.get("is_active") is False:
        n = await db.flats.count_documents({"block_id": block_id, "status": {"$ne": "Available"}})
        if n:
            raise ApiError(409, f"Cannot deactivate: block has {n} flat(s) not Available", "IN_USE")
        changes["deleted_at"] = now_iso()
    if changes.get("is_active") is True:
        changes["deleted_at"] = None
    after = await apply_update(db.blocks, before, changes, expected_version(request, body.version), "Block")
    if "floor_plans" in changes:
        await db.flats.delete_many({"block_id": block_id})
        flats = await generate_flats(after, None, user)
        after["flats_generated"] = len(flats)
    await write_audit(user, "block.update", "block", block_id, before=before, after=after, ip=client_ip(request))
    return (await _attach_counts([after], user))[0]


@router.post("/{block_id}/generate-flats")
async def regenerate_flats(block_id: str, request: Request, user: dict = Depends(require("masters.flat.create"))):
    block = await _load_block(block_id, user)
    non_avail = await db.flats.count_documents({"block_id": block_id, "status": {"$ne": "Available"}})
    if non_avail:
        raise ApiError(409, f"Cannot regenerate: {non_avail} flat(s) are not Available", "FLATS_NOT_AVAILABLE")
    deleted = await db.flats.delete_many({"block_id": block_id})
    flats = await generate_flats(block, None, user)
    await write_audit(user, "block.generate_flats", "block", block_id, before={"flats": deleted.deleted_count}, after={"flats": len(flats)}, ip=client_ip(request))
    return {"generated": len(flats), "removed": deleted.deleted_count}


@router.post("/{block_id}/floors")
async def add_floors(block_id: str, body: AddFloorsIn, request: Request, user: dict = Depends(require("masters.tower.edit"))):
    block = await _load_block(block_id, user)
    from routers.structure import _extended
    new_block, new_labels = _extended(block, body)
    plans = new_block["floor_plans"]
    flats = await generate_flats(new_block, new_labels, user)
    await db.blocks.update_one({"id": block_id}, {"$set": {"floors": new_block["floors"], "floor_plans": plans, "updated_at": now_iso()}, "$inc": {"version": 1}})
    await write_audit(user, "block.add_floors", "block", block_id, before={"floors": block["floors"]}, after={"floors": new_block["floors"], "flats_added": len(flats)}, ip=client_ip(request))
    return {"floors": new_block["floors"], "flats_added": len(flats)}


@router.post("/{block_id}/bulk-price")
async def bulk_price(block_id: str, body: BulkPriceIn, request: Request, user: dict = Depends(require("masters.flat.edit"))):
    block = await _load_block(block_id, user)
    if body.rate_per_sqft is None and body.price is None:
        raise ApiError(422, "Provide rate_per_sqft or price", "VALIDATION_ERROR")
    q = {"block_id": block_id, "is_active": True, "status": {"$in": ["Available"] if body.only_available else ["Available", "Hold", "Blocked"]}}
    if body.floors:
        q["floor"] = {"$in": body.floors}
    if body.preview:
        n_all = await db.flats.count_documents(q)
        n_sale = await db.flats.count_documents({**q, "bookable": {"$ne": False}})
        return {"preview": True, "saleable": n_sale, "non_saleable": n_all - n_sale, "will_update": n_all if body.include_non_saleable else n_sale}
    if not body.include_non_saleable:  # Phase N: landowner / investor / bank / reserve / sample / society keep their price unless explicitly included
        q["bookable"] = {"$ne": False}
    flats = await db.flats.find(q, {"_id": 0, "id": 1, "floor": 1, "super_builtup_sqft": 1}).to_list(None)
    ops, rise = [], body.floor_rise_per_sqft or 0
    for f in flats:
        if body.price is not None:
            upd = {"price_paise": int(round(body.price * 100)), "rate_per_sqft": None, "price_breakup": [{"label": "Bulk price (lump sum)", "amount": round(body.price, 2)}]}
        else:
            sbu = f.get("super_builtup_sqft") or 0
            rf = max(0, f["floor"] - block["floor_start"])
            breakup = [{"label": f"Base ₹{body.rate_per_sqft:g}/sq.ft × {sbu:g}", "amount": round(body.rate_per_sqft * sbu, 2)}]
            if rise and rf:
                breakup.append({"label": f"Floor rise ₹{rise:g} × {rf} floors × {sbu:g}", "amount": round(rise * rf * sbu, 2)})
            upd = {"rate_per_sqft": round(body.rate_per_sqft + rise * rf, 2), "price_paise": int(round(100 * sum(b["amount"] for b in breakup))), "price_breakup": breakup}
        upd.update({"updated_at": now_iso(), "rate_card_id": None})
        ops.append(UpdateOne({"id": f["id"]}, {"$set": upd, "$inc": {"version": 1}}))
    if ops:
        await db.flats.bulk_write(ops)
    if body.rate_per_sqft is not None and not body.floors:
        await db.blocks.update_one({"id": block_id}, {"$set": {"rate_per_sqft": body.rate_per_sqft, "floor_rise_per_sqft": body.floor_rise_per_sqft, "updated_at": now_iso()}})
    await write_audit(user, "block.bulk_price", "block", block_id, after={**body.model_dump(), "flats_updated": len(ops)}, ip=client_ip(request))
    return {"flats_updated": len(ops)}


@router.post("/{block_id}/bulk-status")
async def bulk_status(block_id: str, body: BulkStatusIn, request: Request, user: dict = Depends(require_any("sales.hold.create", "sales.hold.release"))):
    await _load_block(block_id, user)
    flats = await db.flats.find({"block_id": block_id, "id": {"$in": body.flat_ids}, "status": {"$in": ["Available", "Hold", "Blocked"], "$ne": body.status}}, {"_id": 0, "id": 1, "flat_number": 1, "status": 1}).to_list(None)
    if not flats:
        return {"flats_updated": 0, "skipped": len(body.flat_ids)}
    await db.flats.update_many({"id": {"$in": [f["id"] for f in flats]}}, {"$set": {"status": body.status, "status_reason": body.reason, "status_changed_at": now_iso(), "status_changed_by": user["id"], "updated_at": now_iso()}, "$inc": {"version": 1}})
    from services.counters import refresh_counts
    await refresh_counts(block_id)
    for f in flats:
        await write_audit(user, "flat.status", "flat", f["id"], before={"id": f["id"], "flat_number": f["flat_number"], "status": f["status"]}, after={"id": f["id"], "flat_number": f["flat_number"], "status": body.status, "reason": body.reason}, ip=client_ip(request))
    return {"flats_updated": len(flats), "skipped": len(body.flat_ids) - len(flats)}


@router.get("/{block_id}/grid")
async def block_grid(block_id: str, bookable_for: str | None = None, user: dict = Depends(require("masters.project.view"))):
    block = await _load_block(block_id, user)
    from services import inventory as _inv
    _q = {"block_id": block_id, "is_active": True}
    if bookable_for is not None:  # booking wizard: server-side saleability filter (saleable + Available / held for this customer or RM)
        _q.update(_inv.bookable_filter(bookable_for or None, user))
    flats = await db.flats.find(_q, {"_id": 0, "id": 1, "flat_number": 1, "floor": 1, "floor_label": 1, "position": 1, "status": 1, "price_paise": 1, "flat_type_code": 1, "flat_type_id": 1, "super_builtup_sqft": 1, "facing": 1, "is_corner": 1, "version": 1, "display_state": 1, "display_override": 1, "allocation_category_code": 1, "bookable": 1, "hold": 1, "block": 1}).sort([("floor", -1), ("position", 1)]).to_list(None)
    from services import inventory as inv
    flats = inv.shape_list(flats, user)  # Phase N: display layer for non-privileged viewers (server-side)
    by_floor: dict[int, list] = {}
    for f in flats:
        with_price(f)
        by_floor.setdefault(f["floor"], []).append(f)
    counts = {s: 0 for s in STATUSES}
    for f in flats:
        counts[f["status"]] = counts.get(f["status"], 0) + 1
    refuge, podium = set(block.get("refuge_floors") or []), set(block.get("podium_floors") or [])
    labels = floor_labels(block)
    prices = [f["price_paise"] / 100 for f in flats if f.get("price_paise")]
    return {
        "block": {k: block.get(k) for k in ("id", "name", "code", "project_id", "floors", "flats_per_floor", "floor_start", "numbering_pattern", "status", "construction_percent", "skip_floors", "refuge_floors", "podium_floors", "ground_floor_label")},
        "positions": list(range(1, max([block.get("flats_per_floor") or 0] + [len(v) for v in by_floor.values()]) + 1)),
        "floors": [{"floor": fl, "label": block.get("ground_floor_label") if fl == 0 and block.get("ground_floor_label") else str(fl),
                    "kind": "refuge" if fl in refuge else "podium" if fl in podium else "units", "flats": by_floor.get(fl, [])} for fl in sorted(labels, reverse=True)],
        "counts": {**counts, "total": len(flats)},
        "price_range": {"min": min(prices) if prices else None, "max": max(prices) if prices else None},
        "privileged": inv.can_see_real(user),
    }
