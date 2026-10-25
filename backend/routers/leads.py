from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import Field, field_validator

from db import db
from deps import require
from services.kyc import normalize_phone
from services.numbering import generate_number
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
    write_audit,
)

router = APIRouter(prefix="/leads", tags=["leads"])
STAGES = ["New", "Contacted", "Site Visit Scheduled", "Site Visit Done", "Negotiation", "Converted", "Lost"]
Stage = Literal["New", "Contacted", "Site Visit Scheduled", "Site Visit Done", "Negotiation", "Converted", "Lost"]


class LeadIn(StrictModel):
    name: str = Field(min_length=2, max_length=120)
    phone: str
    email: str | None = None
    project_id: str | None = None
    flat_type_id: str | None = None
    budget_min: float | None = Field(default=None, ge=0)
    budget_max: float | None = Field(default=None, ge=0)
    source: Literal["Walk-in", "Website", "Referral", "Broker", "Campaign", "Brochure", "Site Visit"] = "Walk-in"
    assigned_to: str | None = None
    notes: str | None = None

    @field_validator("phone")
    @classmethod
    def _ph(cls, v):
        return normalize_phone(v)


class LeadUpdate(LeadIn):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    phone: str | None = None
    source: Literal["Walk-in", "Website", "Referral", "Broker", "Campaign", "Brochure", "Site Visit"] | None = None
    version: int | None = None


class StageIn(StrictModel):
    status: Stage
    note: str | None = None
    lost_reason: str | None = None
    version: int | None = None


class FollowUpIn(StrictModel):
    note: str = Field(min_length=1, max_length=1000)
    next_follow_up_at: datetime | None = None
    version: int | None = None


class ConvertIn(StrictModel):
    customer_id: str | None = None
    version: int | None = None


@router.get("/stages")
async def stages(user: dict = Depends(require("lead.read"))):
    return {"stages": STAGES}


@router.get("")
async def list_leads(params: ListParams = Depends(), status: str | None = None, assigned_to: str | None = None, project_id: str | None = None,
                     due_today: bool = False, source: str | None = None, unread: bool = False, user: dict = Depends(require("lead.read"))):
    q = {"company_id": user["company_id"], **search_filter(params.search, ["name", "phone", "lead_number", "email"])}
    if source:
        q["source"] = source
    if unread:
        q["is_read"] = False
    if status:
        q["status"] = {"$in": status.split(",")}
    if assigned_to:
        q["assigned_to"] = assigned_to
    if project_id:
        q["project_id"] = project_id
    if due_today:
        end = datetime.now(UTC).replace(hour=23, minute=59, second=59).isoformat()
        q["next_follow_up_at"] = {"$lte": end}
        q["status"] = {"$nin": ["Converted", "Lost"]}
    res = await paginate(db.leads, q, params, params.sort_spec(["name", "lead_number", "created_at", "status", "next_follow_up_at"], "-created_at"), {"stage_history": 0})
    from services.includes import expand
    res["items"] = await expand(res["items"], params.include, "leads")
    return res


@router.get("/board")
async def board(project_id: str | None = None, assigned_to: str | None = None, user: dict = Depends(require("lead.read"))):
    q = {"company_id": user["company_id"]}
    if project_id:
        q["project_id"] = project_id
    if assigned_to:
        q["assigned_to"] = assigned_to
    items = await db.leads.find(q, {"_id": 0, "stage_history": 0}).sort("updated_at", -1).to_list(500)
    cols = {s: [] for s in STAGES}
    for l in items:
        cols.setdefault(l["status"], []).append(l)
    return {"columns": [{"stage": s, "leads": cols[s], "count": len(cols[s])} for s in STAGES]}


@router.post("", status_code=201)
async def create_lead(body: LeadIn, request: Request, user: dict = Depends(require("lead.write"))):
    company = await db.companies.find_one({"id": user["company_id"]}, {"_id": 0})
    doc = {**base_doc(user, user["company_id"]), **body.model_dump(), "lead_number": await generate_number("lead", company), "status": "New",
           "stage_history": [{"status": "New", "at": now_iso(), "by": user["id"], "note": None}], "follow_ups": [], "next_follow_up_at": None,
           "lost_reason": None, "converted_customer_id": None, "assigned_to": body.assigned_to or user["id"]}
    await db.leads.insert_one(doc)
    doc.pop("_id", None)
    await write_audit(user, "lead.create", "lead", doc["id"], after=doc, ip=client_ip(request))
    return doc


@router.get("/{lead_id}")
async def get_lead(lead_id: str, user: dict = Depends(require("lead.read"))):
    lead = await get_or_404(db.leads, lead_id, "Lead", {"company_id": user["company_id"]})
    if lead.get("is_read") is False:
        await db.leads.update_one({"id": lead_id}, {"$set": {"is_read": True}})
        lead["is_read"] = True
    return lead


