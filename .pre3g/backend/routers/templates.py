"""Phase S1 — company-level templates (Floor / Tower / Stage Plan / Payment Plan) and the one-action appliers that turn them into tower copies."""

from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import Field, model_validator

from db import db
from deps import ensure_project_access, require
from routers.construction import AssignIn, assign_plan, ensure_block_stages
from routers.masters_plus import (
    PlanRow,
    StagePlanIn,
    StructuredPlanIn,
    _stages,
    create_stage_plan,
    create_structured,
    update_stage_plan,
)
from routers.pricing import FloorPosition, _block, _save_floor
from services.flat_generation import unit_floors
from utils import ApiError, StrictModel, base_doc, client_ip, get_or_404, now_iso, write_audit

router = APIRouter(tags=["templates"])
Pattern = Literal["{block}-{floor}{pos2}", "{floor}{pos2}", "{block}{seq}"]
Trigger = Literal["on_booking", "stage", "on_possession", "days_after_booking"]


class FloorPos(StrictModel):
    pos: int = Field(ge=1, le=50)
    flat_type_id: str
    facing: str | None = Field(default=None, max_length=10)


class FloorTemplateIn(StrictModel):
    name: str = Field(min_length=1, max_length=80)
    positions: list[FloorPos] = Field(min_length=1, max_length=50)
    use_type_defaults: bool = False
    version: int | None = None

    @model_validator(mode="after")
    def _contig(self):
        if sorted(p.pos for p in self.positions) != list(range(1, len(self.positions) + 1)):
            raise ValueError("positions must be 1..N without gaps")
        return self


class FloorMap(StrictModel):
    from_floor: int = Field(alias="from", ge=0)
    to_floor: int = Field(alias="to", ge=0)
    floor_template_id: str
    model_config = {"populate_by_name": True, "extra": "forbid"}


class TowerTemplateIn(StrictModel):
    name: str = Field(min_length=1, max_length=80)
    floors: int = Field(ge=1, le=200)
    floor_start: int = Field(default=1, ge=0)
    ground_floor_label: str | None = Field(default=None, max_length=5)
    numbering_pattern: Pattern = "{block}-{floor}{pos2}"
    floor_map: list[FloorMap] = []
    refuge_floors: list[int] = []
    podium_floors: list[int] = []
    default_stage_plan_template_id: str | None = None
    default_payment_plan_template_ids: list[str] = []
    default_payment_plan_template_id: str | None = None
    version: int | None = None


class StagePlanTemplateIn(StrictModel):
    name: str = Field(min_length=1, max_length=80)
    stage_ids: list[str] = Field(min_length=1)
    version: int | None = None


class Installment(StrictModel):
    label: str = Field(min_length=1, max_length=80)
    percent: float = Field(gt=0, le=100)
    trigger: Trigger
    stage_id: str | None = None
    days: int | None = Field(default=None, ge=0, le=3650)


class PaymentPlanTemplateIn(StrictModel):
    name: str = Field(min_length=1, max_length=80)
    installments: list[Installment] = Field(min_length=1)
    version: int | None = None

    @model_validator(mode="after")
    def _total(self):
        total = round(sum(i.percent for i in self.installments), 2)
        if total != 100.0:
            raise ValueError(f"Installments must total exactly 100% (currently {total:.2f}%)")
        for i in self.installments:
            if i.trigger == "stage" and not i.stage_id:
                raise ValueError(f"'{i.label}': pick a construction stage")
            if i.trigger == "days_after_booking" and i.days is None:
                raise ValueError(f"'{i.label}': enter the number of days")
        return self


# ---------------- shaping ----------------
def _floor_tpl_out(t: dict, fts: dict) -> dict:
    pos = sorted(t.get("positions") or [], key=lambda p: p.get("position") or p.get("pos") or 0)
    names: dict[str, int] = {}
    for p in pos:
        n = (fts.get(p["flat_type_id"]) or {}).get("name") or (fts.get(p["flat_type_id"]) or {}).get("code") or "?"
        names[n] = names.get(n, 0) + 1
    return {
        **{k: v for k, v in t.items() if k != "positions"},
        "positions": [
            {"pos": p.get("position") or p.get("pos"), "flat_type_id": p["flat_type_id"], "facing": p.get("facing")}
            for p in pos
        ],
        "flats_per_floor": len(pos),
        "use_type_defaults": bool(t.get("use_type_defaults")),
        "preview": f"{len(pos)} flats: " + ", ".join(f"{c}×{n}" for n, c in names.items()),
    }


async def _flat_types(company_id: str) -> dict:
    return {
        f["id"]: f
        for f in await db.flat_types.find(
            {"company_id": company_id}, {"_id": 0, "id": 1, "name": 1, "code": 1}
        ).to_list(None)
    }


async def _tower_preview(t: dict, company_id: str) -> str:
    tids = [m["floor_template_id"] for m in t.get("floor_map") or []]
    ftpl = {
        x["id"]: x
        for x in await db.floor_plan_templates.find({"id": {"$in": tids}}, {"_id": 0, "id": 1, "positions": 1}).to_list(
            None
        )
    }
    flats = sum(
        len((ftpl.get(m["floor_template_id"]) or {}).get("positions") or []) * max(0, m["to"] - m["from"] + 1)
        for m in t.get("floor_map") or []
    )
    parts = [f"{t['floors']} floors", f"{flats} flats"]
    if t.get("default_stage_plan_template_id"):
        sp = await db.stage_plan_templates.find_one({"id": t["default_stage_plan_template_id"]}, {"_id": 0, "name": 1})
        parts.append(f"{sp['name']} stage plan" if sp else "stage plan missing")
    if t.get("default_payment_plan_template_ids"):
        pp = await db.payment_plan_templates.find(
            {"id": {"$in": t["default_payment_plan_template_ids"]}}, {"_id": 0, "id": 1, "name": 1}
        ).to_list(None)
        parts.append(
            ", ".join(
                p["name"] + (" (default)" if p["id"] == t.get("default_payment_plan_template_id") else "") for p in pp
            )
        )
    return " · ".join(parts)


def _check_version(doc: dict, version: int | None):
    if version is not None and doc.get("version") != version:
        raise ApiError(
            409,
            "This record changed since you opened it — reload and try again",
            "VERSION_CONFLICT",
            {"current": doc.get("version")},
        )


def _active_q(user: dict, include_inactive: bool) -> dict:
    return {"company_id": user["company_id"], **({} if include_inactive else {"is_active": {"$ne": False}})}


