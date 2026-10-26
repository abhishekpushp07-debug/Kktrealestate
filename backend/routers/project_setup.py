"""Project Setup: the whole project configuration in ONE read (`GET /projects/{id}/setup`) and section writes
(`PUT /projects/{id}/setup/{section}`). Expresses the hierarchy explicitly: project → towers → stage sequence / plans / pricing."""
import asyncio

from fastapi import APIRouter, Depends, Request
from pydantic import Field

from db import db
from deps import ensure_project_access, require
from routers.construction import _check_plan_fits, _validate_seq, ensure_block_stages, stage_sequence_for_block
from utils import ApiError, StrictModel, base_doc, client_ip, get_or_404, now_iso, write_audit

router = APIRouter(prefix="/projects", tags=["project-setup"])
SECTIONS = ("towers", "stages", "plans", "pricing")


async def _active_assignments(project_id: str) -> list[dict]:
    """Assignments whose plan is still active (a deactivated plan must not be re-submitted by the setup form)."""
    asg = await db.payment_plan_assignments.find({"project_id": project_id, "is_active": True}, {"_id": 0}).to_list(200)
    live = {p["id"] for p in await db.payment_plans.find({"id": {"$in": [a["payment_plan_id"] for a in asg]}, "is_active": True}, {"_id": 0, "id": 1}).to_list(None)}
    return [a for a in asg if a["payment_plan_id"] in live]


async def _tower_view(b: dict, assignments: list[dict], flats_by_block: dict) -> dict:
    stages = await ensure_block_stages(b)
    done = [s for s in stages if s.get("status") == "Completed"]
    nxt = next((s for s in stages if s.get("status") != "Completed"), None)
    counts = flats_by_block.get(b["id"], {})
    return {"id": b["id"], "name": b["name"], "code": b["code"], "block_type_id": b.get("block_type_id"), "status": b.get("status"), "version": b.get("version"),
            "floors": b.get("floors"), "floor_start": b.get("floor_start"), "skip_floors": b.get("skip_floors") or [], "refuge_floors": b.get("refuge_floors") or [], "podium_floors": b.get("podium_floors") or [],
            "floor_plans": b.get("floor_plans") or [], "numbering_pattern": b.get("numbering_pattern"), "rate_per_sqft": b.get("rate_per_sqft"), "floor_rise_per_sqft": b.get("floor_rise_per_sqft"),
            "units": {"total": sum(counts.values()), "by_status": counts},
            "construction": {"percent": b.get("construction_percent", 0), "completed": len(done), "total": len(stages), "current": done[-1]["name"] if done else None, "next": nxt["name"] if nxt else None,
                             "sequence_source": "tower" if b.get("construction_stage_sequence") else "project", "stages": stages},
            "plans": [{"assignment_id": a["id"], "payment_plan_id": a["payment_plan_id"], "name": a["plan_name"], "code": a.get("plan_code"), "is_default": a.get("is_default", False), "scope": "tower" if a.get("block_id") else "project"}
                      for a in assignments if a.get("block_id") in (b["id"], None)]}


