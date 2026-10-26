"""Phase 7: construction stage sequences, tower construction status, payment-plan assignments, booking plan/schedule, dues admin."""
from datetime import date

from fastapi import APIRouter, Depends, Request
from pydantic import Field

from services import clock
from db import db
from deps import require_any, ensure_project_access, require
from services.dues_engine import raise_due_installments, run_dues_for_all, schedule, trigger_label
from services.ledger import rebuild
from services.money import present_money
from utils import ApiError, StrictModel, client_ip, expected_version, get_or_404, new_id, now_iso, write_audit

router = APIRouter(tags=["construction"])


# ---------- stage sequences ----------
async def stage_sequence_for_block(block: dict) -> list[dict]:
    """Resolved [{stage_id, seq, name, code, is_possession}] for a block (block override → project → master order)."""
    seq = block.get("construction_stage_sequence")
    if not seq:
        p = await db.projects.find_one({"id": block["project_id"]}, {"_id": 0, "construction_stage_sequence": 1})
        seq = (p or {}).get("construction_stage_sequence")
    stages = {s["id"]: s for s in await db.construction_stages.find({"is_active": True}, {"_id": 0}).to_list(None)}
    if not seq:
        seq = [{"stage_id": s["id"], "seq": i + 1} for i, s in enumerate(sorted(stages.values(), key=lambda s: (s.get("seq_hint") or 0, s["name"])))]
    out = []
    for i, x in enumerate(sorted(seq, key=lambda x: x["seq"])):
        s = stages.get(x["stage_id"])
        if s:
            out.append({"stage_id": s["id"], "seq": i + 1, "name": s["name"], "code": s.get("code"), "is_possession": bool(s.get("is_possession"))})
    return out


def legacy_milestones(stages: list[dict]) -> list[dict]:
    """Mirror stage records into the legacy block.milestones shape (photos/portal/public keep working)."""
    n = len(stages) or 1
    return [{"seq": s["seq"], "name": s["name"], "cumulative_percent": round(s["seq"] * 100 / n, 2), "status": s["status"], "completed_on": s.get("completed_on"), "completed_at": s.get("completed_at"), "completed_by": s.get("completed_by"), "notes": s.get("notes"), "progress_note": s.get("progress_note"), "stage_id": s["stage_id"]} for s in stages]


async def ensure_block_stages(block: dict) -> list[dict]:
    if block.get("construction_stages"):
        return block["construction_stages"]
    seq = await stage_sequence_for_block(block)
    stages = [{**s, "status": "Pending", "started_on": None, "completed_on": None, "completed_at": None, "completed_by": None, "notes": None, "visible_to_customers": True} for s in seq]
    await db.blocks.update_one({"id": block["id"]}, {"$set": {"construction_stages": stages, "milestones": legacy_milestones(stages)}})
    return stages


class SeqIn(StrictModel):
    construction_stage_sequence: list[dict]
    version: int | None = None


async def _validate_seq(seq: list[dict]):
    ids = [x.get("stage_id") for x in seq]
    if len(set(ids)) != len(ids) or any(not isinstance(x.get("seq"), int) for x in seq):
        raise ApiError(422, "Stage sequence must have unique stage_ids and integer seq", "VALIDATION_ERROR")
    if await db.construction_stages.count_documents({"id": {"$in": ids}, "is_active": True}) != len(ids):
        raise ApiError(422, "Unknown or inactive stage in sequence", "VALIDATION_ERROR")


@router.patch("/projects/{project_id}/stage-sequence")
async def set_project_sequence(project_id: str, body: SeqIn, request: Request, user: dict = Depends(require("masters.construction_stage.edit"))):
    await get_or_404(db.projects, project_id, "Project", {"company_id": user["company_id"]})
    await _validate_seq(body.construction_stage_sequence)
    await db.projects.update_one({"id": project_id}, {"$set": {"construction_stage_sequence": body.construction_stage_sequence, "updated_at": now_iso()}, "$inc": {"version": 1}})
    await write_audit(user, "project.stage_sequence", "project", project_id, after={"stages": len(body.construction_stage_sequence)}, ip=client_ip(request))
    return {"ok": True}