_USAGE = {  # REQ-132: where each template is used → "Used in N"
    "floor": (
        lambda i: db.tower_templates.count_documents({"floor_map.floor_template_id": i, "is_active": {"$ne": False}}),
        "tower template(s)",
    ),
    "tower": (lambda i: db.blocks.count_documents({"tower_template_id": i, "is_active": {"$ne": False}}), "tower(s)"),
    "stage": (
        lambda i: db.tower_templates.count_documents(
            {"default_stage_plan_template_id": i, "is_active": {"$ne": False}}
        ),
        "tower template(s)",
    ),
    "payment": (
        lambda i: db.tower_templates.count_documents(
            {"default_payment_plan_template_ids": i, "is_active": {"$ne": False}}
        ),
        "tower template(s)",
    ),
}
_COLL = {
    "floor": "floor_plan_templates",
    "tower": "tower_templates",
    "stage": "stage_plan_templates",
    "payment": "payment_plan_templates",
}
_PATH = {
    "floor-templates": "floor",
    "tower-templates": "tower",
    "stage-plan-templates": "stage",
    "payment-plan-templates": "payment",
}


async def _with_usage(kind: str, items: list[dict]) -> list[dict]:
    fn, label = _USAGE[kind]
    for t in items:
        t["usage_count"], t["usage_label"] = await fn(t["id"]), label
        t["is_active"] = t.get("is_active") is not False
    return items


# ---------------- Floor Templates (collection floor_plan_templates, ids preserved) ----------------
@router.get("/floor-templates")
async def list_floor_templates(
    include_inactive: bool = False, user: dict = Depends(require("masters.floor_plan.view"))
):
    fts = await _flat_types(user["company_id"])
    items = (
        await db.floor_plan_templates.find(_active_q(user, include_inactive), {"_id": 0}).sort("name", 1).to_list(500)
    )
    return {"items": await _with_usage("floor", [_floor_tpl_out(t, fts) for t in items]), "total": len(items)}


async def _floor_tpl_doc(body: FloorTemplateIn, user: dict) -> dict:
    fts = await _flat_types(user["company_id"])
    missing = [p.flat_type_id for p in body.positions if p.flat_type_id not in fts]
    if missing:
        raise ApiError(422, "Unknown flat type", "VALIDATION_ERROR", {"field": "positions", "missing": missing})
    return {
        "name": body.name.strip(),
        "code": body.name.strip().upper().replace(" ", "_")[:30],
        "flats_per_floor": len(body.positions),
        "use_type_defaults": body.use_type_defaults,
        "positions": [
            {"position": p.pos, "flat_type_id": p.flat_type_id, "facing": p.facing, "is_corner": False}
            for p in sorted(body.positions, key=lambda x: x.pos)
        ],
    }


@router.post("/floor-templates", status_code=201)
async def create_floor_template(
    body: FloorTemplateIn, request: Request, user: dict = Depends(require("masters.floor_plan.create"))
):
    doc = {**base_doc(user, user["company_id"]), **await _floor_tpl_doc(body, user)}
    await db.floor_plan_templates.insert_one(doc)
    doc.pop("_id", None)
    await write_audit(
        user,
        "floor_template.create",
        "floor_template",
        doc["id"],
        after={"name": doc["name"], "flats_per_floor": doc["flats_per_floor"]},
        ip=client_ip(request),
    )
    return _floor_tpl_out(doc, await _flat_types(user["company_id"]))


@router.patch("/floor-templates/{tid}")
async def update_floor_template(
    tid: str, body: FloorTemplateIn, request: Request, user: dict = Depends(require("masters.floor_plan.edit"))
):
    cur = await get_or_404(db.floor_plan_templates, tid, "Floor template", {"company_id": user["company_id"]})
    _check_version(cur, body.version)
    ch = await _floor_tpl_doc(body, user)
    await db.floor_plan_templates.update_one(
        {"id": tid}, {"$set": {**ch, "updated_at": now_iso()}, "$inc": {"version": 1}}
    )
    await write_audit(
        user,
        "floor_template.update",
        "floor_template",
        tid,
        before={"name": cur["name"]},
        after={"name": ch["name"], "flats_per_floor": ch["flats_per_floor"]},
        ip=client_ip(request),
    )
    return _floor_tpl_out(
        await db.floor_plan_templates.find_one({"id": tid}, {"_id": 0}), await _flat_types(user["company_id"])
    )


@router.delete("/floor-templates/{tid}")
async def delete_floor_template(tid: str, request: Request, user: dict = Depends(require("masters.floor_plan.delete"))):
    cur = await get_or_404(db.floor_plan_templates, tid, "Floor template", {"company_id": user["company_id"]})
    used = await db.tower_templates.count_documents({"floor_map.floor_template_id": tid, "is_active": {"$ne": False}})
    if used:
        raise ApiError(
            409, f"Used by {used} tower template(s) — remove it there first", "IN_USE", {"tower_templates": used}
        )
    await db.floor_plan_templates.update_one({"id": tid}, {"$set": {"is_active": False, "updated_at": now_iso()}})
    await write_audit(
        user,
        "floor_template.deactivate",
        "floor_template",
        tid,
        before={"name": cur["name"]},
        after={"is_active": False},
        ip=client_ip(request),
    )
    return {"ok": True}


# ---------------- Tower Templates ----------------
async def _tower_tpl_out(t: dict) -> dict:
    return {**t, "preview": await _tower_preview(t, t["company_id"])}


async def _validate_tower_tpl(body: TowerTemplateIn, company_id: str) -> dict:
    floors = set(range(body.floor_start, body.floor_start + body.floors))
    seen: set[int] = set()
    for m in body.floor_map:
        if m.to_floor < m.from_floor:
            raise ApiError(
                422,
                f"Floor map {m.from_floor}–{m.to_floor}: 'to' is before 'from'",
                "VALIDATION_ERROR",
                {"field": "floor_map"},
            )
        rng = set(range(m.from_floor, m.to_floor + 1))
        if not rng <= floors:
            raise ApiError(
                422,
                f"Floor map {m.from_floor}–{m.to_floor} is outside floors {body.floor_start}–{body.floor_start + body.floors - 1}",
                "VALIDATION_ERROR",
                {"field": "floor_map"},
            )
        if rng & seen:
            raise ApiError(
                422,
                f"Floor map {m.from_floor}–{m.to_floor} overlaps another range",
                "VALIDATION_ERROR",
                {"field": "floor_map"},
            )
        seen |= rng
        if not await db.floor_plan_templates.find_one(
            {"id": m.floor_template_id, "company_id": company_id, "is_active": {"$ne": False}}, {"_id": 1}
        ):
            raise ApiError(
                422,
                "Unknown floor template",
                "VALIDATION_ERROR",
                {"field": "floor_map", "floor_template_id": m.floor_template_id},
            )
    if body.default_stage_plan_template_id and not await db.stage_plan_templates.find_one(
        {"id": body.default_stage_plan_template_id, "company_id": company_id}, {"_id": 1}
    ):
        raise ApiError(
            422, "Unknown stage plan template", "VALIDATION_ERROR", {"field": "default_stage_plan_template_id"}
        )
    for pid in body.default_payment_plan_template_ids:
        if not await db.payment_plan_templates.find_one({"id": pid, "company_id": company_id}, {"_id": 1}):
            raise ApiError(
                422,
                "Unknown payment plan template",
                "VALIDATION_ERROR",
                {"field": "default_payment_plan_template_ids", "id": pid},
            )
    if (
        body.default_payment_plan_template_id
        and body.default_payment_plan_template_id not in body.default_payment_plan_template_ids
    ):
        raise ApiError(
            422,
            "The default payment plan must be one of the selected plans",
            "VALIDATION_ERROR",
            {"field": "default_payment_plan_template_id"},
        )
    d = body.model_dump(exclude={"version"})
    d["name"] = d["name"].strip()
    d["floor_map"] = [
        {"from": m.from_floor, "to": m.to_floor, "floor_template_id": m.floor_template_id} for m in body.floor_map
    ]
    return d


