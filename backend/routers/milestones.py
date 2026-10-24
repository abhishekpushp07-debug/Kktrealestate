from datetime import date

from fastapi import APIRouter, Depends, Request
from pydantic import Field

from db import db
from deps import ensure_project_access, require
from services.ledger import create_demand, raise_other_charges, rebuild
from services.money import present_money
from utils import (
    ApiError,
    StrictModel,
    client_ip,
    expected_version,
    get_or_404,
    now_iso,
    write_audit,
)

router = APIRouter(prefix="/blocks", tags=["milestones"])


class CompleteIn(StrictModel):
    completed_on: date
    notes: str | None = Field(default=None, max_length=500)
    version: int | None = None


class UndoIn(StrictModel):
    reason: str = Field(min_length=3, max_length=500)
    version: int | None = None


async def ensure_block_milestones(block: dict) -> list[dict]:
    """Snapshot template into block.milestones on first use (legacy blocks)."""
    if block.get("milestones"):
        return block["milestones"]
    mt_id = block.get("milestone_template_id")
    if not mt_id:
        p = await db.projects.find_one({"id": block["project_id"]}, {"_id": 0, "milestone_template_id": 1})
        mt_id = (p or {}).get("milestone_template_id")
    mt = await db.milestone_templates.find_one({"id": mt_id}, {"_id": 0}) if mt_id else None
    ms = [{"seq": m["seq"], "name": m["name"], "cumulative_percent": m["cumulative_percent"], "status": "Pending", "completed_on": None, "completed_at": None, "completed_by": None, "notes": None} for m in (mt or {}).get("milestones", [])]
    await db.blocks.update_one({"id": block["id"]}, {"$set": {"milestones": ms}})
    return ms


@router.get("/{block_id}/milestones")
async def list_milestones(block_id: str, user: dict = Depends(require("project.read"))):
    block = await get_or_404(db.blocks, block_id, "Block", {"company_id": user["company_id"]})
    ensure_project_access(user, block["project_id"])
    ms = await ensure_block_milestones(block)
    agg = await db.demands.aggregate([{"$match": {"block_id": block_id, "voided": {"$ne": True}}}, {"$group": {"_id": "$milestone_seq", "n": {"$sum": 1}, "total_paise": {"$sum": "$total_demand_paise"}, "paid_paise": {"$sum": "$paid_paise"}}}]).to_list(None)
    amap = {a["_id"]: a for a in agg}
    for m in ms:
        a = amap.get(m["seq"], {})
        m["demands"] = {"count": a.get("n", 0), "total_paise": a.get("total_paise", 0), "paid_paise": a.get("paid_paise", 0)}
    active = await db.bookings.count_documents({"block_id": block_id, "status": "Active"})
    return present_money({"block": {k: block.get(k) for k in ("id", "name", "code", "construction_percent", "version")}, "milestones": ms, "active_bookings": active,
                          "next_seq": next((m["seq"] for m in ms if m["status"] == "Pending"), None)})