@router.patch("/blocks/{block_id}/stage-sequence")
async def set_block_sequence(block_id: str, body: SeqIn, request: Request, user: dict = Depends(require("masters.construction_stage.edit"))):
    block = await get_or_404(db.blocks, block_id, "Block", {"company_id": user["company_id"]})
    if any(s["status"] != "Pending" for s in block.get("construction_stages") or []):
        raise ApiError(409, "Cannot change the sequence once stages are completed; undo them first", "SEQUENCE_LOCKED")
    await _validate_seq(body.construction_stage_sequence)
    await db.blocks.update_one({"id": block_id}, {"$set": {"construction_stage_sequence": body.construction_stage_sequence, "construction_stages": [], "updated_at": now_iso()}, "$inc": {"version": 1}})
    await ensure_block_stages({**block, "construction_stage_sequence": body.construction_stage_sequence, "construction_stages": []})
    await write_audit(user, "block.stage_sequence", "block", block_id, after={"stages": len(body.construction_stage_sequence)}, ip=client_ip(request))
    return {"ok": True}


# ---------- tower construction status ----------
@router.get("/blocks/{block_id}/construction")
async def block_construction(block_id: str, user: dict = Depends(require("construction.stage.view"))):
    block = await get_or_404(db.blocks, block_id, "Block", {"company_id": user["company_id"]})
    ensure_project_access(user, block["project_id"])
    stages = await ensure_block_stages(block)
    agg = {a["_id"]: a for a in await db.demands.aggregate([{"$match": {"block_id": block_id, "voided": {"$ne": True}, "trigger_type": {"$in": ["ON_STAGE", "ON_POSSESSION"]}}}, {"$group": {"_id": "$trigger_stage_id", "n": {"$sum": 1}, "total_paise": {"$sum": "$total_demand_paise"}, "paid_paise": {"$sum": "$paid_paise"}}}]).to_list(None)}
    done = sum(1 for s in stages if s["status"] == "Completed")
    for s in stages:
        a = agg.get(s["stage_id"], {})
        s["demands"] = {"count": a.get("n", 0), "total_paise": a.get("total_paise", 0), "paid_paise": a.get("paid_paise", 0)}
    cur = next((s for s in reversed(stages) if s["status"] == "Completed"), None)
    return present_money({"block": {k: block.get(k) for k in ("id", "name", "code", "version")}, "construction_percent": round(done * 100 / len(stages)) if stages else 0, "stages": stages, "current_stage": cur, "next_stage": next((s for s in stages if s["status"] == "Pending"), None),
                          "active_bookings": await db.bookings.count_documents({"block_id": block_id, "status": "Active"})})


class StageSetIn(StrictModel):
    stage_id: str
    completed_on: date
    dates: dict[str, date] = {}
    notes: str | None = Field(default=None, max_length=500)
    visible_to_customers: bool | None = None
    in_progress: bool = False
    version: int | None = None