@router.get("/tower-templates")
async def list_tower_templates(include_inactive: bool = False, user: dict = Depends(require("masters.project.view"))):
    items = await db.tower_templates.find(_active_q(user, include_inactive), {"_id": 0}).sort("name", 1).to_list(200)
    return {"items": await _with_usage("tower", [await _tower_tpl_out(t) for t in items]), "total": len(items)}


@router.post("/tower-templates", status_code=201)
async def create_tower_template(
    body: TowerTemplateIn, request: Request, user: dict = Depends(require("masters.tower.create"))
):
    doc = {**base_doc(user, user["company_id"]), **await _validate_tower_tpl(body, user["company_id"])}
    await db.tower_templates.insert_one(doc)
    doc.pop("_id", None)
    await write_audit(
        user,
        "tower_template.create",
        "tower_template",
        doc["id"],
        after={"name": doc["name"], "floors": doc["floors"]},
        ip=client_ip(request),
    )
    return await _tower_tpl_out(doc)


@router.patch("/tower-templates/{tid}")
async def update_tower_template(
    tid: str, body: TowerTemplateIn, request: Request, user: dict = Depends(require("masters.tower.edit"))
):
    cur = await get_or_404(db.tower_templates, tid, "Tower template", {"company_id": user["company_id"]})
    _check_version(cur, body.version)
    ch = await _validate_tower_tpl(body, user["company_id"])
    await db.tower_templates.update_one({"id": tid}, {"$set": {**ch, "updated_at": now_iso()}, "$inc": {"version": 1}})
    await write_audit(
        user,
        "tower_template.update",
        "tower_template",
        tid,
        before={"name": cur["name"]},
        after={"name": ch["name"], "floors": ch["floors"]},
        ip=client_ip(request),
    )
    return await _tower_tpl_out(await db.tower_templates.find_one({"id": tid}, {"_id": 0}))


@router.delete("/tower-templates/{tid}")
async def delete_tower_template(tid: str, request: Request, user: dict = Depends(require("masters.tower.edit"))):
    cur = await get_or_404(db.tower_templates, tid, "Tower template", {"company_id": user["company_id"]})
    await db.tower_templates.update_one({"id": tid}, {"$set": {"is_active": False, "updated_at": now_iso()}})
    await write_audit(
        user,
        "tower_template.deactivate",
        "tower_template",
        tid,
        before={"name": cur["name"]},
        after={"is_active": False},
        ip=client_ip(request),
    )
    return {"ok": True}


# ---------------- Stage Plan Templates ----------------
async def _sp_out(t: dict, stages: dict) -> dict:
    return {
        **t,
        "stages": [
            {"seq": i + 1, "stage_id": s, "name": (stages.get(s) or {}).get("name", "?")}
            for i, s in enumerate(t.get("stage_ids") or [])
        ],
    }


@router.get("/stage-plan-templates")
async def list_sp_templates(include_inactive: bool = False, user: dict = Depends(require("masters.stage_plan.view"))):
    stages = await _stages(user["company_id"])
    items = (
        await db.stage_plan_templates.find(_active_q(user, include_inactive), {"_id": 0}).sort("name", 1).to_list(200)
    )
    return {"items": await _with_usage("stage", [await _sp_out(t, stages) for t in items]), "total": len(items)}


async def _sp_check(body: StagePlanTemplateIn, company_id: str) -> dict:
    stages = await _stages(company_id)
    if len(set(body.stage_ids)) != len(body.stage_ids):
        raise ApiError(422, "A stage cannot appear twice", "VALIDATION_ERROR", {"field": "stage_ids"})
    missing = [s for s in body.stage_ids if s not in stages]
    if missing:
        raise ApiError(422, "Unknown stage", "VALIDATION_ERROR", {"field": "stage_ids", "missing": missing})
    return stages


@router.post("/stage-plan-templates", status_code=201)
async def create_sp_template(
    body: StagePlanTemplateIn, request: Request, user: dict = Depends(require("masters.stage_plan.create"))
):
    stages = await _sp_check(body, user["company_id"])
    doc = {**base_doc(user, user["company_id"]), "name": body.name.strip(), "stage_ids": body.stage_ids}
    await db.stage_plan_templates.insert_one(doc)
    doc.pop("_id", None)
    await write_audit(
        user,
        "stage_plan_template.create",
        "stage_plan_template",
        doc["id"],
        after={"name": doc["name"], "stages": [stages[s]["name"] for s in body.stage_ids]},
        ip=client_ip(request),
    )
    return await _sp_out(doc, stages)


@router.patch("/stage-plan-templates/{tid}")
async def update_sp_template(
    tid: str, body: StagePlanTemplateIn, request: Request, user: dict = Depends(require("masters.stage_plan.edit"))
):
    cur = await get_or_404(db.stage_plan_templates, tid, "Stage plan template", {"company_id": user["company_id"]})
    _check_version(cur, body.version)
    stages = await _sp_check(body, user["company_id"])
    await db.stage_plan_templates.update_one(
        {"id": tid},
        {
            "$set": {"name": body.name.strip(), "stage_ids": body.stage_ids, "updated_at": now_iso()},
            "$inc": {"version": 1},
        },
    )
    await write_audit(
        user,
        "stage_plan_template.update",
        "stage_plan_template",
        tid,
        before={"name": cur["name"]},
        after={"name": body.name.strip(), "stages": [stages[s]["name"] for s in body.stage_ids]},
        ip=client_ip(request),
    )
    return await _sp_out(await db.stage_plan_templates.find_one({"id": tid}, {"_id": 0}), stages)


@router.delete("/stage-plan-templates/{tid}")
async def delete_sp_template(tid: str, request: Request, user: dict = Depends(require("masters.stage_plan.delete"))):
    cur = await get_or_404(db.stage_plan_templates, tid, "Stage plan template", {"company_id": user["company_id"]})
    await db.stage_plan_templates.update_one({"id": tid}, {"$set": {"is_active": False, "updated_at": now_iso()}})
    await write_audit(
        user,
        "stage_plan_template.deactivate",
        "stage_plan_template",
        tid,
        before={"name": cur["name"]},
        after={"is_active": False},
        ip=client_ip(request),
    )
    return {"ok": True}


