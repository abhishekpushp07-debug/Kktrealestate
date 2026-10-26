from typing import Literal

from fastapi import APIRouter, Depends, Request, Response
from pydantic import Field

from db import db
from deps import ensure_project_access, project_scope_filter, require
from utils import (
    ApiError,
    ListParams,
    StrictModel,
    apply_update,
    base_doc,
    client_ip,
    expected_version,
    get_or_404,
    paginate,
    search_filter,
    to_csv,
    write_audit,
)

router = APIRouter(prefix="/parking", tags=["parking"])
SlotType = Literal["Covered", "Open", "Stilt", "Basement"]
SlotStatus = Literal["Available", "Allotted", "Blocked"]


class SlotIn(StrictModel):
    project_id: str
    number: str = Field(min_length=1, max_length=20)
    type: SlotType
    level: str | None = None
    price: float | None = Field(default=None, ge=0)
    status: SlotStatus = "Available"


class SlotUpdate(StrictModel):
    type: SlotType | None = None
    level: str | None = None
    price: float | None = Field(default=None, ge=0)
    status: Literal["Available", "Blocked"] | None = None
    is_active: bool | None = None
    version: int | None = None


class BulkGenerateIn(StrictModel):
    project_id: str
    prefix: str = Field(default="P", max_length=10)
    start: int = Field(default=1, ge=0)
    count: int = Field(ge=1, le=2000)
    type: SlotType
    level: str | None = None
    price: float | None = Field(default=None, ge=0)
    pad: int = Field(default=3, ge=0, le=5)


@router.get("")
async def list_slots(params: ListParams = Depends(), project_id: str | None = None, status: str | None = None, type: str | None = None, user: dict = Depends(require("masters.flat.view"))):
    q = {"company_id": user["company_id"], **project_scope_filter(user), **search_filter(params.search, ["number", "level"])}
    if project_id:
        ensure_project_access(user, project_id)
        q["project_id"] = project_id
    if status:
        q["status"] = status
    if type:
        q["type"] = type
    if not params.include_inactive:
        q["is_active"] = True
    res = await paginate(db.parking_slots, q, params, params.sort_spec(["number", "type", "status", "price", "level"], "number"))
    if res.pop("_csv", False):
        return Response(to_csv(res["items"], ["number", "type", "level", "price", "status", "flat_id"]), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=parking.csv"})
    counts = await db.parking_slots.aggregate([{"$match": {k: v for k, v in q.items() if k not in ("$or", "status")}}, {"$group": {"_id": "$status", "n": {"$sum": 1}}}]).to_list(None)
    res["counts"] = {c["_id"]: c["n"] for c in counts}
    return res


@router.post("", status_code=201)
async def create_slot(body: SlotIn, request: Request, user: dict = Depends(require("masters.flat.create"))):
    ensure_project_access(user, body.project_id)
    await get_or_404(db.projects, body.project_id, "Project", {"company_id": user["company_id"]})
    if await db.parking_slots.find_one({"project_id": body.project_id, "number": body.number}):
        raise ApiError(409, f"Slot {body.number} already exists", "DUPLICATE")
    doc = {**base_doc(user, user["company_id"]), **body.model_dump(), "flat_id": None}
    await db.parking_slots.insert_one(doc)
    doc.pop("_id", None)
    await write_audit(user, "parking_slot.create", "parking_slot", doc["id"], after=doc, ip=client_ip(request))
    return doc


@router.post("/bulk-generate", status_code=201)
async def bulk_generate(body: BulkGenerateIn, request: Request, user: dict = Depends(require("masters.flat.create"))):
    ensure_project_access(user, body.project_id)
    await get_or_404(db.projects, body.project_id, "Project", {"company_id": user["company_id"]})
    numbers = [f"{body.prefix}{str(body.start + i).zfill(body.pad)}" for i in range(body.count)]
    existing = await db.parking_slots.find({"project_id": body.project_id, "number": {"$in": numbers}}, {"_id": 0, "number": 1}).to_list(None)
    if existing:
        raise ApiError(409, f"{len(existing)} slot number(s) already exist (e.g. {existing[0]['number']})", "DUPLICATE")
    docs = [{**base_doc(user, user["company_id"]), "project_id": body.project_id, "number": n, "type": body.type, "level": body.level, "price": body.price, "status": "Available", "flat_id": None} for n in numbers]
    await db.parking_slots.insert_many(docs)
    await write_audit(user, "parking_slot.bulk_generate", "project", body.project_id, after={"count": len(docs), "prefix": body.prefix, "type": body.type}, ip=client_ip(request))
    return {"generated": len(docs), "first": numbers[0], "last": numbers[-1]}


@router.patch("/{slot_id}")
async def update_slot(slot_id: str, body: SlotUpdate, request: Request, user: dict = Depends(require("masters.flat.edit"))):
    before = await get_or_404(db.parking_slots, slot_id, "Parking slot", {"company_id": user["company_id"]})
    ensure_project_access(user, before["project_id"])
    changes = body.model_dump(exclude_unset=True)
    if "status" in changes and before["status"] == "Allotted":
        raise ApiError(409, "Allotted slots are controlled by the booking", "STATUS_LOCKED")
    after = await apply_update(db.parking_slots, before, changes, expected_version(request, body.version), "Parking slot")
    await write_audit(user, "parking_slot.update", "parking_slot", slot_id, before=before, after=after, ip=client_ip(request))
    return after
