"""Phase X.3 — Project Structure Builder: one composite read (tree + readiness) and single-flat add.
Flat generation reuses services.flat_generation (same numbering, snapshots, pricing); duplicates → 409."""
import asyncio

from fastapi import APIRouter, Depends, Request
from pydantic import Field

from db import db
from deps import ensure_project_access, require
from routers.construction import ensure_block_stages
from routers.project_setup import _active_assignments
from services import inventory as inv
from services.flat_generation import (
    build_flat,
    flat_number,
    floor_labels,
    load_flat_types,
    resolve_positions,
    unit_floors,
)
from services.money import present_money
from utils import ApiError, StrictModel, client_ip, get_or_404, write_audit

router = APIRouter(tags=["structure"])
FLAT_FIELDS = {"_id": 0, "id": 1, "block_id": 1, "floor": 1, "floor_label": 1, "position": 1, "flat_number": 1, "flat_type_code": 1, "flat_type_id": 1, "status": 1,
               "price_paise": 1, "super_builtup_sqft": 1, "facing": 1, "version": 1, "display_state": 1, "display_override": 1, "allocation_category_code": 1, "bookable": 1, "booking_id": 1}


def _tower_checks(t: dict, pid: str) -> list[dict]:
    out = []
    if not t["floors_list"]:
        out.append({"code": "no_floors", "label": "Tower has no floors", "fix": {"label": "Add floors", "action": "add_floors", "block_id": t["id"]}})
    if t["units"]["total"] == 0:
        out.append({"code": "no_flats", "label": "No flats generated", "fix": {"label": "Add floors / flats", "action": "add_floors", "block_id": t["id"]}})
    if not t["stage_plan"]["total"]:
        out.append({"code": "no_stage_plan", "label": "No stage plan", "fix": {"label": "Assign stage plan", "to": f"/projects/{pid}/setup?section=stages"}})
    if not t["payment_plans"]:
        out.append({"code": "no_payment_plan", "label": "No payment plan", "fix": {"label": "Assign payment plan", "to": f"/projects/{pid}/setup?section=plans"}})
    if t["missing_price"]:
        out.append({"code": "missing_price", "label": f"{t['missing_price']} flat(s) missing price", "fix": {"label": "Set pricing", "to": f"/projects/{pid}/setup?section=pricing"}})
    return out


@router.get("/projects/{project_id}/structure")
async def project_structure(project_id: str, user: dict = Depends(require("masters.project.view"))):
    ensure_project_access(user, project_id)
    p = await get_or_404(db.projects, project_id, "Project", {"company_id": user["company_id"]})
    blocks, flats, assignments = await asyncio.gather(
        db.blocks.find({"project_id": project_id, "is_active": True}, {"_id": 0}).sort("name", 1).to_list(200),
        db.flats.find({"project_id": project_id, "is_active": True}, FLAT_FIELDS).sort([("floor", 1), ("position", 1)]).to_list(20000),
        _active_assignments(project_id))
    real = inv.can_see_real(user)
    by_block: dict[str, list] = {}
    for f in flats:
        shaped = inv.shape(f, user)
        if shaped is not None:
            by_block.setdefault(f["block_id"], []).append(shaped)
    towers = []
    for b in blocks:
        stages = await ensure_block_stages(b)
        fl = by_block.get(b["id"], [])
        counts: dict[str, int] = {}
        for f in fl:
            counts[f["status"]] = counts.get(f["status"], 0) + 1
        floors = {}
        for f in fl:
            floors.setdefault(f["floor"], {"floor": f["floor"], "label": f.get("floor_label") or str(f["floor"]), "flats": []})["flats"].append(present_money(f))
        plans = [{"id": a["payment_plan_id"], "name": a["plan_name"], "scope": "tower" if a.get("block_id") else "project"} for a in assignments if a.get("block_id") in (b["id"], None)]
        t = {"id": b["id"], "name": b["name"], "code": b["code"], "version": b.get("version"), "floors": b.get("floors"), "floor_start": b.get("floor_start", 1), "numbering_pattern": b.get("numbering_pattern"),
             "rate_per_sqft": b.get("rate_per_sqft"), "floors_list": [floors[k] for k in sorted(floors)], "unit_floors": unit_floors(b), "all_floors": floor_labels(b),
             "units": {"total": len(fl), "by_status": counts, "masked": not real}, "missing_price": sum(1 for f in fl if f.get("price_paise") is None),
             "stage_plan": {"total": len(stages), "completed": sum(1 for s in stages if s.get("status") == "Completed"), "source": "tower" if b.get("construction_stage_sequence") else "project"},
             "payment_plans": plans, "floor_plans": b.get("floor_plans") or []}
        t["checks"] = _tower_checks(t, project_id)
        towers.append(t)
    project_checks = [] if blocks else [{"code": "no_towers", "label": "Project has no towers", "fix": {"label": "Add tower", "to": f"/projects/{project_id}/setup?section=towers"}}]
    ready = not project_checks and all(not t["checks"] for t in towers)
    return {"project": {k: p.get(k) for k in ("id", "name", "code", "status", "version")}, "towers": towers,
            "readiness": {"ready": ready, "project_checks": project_checks, "open_items": len(project_checks) + sum(len(t["checks"]) for t in towers)}}