# ---------------- Payment Plan Templates ----------------
async def _pp_out(t: dict, stages: dict) -> dict:
    return {
        **t,
        "installments": [
            {
                **i,
                "stage_name": (stages.get(i.get("stage_id")) or {}).get("name")
                if i.get("trigger") == "stage"
                else None,
            }
            for i in t.get("installments") or []
        ],
    }


@router.get("/payment-plan-templates")
async def list_pp_templates(include_inactive: bool = False, user: dict = Depends(require("masters.payment_plan.view"))):
    stages = await _stages(user["company_id"])
    items = (
        await db.payment_plan_templates.find(_active_q(user, include_inactive), {"_id": 0}).sort("name", 1).to_list(200)
    )
    return {"items": await _with_usage("payment", [await _pp_out(t, stages) for t in items]), "total": len(items)}


async def _pp_check(body: PaymentPlanTemplateIn, company_id: str) -> dict:
    stages = await _stages(company_id)
    missing = [i.stage_id for i in body.installments if i.trigger == "stage" and i.stage_id not in stages]
    if missing:
        raise ApiError(
            422, "Unknown stage in installments", "VALIDATION_ERROR", {"field": "installments", "missing": missing}
        )
    return stages


@router.post("/payment-plan-templates", status_code=201)
async def create_pp_template(
    body: PaymentPlanTemplateIn, request: Request, user: dict = Depends(require("masters.payment_plan.create"))
):
    stages = await _pp_check(body, user["company_id"])
    doc = {
        **base_doc(user, user["company_id"]),
        "name": body.name.strip(),
        "installments": [i.model_dump() for i in body.installments],
    }
    await db.payment_plan_templates.insert_one(doc)
    doc.pop("_id", None)
    await write_audit(
        user,
        "payment_plan_template.create",
        "payment_plan_template",
        doc["id"],
        after={"name": doc["name"], "rows": [(i.label, i.percent) for i in body.installments]},
        ip=client_ip(request),
    )
    return await _pp_out(doc, stages)


@router.patch("/payment-plan-templates/{tid}")
async def update_pp_template(
    tid: str, body: PaymentPlanTemplateIn, request: Request, user: dict = Depends(require("masters.payment_plan.edit"))
):
    cur = await get_or_404(db.payment_plan_templates, tid, "Payment plan template", {"company_id": user["company_id"]})
    _check_version(cur, body.version)
    stages = await _pp_check(body, user["company_id"])
    await db.payment_plan_templates.update_one(
        {"id": tid},
        {
            "$set": {
                "name": body.name.strip(),
                "installments": [i.model_dump() for i in body.installments],
                "updated_at": now_iso(),
            },
            "$inc": {"version": 1},
        },
    )
    await write_audit(
        user,
        "payment_plan_template.update",
        "payment_plan_template",
        tid,
        before={"name": cur["name"]},
        after={"name": body.name.strip(), "rows": [(i.label, i.percent) for i in body.installments]},
        ip=client_ip(request),
    )
    return await _pp_out(await db.payment_plan_templates.find_one({"id": tid}, {"_id": 0}), stages)


@router.delete("/payment-plan-templates/{tid}")
async def delete_pp_template(tid: str, request: Request, user: dict = Depends(require("masters.payment_plan.delete"))):
    cur = await get_or_404(db.payment_plan_templates, tid, "Payment plan template", {"company_id": user["company_id"]})
    await db.payment_plan_templates.update_one({"id": tid}, {"$set": {"is_active": False, "updated_at": now_iso()}})
    await write_audit(
        user,
        "payment_plan_template.deactivate",
        "payment_plan_template",
        tid,
        before={"name": cur["name"]},
        after={"is_active": False},
        ip=client_ip(request),
    )
    return {"ok": True}


# ---------------- Appliers ----------------
class ApplyFloorIn(StrictModel):
    floor_template_id: str
    use_type_defaults: bool | None = None  # None → template's own checkbox


class ApplyTemplateIn(StrictModel):
    template_id: str
    is_default: bool = False


class TowerFromTemplateIn(StrictModel):
    name: str = Field(min_length=1, max_length=80)
    code: str = Field(min_length=1, max_length=10)
    tower_template_id: str | None = None
    block_type_id: str | None = None
    floors: int | None = Field(default=None, ge=1, le=200)
    floor_start: int | None = Field(default=None, ge=0)
    numbering_pattern: Pattern | None = None


class ApplyAllIn(StrictModel):
    stage_plan_template_id: str | None = None
    payment_plan_template_ids: list[str] = []
    default_payment_plan_template_id: str | None = None


async def apply_floor_template(block: dict, floor: int, tpl: dict, use_defaults: bool | None, user: dict) -> dict:
    positions = [
        FloorPosition(
            position=p.get("position") or p.get("pos"), flat_type_id=p["flat_type_id"], facing=p.get("facing") or None
        )
        for p in tpl["positions"]
    ]
    res = await _save_floor(
        block, floor, positions, bool(tpl.get("use_type_defaults")) if use_defaults is None else use_defaults, user
    )
    await db.blocks.update_one({"id": block["id"]}, {"$set": {f"floor_templates.{floor}": tpl["id"]}})
    return res


@router.post("/blocks/{block_id}/floors/{floor}/apply-template")
async def apply_floor_template_ep(
    block_id: str, floor: int, body: ApplyFloorIn, request: Request, user: dict = Depends(require("masters.tower.edit"))
):
    block = await _block(block_id, user)
    tpl = await get_or_404(
        db.floor_plan_templates, body.floor_template_id, "Floor template", {"company_id": user["company_id"]}
    )
    res = await apply_floor_template(block, floor, tpl, body.use_type_defaults, user)
    await write_audit(
        user,
        "floor.apply_template",
        "block",
        block_id,
        after={"floor": floor, "template": tpl["name"], **{k: v for k, v in res.items() if k != "floor"}},
        ip=client_ip(request),
    )
    return {**res, "floor_template_id": tpl["id"]}


async def apply_stage_plan_template(block: dict, tpl: dict, request: Request, user: dict) -> dict:
    cur = await db.construction_stage_plans.find_one({"block_id": block["id"], "is_active": True}, {"_id": 0})
    body = StagePlanIn(
        name=tpl["name"], project_id=block["project_id"], block_id=block["id"], stage_ids=tpl["stage_ids"]
    )
    plan = (
        await update_stage_plan(cur["id"], body, request, user) if cur else await create_stage_plan(body, request, user)
    )
    await db.construction_stage_plans.update_one({"id": plan["id"]}, {"$set": {"template_id": tpl["id"]}})
    return {**plan, "template_id": tpl["id"]}


