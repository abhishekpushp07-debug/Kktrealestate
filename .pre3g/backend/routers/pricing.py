"""Phase PS — per-flat pricing sheet, bulk edit, apply-type-defaults, floor-by-floor designer, tower structure edits, project pricing setup, parking attach."""

from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import Field

from db import db
from deps import ensure_project_access, require
from services import pricing as P
from services.counters import refresh_counts
from services.flat_generation import (
    build_flat,
    flat_number,
    floor_labels,
    load_flat_types,
    unit_floors,
)
from utils import (
    ApiError,
    StrictModel,
    apply_update,
    client_ip,
    expected_version,
    get_or_404,
    now_iso,
    with_price,
    write_audit,
)

router = APIRouter(tags=["pricing"])
Facing = Literal["N", "S", "E", "W", "NE", "NW", "SE", "SW"]


class MaintenanceIn(StrictModel):
    method: Literal["per_sqft_months", "fixed", "none"]
    rate_per_sqft: float | None = Field(default=None, ge=0)
    months: int | None = Field(default=None, ge=0, le=240)
    fixed_amount: float | None = Field(default=None, ge=0)


class FlatPricingIn(StrictModel):
    saleable_sqft: float | None = Field(default=None, gt=0)
    pricing_mode: Literal["rate", "lump_sum"] | None = None
    rate_per_sqft: float | None = Field(default=None, ge=0)
    price: float | None = Field(default=None, ge=0)
    flat_type_id: str | None = None
    facing: Facing | None = None
    maintenance: MaintenanceIn | None = None
    parking_slot_ids: list[str] | None = None
    notes: str | None = None
    version: int | None = None


class BulkEditIn(StrictModel):
    flat_ids: list[str] = Field(min_length=1, max_length=2000)
    saleable_sqft: float | None = Field(default=None, gt=0)
    rate_per_sqft: float | None = Field(default=None, ge=0)
    maintenance: MaintenanceIn | None = None
    apply_type_defaults: bool = False


class FloorPosition(StrictModel):
    position: int = Field(ge=1, le=50)
    flat_type_id: str
    flat_number: str | None = Field(default=None, max_length=20)
    facing: Facing | None = None


class FloorIn(StrictModel):
    positions: list[FloorPosition] = Field(min_length=1, max_length=50)
    apply_type_defaults: bool = False
    version: int | None = None


class CopyFloorIn(StrictModel):
    to_floors: list[int] = Field(min_length=1, max_length=200)
    apply_type_defaults: bool = False


class StructureIn(StrictModel):
    floors: int | None = Field(default=None, ge=1, le=200)
    floor_start: int | None = Field(default=None, ge=0)
    numbering_pattern: Literal["{block}-{floor}{pos2}", "{floor}{pos2}", "{block}{seq}"] | None = None
    refuge_floors: list[int] | None = None
    podium_floors: list[int] | None = None
    skip_floors: list[int] | None = None
    preview: bool = True
    version: int | None = None


class ChargeHeadSetup(StrictModel):
    charge_type_id: str
    enabled: bool = True
    value: float | None = Field(default=None, ge=0)
    gst_percent: float | None = Field(default=None, ge=0, le=100)
    timing: str | None = None


class PricingSetupIn(StrictModel):
    agreement_gst_percent: float = Field(ge=0, le=100)
    floor_rise_enabled: bool = False
    rounding: Literal["none", "nearest_100", "nearest_1000"] = "none"
    maintenance: MaintenanceIn
    charge_heads: list[ChargeHeadSetup] = []
    version: int | None = None


async def _flat(flat_id: str, user: dict) -> tuple[dict, dict, dict]:
    flat = await get_or_404(db.flats, flat_id, "Flat", {"company_id": user["company_id"]})
    ensure_project_access(user, flat["project_id"])
    block = await db.blocks.find_one({"id": flat["block_id"]}, {"_id": 0})
    project = await db.projects.find_one({"id": flat["project_id"]}, {"_id": 0, "pricing_setup": 1})
    return flat, block, P.setup_of(project)