@router.get("/{project_id}/setup")
async def get_setup(project_id: str, user: dict = Depends(require("masters.project.view"))):
    ensure_project_access(user, project_id)
    p = await get_or_404(db.projects, project_id, "Project", {"company_id": user["company_id"]})
    blocks, assignments, rate_card, parking, counts = await asyncio.gather(
        db.blocks.find({"project_id": project_id, "is_active": True}, {"_id": 0}).sort("name", 1).to_list(200),
        _active_assignments(project_id),
        db.rate_cards.find_one({"project_id": project_id, "status": "Active"}, {"_id": 0, "id": 1, "name": 1, "effective_from": 1, "rates": 1, "applied_count": 1}),
        db.parking_slots.aggregate([{"$match": {"project_id": project_id}}, {"$group": {"_id": "$status", "n": {"$sum": 1}}}]).to_list(None),
        db.flats.aggregate([{"$match": {"project_id": project_id, "is_active": True}}, {"$group": {"_id": {"b": "$block_id", "s": "$status"}, "n": {"$sum": 1}}}]).to_list(None))
    fb: dict[str, dict] = {}
    for c in counts:
        fb.setdefault(c["_id"]["b"], {})[c["_id"]["s"]] = c["n"]
    towers = [await _tower_view(b, assignments, fb) for b in blocks]
    project_seq = await stage_sequence_for_block({"project_id": project_id, "construction_stage_sequence": p.get("construction_stage_sequence")})
    web = p.get("website") or {}
    return {"project": {k: p.get(k) for k in ("id", "name", "code", "status", "address", "rera_number", "version", "launch_date", "possession_date")},
            "towers": towers,
            "stages": {"project_sequence": project_seq, "catalogue": await db.construction_stages.find({"is_active": True}, {"_id": 0, "id": 1, "name": 1, "code": 1, "seq_hint": 1, "is_possession": 1}).sort("seq_hint", 1).to_list(None)},
            "plans": {"assignments": assignments, "catalogue": await db.payment_plans.find({"is_active": True}, {"_id": 0, "id": 1, "name": 1, "code": 1, "plan_type": 1, "installments": 1}).to_list(None)},
            "pricing": {"rate_card": rate_card, "block_rates": [{"block_id": b["id"], "rate_per_sqft": b.get("rate_per_sqft"), "floor_rise_per_sqft": b.get("floor_rise_per_sqft"), "default_cash_percent": b.get("default_cash_percent")} for b in blocks]},
            "parking": {"by_status": {x["_id"]: x["n"] for x in parking}, "total": sum(x["n"] for x in parking)},
            "website": {"published": bool(web.get("published")), "slug": web.get("slug"), "show_prices": bool(web.get("show_prices")), "brochure_gate_enabled": bool(web.get("brochure_gate_enabled")), "site_visits_enabled": bool((web.get("site_visits") or {}).get("enabled"))},
            "checklist": {"has_towers": bool(blocks), "has_units": bool(counts), "stages_configured": all(t["construction"]["total"] > 0 for t in towers) if towers else False,
                          "plans_assigned": all(t["plans"] for t in towers) if towers else False, "pricing_set": all(t["rate_per_sqft"] for t in towers) if towers else False}}


class StageSeqItem(StrictModel):
    stage_id: str
    seq: int


class StagesIn(StrictModel):
    project_sequence: list[StageSeqItem] | None = None
    tower_sequences: dict[str, list[StageSeqItem] | None] = {}  # block_id → override (None resets to project default)
    version: int | None = None


class PlanAssignIn(StrictModel):
    payment_plan_id: str
    block_id: str | None = None
    is_default: bool = False


class PlansIn(StrictModel):
    assignments: list[PlanAssignIn] = Field(max_length=50)


class TowerRate(StrictModel):
    block_id: str
    rate_per_sqft: float | None = Field(default=None, ge=0)
    floor_rise_per_sqft: float | None = Field(default=None, ge=0)
    default_cash_percent: float | None = Field(default=None, ge=0, le=100)


class PricingIn(StrictModel):
    block_rates: list[TowerRate]


class TowersIn(StrictModel):
    towers: list[dict]  # [{id, name?, status?, version}] — basic fields only; structural edits go through /blocks