@router.post("/blocks/{block_id}/construction/stage")
async def set_current_stage(block_id: str, body: StageSetIn, request: Request, user: dict = Depends(require_any("construction.stage.update", "construction.update.complete"))):
    """Mark `stage_id` (and all earlier pending stages) Completed; raise plan installments for Active bookings."""
    block = await get_or_404(db.blocks, block_id, "Block", {"company_id": user["company_id"]})
    ensure_project_access(user, block["project_id"])
    stages = await ensure_block_stages(block)
    target = next((s for s in stages if s["stage_id"] == body.stage_id), None)
    if not target:
        raise ApiError(404, "Stage is not in this block's sequence", "NOT_FOUND")
    if body.in_progress:
        for s in stages:
            if s["stage_id"] == body.stage_id and s["status"] == "Pending":
                s.update(status="In Progress", started_on=body.completed_on.isoformat())
        await db.blocks.update_one({"id": block_id}, {"$set": {"construction_stages": stages, "milestones": legacy_milestones(stages), "updated_at": now_iso()}, "$inc": {"version": 1}})
        return {"ok": True, "marked": [], "demands_raised": 0}
    if target["status"] == "Completed":
        raise ApiError(409, "Stage already completed", "ALREADY_COMPLETED")
    ts = now_iso()
    marked = []
    last_date = max((s["completed_on"] for s in stages if s["status"] == "Completed" and s.get("completed_on")), default=None)
    for s in stages:
        if s["seq"] <= target["seq"] and s["status"] != "Completed":
            d = body.dates.get(s["stage_id"], body.completed_on).isoformat()
            if last_date and d < last_date:
                raise ApiError(422, f"{s['name']}: completed_on cannot be before the previous stage ({last_date})", "VALIDATION_ERROR")
            last_date = d
            s.update(status="Completed", completed_on=d, completed_at=ts, completed_by=user["id"], completed_by_name=user["name"], notes=body.notes if s["stage_id"] == body.stage_id else s.get("notes"))
            if body.visible_to_customers is not None and s["stage_id"] == body.stage_id:
                s["visible_to_customers"] = body.visible_to_customers
            marked.append({"stage_id": s["stage_id"], "name": s["name"], "completed_on": d})
    done = sum(1 for s in stages if s["status"] == "Completed")
    ver = expected_version(request, body.version)
    q = {"id": block_id, **({"version": ver} if ver is not None else {})}
    res = await db.blocks.find_one_and_update(q, {"$set": {"construction_stages": stages, "milestones": legacy_milestones(stages), "construction_percent": round(done * 100 / len(stages)), "updated_at": ts}, "$inc": {"version": 1}}, projection={"_id": 0}, return_document=True)
    if not res:
        raise ApiError(409, "Block was modified by someone else. Reload and retry.", "VERSION_CONFLICT")
    created = []
    from services.portal_notify import notify_booking_parties
    async for b in db.bookings.find({"block_id": block_id, "status": "Active"}, {"_id": 0}):
        created += await raise_due_installments(b, posted_at=ts, actor=user)
        for m in marked:
            st = next((s for s in stages if s["stage_id"] == m["stage_id"]), {})
            if st.get("visible_to_customers", True):
                await notify_booking_parties(b, "stage.completed", f"Construction update: {m['name']} completed", f"{res.get('name', '')} · {m['name']} completed on {m['completed_on']} · {round(done * 100 / len(stages))}% done", "block", block_id, {"stage_id": m["stage_id"]})
    audit_id = await write_audit(user, "construction.stage_complete", "block", block_id, after={"stage": target["name"], "marked": [m["name"] for m in marked], "demands_raised": len(created), "demands_total_paise": sum(d.get("total_demand_paise", 0) for d in created)}, ip=client_ip(request))
    return present_money({"block": {k: res.get(k) for k in ("id", "construction_percent", "version")}, "marked": marked, "demands_raised": len(created), "demands": created, "demands_total_paise": sum(d.get("total_demand_paise", 0) for d in created), "audit_id": audit_id, "stage_name": target["name"]})


class UndoIn(StrictModel):
    reason: str = Field(min_length=3, max_length=500)
    version: int | None = None