async def _enrich(flat: dict, setup: dict) -> dict:
    flat["parking_slots"] = await db.parking_slots.find(
        {"flat_id": flat["id"], "is_active": True}, {"_id": 0, "id": 1, "number": 1, "type": 1, "level": 1, "price": 1}
    ).to_list(50)
    flat["maintenance_effective"] = {**setup["maintenance"], **(flat.get("maintenance") or {})}
    flat["maintenance_amount"] = P.maintenance_amount(flat, setup)
    flat["lock"] = P.lock_of(flat)
    return with_price(flat)


@router.get("/flats/{flat_id}/pricing")
async def get_pricing(flat_id: str, user: dict = Depends(require("masters.project.view"))):
    flat, block, setup = await _flat(flat_id, user)
    ft = await db.flat_types.find_one(
        {"id": flat["flat_type_id"]},
        {"_id": 0, "default_saleable_sqft": 1, "base_rate_per_sqft": 1, "areas_snapshot": 1},
    )
    flat["type_defaults"] = P.type_defaults(ft or {})
    flat["project_setup"] = setup
    return await _enrich(flat, setup)


async def _attach_slots(flat: dict, slot_ids: list[str], user: dict):
    slots = await db.parking_slots.find(
        {"id": {"$in": slot_ids}, "project_id": flat["project_id"], "is_active": True},
        {"_id": 0, "id": 1, "flat_id": 1, "status": 1, "number": 1},
    ).to_list(None)
    if len(slots) != len(set(slot_ids)):
        raise ApiError(422, "One or more parking slots are unknown or belong to another project", "VALIDATION_ERROR")
    for s in slots:
        if s.get("flat_id") not in (None, flat["id"]):
            raise ApiError(409, f"Slot {s['number']} is already attached to another flat", "SLOT_TAKEN")
        if s["status"] == "Allotted" and s.get("flat_id") != flat["id"]:
            raise ApiError(409, f"Slot {s['number']} is allotted by a booking", "STATUS_LOCKED")
    await db.parking_slots.update_many(
        {"flat_id": flat["id"], "id": {"$nin": slot_ids}, "status": {"$ne": "Allotted"}},
        {"$set": {"flat_id": None, "status": "Available", "updated_at": now_iso()}},
    )
    await db.parking_slots.update_many(
        {"id": {"$in": slot_ids}, "status": {"$ne": "Allotted"}},
        {"$set": {"flat_id": flat["id"], "status": "Attached", "updated_at": now_iso()}},
    )


@router.patch("/flats/{flat_id}/pricing")
async def update_pricing(
    flat_id: str, body: FlatPricingIn, request: Request, user: dict = Depends(require("masters.flat.edit"))
):
    before, block, setup = await _flat(flat_id, user)
    P.ensure_unlocked(before)
    ch = body.model_dump(exclude_unset=True)
    ch.pop("version", None)
    slot_ids = ch.pop("parking_slot_ids", None)
    if not ch and slot_ids is None:
        raise ApiError(400, "No changes supplied", "NO_CHANGES")
    if "flat_type_id" in ch and ch["flat_type_id"] != before["flat_type_id"]:
        ft = (await load_flat_types([ch["flat_type_id"]]))[ch["flat_type_id"]]
        ch.update(
            flat_type_code=ft["code"], rooms_snapshot=ft["rooms_snapshot"], areas_snapshot=ft["areas_snapshot"]
        )  # area/price deliberately untouched
        if before.get("saleable_sqft") or before.get("price_paise"):
            ch["pricing_review"] = "flat type changed — verify saleable area / rate"
    if "price" in ch:
        price = ch.pop("price")
        ch["price_paise"] = round(price * 100) if price is not None else None
        ch.setdefault("pricing_mode", "lump_sum")
    merged = {**before, **ch}
    ch.update(P.compute(merged, block, setup))
    if "pricing_review" in ch and ch["pricing_review"] and ch.get("pricing_status") == "ready":
        ch["pricing_status"] = "review"
    elif (
        any(k in ch for k in ("saleable_sqft", "rate_per_sqft", "price_paise"))
        and before.get("pricing_review")
        and "pricing_review" not in ch
    ):
        ch["pricing_review"] = None  # user confirmed values ("Keep values" / edit) → review cleared
    if slot_ids is not None:
        await _attach_slots(before, slot_ids, user)
    after = await apply_update(db.flats, before, ch, expected_version(request, body.version), "Flat") if ch else before
    await write_audit(
        user,
        "flat.pricing",
        "flat",
        flat_id,
        before={k: before.get(k) for k in ch} | ({"parking_slot_ids": "changed"} if slot_ids is not None else {}),
        after={k: after.get(k) for k in ch} | ({"parking_slot_ids": slot_ids} if slot_ids is not None else {}),
        ip=client_ip(request),
    )
    return await _enrich(after, setup)