@router.post("/{block_id}/milestones/{seq}/complete")
async def complete_milestone(block_id: str, seq: int, body: CompleteIn, request: Request, user: dict = Depends(require("milestone.update"))):
    block = await get_or_404(db.blocks, block_id, "Block", {"company_id": user["company_id"]})
    ensure_project_access(user, block["project_id"])
    ms = await ensure_block_milestones(block)
    nxt = next((m for m in ms if m["status"] == "Pending"), None)
    if not nxt:
        raise ApiError(409, "All milestones already completed", "ALL_COMPLETED")
    if nxt["seq"] != seq:
        raise ApiError(409, f"Milestones are forward-only: next pending is #{nxt['seq']} {nxt['name']}", "MILESTONE_OUT_OF_ORDER")
    prev = [m for m in ms if m["status"] == "Completed"]
    if prev and prev[-1].get("completed_on") and prev[-1]["completed_on"] > body.completed_on.isoformat():
        raise ApiError(422, "completed_on cannot be before the previous milestone date", "VALIDATION_ERROR")
    ts = now_iso()
    for m in ms:
        if m["seq"] == seq:
            m.update(status="Completed", completed_on=body.completed_on.isoformat(), completed_at=ts, completed_by=user["id"], completed_by_name=user["name"], notes=body.notes)
    ver = expected_version(request, body.version)
    q = {"id": block_id, **({"version": ver} if ver is not None else {})}
    res = await db.blocks.find_one_and_update(q, {"$set": {"milestones": ms, "construction_percent": nxt["cumulative_percent"], "updated_at": ts}, "$inc": {"version": 1}}, projection={"_id": 0}, return_document=True)
    if not res:
        raise ApiError(409, "Block was modified by someone else. Reload and retry.", "VERSION_CONFLICT")
    company = await db.companies.find_one({"id": user["company_id"]}, {"_id": 0})
    due_days = int(company.get("demand_due_days") or 15)
    created = []
    async for b in db.bookings.find({"block_id": block_id, "status": "Active"}, {"_id": 0}):
        d = await create_demand(b, company, nxt, body.completed_on, due_days, ts)
        if d:
            created.append(d)
        if nxt["cumulative_percent"] >= 100:
            lines = raise_other_charges(b, "on_possession", ts)
            if lines:
                await db.bookings.update_one({"id": b["id"]}, {"$set": {"other_charges": lines}})
        await rebuild(b["id"])
    await write_audit(user, "milestone.complete", "block", block_id, before={"construction_percent": block.get("construction_percent")},
                      after={"construction_percent": nxt["cumulative_percent"], "milestone": nxt["name"], "seq": seq, "completed_on": body.completed_on.isoformat(), "demands_raised": len(created)}, ip=client_ip(request))
    for d in created:
        await write_audit(user, "demand.create", "booking", d["booking_id"], after={"demand_number": d["demand_number"], "milestone": d["milestone_name"], "total_paise": d["total_demand_paise"]}, ip=client_ip(request))
    return present_money({"block": {k: res.get(k) for k in ("id", "construction_percent", "version")}, "milestone": nxt, "demands_raised": len(created), "demands": created})


@router.post("/{block_id}/milestones/{seq}/undo")
async def undo_milestone(block_id: str, seq: int, body: UndoIn, request: Request, user: dict = Depends(require("milestone.undo"))):
    block = await get_or_404(db.blocks, block_id, "Block", {"company_id": user["company_id"]})
    ensure_project_access(user, block["project_id"])
    ms = await ensure_block_milestones(block)
    done = [m for m in ms if m["status"] == "Completed"]
    if not done or done[-1]["seq"] != seq:
        raise ApiError(409, "Only the latest completed milestone can be undone", "MILESTONE_NOT_LATEST")
    latest = done[-1]
    if await db.payments.count_documents({"block_id": block_id, "status": {"$in": ["Cleared", "Pending"]}, "posted_at": {"$gt": latest["completed_at"]}}):
        raise ApiError(409, "Payments were posted after this milestone; undo is blocked", "UNDO_BLOCKED_BY_PAYMENTS")
    new_pct = done[-2]["cumulative_percent"] if len(done) > 1 else 0
    for m in ms:
        if m["seq"] == seq:
            m.update(status="Pending", completed_on=None, completed_at=None, completed_by=None, completed_by_name=None, notes=None)
    ts = now_iso()
    ver = expected_version(request, body.version)
    q = {"id": block_id, **({"version": ver} if ver is not None else {})}
    res = await db.blocks.find_one_and_update(q, {"$set": {"milestones": ms, "construction_percent": new_pct, "updated_at": ts}, "$inc": {"version": 1}}, projection={"_id": 0}, return_document=True)
    if not res:
        raise ApiError(409, "Block was modified by someone else. Reload and retry.", "VERSION_CONFLICT")
    voided = await db.demands.update_many({"block_id": block_id, "milestone_seq": seq, "voided": {"$ne": True}}, {"$set": {"voided": True, "voided_at": ts, "voided_by": user["id"], "void_reason": body.reason, "status": "Voided"}})
    async for b in db.bookings.find({"block_id": block_id, "status": "Active"}, {"_id": 0, "id": 1}):
        await db.bookings.update_one({"id": b["id"]}, {"$set": {"construction_percent": new_pct}})
        await rebuild(b["id"])
    await write_audit(user, "milestone.undo", "block", block_id, before={"construction_percent": latest["cumulative_percent"], "milestone": latest["name"]}, after={"construction_percent": new_pct, "reason": body.reason, "demands_voided": voided.modified_count}, ip=client_ip(request))
    return present_money({"block": {k: res.get(k) for k in ("id", "construction_percent", "version")}, "demands_voided": voided.modified_count})