@router.post("/blocks/{block_id}/construction/undo")
async def undo_stage(block_id: str, body: UndoIn, request: Request, user: dict = Depends(require_any("construction.stage.undo", "construction.update.undo"))):
    block = await get_or_404(db.blocks, block_id, "Block", {"company_id": user["company_id"]})
    stages = await ensure_block_stages(block)
    done = [s for s in stages if s["status"] == "Completed"]
    if not done:
        raise ApiError(409, "No completed stage to undo", "NOTHING_TO_UNDO")
    last = done[-1]
    dem_q = {"block_id": block_id, "voided": {"$ne": True}, "trigger_stage_id": last["stage_id"]}
    async for d in db.demands.find({**dem_q, "paid_paise": {"$gt": 0}}, {"_id": 0, "booking_id": 1, "demand_date": 1}):
        # only a payment received after the demand was raised counts; earlier advances auto-allocated FIFO do not block undo
        if await db.payments.count_documents({"booking_id": d["booking_id"], "status": {"$nin": ["Reversed", "Bounced", "Cancelled"]}, "payment_date": {"$gte": d["demand_date"]}}):
            raise ApiError(409, "A demand raised by this stage already has a payment; undo is blocked", "UNDO_BLOCKED_BY_PAYMENTS")
    ts = now_iso()
    for s in stages:
        if s["stage_id"] == last["stage_id"]:
            s.update(status="Pending", completed_on=None, completed_at=None, completed_by=None, completed_by_name=None, started_on=None, notes=None)
    n_done = len(done) - 1
    ver = expected_version(request, body.version)
    q = {"id": block_id, **({"version": ver} if ver is not None else {})}
    res = await db.blocks.find_one_and_update(q, {"$set": {"construction_stages": stages, "milestones": legacy_milestones(stages), "construction_percent": round(n_done * 100 / len(stages)), "updated_at": ts}, "$inc": {"version": 1}}, projection={"_id": 0}, return_document=True)
    if not res:
        raise ApiError(409, "Block was modified by someone else. Reload and retry.", "VERSION_CONFLICT")
    to_void = await db.demands.find(dem_q, {"_id": 0, "id": 1, "demand_number": 1}).to_list(None)
    voided = await db.demands.update_many(dem_q, {"$set": {"voided": True, "voided_at": ts, "voided_by": user["id"], "void_reason": body.reason, "status": "Voided"}})
    from services.portal_notify import retract_for_demands, retract_for_stage
    retracted = await retract_for_demands(to_void)
    rs = await retract_for_stage(block_id, last["stage_id"], last["name"])
    retracted = {k: retracted[k] + rs[k] for k in retracted}
    async for b in db.bookings.find({"block_id": block_id, "status": "Active"}, {"_id": 0}):
        rem = await db.demands.find({"booking_id": b["id"], "voided": {"$ne": True}}, {"_id": 0, "percent": 1, "cumulative_percent": 1}).to_list(None)
        cum = round(sum(d.get("percent") or 0 for d in rem), 2) if all(d.get("percent") is not None for d in rem) else max((d.get("cumulative_percent") or 0 for d in rem), default=0)
        await db.bookings.update_one({"id": b["id"]}, {"$set": {"raised_percent": cum, "construction_percent": cum}})
        await rebuild(b["id"])
    audit_id = await write_audit(user, "construction.undo", "block", block_id, before={"stage": last["name"]}, after={"reason": body.reason, "demands_voided": voided.modified_count, "notifications": retracted}, ip=client_ip(request))
    return present_money({"block": {k: res.get(k) for k in ("id", "construction_percent", "version")}, "demands_voided": voided.modified_count, "notifications_retracted": retracted, "audit_id": audit_id, "stage_name": last["name"]})


# ---------- payment plan assignments ----------
class AssignIn(StrictModel):
    payment_plan_id: str
    project_id: str
    block_id: str | None = None
    is_default: bool = False
    effective_from: date | None = None
    effective_to: date | None = None
    is_active: bool = True


async def _check_plan_fits(plan: dict, block: dict, project_wide: bool = False):
    need = {i["trigger_stage_id"] for i in plan["installments"] if i["trigger_type"] == "ON_STAGE" and i.get("trigger_stage_id")}
    if not need:
        return
    if project_wide and await db.construction_stage_plans.find_one({"block_id": block["id"], "is_active": True}, {"_id": 0, "id": 1}):
        return  # Phase M: a tower with its own stage plan takes tower-wise payment plans; project-wide templates are not validated against it
    have = {s["stage_id"] for s in await stage_sequence_for_block(block)}
    missing = need - have
    if missing:
        names = [s["name"] for s in await db.construction_stages.find({"id": {"$in": list(missing)}}, {"_id": 0, "name": 1}).to_list(None)]
        raise ApiError(409, f"Plan '{plan['name']}' needs stages missing from {block['name']}'s sequence: {', '.join(names)}", "PLAN_STAGES_MISSING")


