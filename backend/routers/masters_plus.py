"""Phase M: Construction Stage Plans (named, per tower), structured Payment Plans (project+tower, % per stage), Where-used, Construction-update preview."""
from fastapi import APIRouter, Depends, Request
from pydantic import Field

from db import db
from deps import ensure_project_access, require
from routers.construction import ensure_block_stages, legacy_milestones, stage_sequence_for_block
from services.money import pct_of, present_money
from utils import ApiError, StrictModel, base_doc, client_ip, get_or_404, now_iso, write_audit

router = APIRouter(tags=["masters-plus"])


class StagePlanIn(StrictModel):
    name: str = Field(min_length=2, max_length=80)
    project_id: str
    block_id: str
    stage_ids: list[str] = Field(min_length=1)
    version: int | None = None


class CopyIn(StrictModel):
    block_ids: list[str] = Field(min_length=1)


class PlanRow(StrictModel):
    stage_id: str
    percent: float = Field(ge=0, le=100)


class StructuredPlanIn(StrictModel):
    name: str = Field(min_length=2, max_length=80)
    project_id: str
    block_id: str
    stage_plan_id: str
    rows: list[PlanRow] = Field(min_length=1)
    applies_percent_to: str = "BOTH_BUCKETS"
    grace_days: int = Field(default=0, ge=0, le=365)
    due_days: int = Field(default=15, ge=0, le=365)
    advanced: list[dict] = []  # optional DAYS_AFTER_BOOKING / ON_DATE installments (kept behind the Advanced disclosure)


async def _stages(company_id: str) -> dict:
    return {s["id"]: s for s in await db.construction_stages.find({"company_id": company_id}, {"_id": 0}).to_list(None)}


async def _apply_sequence(block: dict, stage_ids: list[str], stages: dict):
    """Set the tower's stage sequence from a plan, preserving completed records; the engine reads blocks.construction_stages."""
    existing = {s["stage_id"]: s for s in (block.get("construction_stages") or [])}
    seq_doc, recs = [], []
    for i, sid in enumerate(stage_ids, 1):
        s = stages[sid]
        seq_doc.append({"stage_id": sid, "seq": i})
        old = existing.get(sid) or {"status": "Pending"}
        recs.append({**old, "stage_id": sid, "seq": i, "name": s["name"], "code": s.get("code"), "is_possession": bool(s.get("is_possession"))})
    done = sum(1 for r in recs if r["status"] == "Completed")
    await db.blocks.update_one({"id": block["id"]}, {"$set": {"construction_stage_sequence": seq_doc, "construction_stages": recs, "milestones": legacy_milestones(recs), "construction_percent": round(done * 100 / len(recs)), "updated_at": now_iso()}, "$inc": {"version": 1}})


async def stage_where_used(stage_id: str, company_id: str) -> dict:
    plans = await db.construction_stage_plans.find({"company_id": company_id, "is_active": True, "stage_ids": stage_id}, {"_id": 0, "id": 1, "name": 1, "block_name": 1}).to_list(None)
    pplans = await db.payment_plans.find({"company_id": company_id, "is_active": True, "installments.trigger_stage_id": stage_id}, {"_id": 0, "id": 1, "name": 1}).to_list(None)
    blocks = await db.blocks.find({"company_id": company_id, "construction_stages": {"$elemMatch": {"stage_id": stage_id, "status": "Completed"}}}, {"_id": 0, "id": 1, "name": 1, "project_name": 1}).to_list(None)
    bookings = await db.bookings.count_documents({"company_id": company_id, "status": "Active", "payment_plan_snapshot.installments.trigger_stage_id": stage_id})
    refs = [{"type": "stage_plan", "id": p["id"], "label": p["name"]} for p in plans] + [{"type": "payment_plan", "id": p["id"], "label": p["name"]} for p in pplans] + [{"type": "tower_completed", "id": b["id"], "label": f"{b.get('project_name', '')} {b['name']}"} for b in blocks]
    return {"count": len(refs) + bookings, "references": refs, "active_bookings": bookings}


# ---------------- Construction Stage master extras ----------------
@router.get("/master/construction-stages/{stage_id}/where-used")
async def stage_usage(stage_id: str, user: dict = Depends(require("masters.construction_stage.view"))):
    await get_or_404(db.construction_stages, stage_id, "Stage", {"company_id": user["company_id"]})
    return await stage_where_used(stage_id, user["company_id"])