@router.post("/flats/{flat_id}/apply-type-defaults")
async def apply_type_defaults(flat_id: str, request: Request, user: dict = Depends(require("masters.flat.edit"))):
    before, block, setup = await _flat(flat_id, user)
    P.ensure_unlocked(before)
    ft = (await load_flat_types([before["flat_type_id"]]))[before["flat_type_id"]]
    d = P.type_defaults(ft)
    if d["saleable_sqft"] is None and d["rate_per_sqft"] is None:
        raise ApiError(422, "This flat type has no default saleable area or rate", "NO_DEFAULTS")
    ch = {k: v for k, v in d.items() if v is not None} | {"pricing_mode": "rate", "pricing_review": None}
    ch.update(P.compute({**before, **ch}, block, setup))
    after = await apply_update(db.flats, before, ch, None, "Flat")
    await write_audit(
        user,
        "flat.apply_type_defaults",
        "flat",
        flat_id,
        before={k: before.get(k) for k in ch},
        after={k: after.get(k) for k in ch},
        ip=client_ip(request),
    )
    return await _enrich(after, setup)


@router.post("/flats/{flat_id}/keep-values")
async def keep_values(flat_id: str, request: Request, user: dict = Depends(require("masters.flat.edit"))):
    """Fix 2: user confirms the existing saleable area / rate after a type change → review cleared."""
    before, block, setup = await _flat(flat_id, user)
    P.ensure_unlocked(before)
    ch = {"pricing_review": None}
    ch.update(P.compute(before, block, setup))
    after = await apply_update(db.flats, before, ch, None, "Flat")
    await write_audit(
        user,
        "flat.pricing",
        "flat",
        flat_id,
        before={"pricing_review": before.get("pricing_review")},
        after={"pricing_review": None, "kept": True},
        ip=client_ip(request),
    )
    return await _enrich(after, setup)


@router.post("/flats/bulk-edit")
async def bulk_edit(body: BulkEditIn, request: Request, user: dict = Depends(require("masters.flat.edit"))):
    flats = await db.flats.find({"id": {"$in": body.flat_ids}, "company_id": user["company_id"]}, {"_id": 0}).to_list(
        None
    )
    if not flats:
        raise ApiError(404, "No flats found", "NOT_FOUND")
    for f in flats:
        ensure_project_access(user, f["project_id"])
    blocks = {
        b["id"]: b
        for b in await db.blocks.find({"id": {"$in": list({f["block_id"] for f in flats})}}, {"_id": 0}).to_list(None)
    }
    setups = {
        p["id"]: P.setup_of(p)
        for p in await db.projects.find(
            {"id": {"$in": list({f["project_id"] for f in flats})}}, {"_id": 0, "id": 1, "pricing_setup": 1}
        ).to_list(None)
    }
    fts = await load_flat_types([f["flat_type_id"] for f in flats]) if body.apply_type_defaults else {}
    updated, skipped = 0, []
    for f in flats:
        if P.lock_of(f):
            skipped.append({"id": f["id"], "flat_number": f["flat_number"], "status": f["status"]})
            continue
        ch = {}
        if body.apply_type_defaults:
            ch.update({k: v for k, v in P.type_defaults(fts[f["flat_type_id"]]).items() if v is not None})
        if body.saleable_sqft is not None:
            ch["saleable_sqft"] = body.saleable_sqft
        if body.rate_per_sqft is not None:
            ch["rate_per_sqft"] = body.rate_per_sqft
        if body.maintenance is not None:
            ch["maintenance"] = body.maintenance.model_dump()
        if "rate_per_sqft" in ch or "saleable_sqft" in ch:
            ch["pricing_mode"] = "rate"
        if not ch:
            continue
        ch.update(P.compute({**f, **ch}, blocks[f["block_id"]], setups[f["project_id"]]))
        await db.flats.update_one({"id": f["id"]}, {"$set": {**ch, "updated_at": now_iso()}, "$inc": {"version": 1}})
        updated += 1
    await write_audit(
        user,
        "flat.bulk_edit",
        "flats",
        ",".join(body.flat_ids[:20]),
        after={
            "updated": updated,
            "skipped_locked": len(skipped),
            "fields": [k for k in ("saleable_sqft", "rate_per_sqft", "maintenance") if getattr(body, k) is not None],
            "apply_type_defaults": body.apply_type_defaults,
        },
        ip=client_ip(request),
    )
    return {"updated": updated, "skipped_locked": skipped}