@router.post("/blocks/{block_id}/apply-stage-plan-template")
async def apply_sp_template_ep(
    block_id: str, body: ApplyTemplateIn, request: Request, user: dict = Depends(require("masters.stage_plan.create"))
):
    block = await _block(block_id, user)
    tpl = await get_or_404(
        db.stage_plan_templates, body.template_id, "Stage plan template", {"company_id": user["company_id"]}
    )
    return await apply_stage_plan_template(block, tpl, request, user)


async def apply_payment_plan_template(block: dict, tpl: dict, is_default: bool, request: Request, user: dict) -> dict:
    sp = await db.construction_stage_plans.find_one({"block_id": block["id"], "is_active": True}, {"_id": 0})
    if not sp:
        raise ApiError(
            422,
            f"{block['name']} has no stage plan yet — pick a stage plan first",
            "STAGE_PLAN_REQUIRED",
            {"block_id": block["id"]},
        )
    stages = await _stages(user["company_id"])
    tower_stage_ids = set(sp["stage_ids"])
    missing = [
        stages.get(i["stage_id"], {}).get("name", i["stage_id"])
        for i in tpl["installments"]
        if i["trigger"] == "stage" and i["stage_id"] not in tower_stage_ids
    ]
    if missing:
        raise ApiError(
            422,
            f"Add {', '.join(repr(m) for m in missing)} to {block['name']}'s stage plan first",
            "MISSING_STAGES",
            {
                "block_id": block["id"],
                "stage_plan_id": sp["id"],
                "missing": [
                    i["stage_id"]
                    for i in tpl["installments"]
                    if i["trigger"] == "stage" and i["stage_id"] not in tower_stage_ids
                ],
                "missing_names": missing,
            },
        )
    booking_stage = next(
        (
            s
            for s in sp["stage_ids"]
            if stages.get(s, {}).get("auto_complete_on_booking") or stages.get(s, {}).get("code") == "BOOKING"
        ),
        None,
    )
    possession_stage = next((s for s in sp["stage_ids"] if stages.get(s, {}).get("is_possession")), None) or (
        sp["stage_ids"][-1] if len(sp["stage_ids"]) > 1 else None
    )  # S3: possession = last stage unless one is flagged
    rows: dict[str, float] = {}
    advanced = []
    for i in tpl["installments"]:
        if i["trigger"] == "stage":
            rows[i["stage_id"]] = rows.get(i["stage_id"], 0) + i["percent"]
        elif i["trigger"] == "on_booking" and booking_stage:
            rows[booking_stage] = rows.get(booking_stage, 0) + i["percent"]
        elif i["trigger"] == "on_possession" and possession_stage:
            rows[possession_stage] = rows.get(possession_stage, 0) + i["percent"]
        elif i["trigger"] == "on_booking":
            advanced.append(
                {"name": i["label"], "trigger_type": "DAYS_AFTER_BOOKING", "trigger_days": 0, "percent": i["percent"]}
            )
        elif i["trigger"] == "on_possession":
            raise ApiError(
                422,
                f"Add a possession stage to {block['name']}'s stage plan first",
                "MISSING_STAGES",
                {"block_id": block["id"], "stage_plan_id": sp["id"], "missing_names": ["Possession"]},
            )
        else:
            advanced.append(
                {
                    "name": i["label"],
                    "trigger_type": "DAYS_AFTER_BOOKING",
                    "trigger_days": i.get("days") or 0,
                    "percent": i["percent"],
                }
            )
    existing = await db.payment_plans.find_one(
        {"block_id": block["id"], "is_active": True, "template_id": tpl["id"]}, {"_id": 0}
    )
    if existing:
        plan = existing
    else:
        name = tpl["name"]
        if await db.payment_plans.find_one(
            {"project_id": block["project_id"], "block_id": block["id"], "is_active": True, "name": name}, {"_id": 1}
        ):
            name = f"{tpl['name']} ({block['name']})"
        plan = await create_structured(
            StructuredPlanIn(
                name=name,
                project_id=block["project_id"],
                block_id=block["id"],
                stage_plan_id=sp["id"],
                rows=[PlanRow(stage_id=k, percent=round(v, 2)) for k, v in rows.items()],
                advanced=advanced,
            ),
            request,
            user,
        )
        await db.payment_plans.update_one({"id": plan["id"]}, {"$set": {"template_id": tpl["id"]}})
    if is_default:
        await assign_plan(
            AssignIn(payment_plan_id=plan["id"], project_id=block["project_id"], block_id=block["id"], is_default=True),
            request,
            user,
        )
    return {**plan, "template_id": tpl["id"], "is_default": is_default}


@router.post("/blocks/{block_id}/apply-payment-plan-template")
async def apply_pp_template_ep(
    block_id: str, body: ApplyTemplateIn, request: Request, user: dict = Depends(require("masters.payment_plan.create"))
):
    block = await _block(block_id, user)
    tpl = await get_or_404(
        db.payment_plan_templates, body.template_id, "Payment plan template", {"company_id": user["company_id"]}
    )
    return await apply_payment_plan_template(block, tpl, body.is_default, request, user)