# ---------------- Stage plans ----------------
@router.get("/stage-plans")
async def list_stage_plans(project_id: str | None = None, block_id: str | None = None, user: dict = Depends(require("masters.stage_plan.view"))):
    from tools.migrate_phase_m import ensure_booking_stage
    await ensure_booking_stage(user["company_id"])
    q = {"company_id": user["company_id"], **({"project_id": project_id} if project_id else {}), **({"block_id": block_id} if block_id else {})}
    items = await db.construction_stage_plans.find(q, {"_id": 0}).sort("name", 1).to_list(500)
    stages = await _stages(user["company_id"])
    for it in items:
        it["stages"] = [{"stage_id": s, "seq": i + 1, "name": stages.get(s, {}).get("name")} for i, s in enumerate(it["stage_ids"])]
    return {"items": items, "total": len(items)}


@router.get("/stage-plans/{plan_id}")
async def get_stage_plan(plan_id: str, user: dict = Depends(require("masters.stage_plan.view"))):
    p = await get_or_404(db.construction_stage_plans, plan_id, "Stage plan", {"company_id": user["company_id"]})
    stages = await _stages(user["company_id"])
    return {**p, "stages": [{"stage_id": s, "seq": i + 1, "name": stages.get(s, {}).get("name")} for i, s in enumerate(p["stage_ids"])]}


@router.get("/stage-plans/{plan_id}/where-used")
async def stage_plan_usage(plan_id: str, user: dict = Depends(require("masters.stage_plan.view"))):
    p = await get_or_404(db.construction_stage_plans, plan_id, "Stage plan", {"company_id": user["company_id"]})
    pplans = await db.payment_plans.find({"stage_plan_id": plan_id, "is_active": True}, {"_id": 0, "id": 1, "name": 1}).to_list(None)
    blk = await db.blocks.find_one({"id": p["block_id"]}, {"_id": 0, "construction_stages": 1})
    done = [s["name"] for s in (blk or {}).get("construction_stages") or [] if s["status"] == "Completed"]
    bookings = await db.bookings.count_documents({"block_id": p["block_id"], "status": "Active"})
    return {"count": len(pplans) + len(done), "references": [{"type": "payment_plan", "id": x["id"], "label": x["name"]} for x in pplans] + [{"type": "completed_stage", "id": n, "label": n} for n in done], "active_bookings": bookings}


async def _validate_plan(body: StagePlanIn, user: dict, exclude_id: str | None = None) -> tuple[dict, dict]:
    block = await get_or_404(db.blocks, body.block_id, "Tower", {"company_id": user["company_id"], "project_id": body.project_id})
    ensure_project_access(user, body.project_id)
    stages = await _stages(user["company_id"])
    if len(set(body.stage_ids)) != len(body.stage_ids):
        raise ApiError(422, "A stage cannot appear twice in a plan", "VALIDATION_ERROR", {"field": "stage_ids"})
    missing = [s for s in body.stage_ids if s not in stages]
    if missing:
        raise ApiError(422, "Unknown stage in plan", "VALIDATION_ERROR", {"field": "stage_ids", "missing": missing})
    dup = await db.construction_stage_plans.find_one({"company_id": user["company_id"], "project_id": body.project_id, "block_id": body.block_id, "is_active": True, "id": {"$ne": exclude_id}}, {"_id": 0, "id": 1, "name": 1})
    return block, stages | {"__dup__": dup} if dup else stages


@router.post("/stage-plans", status_code=201)
async def create_stage_plan(body: StagePlanIn, request: Request, user: dict = Depends(require("masters.stage_plan.create"))):
    block, stages = await _validate_plan(body, user)
    if "__dup__" in stages:
        raise ApiError(409, f"Tower already has an active stage plan ('{stages['__dup__']['name']}'). Edit it or deactivate it first.", "STAGE_PLAN_EXISTS", {"existing_id": stages["__dup__"]["id"]})
    project = await db.projects.find_one({"id": body.project_id}, {"_id": 0, "name": 1})
    doc = {**base_doc(user, user["company_id"]), "name": body.name.strip(), "project_id": body.project_id, "project_name": (project or {}).get("name"), "block_id": body.block_id, "block_name": block["name"], "stage_ids": body.stage_ids, "is_active": True}
    await db.construction_stage_plans.insert_one(doc)
    await _apply_sequence(block, body.stage_ids, stages)
    doc.pop("_id", None)
    await write_audit(user, "stage_plan.create", "stage_plan", doc["id"], after={"name": doc["name"], "tower": block["name"], "stages": [stages[s]["name"] for s in body.stage_ids]}, ip=client_ip(request))
    return doc