# ---------------- floor-by-floor designer ----------------
FLOOR_FIELDS = {
    "_id": 0,
    "id": 1,
    "floor": 1,
    "floor_label": 1,
    "position": 1,
    "flat_number": 1,
    "flat_type_id": 1,
    "flat_type_code": 1,
    "status": 1,
    "booking_id": 1,
    "booking_number": 1,
    "saleable_sqft": 1,
    "rate_per_sqft": 1,
    "price_paise": 1,
    "pricing_status": 1,
    "pricing_mode": 1,
    "facing": 1,
    "version": 1,
    "maintenance": 1,
}


async def _delete_unlocked(flats: list[dict]) -> list[str]:
    """CR-3: delete only flats still unbooked at write time (status guard in the predicate); returns the flat numbers that were NOT deleted
    (booked a moment earlier). Callers reconcile counts from actual deletes and report `kept_locked`."""
    ids = [f["id"] for f in flats]
    if not ids:
        return []
    await db.flats.delete_many({"id": {"$in": ids}, "status": {"$nin": sorted(P.LOCKED_STATUSES)}, "booking_id": None})
    survivors = await db.flats.find({"id": {"$in": ids}}, {"_id": 0, "flat_number": 1}).to_list(None)
    return [f["flat_number"] for f in survivors]


async def _block(block_id: str, user: dict) -> dict:
    b = await get_or_404(db.blocks, block_id, "Tower", {"company_id": user["company_id"]})
    ensure_project_access(user, b["project_id"])
    return b


def _floor_view(block: dict, flats: list[dict]) -> list[dict]:
    by = {}
    for f in flats:
        by.setdefault(f["floor"], []).append({**with_price(f), "locked": P.lock_of(f) is not None})
    return [
        {
            "floor": fl,
            "label": block.get("ground_floor_label") if fl == 0 and block.get("ground_floor_label") else str(fl),
            "flats": sorted(by.get(fl, []), key=lambda x: x.get("position") or 0),
            "locked_count": sum(1 for x in by.get(fl, []) if x["locked"]),
            "pending_pricing": sum(1 for x in by.get(fl, []) if x.get("pricing_status") != "ready"),
        }
        for fl in unit_floors(block)
    ]


@router.get("/blocks/{block_id}/floors")
async def list_floors(block_id: str, user: dict = Depends(require("masters.project.view"))):
    block = await _block(block_id, user)
    flats = await db.flats.find({"block_id": block_id, "is_active": True}, FLOOR_FIELDS).to_list(5000)
    return {
        "block": {
            k: block.get(k)
            for k in (
                "id",
                "name",
                "code",
                "floors",
                "floor_start",
                "numbering_pattern",
                "skip_floors",
                "refuge_floors",
                "podium_floors",
                "ground_floor_label",
                "version",
                "floor_rise_per_sqft",
            )
        },
        "floors": _floor_view(block, flats),
        "pending_pricing": sum(1 for f in flats if f.get("pricing_status") != "ready"),
        "locked": sum(1 for f in flats if P.lock_of(f)),
    }


