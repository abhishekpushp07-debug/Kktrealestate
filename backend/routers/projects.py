from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import Field, field_validator

from db import db
from models_out import ProjectsOut, ProjectsOutPage
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
    next_number,
    now_iso,
    paginate,
    search_filter,
    write_audit,
)

router = APIRouter(prefix="/projects", tags=["projects"])

ProjectStatus = Literal["Planning", "Under Construction", "Ready", "Completed"]
STATUSES = ["Available", "Hold", "Booked", "Sold", "Blocked"]


class Address(StrictModel):
    line1: str | None = None
    city: str | None = None
    state: str | None = None
    pincode: str | None = None


class GeoPoint(StrictModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class Landmark(StrictModel):
    name: str
    distance_km: float = Field(ge=0)


class Approval(StrictModel):
    name: str
    number: str | None = None
    date: str | None = None


class Phase(StrictModel):
    name: str
    block_ids: list[str] = []


class ProjectCreate(StrictModel):
    name: str = Field(min_length=1, max_length=120)
    code: str = Field(min_length=1, max_length=20)
    description: str | None = None
    project_type: Literal["Residential", "Commercial", "Mixed"] = "Residential"
    address: Address = Address()
    rera_number: str | None = None
    launch_date: str | None = None
    expected_possession_date: str | None = None
    status: ProjectStatus = "Planning"
    amenity_ids: list[str] = []
    milestone_template_id: str | None = None
    cover_image_url: str | None = None
    default_cash_percent: float = Field(default=0, ge=0, le=100)
    is_published: bool = False
    show_prices: bool = False
    show_availability: bool = False
    geo: GeoPoint | None = None
    landmarks: list[Landmark] = []
    approvals: list[Approval] = []
    team: list[str] = []
    escrow_bank_account_id: str | None = None
    land_area_sqft: float | None = Field(default=None, ge=0)
    phases: list[Phase] = []

    @field_validator("code")
    @classmethod
    def _code(cls, v):
        v = v.upper()
        if not v.replace("-", "").replace("_", "").isalnum():
            raise ValueError("Code must be alphanumeric")
        return v


class ProjectUpdate(StrictModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    default_cash_percent: float | None = Field(default=None, ge=0, le=100)
    description: str | None = None
    project_type: Literal["Residential", "Commercial", "Mixed"] | None = None
    address: Address | None = None
    rera_number: str | None = None
    launch_date: str | None = None
    expected_possession_date: str | None = None
    status: ProjectStatus | None = None
    amenity_ids: list[str] | None = None
    milestone_template_id: str | None = None
    cover_image_url: str | None = None
    is_published: bool | None = None
    show_prices: bool | None = None
    show_availability: bool | None = None
    is_active: bool | None = None
    geo: GeoPoint | None = None
    landmarks: list[Landmark] | None = None
    approvals: list[Approval] | None = None
    team: list[str] | None = None
    escrow_bank_account_id: str | None = None
    land_area_sqft: float | None = Field(default=None, ge=0)
    phases: list[Phase] | None = None
    version: int | None = None


async def _validate_refs(amenity_ids: list[str] | None, mt_id: str | None, team: list[str] | None = None, bank_id: str | None = None):
    if team:
        if await db.users.count_documents({"id": {"$in": team}, "is_active": True}) != len(set(team)):
            raise ApiError(400, "One or more team members are invalid", "INVALID_TEAM")
    if bank_id and not await db.bank_accounts.find_one({"id": bank_id, "is_active": True}):
        raise ApiError(400, "Escrow bank account not found", "INVALID_BANK_ACCOUNT")
    if amenity_ids:
        n = await db.amenities.count_documents({"id": {"$in": amenity_ids}, "is_active": True})
        if n != len(set(amenity_ids)):
            raise ApiError(400, "One or more amenities are invalid or inactive", "INVALID_AMENITY")
    if mt_id and not await db.milestone_templates.find_one({"id": mt_id, "is_active": True}):
        raise ApiError(400, "Milestone template not found", "INVALID_MILESTONE_TEMPLATE")


async def status_counts(match: dict) -> dict:
    rows = await db.flats.aggregate([{"$match": {**match, "is_active": True}}, {"$group": {"_id": "$status", "n": {"$sum": 1}, "value": {"$sum": {"$divide": [{"$ifNull": ["$price_paise", 0]}, 100]}}}}]).to_list(None)
    counts = {s: 0 for s in STATUSES}
    value = 0
    for r in rows:
        counts[r["_id"]] = r["n"]
        value += r["value"]
    counts["total"] = sum(counts[s] for s in STATUSES)
    counts["inventory_value"] = round(value, 2)
    return counts


async def _attach_counts(projects: list[dict]):
    from services.counters import present_counts
    for p in projects:
        present_counts(p)
        p["block_count"] = p.get("block_count", 0)
    return projects


@router.get("", response_model=ProjectsOutPage, response_model_exclude_unset=True)
async def list_projects(params: ListParams = Depends(), status: str | None = None, user: dict = Depends(require("masters.project.view"))):
    q = {"company_id": user["company_id"], **project_scope_filter(user, "id"), **search_filter(params.search, ["name", "code", "address.city"])}
    if not params.include_inactive:
        q["is_active"] = True
    if status:
        q["status"] = status
    res = await paginate(db.projects, q, params, params.sort_spec(["name", "code", "status", "created_at", "launch_date"]))
    if res.pop("_csv", False):
        from fastapi import Response

        from utils import to_csv
        return Response(to_csv(res["items"], ["code", "name", "project_type", "status", "rera_number", "launch_date", "expected_possession_date"]), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=projects.csv"})
    res["items"] = await _attach_counts(res["items"])
    return res


@router.get("/suggest-code")
async def suggest_code(name: str = "", user: dict = Depends(require("masters.project.create"))):
    """Atomic counter-backed code suggestion: initials + sequence (e.g. SGH-02)."""
    initials = "".join(w[0] for w in name.upper().split() if w[0].isalnum())[:4] or "PRJ"
    seq = await next_number("project_code", initials)
    code = initials if seq == 1 and not await db.projects.find_one({"company_id": user["company_id"], "code": initials}) else f"{initials}{seq:02d}"
    while await db.projects.find_one({"company_id": user["company_id"], "code": code}):
        seq = await next_number("project_code", initials)
        code = f"{initials}{seq:02d}"
    return {"code": code}


@router.post("", status_code=201)
async def create_project(body: ProjectCreate, request: Request, user: dict = Depends(require("masters.project.create"))):
    if await db.projects.find_one({"company_id": user["company_id"], "code": body.code}):
        raise ApiError(409, f"Project code {body.code} already exists", "DUPLICATE_CODE")
    await _validate_refs(body.amenity_ids, body.milestone_template_id, body.team, body.escrow_bank_account_id)
    doc = {**base_doc(user, user["company_id"]), **body.model_dump()}
    await db.projects.insert_one(doc)
    doc.pop("_id", None)
    await write_audit(user, "project.create", "project", doc["id"], after=doc, ip=client_ip(request))
    return doc


@router.get("/{project_id}", response_model=ProjectsOut, response_model_exclude_unset=True)
async def get_project(project_id: str, user: dict = Depends(require("masters.project.view"))):
    ensure_project_access(user, project_id)
    p = await get_or_404(db.projects, project_id, "Project", {"company_id": user["company_id"]})
    blocks = await db.blocks.find({"project_id": project_id, "is_active": True}, {"_id": 0, "position_flat_types": 0}).sort("code", 1).to_list(None)
    rows = await db.flats.aggregate([{"$match": {"project_id": project_id, "is_active": True}}, {"$group": {"_id": {"b": "$block_id", "s": "$status"}, "n": {"$sum": 1}}}]).to_list(None)
    bmap = {b["id"]: {s: 0 for s in STATUSES} for b in blocks}
    for r in rows:
        if r["_id"]["b"] in bmap:
            bmap[r["_id"]["b"]][r["_id"]["s"]] = r["n"]
    for b in blocks:
        c = bmap[b["id"]]
        c["total"] = sum(c[s] for s in STATUSES)
        b["inventory"] = c
    p["blocks"] = blocks
    p["inventory"] = await status_counts({"project_id": project_id})
    p["total_towers"] = len(blocks)
    p["total_units"] = p["inventory"]["total"]
    pk = await db.parking_slots.aggregate([{"$match": {"project_id": project_id, "is_active": True}}, {"$group": {"_id": "$status", "n": {"$sum": 1}}}]).to_list(None)
    p["parking"] = {"Available": 0, "Allotted": 0, "Blocked": 0, **{r["_id"]: r["n"] for r in pk}}
    p["parking"]["total"] = sum(r["n"] for r in pk)
    p["active_rate_card"] = await db.rate_cards.find_one({"project_id": project_id, "status": "Active"}, {"_id": 0, "id": 1, "name": 1, "effective_from": 1, "applied_at": 1})
    if p.get("team"):
        p["team_members"] = await db.users.find({"id": {"$in": p["team"]}}, {"_id": 0, "id": 1, "name": 1, "email": 1}).to_list(None)
    amen = await db.amenities.find({"id": {"$in": p.get("amenity_ids", [])}}, {"_id": 0}).to_list(None)
    p["amenities"] = amen
    if p.get("milestone_template_id"):
        p["milestone_template"] = await db.milestone_templates.find_one({"id": p["milestone_template_id"]}, {"_id": 0})
    return p


@router.patch("/{project_id}")
async def update_project(project_id: str, body: ProjectUpdate, request: Request, user: dict = Depends(require("masters.project.edit"))):
    ensure_project_access(user, project_id)
    before = await get_or_404(db.projects, project_id, "Project", {"company_id": user["company_id"]})
    changes = body.model_dump(exclude_unset=True)
    changes.pop("version", None)
    if not changes:
        raise ApiError(400, "No changes supplied", "NO_CHANGES")
    await _validate_refs(changes.get("amenity_ids"), changes.get("milestone_template_id"), changes.get("team"), changes.get("escrow_bank_account_id"))
    if changes.get("is_active") is False:
        n = await db.flats.count_documents({"project_id": project_id, "status": {"$in": ["Booked", "Sold", "Hold"]}})
        if n:
            raise ApiError(409, f"Cannot deactivate: project has {n} flat(s) on Hold/Booked/Sold", "IN_USE")
        changes["deleted_at"] = now_iso()
    if changes.get("is_active") is True:
        changes["deleted_at"] = None
    after = await apply_update(db.projects, before, changes, expected_version(request, body.version), "Project")
    await write_audit(user, "project.update", "project", project_id, before=before, after=after, ip=client_ip(request))
    return after