@router.patch("/stage-plans/{plan_id}")
async def update_stage_plan(plan_id: str, body: StagePlanIn, request: Request, user: dict = Depends(require("masters.stage_plan.edit"))):
    before = await get_or_404(db.construction_stage_plans, plan_id, "Stage plan", {"company_id": user["company_id"]})
    block, stages = await _validate_plan(body, user, exclude_id=plan_id)
    stages.pop("__dup__", None)
    removed = [s for s in before["stage_ids"] if s not in body.stage_ids]
    if removed:
        blk_stages = {s["stage_id"]: s for s in block.get("construction_stages") or []}
        blocked = [stages[s]["name"] for s in removed if blk_stages.get(s, {}).get("status") == "Completed" or await db.payment_plans.count_documents({"stage_plan_id": plan_id, "is_active": True, "installments.trigger_stage_id": s})]
        if blocked:
            raise ApiError(409, f"Cannot remove {', '.join(blocked)}: completed on this tower or referenced by a payment plan (see Where used). Append or reorder pending stages instead.", "STAGE_IN_USE", {"stages": blocked})
    await db.construction_stage_plans.update_one({"id": plan_id}, {"$set": {"name": body.name.strip(), "stage_ids": body.stage_ids, "updated_at": now_iso()}, "$inc": {"version": 1}})
    await _apply_sequence(block, body.stage_ids, stages)
    after = await db.construction_stage_plans.find_one({"id": plan_id}, {"_id": 0})
    await write_audit(user, "stage_plan.update", "stage_plan", plan_id, before={"name": before["name"], "stages": [stages.get(s, {}).get("name") for s in before["stage_ids"]]}, after={"name": after["name"], "stages": [stages[s]["name"] for s in body.stage_ids]}, ip=client_ip(request))
    return after


@router.delete("/stage-plans/{plan_id}")
async def deactivate_stage_plan(plan_id: str, request: Request, user: dict = Depends(require("masters.stage_plan.delete"))):
    p = await get_or_404(db.construction_stage_plans, plan_id, "Stage plan", {"company_id": user["company_id"]})
    used = await stage_plan_usage(plan_id, user)
    if used["count"]:
        raise ApiError(409, f"Stage plan is in use ({used['count']} references). Remove the payment plans first.", "IN_USE", used)
    await db.construction_stage_plans.update_one({"id": plan_id}, {"$set": {"is_active": False, "updated_at": now_iso()}})
    await write_audit(user, "stage_plan.deactivate", "stage_plan", plan_id, before={"is_active": True}, after={"is_active": False, "name": p["name"]}, ip=client_ip(request))
    return {"ok": True}


@router.post("/stage-plans/{plan_id}/copy", status_code=201)
async def copy_stage_plan(plan_id: str, body: CopyIn, request: Request, user: dict = Depends(require("masters.stage_plan.create"))):
    src = await get_or_404(db.construction_stage_plans, plan_id, "Stage plan", {"company_id": user["company_id"]})
    out = []
    for bid in body.block_ids:
        blk = await get_or_404(db.blocks, bid, "Tower", {"project_id": src["project_id"]})
        if await db.construction_stage_plans.find_one({"block_id": bid, "is_active": True}):
            continue
        out.append(await create_stage_plan(StagePlanIn(name=f"{src['name']} — {blk['name']}", project_id=src["project_id"], block_id=bid, stage_ids=src["stage_ids"]), request, user))
    return {"items": out, "copied": len(out)}


# ---------------- Structured payment plans (project + tower, % per stage) ----------------
@router.get("/payment-plans/structured")
async def list_structured(project_id: str | None = None, block_id: str | None = None, user: dict = Depends(require("masters.payment_plan.view"))):
    q = {"company_id": user["company_id"], "is_active": True, **({"project_id": project_id} if project_id else {}), **({"block_id": block_id} if block_id else {})}
    items = await db.payment_plans.find(q, {"_id": 0}).sort("name", 1).to_list(500)
    return {"items": items, "total": len(items)}