async def _save_floor(
    block: dict, floor: int, positions: list[FloorPosition], apply_defaults: bool, user: dict
) -> dict:
    if floor not in unit_floors(block):
        raise ApiError(422, f"Floor {floor} is not a unit floor of this tower", "FLOOR_NOT_IN_TOWER")
    if sorted(p.position for p in positions) != list(range(1, len(positions) + 1)):
        raise ApiError(422, "positions must be 1..N without gaps", "VALIDATION_ERROR")
    existing = await db.flats.find({"block_id": block["id"], "floor": floor, "is_active": True}, {"_id": 0}).to_list(
        None
    )
    by_pos = {f.get("position"): f for f in existing}
    wanted = {p.position for p in positions}
    removed = [f for pos, f in by_pos.items() if pos not in wanted]
    locked_removed = [f["flat_number"] for f in removed if P.lock_of(f)]
    if locked_removed:
        raise ApiError(
            409, f"Cannot remove booked flats: {', '.join(locked_removed)}", "STATUS_LOCKED", {"locked": locked_removed}
        )
    fts = await load_flat_types([p.flat_type_id for p in positions])
    setup = P.setup_of(await db.projects.find_one({"id": block["project_id"]}, {"_id": 0, "pricing_setup": 1}))
    seq_base = await db.flats.count_documents({"block_id": block["id"], "floor": {"$lt": floor}, "is_active": True})
    created, updated, kept = 0, 0, []
    for p in sorted(positions, key=lambda x: x.position):
        cur = by_pos.get(p.position)
        number = (p.flat_number or "").strip() or (
            cur["flat_number"] if cur else flat_number(block, floor, p.position, seq_base + p.position)
        )
        if cur and P.lock_of(cur):
            kept.append(cur["flat_number"])
            continue
        if cur:
            ch = {"flat_number": number}
            if p.flat_type_id != cur["flat_type_id"]:
                ft = fts[p.flat_type_id]
                ch.update(
                    flat_type_id=ft["id"],
                    flat_type_code=ft["code"],
                    rooms_snapshot=ft["rooms_snapshot"],
                    areas_snapshot=ft["areas_snapshot"],
                )
            if p.facing:
                ch["facing"] = p.facing
            if apply_defaults:
                ch.update(
                    {k: v for k, v in P.type_defaults(fts[p.flat_type_id]).items() if v is not None},
                    pricing_mode="rate",
                )
                ch.update(P.compute({**cur, **ch}, block, setup))
            if any(ch.get(k) != cur.get(k) for k in ch):
                await db.flats.update_one(
                    {"id": cur["id"]}, {"$set": {**ch, "updated_at": now_iso()}, "$inc": {"version": 1}}
                )
                updated += 1
        else:
            dup = await db.flats.find_one(
                {"block_id": block["id"], "flat_number": number, "is_active": True}, {"_id": 0, "id": 1}
            )
            if dup:
                raise ApiError(409, f"Duplicate flat number {number}", "DUPLICATE_FLAT")
            doc = build_flat(
                block,
                fts[p.flat_type_id],
                floor,
                p.position,
                seq_base + p.position,
                user,
                {"facing": p.facing},
                apply_defaults=apply_defaults,
            )
            doc["flat_number"] = number
            if apply_defaults:
                doc.update(P.compute(doc, block, setup))
            builder = await db.allocation_categories.find_one(
                {"company_id": block["company_id"], "code": "BUILDER"}, {"_id": 0, "id": 1}
            )
            doc.update(
                {
                    "allocation_category_id": builder["id"] if builder else None,
                    "allocation_category_code": "BUILDER",
                    "bookable": True,
                    "display_state": None,
                    "display_override": False,
                }
            )
            await db.flats.insert_one(doc)
            created += 1
    not_removed = await _delete_unlocked(removed)
    kept += not_removed
    # keep the tower's floor_plans in sync so legacy generation/preview sees this floor's inline mix
    plans = [
        fp
        for fp in (block.get("floor_plans") or [])
        if not (fp["from_floor"] <= floor <= fp["to_floor"]) or fp["from_floor"] != fp["to_floor"]
    ]
    plans = _split_ranges(plans, floor) + [
        {
            "from_floor": floor,
            "to_floor": floor,
            "floor_plan_template_id": None,
            "positions": [
                {"position": p.position, "flat_type_id": p.flat_type_id, "facing": p.facing, "is_corner": False}
                for p in positions
            ],
        }
    ]
    await db.blocks.update_one(
        {"id": block["id"]},
        {
            "$set": {"floor_plans": sorted(plans, key=lambda x: x["from_floor"]), "updated_at": now_iso()},
            "$inc": {"version": 1},
        },
    )
    await refresh_counts(block["id"], block["project_id"])
    return {
        "floor": floor,
        "created": created,
        "updated": updated,
        "removed": len(removed) - len(not_removed),
        "kept_locked": kept,
    }