@router.put("/{project_id}/setup/{section}")
async def save_section(project_id: str, section: str, body: dict, request: Request, user: dict = Depends(require("masters.project.edit"))):
    ensure_project_access(user, project_id)
    p = await get_or_404(db.projects, project_id, "Project", {"company_id": user["company_id"]})
    if section not in SECTIONS:
        raise ApiError(404, f"Unknown setup section; one of {', '.join(SECTIONS)}", "NOT_FOUND")
    blocks = {b["id"]: b for b in await db.blocks.find({"project_id": project_id, "is_active": True}, {"_id": 0}).to_list(200)}
    if section == "stages":
        data = StagesIn(**body)
        if data.project_sequence is not None:
            seq = [x.model_dump() for x in data.project_sequence]
            await _validate_seq(seq)
            q = {"id": project_id, **({"version": data.version} if data.version is not None else {})}
            if not (await db.projects.update_one(q, {"$set": {"construction_stage_sequence": seq, "updated_at": now_iso()}, "$inc": {"version": 1}})).matched_count:
                raise ApiError(409, "Project was modified by someone else. Reload and retry.", "VERSION_CONFLICT")
        for bid, seq in data.tower_sequences.items():
            if bid not in blocks:
                raise ApiError(404, "Tower does not belong to this project", "TOWER_NOT_IN_PROJECT")
            if await db.bookings.count_documents({"block_id": bid, "status": "Active"}) and seq is not None:
                done = {s["stage_id"] for s in blocks[bid].get("construction_stages") or [] if s.get("status") == "Completed"}
                if done - {x.stage_id for x in seq}:
                    raise ApiError(409, "Cannot remove a completed stage from a tower with active bookings", "STAGE_COMPLETED_LOCKED")
            seqd = [x.model_dump() for x in seq] if seq is not None else None
            if seqd:
                await _validate_seq(seqd)
            await db.blocks.update_one({"id": bid}, {"$set": {"construction_stage_sequence": seqd, "updated_at": now_iso()}, "$inc": {"version": 1}})
            await ensure_block_stages({**blocks[bid], "construction_stage_sequence": seqd})
    elif section == "plans":
        data = PlansIn(**body)
        plans = {pl["id"]: pl for pl in await db.payment_plans.find({"id": {"$in": [a.payment_plan_id for a in data.assignments]}, "is_active": True}, {"_id": 0}).to_list(None)}
        for a in data.assignments:
            if a.payment_plan_id not in plans:
                raise ApiError(422, "Unknown or inactive payment plan", "VALIDATION_ERROR")
            if a.block_id and a.block_id not in blocks:
                raise ApiError(404, "Tower does not belong to this project", "TOWER_NOT_IN_PROJECT")
            for b in ([blocks[a.block_id]] if a.block_id else blocks.values()):
                await _check_plan_fits(plans[a.payment_plan_id], b, project_wide=not a.block_id)
        if sum(1 for a in data.assignments if a.is_default and not a.block_id) > 1 or any(sum(1 for a in data.assignments if a.is_default and a.block_id == bid) > 1 for bid in blocks):
            raise ApiError(422, "Only one default plan per scope", "VALIDATION_ERROR")
        in_use = {a["payment_plan_id"] for a in await db.bookings.find({"project_id": project_id, "status": "Active"}, {"_id": 0, "payment_plan_id": 1}).to_list(None)}
        keep = {(a.payment_plan_id, a.block_id) for a in data.assignments}
        for old in await db.payment_plan_assignments.find({"project_id": project_id, "is_active": True}, {"_id": 0}).to_list(None):
            if (old["payment_plan_id"], old.get("block_id")) not in keep:
                await db.payment_plan_assignments.update_one({"id": old["id"]}, {"$set": {"is_active": False, "effective_to": now_iso()[:10]}})
        for a in data.assignments:
            pl, b = plans[a.payment_plan_id], blocks.get(a.block_id) if a.block_id else None
            setv = {"is_active": True, "is_default": a.is_default, "plan_name": pl["name"], "plan_code": pl.get("code"), "block_name": b["name"] if b else None, "project_name": p["name"], "effective_to": None}
            ins = {k: v for k, v in base_doc(user, user["company_id"]).items() if k not in setv}
            await db.payment_plan_assignments.update_one({"project_id": project_id, "block_id": a.block_id, "payment_plan_id": a.payment_plan_id},
                                                         {"$set": setv, "$setOnInsert": {**ins, "effective_from": now_iso()[:10]}}, upsert=True)
        body = {"assignments": [a.model_dump() for a in data.assignments], "plans_in_use": sorted(in_use)}
    elif section == "pricing":
        data = PricingIn(**body)
        for r in data.block_rates:
            if r.block_id not in blocks:
                raise ApiError(404, "Tower does not belong to this project", "TOWER_NOT_IN_PROJECT")
            await db.blocks.update_one({"id": r.block_id}, {"$set": {"rate_per_sqft": r.rate_per_sqft, "floor_rise_per_sqft": r.floor_rise_per_sqft, "default_cash_percent": r.default_cash_percent, "updated_at": now_iso()}, "$inc": {"version": 1}})
    else:  # towers: light fields only
        data = TowersIn(**body)
        for t in data.towers:
            if t.get("id") not in blocks:
                raise ApiError(404, "Tower does not belong to this project", "TOWER_NOT_IN_PROJECT")
            upd = {k: t[k] for k in ("name", "status", "ground_floor_label") if k in t}
            if upd:
                q = {"id": t["id"], **({"version": t["version"]} if t.get("version") is not None else {})}
                if not (await db.blocks.update_one(q, {"$set": {**upd, "updated_at": now_iso()}, "$inc": {"version": 1}})).matched_count:
                    raise ApiError(409, f"Tower {blocks[t['id']]['name']} was modified by someone else", "VERSION_CONFLICT")
    await write_audit(user, f"project.setup.{section}", "project", project_id, after={"section": section, **({k: v for k, v in body.items() if k != "version"} if isinstance(body, dict) else {})}, ip=client_ip(request))
    return await get_setup(project_id, user)