@router.post("/payment-plans/structured", status_code=201)
async def create_structured(body: StructuredPlanIn, request: Request, user: dict = Depends(require("masters.payment_plan.create"))):
    sp = await get_or_404(db.construction_stage_plans, body.stage_plan_id, "Stage plan", {"company_id": user["company_id"], "project_id": body.project_id, "block_id": body.block_id})
    ensure_project_access(user, body.project_id)
    stages = await _stages(user["company_id"])
    ids = [r.stage_id for r in body.rows]
    if len(set(ids)) != len(ids):
        raise ApiError(422, "The same stage cannot appear twice", "VALIDATION_ERROR", {"field": "rows", "duplicate": [s for s in ids if ids.count(s) > 1][0]})
    outside = [s for s in ids if s not in sp["stage_ids"]]
    if outside:
        raise ApiError(422, "Row stage is not part of the selected stage plan", "VALIDATION_ERROR", {"field": "rows", "stage_ids": outside})
    total = round(sum(r.percent for r in body.rows) + sum(float(a.get("percent") or 0) for a in body.advanced), 2)
    if total != 100.0:
        raise ApiError(422, f"Percentages must total exactly 100.00% (currently {total:.2f}%)", "VALIDATION_ERROR", {"field": "rows", "total": total})
    if await db.payment_plans.find_one({"company_id": user["company_id"], "project_id": body.project_id, "block_id": body.block_id, "is_active": True, "name": {"$regex": f"^{body.name.strip()}$", "$options": "i"}}):
        raise ApiError(409, "A payment plan with this name already exists for this project & tower", "DUPLICATE_NAME", {"field": "name"})
    order = {s: i for i, s in enumerate(sp["stage_ids"])}
    installments, seq = [], 0
    for r in sorted(body.rows, key=lambda r: order[r.stage_id]):
        if r.percent <= 0:
            continue
        seq += 1
        st = stages[r.stage_id]
        booking_stage = bool(st.get("auto_complete_on_booking")) or st.get("code") == "BOOKING"
        installments.append({"seq": seq, "name": st["name"], "percent": r.percent, "trigger_type": "ON_BOOKING" if booking_stage else "ON_STAGE", "trigger_days": None, "trigger_stage_id": None if booking_stage else r.stage_id, "trigger_date": None, "due_days": body.due_days, "notes": None})
    for a in body.advanced:
        seq += 1
        installments.append({"seq": seq, "name": a.get("name") or a["trigger_type"].replace("_", " ").title(), "percent": float(a["percent"]), "trigger_type": a["trigger_type"], "trigger_days": a.get("trigger_days"), "trigger_stage_id": None, "trigger_date": a.get("trigger_date"), "due_days": body.due_days, "notes": None})
    if not installments:
        raise ApiError(422, "At least one row with a percentage is required", "VALIDATION_ERROR", {"field": "rows"})
    block = await db.blocks.find_one({"id": body.block_id}, {"_id": 0, "name": 1})
    project = await db.projects.find_one({"id": body.project_id}, {"_id": 0, "name": 1})
    plan = {**base_doc(user, user["company_id"]), "name": body.name.strip(), "code": body.name.strip().upper().replace(" ", "_")[:40], "description": f"{(project or {}).get('name')} · {(block or {}).get('name')} · stage plan {sp['name']}", "plan_type": "CLP",
            "installments": installments, "applies_percent_to": body.applies_percent_to, "grace_days": body.grace_days, "is_active": True, "project_id": body.project_id, "block_id": body.block_id, "stage_plan_id": sp["id"], "stage_plan_name": sp["name"]}
    await db.payment_plans.insert_one(plan)
    asg = {**base_doc(user, user["company_id"]), "payment_plan_id": plan["id"], "plan_name": plan["name"], "plan_code": plan["code"], "project_id": body.project_id, "project_name": (project or {}).get("name"), "block_id": body.block_id, "block_name": (block or {}).get("name"), "is_default": False, "is_active": True, "effective_from": None, "effective_to": None}
    await db.payment_plan_assignments.insert_one(asg)
    plan.pop("_id", None)
    await write_audit(user, "payment_plan.create", "payment_plan", plan["id"], after={"name": plan["name"], "tower": (block or {}).get("name"), "stage_plan": sp["name"], "rows": [(i["name"], i["percent"]) for i in installments]}, ip=client_ip(request))
    return plan