class FloorsPreviewIn(StrictModel):
    count: int = Field(ge=1, le=50)
    floor_plan_template_id: str | None = None
    flats_per_floor: int | None = Field(default=None, ge=1, le=50)
    flat_type_id: str | None = None


def _extended(block: dict, body: FloorsPreviewIn) -> tuple[dict, list[int]]:
    old = floor_labels(block)
    nb = {**block, "floors": block["floors"] + body.count}
    new_labels = [f for f in floor_labels(nb) if f not in old]
    plans = list(block.get("floor_plans") or [])
    last = plans[-1] if plans else None
    if body.flats_per_floor and body.flat_type_id:
        plans.append({"from_floor": new_labels[0], "to_floor": new_labels[-1], "floor_plan_template_id": None, "positions": [{"position": i + 1, "flat_type_id": body.flat_type_id, "facing": None, "is_corner": False} for i in range(body.flats_per_floor)]})
    else:
        tmpl = body.floor_plan_template_id or (last or {}).get("floor_plan_template_id")
        if tmpl or (last and last.get("positions")):
            plans.append({"from_floor": new_labels[0], "to_floor": new_labels[-1], "floor_plan_template_id": tmpl, "positions": None if tmpl else last["positions"]})
    nb["floor_plans"] = plans
    return nb, new_labels


@router.post("/blocks/{block_id}/floors/preview")
async def floors_preview(block_id: str, body: FloorsPreviewIn, user: dict = Depends(require("masters.tower.edit"))):
    """Dry run: which floors/flat numbers `POST /blocks/{id}/floors` would create (no writes)."""
    block = await get_or_404(db.blocks, block_id, "Block", {"company_id": user["company_id"]})
    ensure_project_access(user, block["project_id"])
    nb, new_labels = _extended(block, body)
    plan = await resolve_positions(nb)
    seq, numbers = 0, []
    for floor in sorted(plan):
        for pos in sorted(plan[floor], key=lambda x: x["position"]):
            seq += 1
            if floor in new_labels:
                numbers.append(flat_number(nb, floor, pos["position"], seq))
    existing = {f["flat_number"] for f in await db.flats.find({"block_id": block_id, "flat_number": {"$in": numbers}}, {"_id": 0, "flat_number": 1}).to_list(None)}
    return {"floors": new_labels, "flat_numbers": numbers, "count": len(numbers), "duplicates": sorted(existing), "floor_plans": nb["floor_plans"]}


class SingleFlatIn(StrictModel):
    floor: int = Field(ge=0)
    position: int = Field(ge=1, le=50)
    flat_type_id: str
    flat_number: str | None = Field(default=None, min_length=1, max_length=20)


@router.post("/blocks/{block_id}/flats", status_code=201)
async def add_single_flat(block_id: str, body: SingleFlatIn, request: Request, user: dict = Depends(require("masters.flat.create"))):
    block = await get_or_404(db.blocks, block_id, "Block", {"company_id": user["company_id"]})
    ensure_project_access(user, block["project_id"])
    if body.floor not in floor_labels(block):
        raise ApiError(422, f"Floor {body.floor} is outside this tower ({block['floors']} floors from {block.get('floor_start', 1)})", "FLOOR_OUT_OF_RANGE")
    ft = (await load_flat_types([body.flat_type_id]))[body.flat_type_id]
    doc = build_flat(block, ft, body.floor, body.position, 0, user)
    if body.flat_number:
        doc["flat_number"] = body.flat_number.strip()
    dup = await db.flats.find_one({"block_id": block_id, "$or": [{"flat_number": doc["flat_number"]}, {"floor": body.floor, "position": body.position}]}, {"_id": 0, "flat_number": 1, "floor": 1, "position": 1})
    if dup:
        what = f"flat number {dup['flat_number']}" if dup["flat_number"] == doc["flat_number"] else f"floor {body.floor} position {body.position} ({dup['flat_number']})"
        raise ApiError(409, f"Duplicate: {what} already exists in this tower", "DUPLICATE_FLAT")
    builder = await db.allocation_categories.find_one({"company_id": block["company_id"], "code": "BUILDER"}, {"_id": 0, "id": 1})
    doc.update({"allocation_category_id": builder["id"] if builder else None, "allocation_category_code": "BUILDER", "bookable": True, "display_state": None, "display_override": False})
    await db.flats.insert_one(doc)
    doc.pop("_id", None)
    from services.counters import refresh_counts
    await refresh_counts(block_id, block["project_id"])
    await write_audit(user, "flat.create", "flat", doc["id"], before=None, after={"flat_number": doc["flat_number"], "floor": body.floor, "position": body.position, "block_id": block_id}, ip=client_ip(request))
    return present_money(doc)