@router.get("/payment-plan-assignments")
async def list_assignments(project_id: str | None = None, payment_plan_id: str | None = None, user: dict = Depends(require("masters.payment_plan.view"))):
    q = {"company_id": user["company_id"], "is_active": True}
    if project_id:
        q["project_id"] = project_id
    if payment_plan_id:
        q["payment_plan_id"] = payment_plan_id
    return {"items": await db.payment_plan_assignments.find(q, {"_id": 0}).to_list(500)}


@router.post("/payment-plan-assignments", status_code=201)
async def assign_plan(body: AssignIn, request: Request, user: dict = Depends(require("masters.payment_plan.assign"))):
    plan = await get_or_404(db.payment_plans, body.payment_plan_id, "Payment plan", {"is_active": True})
    project = await get_or_404(db.projects, body.project_id, "Project", {"company_id": user["company_id"]})
    blocks = [await get_or_404(db.blocks, body.block_id, "Block", {"project_id": body.project_id})] if body.block_id else await db.blocks.find({"project_id": body.project_id, "is_active": True}, {"_id": 0}).to_list(None)
    for blk in blocks:
        await _check_plan_fits(plan, blk)
    doc = {"id": new_id(), "company_id": user["company_id"], **body.model_dump(mode="json"), "plan_name": plan["name"], "plan_code": plan.get("code"), "project_name": project["name"], "block_name": blocks[0]["name"] if body.block_id else None, "created_at": now_iso(), "created_by": user["id"]}
    if body.is_default:
        await db.payment_plan_assignments.update_many({"project_id": body.project_id, "block_id": body.block_id, "is_active": True}, {"$set": {"is_default": False}})
    await db.payment_plan_assignments.update_one({"payment_plan_id": body.payment_plan_id, "project_id": body.project_id, "block_id": body.block_id}, {"$set": doc}, upsert=True)
    await write_audit(user, "payment_plan.assign", "project", body.project_id, after={"plan": plan["name"], "block_id": body.block_id, "is_default": body.is_default}, ip=client_ip(request))
    return doc


@router.delete("/payment-plan-assignments/{assignment_id}")
async def unassign_plan(assignment_id: str, request: Request, user: dict = Depends(require("masters.payment_plan.assign"))):
    r = await db.payment_plan_assignments.update_one({"id": assignment_id, "company_id": user["company_id"]}, {"$set": {"is_active": False}})
    if not r.matched_count:
        raise ApiError(404, "Assignment not found", "NOT_FOUND")
    await write_audit(user, "payment_plan.unassign", "payment_plan_assignment", assignment_id, ip=client_ip(request))
    return {"ok": True}


async def applicable_plans(project_id: str, block_id: str) -> list[dict]:
    today = clock.today().isoformat()
    asg = await db.payment_plan_assignments.find({"project_id": project_id, "is_active": True, "$or": [{"block_id": block_id}, {"block_id": None}], "$and": [{"$or": [{"effective_from": None}, {"effective_from": {"$lte": today}}]}, {"$or": [{"effective_to": None}, {"effective_to": {"$gte": today}}]}]}, {"_id": 0}).to_list(None)
    plans = {p["id"]: p for p in await db.payment_plans.find({"id": {"$in": [a["payment_plan_id"] for a in asg]}, "is_active": True}, {"_id": 0}).to_list(None)}
    seen, out = set(), []
    for a in sorted(asg, key=lambda a: (not a.get("is_default"), a.get("block_id") is None, a.get("plan_name") or "")):
        p = plans.get(a["payment_plan_id"])
        if p and p["id"] not in seen:
            seen.add(p["id"])
            out.append({**p, "is_default": bool(a.get("is_default")), "assignment_scope": "block" if a.get("block_id") else "project", "installments": [{**i, "trigger_label": trigger_label(i)} for i in p["installments"]]})
    return out