def _split_ranges(plans: list[dict], floor: int) -> list[dict]:
    out = []
    for fp in plans:
        if fp["from_floor"] <= floor <= fp["to_floor"]:
            if fp["from_floor"] < floor:
                out.append({**fp, "to_floor": floor - 1})
            if fp["to_floor"] > floor:
                out.append({**fp, "from_floor": floor + 1})
        else:
            out.append(fp)
    return out


@router.put("/blocks/{block_id}/floors/{floor}")
async def save_floor(
    block_id: str, floor: int, body: FloorIn, request: Request, user: dict = Depends(require("masters.tower.edit"))
):
    block = await _block(block_id, user)
    if body.version is not None and body.version != block.get("version"):
        raise ApiError(409, "Tower was modified by someone else. Reload and retry.", "VERSION_CONFLICT")
    res = await _save_floor(block, floor, body.positions, body.apply_type_defaults, user)
    await write_audit(
        user,
        "block.floor_edit",
        "block",
        block_id,
        after={**res, "positions": [p.model_dump() for p in body.positions]},
        ip=client_ip(request),
    )
    return res


@router.delete("/blocks/{block_id}/floors/{floor}")
async def delete_floor(
    block_id: str, floor: int, request: Request, user: dict = Depends(require("masters.tower.edit"))
):
    block = await _block(block_id, user)
    flats = await db.flats.find(
        {"block_id": block_id, "floor": floor, "is_active": True},
        {"_id": 0, "id": 1, "flat_number": 1, "status": 1, "booking_id": 1},
    ).to_list(None)
    locked = [f["flat_number"] for f in flats if P.lock_of(f)]
    if locked:
        raise ApiError(409, f"Floor {floor} has booked flats: {', '.join(locked)}", "STATUS_LOCKED", {"locked": locked})
    not_removed = await _delete_unlocked(flats)
    await refresh_counts(block_id, block["project_id"])
    if not_removed:  # booked between our read and the delete → floor stays, partial result reported
        await write_audit(
            user,
            "block.floor_delete",
            "block",
            block_id,
            before={"floor": floor, "flats": [f["flat_number"] for f in flats]},
            after={"removed": len(flats) - len(not_removed), "kept_locked": not_removed},
            ip=client_ip(request),
        )
        raise ApiError(
            409,
            f"Floor {floor} has booked flats: {', '.join(not_removed)}",
            "STATUS_LOCKED",
            {"locked": not_removed, "removed": len(flats) - len(not_removed)},
        )
    plans = _split_ranges(block.get("floor_plans") or [], floor)
    await db.blocks.update_one(
        {"id": block_id}, {"$set": {"floor_plans": plans, "updated_at": now_iso()}, "$inc": {"version": 1}}
    )
    await write_audit(
        user,
        "block.floor_delete",
        "block",
        block_id,
        before={"floor": floor, "flats": [f["flat_number"] for f in flats]},
        ip=client_ip(request),
    )
    return {"floor": floor, "removed": len(flats)}