@router.get("/payment-plans/{plan_id}/where-used")
async def payment_plan_usage(plan_id: str, user: dict = Depends(require("masters.payment_plan.view"))):
    await get_or_404(db.payment_plans, plan_id, "Payment plan", {"company_id": user["company_id"]})
    bks = await db.bookings.find({"payment_plan_id": plan_id}, {"_id": 0, "id": 1, "booking_number": 1, "status": 1}).to_list(200)
    asg = await db.payment_plan_assignments.find({"payment_plan_id": plan_id, "is_active": True}, {"_id": 0, "id": 1, "project_name": 1, "block_name": 1}).to_list(None)
    return {"count": len(bks) + len(asg), "references": [{"type": "booking", "id": b["id"], "label": f"{b['booking_number']} ({b['status']})"} for b in bks] + [{"type": "assignment", "id": a["id"], "label": f"{a.get('project_name')} {a.get('block_name') or '(all towers)'}"} for a in asg]}


# ---------------- Construction update: preview ----------------
@router.get("/blocks/{block_id}/stages/{stage_id}/preview")
async def preview_stage_completion(block_id: str, stage_id: str, user: dict = Depends(require("construction.update.view"))):
    """What 'Mark completed' will raise: per Active booking, the ON_STAGE installments of every pending stage up to and including this one."""
    block = await get_or_404(db.blocks, block_id, "Block", {"company_id": user["company_id"]})
    stages = await ensure_block_stages(block)
    target = next((s for s in stages if s["stage_id"] == stage_id), None)
    if not target:
        raise ApiError(404, "Stage is not in this tower's plan", "NOT_FOUND")
    will_mark = [s for s in stages if s["seq"] <= target["seq"] and s["status"] != "Completed"]
    mark_ids = {s["stage_id"] for s in will_mark}
    rows, cash, acct = [], 0, 0
    async for b in db.bookings.find({"block_id": block_id, "status": "Active"}, {"_id": 0, "id": 1, "booking_number": 1, "customer_name": 1, "cash_agreed_paise": 1, "account_agreed_paise": 1, "payment_plan_snapshot": 1, "payment_plan_id": 1}).batch_size(500):
        raised = {d["installment_seq"] for d in await db.demands.find({"booking_id": b["id"], "voided": {"$ne": True}}, {"_id": 0, "installment_seq": 1}).to_list(None)}
        ins = [i for i in (b.get("payment_plan_snapshot") or {}).get("installments", []) if i["trigger_type"] == "ON_STAGE" and i.get("trigger_stage_id") in mark_ids and i["seq"] not in raised]
        if not ins:
            continue
        c = sum(pct_of(b["cash_agreed_paise"], i["percent"]) for i in ins)
        a = sum(pct_of(b["account_agreed_paise"], i["percent"]) for i in ins)
        cash += c
        acct += a
        rows.append({"booking_id": b["id"], "booking_number": b["booking_number"], "customer_name": b.get("customer_name"), "plan_name": (b.get("payment_plan_snapshot") or {}).get("name"), "installments": [i["name"] for i in ins], "cash_paise": c, "account_paise": a, "total_paise": c + a})
    sp = await db.construction_stage_plans.find_one({"block_id": block_id, "is_active": True}, {"_id": 0, "name": 1})
    active = await db.bookings.count_documents({"block_id": block_id, "status": "Active"})
    reason = None
    if not rows:
        names = " / ".join(s["name"] for s in will_mark) or target["name"]
        reason = f"No payment plan on this tower has an installment on {names} — 0 dues will be raised ({active} active booking{'s' if active != 1 else ''})"
    return present_money({"stage": {"stage_id": target["stage_id"], "name": target["name"], "seq": target["seq"]}, "will_mark": [{"stage_id": s["stage_id"], "name": s["name"]} for s in will_mark], "stage_plan_name": (sp or {}).get("name"),
                          "bookings": rows, "bookings_count": len(rows), "active_bookings": active, "no_dues_reason": reason, "cash_paise": cash, "account_paise": acct, "total_paise": cash + acct})