@router.patch("/{lead_id}")
async def update_lead(lead_id: str, body: LeadUpdate, request: Request, user: dict = Depends(require("lead.write"))):
    before = await get_or_404(db.leads, lead_id, "Lead", {"company_id": user["company_id"]})
    changes = body.model_dump(exclude_unset=True)
    if not changes or set(changes) == {"version"}:
        raise ApiError(400, "No changes supplied", "NO_CHANGES")
    after = await apply_update(db.leads, before, changes, expected_version(request, body.version), "Lead")
    await write_audit(user, "lead.update", "lead", lead_id, before=before, after=after, ip=client_ip(request))
    return after


@router.post("/{lead_id}/stage")
async def move_stage(lead_id: str, body: StageIn, request: Request, user: dict = Depends(require("lead.write"))):
    before = await get_or_404(db.leads, lead_id, "Lead", {"company_id": user["company_id"]})
    if before["status"] == "Converted":
        raise ApiError(409, "Converted leads cannot be moved", "LEAD_CONVERTED")
    if body.status == "Converted":
        raise ApiError(409, "Use /convert to convert a lead", "USE_CONVERT")
    if body.status == "Lost" and not body.lost_reason:
        raise ApiError(422, "lost_reason is required when marking a lead Lost", "VALIDATION_ERROR")
    changes = {"status": body.status, "lost_reason": body.lost_reason if body.status == "Lost" else None}
    ver = expected_version(request, body.version)
    q = {"id": lead_id, **({"version": ver} if ver is not None else {})}
    after = await db.leads.find_one_and_update(q, {"$set": {**changes, "updated_at": now_iso()}, "$inc": {"version": 1},
                                                   "$push": {"stage_history": {"status": body.status, "at": now_iso(), "by": user["id"], "note": body.note or body.lost_reason}}},
                                               projection={"_id": 0}, return_document=True)
    if not after:
        raise ApiError(409, "Lead was modified by someone else. Reload and retry.", "VERSION_CONFLICT")
    await write_audit(user, "lead.stage", "lead", lead_id, before={"status": before["status"]}, after=changes, ip=client_ip(request))
    return after


@router.post("/{lead_id}/follow-ups")
async def add_follow_up(lead_id: str, body: FollowUpIn, request: Request, user: dict = Depends(require("lead.write"))):
    await get_or_404(db.leads, lead_id, "Lead", {"company_id": user["company_id"]})
    fu = {"at": now_iso(), "note": body.note, "next_follow_up_at": body.next_follow_up_at.isoformat() if body.next_follow_up_at else None, "by": user["id"], "by_name": user["name"]}
    after = await db.leads.find_one_and_update({"id": lead_id}, {"$push": {"follow_ups": fu}, "$set": {"next_follow_up_at": fu["next_follow_up_at"], "updated_at": now_iso()}, "$inc": {"version": 1}}, projection={"_id": 0}, return_document=True)
    await write_audit(user, "lead.follow_up", "lead", lead_id, after=fu, ip=client_ip(request))
    return after


@router.post("/{lead_id}/convert")
async def convert(lead_id: str, body: ConvertIn, request: Request, user: dict = Depends(require("lead.write"))):
    from routers.customers import present
    lead = await get_or_404(db.leads, lead_id, "Lead", {"company_id": user["company_id"]})
    if lead["status"] == "Converted":
        raise ApiError(409, "Lead already converted", "LEAD_CONVERTED")
    if body.customer_id:
        customer = await get_or_404(db.customers, body.customer_id, "Customer", {"company_id": user["company_id"]})
    else:
        existing = await db.customers.find_one({"company_id": user["company_id"], "phone": lead["phone"], "is_active": True}, {"_id": 0})
        if existing:
            customer = existing
        else:
            company = await db.companies.find_one({"id": user["company_id"]}, {"_id": 0})
            customer = {**base_doc(user, user["company_id"]), "customer_code": await generate_number("customer", company), "full_name": lead["name"], "phone": lead["phone"],
                        "email": lead.get("email"), "source": lead.get("source"), "assigned_sales_user_id": lead.get("assigned_to"), "kyc_status": "Pending",
                        "co_applicants": [], "tags": ["lead"], "pan_enc": None, "aadhaar_enc": None, "pan_hash": None, "lead_id": lead_id}
            await db.customers.insert_one(customer)
            customer.pop("_id", None)
            await write_audit(user, "customer.create", "customer", customer["id"], after=present(customer), ip=client_ip(request))
    after = await db.leads.find_one_and_update({"id": lead_id}, {"$set": {"status": "Converted", "converted_customer_id": customer["id"], "updated_at": now_iso()}, "$inc": {"version": 1},
                                                                 "$push": {"stage_history": {"status": "Converted", "at": now_iso(), "by": user["id"], "note": customer["customer_code"]}}},
                                               projection={"_id": 0}, return_document=True)
    await write_audit(user, "lead.convert", "lead", lead_id, before={"status": lead["status"]}, after={"status": "Converted", "customer_id": customer["id"]}, ip=client_ip(request))
    return {"lead": after, "customer": present(customer)}