@router.post("/blocks/{block_id}/floors/{floor}/copy")
async def copy_floor(
    block_id: str, floor: int, body: CopyFloorIn, request: Request, user: dict = Depends(require("masters.tower.edit"))
):
    block = await _block(block_id, user)
    src = (
        await db.flats.find(
            {"block_id": block_id, "floor": floor, "is_active": True},
            {"_id": 0, "position": 1, "flat_type_id": 1, "facing": 1},
        )
        .sort("position", 1)
        .to_list(None)
    )
    if not src:
        raise ApiError(422, f"Floor {floor} has no flats to copy", "VALIDATION_ERROR")
    positions = [
        FloorPosition(position=i + 1, flat_type_id=s["flat_type_id"], facing=s.get("facing")) for i, s in enumerate(src)
    ]
    results = []
    for target in body.to_floors:
        if target == floor:
            continue
        block = await db.blocks.find_one({"id": block_id}, {"_id": 0})
        results.append(await _save_floor(block, target, positions, body.apply_type_defaults, user))
    await write_audit(
        user,
        "block.floor_copy",
        "block",
        block_id,
        after={"from": floor, "to": body.to_floors, "results": results},
        ip=client_ip(request),
    )
    return {"from": floor, "results": results}


@router.patch("/blocks/{block_id}/structure")
async def edit_structure(
    block_id: str, body: StructureIn, request: Request, user: dict = Depends(require("masters.tower.edit"))
):
    block = await _block(block_id, user)
    ch = {k: v for k, v in body.model_dump(exclude_unset=True).items() if k not in ("preview", "version")}
    if not ch:
        raise ApiError(400, "No changes supplied", "NO_CHANGES")
    new_block = {**block, **ch}
    flats = await db.flats.find(
        {"block_id": block_id, "is_active": True},
        {"_id": 0, "id": 1, "flat_number": 1, "floor": 1, "position": 1, "status": 1, "booking_id": 1},
    ).to_list(None)
    new_units = set(unit_floors(new_block))
    orphans = [f for f in flats if f["floor"] not in new_units]
    locked_orphans = [f["flat_number"] for f in orphans if P.lock_of(f)]
    if locked_orphans:
        raise ApiError(
            409,
            f"Cannot drop floors with booked flats: {', '.join(locked_orphans)}",
            "STATUS_LOCKED",
            {"locked": locked_orphans},
        )
    by_floor = {}
    for f in flats:
        by_floor.setdefault(f["floor"], []).append(f)
    renames, seq = [], 0
    for fl in sorted(by_floor):
        for f in sorted(by_floor[fl], key=lambda x: x.get("position") or 0):
            seq += 1
            if fl not in new_units:
                continue
            new = flat_number(new_block, fl, f.get("position") or 1, seq)
            if new != f["flat_number"]:
                renames.append({"id": f["id"], "from": f["flat_number"], "to": new, "locked": P.lock_of(f) is not None})
    preview = {
        "changes": ch,
        "floors_removed": sorted({f["floor"] for f in orphans}),
        "flats_removed": len(orphans),
        "renames": renames,
        "all_floors": floor_labels(new_block),
        "unit_floors": sorted(new_units),
    }
    if body.preview:
        return {"preview": True, **preview}
    if body.version is not None and body.version != block.get("version"):
        raise ApiError(409, "Tower was modified by someone else. Reload and retry.", "VERSION_CONFLICT")
    not_removed = await _delete_unlocked(orphans)
    if not_removed:  # booked between preview and apply → nothing else changes
        await refresh_counts(block_id, block["project_id"])
        raise ApiError(
            409,
            f"Floors cannot be removed — booked flats: {', '.join(not_removed)}",
            "STATUS_LOCKED",
            {"locked": not_removed},
        )
    for r in renames:
        if not r["locked"]:
            await db.flats.update_one(
                {"id": r["id"]}, {"$set": {"flat_number": r["to"], "updated_at": now_iso()}, "$inc": {"version": 1}}
            )
    await db.blocks.update_one({"id": block_id}, {"$set": {**ch, "updated_at": now_iso()}, "$inc": {"version": 1}})
    await refresh_counts(block_id, block["project_id"])
    await write_audit(
        user,
        "block.structure",
        "block",
        block_id,
        before={k: block.get(k) for k in ch},
        after=preview,
        ip=client_ip(request),
    )
    return {"preview": False, **preview}