@router.post("/projects/{project_id}/towers-from-template", status_code=201)
async def tower_from_template(
    project_id: str, body: TowerFromTemplateIn, request: Request, user: dict = Depends(require("masters.tower.create"))
):
    """ONE action: tower → floors from the template's floor map → stage plan → payment plans. Without a template: an empty tower (floors appear, no flats)."""
    ensure_project_access(user, project_id)
    tpl = (
        await get_or_404(
            db.tower_templates, body.tower_template_id, "Tower template", {"company_id": user["company_id"]}
        )
        if body.tower_template_id
        else None
    )
    bt_id = body.block_type_id or (
        (
            await db.block_types.find_one(
                {"company_id": user["company_id"], "is_active": True}, {"_id": 0, "id": 1}, sort=[("name", 1)]
            )
        )
        or {}
    ).get("id")
    if not bt_id:
        raise ApiError(
            422,
            "No tower type exists yet — add one under Admin → Advanced → Block types",
            "VALIDATION_ERROR",
            {"field": "block_type_id"},
        )
    floors = body.floors or (tpl or {}).get("floors")
    if not floors:
        raise ApiError(
            422, "Enter the number of floors or pick a tower template", "VALIDATION_ERROR", {"field": "floors"}
        )
    if await db.blocks.find_one({"project_id": project_id, "code": body.code.strip().upper()}, {"_id": 1}):
        raise ApiError(409, f"Tower code {body.code.strip().upper()} already exists in this project", "DUPLICATE_CODE")
    bt = await db.block_types.find_one({"id": bt_id}, {"_id": 0, "has_floors": 1})
    project = await get_or_404(
        db.projects, project_id, "Project", {"company_id": user["company_id"], "is_active": True}
    )
    has_floors = (bt or {}).get("has_floors", True)
    created = {
        **base_doc(user, user["company_id"]),
        "project_id": project_id,
        "block_type_id": bt_id,
        "name": body.name.strip(),
        "code": body.code.strip().upper(),
        "floors": floors if has_floors else 1,
        "flats_per_floor": 0,
        "floor_start": body.floor_start if body.floor_start is not None else (tpl or {}).get("floor_start", 1),
        "ground_floor_label": (tpl or {}).get("ground_floor_label"),
        "skip_floors": [],
        "refuge_floors": (tpl or {}).get("refuge_floors", []) if has_floors else [],
        "podium_floors": (tpl or {}).get("podium_floors", []) if has_floors else [],
        "numbering_pattern": body.numbering_pattern or (tpl or {}).get("numbering_pattern", "{block}-{floor}{pos2}"),
        "position_flat_types": [],
        "floor_plans": [],
        "milestone_template_id": project.get("milestone_template_id"),
        "construction_percent": 0,
        "tower_template_id": (tpl or {}).get("id"),
    }  # empty tower: floors exist, flats come from floor templates
    await db.blocks.insert_one(created)
    created.pop("_id", None)
    await write_audit(
        user,
        "block.create",
        "block",
        created["id"],
        after={**created, "flats_generated": 0, "via": "template" if tpl else "empty"},
        ip=client_ip(request),
    )
    out = {
        "block": created,
        "floors_applied": 0,
        "flats_created": 0,
        "stage_plan": None,
        "payment_plans": [],
        "warnings": [],
    }
    if not tpl:
        return out
    block = await db.blocks.find_one({"id": created["id"]}, {"_id": 0})
    ftpls = {
        t["id"]: t
        for t in await db.floor_plan_templates.find(
            {"id": {"$in": [m["floor_template_id"] for m in tpl.get("floor_map") or []]}}, {"_id": 0}
        ).to_list(None)
    }
    valid = set(unit_floors(block))
    for m in tpl.get("floor_map") or []:
        ft = ftpls.get(m["floor_template_id"])
        if not ft:
            out["warnings"].append(f"Floor template missing for floors {m['from']}–{m['to']}")
            continue
        for fl in range(m["from"], m["to"] + 1):
            if fl not in valid:
                continue
            block = await db.blocks.find_one({"id": created["id"]}, {"_id": 0})
            res = await apply_floor_template(block, fl, ft, None, user)
            out["floors_applied"] += 1
            out["flats_created"] += res["created"]
    block = await db.blocks.find_one({"id": created["id"]}, {"_id": 0})
    if tpl.get("default_stage_plan_template_id"):
        sp = await db.stage_plan_templates.find_one(
            {"id": tpl["default_stage_plan_template_id"], "company_id": user["company_id"]}, {"_id": 0}
        )
        if sp:
            out["stage_plan"] = {
                k: (await apply_stage_plan_template(block, sp, request, user))[k] for k in ("id", "name")
            }
        else:
            out["warnings"].append("Stage plan template no longer exists")
    if not tpl.get("default_payment_plan_template_ids"):
        out["warnings"].append(f"No payment plan on tower template '{tpl['name']}' — pick one on the Plans tab")
    for pid in tpl.get("default_payment_plan_template_ids") or []:
        pp = await db.payment_plan_templates.find_one({"id": pid, "company_id": user["company_id"]}, {"_id": 0})
        if not pp:
            out["warnings"].append("A payment plan template on this tower template no longer exists")
            continue
        try:
            plan = await apply_payment_plan_template(
                block,
                pp,
                pid == tpl.get("default_payment_plan_template_id")
                or (len(tpl["default_payment_plan_template_ids"]) == 1),
                request,
                user,
            )
            out["payment_plans"].append({"id": plan["id"], "name": plan["name"], "is_default": plan["is_default"]})
        except ApiError as e:
            missing = ", ".join(repr(m) for m in (e.extra or {}).get("missing_names") or [])
            out["warnings"].append(
                f"Payment plan '{pp['name']}' not attached: "
                + (f"stage {missing} missing from the tower's stage plan" if missing else str(e.detail))
            )
    if out["payment_plans"] and not any(p["is_default"] for p in out["payment_plans"]):
        first = out["payment_plans"][0]
        await assign_plan(
            AssignIn(payment_plan_id=first["id"], project_id=project_id, block_id=created["id"], is_default=True),
            request,
            user,
        )
        first["is_default"] = True
    await write_audit(
        user,
        "tower.from_template",
        "block",
        created["id"],
        after={"template": tpl["name"], **{k: v for k, v in out.items() if k != "block"}},
        ip=client_ip(request),
    )
    return out


@router.get("/projects/{project_id}/plans")
async def project_plans(project_id: str, user: dict = Depends(require("masters.project.view"))):
    """Plans tab: per tower → stage plan (copy, with template lineage) + payment plans (with default)."""
    ensure_project_access(user, project_id)
    await get_or_404(db.projects, project_id, "Project", {"company_id": user["company_id"]})
    blocks = (
        await db.blocks.find({"project_id": project_id, "is_active": True}, {"_id": 0, "id": 1, "name": 1, "code": 1})
        .sort("name", 1)
        .to_list(200)
    )
    sps = {
        p["block_id"]: p
        for p in await db.construction_stage_plans.find(
            {"project_id": project_id, "is_active": True}, {"_id": 0}
        ).to_list(None)
    }
    pps = await db.payment_plans.find(
        {"project_id": project_id, "is_active": True},
        {"_id": 0, "id": 1, "name": 1, "block_id": 1, "template_id": 1, "installments": 1},
    ).to_list(None)
    asg = await db.payment_plan_assignments.find(
        {"project_id": project_id, "is_active": True}, {"_id": 0, "payment_plan_id": 1, "block_id": 1, "is_default": 1}
    ).to_list(None)
    stages = await _stages(user["company_id"])
    rows = []
    for b in blocks:
        sp = sps.get(b["id"])
        if not sp:
            seq = await ensure_block_stages(await db.blocks.find_one({"id": b["id"]}, {"_id": 0}))
            sp = (
                {
                    "id": None,
                    "name": "Project default" if seq else None,
                    "stage_ids": [s["stage_id"] for s in seq],
                    "template_id": None,
                }
                if seq
                else None
            )
        plans = [p for p in pps if p.get("block_id") in (b["id"], None)]
        defaults = {a["payment_plan_id"] for a in asg if a.get("block_id") in (b["id"], None) and a.get("is_default")}
        rows.append(
            {
                "block_id": b["id"],
                "block_name": b["name"],
                "block_code": b["code"],
                "stage_plan": sp
                and {
                    "id": sp.get("id"),
                    "name": sp.get("name"),
                    "template_id": sp.get("template_id"),
                    "count": len(sp.get("stage_ids") or []),
                    "stages": [
                        {"stage_id": s, "name": stages.get(s, {}).get("name", "?")} for s in sp.get("stage_ids") or []
                    ],
                },
                "payment_plans": [
                    {
                        "id": p["id"],
                        "name": p["name"],
                        "template_id": p.get("template_id"),
                        "is_default": p["id"] in defaults,
                        "rows": [(i["name"], i["percent"]) for i in p.get("installments") or []],
                    }
                    for p in plans
                ],
            }
        )
    return {"towers": rows}