@router.get("/projects/{project_id}/blocks/{block_id}/payment-plans")
async def block_payment_plans(project_id: str, block_id: str, user: dict = Depends(require("masters.payment_plan.view"))):
    return {"items": await applicable_plans(project_id, block_id)}


# ---------- booking plan & schedule ----------
async def build_snapshot(plan: dict) -> dict:
    names = {s["id"]: s["name"] for s in await db.construction_stages.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(None)}
    ins = [{**i, "trigger_stage_name": names.get(i.get("trigger_stage_id"))} for i in sorted(plan["installments"], key=lambda x: x["seq"])]
    return {"id": plan["id"], "name": plan["name"], "code": plan.get("code"), "plan_type": plan.get("plan_type"), "grace_days": plan.get("grace_days", 0), "installments": ins}


@router.get("/bookings/{booking_id}/schedule")
async def booking_schedule(booking_id: str, user: dict = Depends(require("sales.agreement.view"))):
    b = await get_or_404(db.bookings, booking_id, "Booking", {"company_id": user["company_id"]})
    block = await db.blocks.find_one({"id": b["block_id"]}, {"_id": 0, "construction_stages": 1}) or {}
    demands = await db.demands.find({"booking_id": booking_id}, {"_id": 0}).to_list(None)
    rows = schedule(b, block, demands)
    return present_money({"plan": {k: (b.get("payment_plan_snapshot") or {}).get(k) for k in ("id", "name", "code", "plan_type")}, "acceptance": b.get("plan_acceptance"), "items": rows, "next": next((r for r in rows if r["status"] == "Not yet due"), None)})


class PlanChangeIn(StrictModel):
    payment_plan_id: str
    reason: str = Field(min_length=3, max_length=500)
    acceptance_mode: str = "In person"
    version: int | None = None


@router.post("/bookings/{booking_id}/payment-plan")
async def change_booking_plan(booking_id: str, body: PlanChangeIn, request: Request, user: dict = Depends(require("masters.payment_plan.assign"))):
    b = await get_or_404(db.bookings, booking_id, "Booking", {"company_id": user["company_id"], "status": "Active"})
    if await db.demands.count_documents({"booking_id": booking_id, "voided": {"$ne": True}, "paid_paise": {"$gt": 0}}):
        raise ApiError(409, "An installment demand already has a payment; plan cannot be changed", "PLAN_LOCKED")
    plan = await get_or_404(db.payment_plans, body.payment_plan_id, "Payment plan", {"is_active": True})
    if plan["id"] not in {p["id"] for p in await applicable_plans(b["project_id"], b["block_id"])}:
        raise ApiError(409, "Plan is not assigned to this tower", "PLAN_NOT_APPLICABLE")
    ts = now_iso()
    await db.demands.update_many({"booking_id": booking_id, "voided": {"$ne": True}}, {"$set": {"voided": True, "voided_at": ts, "voided_by": user["id"], "void_reason": f"Plan change: {body.reason}", "status": "Voided"}})
    snap = await build_snapshot(plan)
    rev = {"at": ts, "by": user["id"], "by_name": user["name"], "from_plan": (b.get("payment_plan_snapshot") or {}).get("name"), "to_plan": plan["name"], "reason": body.reason}
    await db.bookings.update_one({"id": booking_id}, {"$set": {"payment_plan_id": plan["id"], "payment_plan_snapshot": snap, "plan_acceptance": {"accepted_on": ts[:10], "accepted_by_user_id": user["id"], "mode": body.acceptance_mode}, "raised_percent": 0, "construction_percent": 0, "updated_at": ts}, "$push": {"plan_revisions": rev}, "$inc": {"version": 1}})
    fresh = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    created = await raise_due_installments(fresh, posted_at=ts, actor=user)
    await rebuild(booking_id)
    await write_audit(user, "booking.plan_change", "booking", booking_id, before={"plan": rev["from_plan"]}, after={"plan": plan["name"], "reason": body.reason, "demands_raised": len(created)}, ip=client_ip(request))
    return present_money({"ok": True, "plan": snap["name"], "demands_raised": len(created)})