# ---------------- project pricing setup ----------------
@router.get("/projects/{project_id}/pricing-setup")
async def get_pricing_setup(project_id: str, user: dict = Depends(require("masters.project.view"))):
    ensure_project_access(user, project_id)
    p = await get_or_404(db.projects, project_id, "Project", {"company_id": user["company_id"]})
    heads = (
        await db.charge_types.find({"company_id": user["company_id"], "is_active": True}, {"_id": 0})
        .sort("sort_order", 1)
        .to_list(None)
    )
    pending = await db.flats.count_documents(
        {"project_id": project_id, "is_active": True, "pricing_status": {"$ne": "ready"}}
    )
    return {
        "project_id": project_id,
        "version": p.get("version"),
        "setup": P.setup_of(p),
        "charge_heads": heads,
        "pending_pricing": pending,
    }


@router.put("/projects/{project_id}/pricing-setup")
async def put_pricing_setup(
    project_id: str, body: PricingSetupIn, request: Request, user: dict = Depends(require("masters.project.edit"))
):
    ensure_project_access(user, project_id)
    p = await get_or_404(db.projects, project_id, "Project", {"company_id": user["company_id"]})
    ids = [h.charge_type_id for h in body.charge_heads]
    if len(ids) != len(set(ids)) or await db.charge_types.count_documents(
        {"id": {"$in": ids}, "company_id": user["company_id"]}
    ) != len(set(ids)):
        raise ApiError(422, "Unknown or duplicate charge head", "VALIDATION_ERROR")
    setup = body.model_dump(exclude={"version"})
    await apply_update(db.projects, p, {"pricing_setup": setup}, expected_version(request, body.version), "Project")
    await write_audit(
        user,
        "project.pricing_setup",
        "project",
        project_id,
        before=p.get("pricing_setup"),
        after=setup,
        ip=client_ip(request),
    )
    return await get_pricing_setup(project_id, user)


# ---------------- parking attach / detach ----------------
class AttachIn(StrictModel):
    flat_id: str


@router.post("/parking/{slot_id}/attach")
async def attach_slot(
    slot_id: str, body: AttachIn, request: Request, user: dict = Depends(require("masters.flat.edit"))
):
    slot = await get_or_404(db.parking_slots, slot_id, "Parking slot", {"company_id": user["company_id"]})
    flat, _, setup = await _flat(body.flat_id, user)
    P.ensure_unlocked(flat)
    if slot["project_id"] != flat["project_id"]:
        raise ApiError(422, "Slot belongs to another project", "VALIDATION_ERROR")
    current = [s["id"] for s in await db.parking_slots.find({"flat_id": flat["id"]}, {"_id": 0, "id": 1}).to_list(None)]
    await _attach_slots(flat, list({*current, slot_id}), user)
    await write_audit(
        user,
        "parking_slot.attach",
        "parking_slot",
        slot_id,
        after={"flat_id": flat["id"], "flat_number": flat["flat_number"]},
        ip=client_ip(request),
    )
    return await _enrich(flat, setup)


@router.post("/parking/{slot_id}/detach")
async def detach_slot(slot_id: str, request: Request, user: dict = Depends(require("masters.flat.edit"))):
    slot = await get_or_404(db.parking_slots, slot_id, "Parking slot", {"company_id": user["company_id"]})
    if slot["status"] == "Allotted":
        raise ApiError(409, "Allotted slots are controlled by the booking", "STATUS_LOCKED")
    if slot.get("flat_id"):
        flat = await db.flats.find_one({"id": slot["flat_id"]}, {"_id": 0})
        if flat:
            P.ensure_unlocked(flat)
    await db.parking_slots.update_one(
        {"id": slot_id},
        {"$set": {"flat_id": None, "status": "Available", "updated_at": now_iso()}, "$inc": {"version": 1}},
    )
    await write_audit(
        user,
        "parking_slot.detach",
        "parking_slot",
        slot_id,
        before={"flat_id": slot.get("flat_id")},
        ip=client_ip(request),
    )
    return {"id": slot_id, "status": "Available", "flat_id": None}