@router.post("/projects/{project_id}/apply-plans-to-all")
async def apply_plans_to_all(
    project_id: str, body: ApplyAllIn, request: Request, user: dict = Depends(require("masters.stage_plan.create"))
):
    ensure_project_access(user, project_id)
    blocks = await db.blocks.find(
        {"project_id": project_id, "is_active": True, "company_id": user["company_id"]}, {"_id": 0}
    ).to_list(200)
    sp = (
        await get_or_404(
            db.stage_plan_templates,
            body.stage_plan_template_id,
            "Stage plan template",
            {"company_id": user["company_id"]},
        )
        if body.stage_plan_template_id
        else None
    )
    pps = [
        await get_or_404(db.payment_plan_templates, pid, "Payment plan template", {"company_id": user["company_id"]})
        for pid in body.payment_plan_template_ids
    ]
    out = {"towers": [], "errors": []}
    for b in blocks:
        try:
            if sp:
                await apply_stage_plan_template(b, sp, request, user)
            for pp in pps:
                await apply_payment_plan_template(
                    b, pp, pp["id"] == body.default_payment_plan_template_id, request, user
                )
            out["towers"].append(b["name"])
        except ApiError as e:
            out["errors"].append(
                {"block": b["name"], "block_id": b["id"], "message": str(e.detail), "code": e.code, "details": e.extra}
            )
    return out


# ---------------- startup migration (idempotent) ----------------
async def migrate_templates() -> dict:
    """Existing tower stage plans / payment plans stay as tower copies; distinct shapes become 'Imported – <name>' templates once."""
    if await db.settings.find_one({"key": "migration_s1_templates"}, {"_id": 1}):
        return {"skipped": True}
    created = {"stage": 0, "payment": 0}
    for cid in await db.companies.distinct("id"):
        seen: dict[tuple, str] = {}
        for sp in (
            await db.construction_stage_plans.find(
                {"company_id": cid, "is_active": True, "template_id": {"$exists": False}}, {"_id": 0}
            )
            .sort("created_at", 1)
            .to_list(None)
        ):
            key = tuple(sp.get("stage_ids") or [])
            if not key:
                continue
            if key not in seen:
                doc = {
                    **base_doc(None, cid),
                    "name": f"Imported – {sp['name']}"[:80],
                    "stage_ids": list(key),
                    "imported_from": sp["id"],
                }
                await db.stage_plan_templates.insert_one(doc)
                seen[key] = doc["id"]
                created["stage"] += 1
            await db.construction_stage_plans.update_one(
                {"id": sp["id"], "template_id": {"$exists": False}}, {"$set": {"template_id": seen[key]}}
            )
        seen_pp: dict[tuple, str] = {}
        for pp in (
            await db.payment_plans.find(
                {"company_id": cid, "is_active": True, "template_id": {"$exists": False}}, {"_id": 0}
            )
            .sort("created_at", 1)
            .to_list(None)
        ):
            inst = _template_installments(pp)
            if not inst:
                continue
            key = tuple((x["trigger"], x["stage_id"], x["days"], x["percent"]) for x in inst)
            if key not in seen_pp:
                doc = {
                    **base_doc(None, cid),
                    "name": f"Imported – {pp['name']}"[:80],
                    "installments": inst,
                    "imported_from": pp["id"],
                }
                await db.payment_plan_templates.insert_one(doc)
                seen_pp[key] = doc["id"]
                created["payment"] += 1
            await db.payment_plans.update_one(
                {"id": pp["id"], "template_id": {"$exists": False}}, {"$set": {"template_id": seen_pp[key]}}
            )
    await db.floor_plan_templates.update_many(
        {"use_type_defaults": {"$exists": False}}, {"$set": {"use_type_defaults": False}}
    )
    await db.settings.update_one(
        {"key": "migration_s1_templates"},
        {"$set": {"key": "migration_s1_templates", "value": created, "at": now_iso()}},
        upsert=True,
    )
    return created