# ---------- forecast report ----------
@router.get("/reports/upcoming-dues")
async def upcoming_dues(days: int = 90, project_id: str | None = None, format: str | None = None, user: dict = Depends(require("reports.receivables_forecast.view"))):
    from datetime import timedelta
    horizon = (clock.today() + timedelta(days=days)).isoformat()
    q = {"company_id": user["company_id"], "status": "Active", "payment_plan_snapshot": {"$ne": None}}
    if project_id:
        q["project_id"] = project_id
    rows = []
    async for bk in db.bookings.find(q, {"_id": 0}):
        blk = await db.blocks.find_one({"id": bk["block_id"]}, {"_id": 0, "construction_stages": 1}) or {}
        for r in schedule(bk, blk, await db.demands.find({"booking_id": bk["id"]}, {"_id": 0}).to_list(None)):
            if r["status"] == "Not yet due" and (r["expected_date"] is None or r["expected_date"] <= horizon):
                rows.append({"booking_number": bk["booking_number"], "customer_name": bk.get("customer_name"), "project_name": bk["project_name"], "block_name": bk["block_name"], "installment": r["name"], "percent": r["percent"], "trigger": r["trigger_label"], "expected_date": r["expected_date"], "cash_paise": r["cash_expected_paise"], "account_paise": r["account_expected_paise"], "total_paise": r["total_expected_paise"]})
    rows.sort(key=lambda x: (x["expected_date"] is None, x["expected_date"] or ""))
    out = present_money({"items": rows, "total_paise": sum(r["total_paise"] for r in rows), "dated_total_paise": sum(r["total_paise"] for r in rows if r["expected_date"]), "horizon_days": days})
    if format == "csv":
        from fastapi import Response
        from utils import to_csv
        return Response(to_csv(out["items"], ["booking_number", "customer_name", "project_name", "block_name", "installment", "percent", "trigger", "expected_date", "cash", "account", "total"]), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=upcoming-dues.csv"})
    return out


# ---------- admin ----------
@router.post("/admin/run-dues")
async def run_dues(request: Request, as_of: date | None = None, user: dict = Depends(require("admin.data.recompute"))):
    res = await run_dues_for_all(as_of, actor=user)
    await write_audit(user, "dues.run", "system", "dues", after=res, ip=client_ip(request))
    return res


@router.get("/admin/integrity-report")
async def integrity_report_route(as_of: date | None = None, fresh: bool = False, user: dict = Depends(require("admin.system_health.view"))):
    if user.get("role_name") != "Super Admin":
        raise ApiError(403, "Super Admin only", "FORBIDDEN")
    from services.integrity import integrity_report
    cached = await db.settings.find_one({"key": "integrity_last_report"}, {"_id": 0, "value": 1})
    if not fresh and not as_of and cached and cached.get("value"):
        return present_money({**cached["value"], "cached": True})
    rep = await integrity_report(as_of)
    if not as_of:
        await db.settings.update_one({"key": "integrity_last_report"}, {"$set": {"value": rep}}, upsert=True)
    return present_money(rep)


class RepairIn(StrictModel):
    confirm: str


@router.post("/admin/integrity-repair")
async def integrity_repair_route(body: RepairIn, request: Request, user: dict = Depends(require("admin.data.recompute"))):
    if user.get("role_name") != "Super Admin":
        raise ApiError(403, "Super Admin only", "FORBIDDEN")
    if body.confirm != "REPAIR":
        raise ApiError(400, 'Type "REPAIR" to confirm', "CONFIRM_REQUIRED")
    from services.integrity import repair
    res = await repair(actor=user)
    await write_audit(user, "integrity.repair", "system", "dues", after={k: v for k, v in res.items() if k != "skipped"} | {"skipped": len(res["skipped"])}, ip=client_ip(request))
    return present_money(res)


@router.get("/admin/migration-report")
async def migration_report(user: dict = Depends(require("admin.system_health.view"))):
    return (await db.settings.find_one({"key": "migration_phase7_report"}, {"_id": 0}) or {}).get("value") or {"status": "not run"}