async def seed_s1_templates() -> dict:
    """Demo/story setup through templates: the seeded towers get Tower/Floor template lineage and the seeded plans
    become cleanly named company templates (idempotent).
    """
    if await db.settings.find_one({"key": "seed_s1_templates_done"}, {"_id": 1}):
        return {"skipped": True}
    company = await db.companies.find_one({}, {"_id": 0, "id": 1})
    if not company:
        return {"skipped": "no company"}
    cid = company["id"]
    created = {"stage": 0, "payment": 0, "tower": 0, "blocks": 0}
    sp_by_shape: dict[tuple, str] = {}
    for sp in (
        await db.construction_stage_plans.find(
            {"company_id": cid, "is_active": True, "template_id": {"$exists": False}}, {"_id": 0}
        )
        .sort("created_at", 1)
        .to_list(None)
    ):
        key = tuple(sp.get("stage_ids") or [])
        if not key:
            continue
        if key not in sp_by_shape:
            blk = await db.blocks.find_one({"id": sp.get("block_id")}, {"_id": 0, "block_type_id": 1, "floors": 1})
            bt = await db.block_types.find_one(
                {"id": (blk or {}).get("block_type_id")}, {"_id": 0, "code": 1, "name": 1}
            )
            kind = "Villa" if bt and "VILLA" in (bt.get("code") or "").upper() else "Tower"
            name = f"{kind} standard ({len(key)} stages)"
            if await db.stage_plan_templates.find_one({"company_id": cid, "name": name}, {"_id": 1}):
                name = f"{name} · {sp['name']}"[:80]
            doc = {**base_doc(None, cid), "name": name, "stage_ids": list(key), "seeded": True}
            await db.stage_plan_templates.insert_one(doc)
            sp_by_shape[key] = doc["id"]
            created["stage"] += 1
        await db.construction_stage_plans.update_one({"id": sp["id"]}, {"$set": {"template_id": sp_by_shape[key]}})
    pp_by_shape: dict[tuple, str] = {}
    for pp in (
        await db.payment_plans.find(
            {"company_id": cid, "is_active": True, "template_id": {"$exists": False}}, {"_id": 0}
        )
        .sort("created_at", 1)
        .to_list(None)
    ):
        inst = _template_installments(pp)
        if not inst:
            continue
        key = tuple((x["trigger"], x["stage_id"], x["days"], x["percent"]) for x in inst)
        if key not in pp_by_shape:
            name = pp["name"].split(" (")[0].strip()[:80]
            if await db.payment_plan_templates.find_one({"company_id": cid, "name": name}, {"_id": 1}):
                name = pp["name"][:80]
            doc = {**base_doc(None, cid), "name": name, "installments": inst, "seeded": True}
            await db.payment_plan_templates.insert_one(doc)
            pp_by_shape[key] = doc["id"]
            created["payment"] += 1
        await db.payment_plans.update_one({"id": pp["id"]}, {"$set": {"template_id": pp_by_shape[key]}})
    # towers: floor-plan ranges → per-floor floor_templates + a Tower Template per distinct tower shape
    tt_by_shape: dict[tuple, str] = {}
    for b in await db.blocks.find(
        {"company_id": cid, "is_active": True, "floor_plans.0": {"$exists": True}}, {"_id": 0}
    ).to_list(None):
        valid = set(unit_floors(b))
        fmap, per_floor = [], {}
        for r in b["floor_plans"]:
            if not r.get("floor_plan_template_id"):
                continue
            lo, hi = r["from_floor"], min(r["to_floor"], max(valid) if valid else r["to_floor"])
            fmap.append({"from": lo, "to": hi, "floor_template_id": r["floor_plan_template_id"]})
            for fl in range(lo, hi + 1):
                if fl in valid:
                    per_floor[str(fl)] = r["floor_plan_template_id"]
        sp = await db.construction_stage_plans.find_one(
            {"block_id": b["id"], "is_active": True}, {"_id": 0, "template_id": 1}
        )
        plans = await db.payment_plans.find(
            {"block_id": b["id"], "is_active": True}, {"_id": 0, "id": 1, "template_id": 1}
        ).to_list(None)
        asg = await db.payment_plan_assignments.find(
            {"block_id": b["id"], "is_active": True, "is_default": True}, {"_id": 0, "payment_plan_id": 1}
        ).to_list(None)
        pay_tids = [p["template_id"] for p in plans if p.get("template_id")]
        default_tid = next(
            (
                p["template_id"]
                for p in plans
                if p.get("template_id") and p["id"] in {a["payment_plan_id"] for a in asg}
            ),
            None,
        )
        sp_tpl = (
            await db.stage_plan_templates.find_one({"id": (sp or {}).get("template_id")}, {"_id": 0, "stage_ids": 1})
            if sp
            else None
        )
        if sp_tpl:  # every seeded tower template must carry a default payment plan whose stages exist in its stage plan
            compatible = [
                t
                for t in await db.payment_plan_templates.find(
                    {"company_id": cid, "is_active": {"$ne": False}}, {"_id": 0, "id": 1, "installments": 1}
                ).to_list(None)
                if all(i["stage_id"] in sp_tpl["stage_ids"] for i in t["installments"] if i["trigger"] == "stage")
            ]
            pay_tids = [t for t in pay_tids if t in {c["id"] for c in compatible}] or [c["id"] for c in compatible[:1]]
            if default_tid not in pay_tids:
                default_tid = pay_tids[0] if pay_tids else None
        key = (
            b["floors"],
            b.get("floor_start", 1),
            b.get("numbering_pattern"),
            tuple((m["from"], m["to"], m["floor_template_id"]) for m in fmap),
            (sp or {}).get("template_id"),
            tuple(sorted(pay_tids)),
            default_tid,
        )
        if key not in tt_by_shape:
            proj = await db.projects.find_one({"id": b["project_id"]}, {"_id": 0, "code": 1})
            name = (
                f"Single level like {proj['code'] if proj else ''} {b['name']}"
                if b["floors"] == 1
                else f"G+{b['floors'] - 1} like {proj['code'] if proj else ''} {b['name']}"
            ).strip()[:80]
            doc = {
                **base_doc(None, cid),
                "name": name,
                "floors": b["floors"],
                "floor_start": b.get("floor_start", 1),
                "ground_floor_label": b.get("ground_floor_label"),
                "numbering_pattern": b.get("numbering_pattern") or "{block}-{floor}{pos2}",
                "floor_map": fmap,
                "refuge_floors": b.get("refuge_floors") or [],
                "podium_floors": b.get("podium_floors") or [],
                "default_stage_plan_template_id": (sp or {}).get("template_id"),
                "default_payment_plan_template_ids": sorted(set(pay_tids)),
                "default_payment_plan_template_id": default_tid,
                "seeded": True,
            }
            await db.tower_templates.insert_one(doc)
            tt_by_shape[key] = doc["id"]
            created["tower"] += 1
        await db.blocks.update_one(
            {"id": b["id"]}, {"$set": {"tower_template_id": tt_by_shape[key], "floor_templates": per_floor}}
        )
        created["blocks"] += 1
    await db.settings.update_one(
        {"key": "seed_s1_templates_done"},
        {"$set": {"key": "seed_s1_templates_done", "value": created, "at": now_iso()}},
        upsert=True,
    )
    return created


def _template_installments(pp: dict) -> list[dict]:
    inst = []
    for i in pp.get("installments") or []:
        tt = i.get("trigger_type")
        if tt == "ON_BOOKING":
            inst.append(
                {
                    "label": i.get("name") or "Booking",
                    "percent": float(i["percent"]),
                    "trigger": "on_booking",
                    "stage_id": None,
                    "days": None,
                }
            )
        elif tt == "ON_STAGE" and i.get("trigger_stage_id"):
            inst.append(
                {
                    "label": i.get("name") or "Stage",
                    "percent": float(i["percent"]),
                    "trigger": "stage",
                    "stage_id": i["trigger_stage_id"],
                    "days": None,
                }
            )
        elif tt == "ON_POSSESSION":
            inst.append(
                {
                    "label": i.get("name") or "Possession",
                    "percent": float(i["percent"]),
                    "trigger": "on_possession",
                    "stage_id": None,
                    "days": None,
                }
            )
        elif tt == "DAYS_AFTER_BOOKING":
            inst.append(
                {
                    "label": i.get("name") or "Installment",
                    "percent": float(i["percent"]),
                    "trigger": "days_after_booking",
                    "stage_id": None,
                    "days": int(i.get("trigger_days") or 0),
                }
            )
    return inst if inst and round(sum(x["percent"] for x in inst), 2) == 100.0 else []


@router.post("/floor-templates/{tid}/restore")
@router.post("/tower-templates/{tid}/restore")
@router.post("/stage-plan-templates/{tid}/restore")
@router.post("/payment-plan-templates/{tid}/restore")
async def restore_template(tid: str, request: Request, user: dict = Depends(require("masters.project.edit"))):
    """Inactive → active again (the "Remove" action only deactivates)."""
    kind = _PATH[request.url.path.rstrip("/").split("/")[-3]]
    coll = db[_COLL[kind]]
    await get_or_404(coll, tid, "Template", {"company_id": user["company_id"]})
    await coll.update_one({"id": tid}, {"$set": {"is_active": True, "deleted_at": None, "updated_at": now_iso()}})
    await write_audit(user, "template.restore", _COLL[kind][:-1], tid, after={"is_active": True}, ip=client_ip(request))
    return {"ok": True}
