import uuid
from typing import Literal

from fastapi import APIRouter, Depends, File, Request, UploadFile
from pydantic import Field, field_validator

from db import db
from deps import ensure_project_access, project_scope_filter, require
from models_out import ProjectsOut, ProjectsOutPage
from services import inventory as inv
from services.filesig import sniff
from storage import APP_NAME, put_object
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
    load_test: bool = Field(
        default=False,
        description="Phase L: lineage tag — every record under this project is purgeable via /admin/load-test/purge",
    )
    show_prices: bool = False
    show_availability: bool = False
    geo: GeoPoint | None = None
    landmarks: list[Landmark] = []
    approvals: list[Approval] = []
    team: list[str] = []
    escrow_bank_account_id: str | None = None
    land_area_sqft: float | None = Field(default=None, ge=0)
    phases: list[Phase] = []
    cancellation_policy: "CancellationPolicy | None" = None
    bounce_policy: "BouncePolicy | None" = None

    @field_validator("code")
    @classmethod
    def _code(cls, v):
        v = v.upper()
        if not v.replace("-", "").replace("_", "").isalnum():
            raise ValueError("Code must be alphanumeric")
        return v


class CancellationPolicy(StrictModel):
    deduction_type: Literal["percent", "fixed"] = "percent"
    deduction_base: Literal["received", "agreement"] = "received"
    deduction_value: float = Field(ge=0)
    gst_on_deduction: bool = False
    refund_sla_days: int = Field(default=45, ge=0, le=365)


class BouncePolicy(StrictModel):
    enabled: bool = True
    charge_type_id: str | None = None
    amount: float = Field(default=500.0, ge=0)


ProjectCreate.model_rebuild()


class ProjectUpdate(StrictModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    code: str | None = Field(
        default=None, min_length=1, max_length=20
    )  # PS.4: editable while the project has no bookings
    default_cash_percent: float | None = Field(default=None, ge=0, le=100)
    cancellation_policy: CancellationPolicy | None = None
    bounce_policy: BouncePolicy | None = None
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


async def _validate_refs(
    amenity_ids: list[str] | None, mt_id: str | None, team: list[str] | None = None, bank_id: str | None = None
):
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


async def status_counts(match: dict, user: dict | None = None) -> dict:
    rows = await db.flats.aggregate(
        [
            {"$match": {**match, "is_active": True}},
            {
                "$group": {
                    "_id": inv.status_key(user),
                    "n": {"$sum": 1},
                    "value": {"$sum": {"$divide": [{"$ifNull": ["$price_paise", 0]}, 100]}},
                }
            },
        ]
    ).to_list(None)
    counts = {s: 0 for s in STATUSES}
    value = 0
    for r in rows:
        if r["_id"] in counts:
            counts[r["_id"]] = r["n"]
            value += r["value"]
    counts["total"] = sum(counts[s] for s in STATUSES)
    counts["inventory_value"] = round(value, 2)
    return counts


async def _attach_counts(projects: list[dict], user: dict | None = None):
    from services.counters import present_counts

    await inv.display_unit_counts(projects, "project_id", user)
    for p in projects:
        present_counts(p)
        p["block_count"] = p.get("block_count", 0)
    return projects


@router.get("", response_model=ProjectsOutPage, response_model_exclude_unset=True)
async def list_projects(
    params: ListParams = Depends(), status: str | None = None, user: dict = Depends(require("masters.project.view"))
):
    q = {
        "company_id": user["company_id"],
        **project_scope_filter(user, "id"),
        **search_filter(params.search, ["name", "code", "address.city"]),
    }
    if not params.include_inactive:
        q["is_active"] = True
    if status:
        q["status"] = status
    res = await paginate(
        db.projects, q, params, params.sort_spec(["name", "code", "status", "created_at", "launch_date"])
    )
    if res.pop("_csv", False):
        from fastapi import Response

        from utils import to_csv

        return Response(
            to_csv(
                res["items"],
                ["code", "name", "project_type", "status", "rera_number", "launch_date", "expected_possession_date"],
            ),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=projects.csv"},
        )
    res["items"] = await _attach_counts(res["items"], user)
    from services.cards import project_cards

    cards = await project_cards([p["id"] for p in res["items"]])
    for p in res["items"]:
        p["card"] = cards.get(p["id"])
        p.pop("photos", None)
    cq = {k: v for k, v in q.items() if k != "status"}
    res["status_counts"] = {
        r["_id"]: r["n"]
        for r in await db.projects.aggregate(
            [{"$match": cq}, {"$group": {"_id": "$status", "n": {"$sum": 1}}}]
        ).to_list(None)
    }
    return res


@router.get("/suggest-code")
async def suggest_code(name: str = "", user: dict = Depends(require("masters.project.create"))):
    """Atomic counter-backed code suggestion: initials + sequence (e.g. SGH-02)."""
    initials = "".join(w[0] for w in name.upper().split() if w[0].isalnum())[:4] or "PRJ"
    seq = await next_number("project_code", initials)
    code = (
        initials
        if seq == 1 and not await db.projects.find_one({"company_id": user["company_id"], "code": initials})
        else f"{initials}{seq:02d}"
    )
    while await db.projects.find_one({"company_id": user["company_id"], "code": code}):
        seq = await next_number("project_code", initials)
        code = f"{initials}{seq:02d}"
    return {"code": code}


@router.post("", status_code=201)
async def create_project(
    body: ProjectCreate, request: Request, user: dict = Depends(require("masters.project.create"))
):
    if await db.projects.find_one({"company_id": user["company_id"], "code": body.code}):
        raise ApiError(409, f"Project code {body.code} already exists", "DUPLICATE_CODE")
    await _validate_refs(body.amenity_ids, body.milestone_template_id, body.team, body.escrow_bank_account_id)
    doc = {**base_doc(user, user["company_id"]), **body.model_dump()}
    await db.projects.insert_one(doc)
    if doc.get("load_test"):
        from deps import refresh_loadtest_projects

        await refresh_loadtest_projects(doc["company_id"])
    doc.pop("_id", None)
    await write_audit(user, "project.create", "project", doc["id"], after=doc, ip=client_ip(request))
    return doc


@router.get("/{project_id}", response_model=ProjectsOut, response_model_exclude_unset=True)
async def get_project(project_id: str, user: dict = Depends(require("masters.project.view"))):
    ensure_project_access(user, project_id)
    p = await get_or_404(db.projects, project_id, "Project", {"company_id": user["company_id"]})
    blocks = (
        await db.blocks.find({"project_id": project_id, "is_active": True}, {"_id": 0, "position_flat_types": 0})
        .sort("code", 1)
        .to_list(None)
    )
    rows = await db.flats.aggregate(
        [
            {"$match": {"project_id": project_id, "is_active": True}},
            {"$group": {"_id": {"b": "$block_id", "s": inv.status_key(user)}, "n": {"$sum": 1}}},
        ]
    ).to_list(None)
    bmap = {b["id"]: {s: 0 for s in STATUSES} for b in blocks}
    for r in rows:
        if r["_id"]["b"] in bmap and r["_id"]["s"] in STATUSES:
            bmap[r["_id"]["b"]][r["_id"]["s"]] = r["n"]
    for b in blocks:
        c = bmap[b["id"]]
        c["total"] = sum(c[s] for s in STATUSES)
        b["inventory"] = c
    p["blocks"] = blocks
    p["inventory"] = await status_counts({"project_id": project_id}, user)
    p["total_towers"] = len(blocks)
    p["total_units"] = p["inventory"]["total"]
    from services.cards import project_cards

    p["card"] = (await project_cards([project_id]))[project_id]  # 3L: tower stage progress for the tower cards
    p["has_bookings"] = bool(
        await db.bookings.count_documents({"project_id": project_id, "status": {"$ne": "Cancelled"}})
    )  # PS.4: code lock reason
    pk = await db.parking_slots.aggregate(
        [{"$match": {"project_id": project_id, "is_active": True}}, {"$group": {"_id": "$status", "n": {"$sum": 1}}}]
    ).to_list(None)
    p["parking"] = {"Available": 0, "Allotted": 0, "Blocked": 0, **{r["_id"]: r["n"] for r in pk}}
    p["parking"]["total"] = sum(r["n"] for r in pk)
    p["active_rate_card"] = await db.rate_cards.find_one(
        {"project_id": project_id, "status": "Active"},
        {"_id": 0, "id": 1, "name": 1, "effective_from": 1, "applied_at": 1},
    )
    if p.get("team"):
        p["team_members"] = await db.users.find(
            {"id": {"$in": p["team"]}}, {"_id": 0, "id": 1, "name": 1, "email": 1}
        ).to_list(None)
    amen = await db.amenities.find({"id": {"$in": p.get("amenity_ids", [])}}, {"_id": 0}).to_list(None)
    p["amenities"] = amen
    if p.get("milestone_template_id"):
        p["milestone_template"] = await db.milestone_templates.find_one({"id": p["milestone_template_id"]}, {"_id": 0})
    p["photos"] = [_photo_out(x) for x in _seed_photos(p)]
    p.setdefault("cover_photo_id", p["photos"][0]["id"] if p["photos"] else None)
    return p


@router.patch("/{project_id}")
async def update_project(
    project_id: str, body: ProjectUpdate, request: Request, user: dict = Depends(require("masters.project.edit"))
):
    ensure_project_access(user, project_id)
    before = await get_or_404(db.projects, project_id, "Project", {"company_id": user["company_id"]})
    changes = body.model_dump(exclude_unset=True)
    changes.pop("version", None)
    if not changes:
        raise ApiError(400, "No changes supplied", "NO_CHANGES")
    await _validate_refs(
        changes.get("amenity_ids"),
        changes.get("milestone_template_id"),
        changes.get("team"),
        changes.get("escrow_bank_account_id"),
    )
    if "code" in changes and changes["code"] != before["code"]:
        changes["code"] = changes["code"].strip().upper()
        if await db.bookings.count_documents({"project_id": project_id, "status": {"$ne": "Cancelled"}}):
            raise ApiError(
                409,
                "Project code is locked because bookings exist (cancel or transfer them to unlock)",
                "CODE_LOCKED",
                {"unlock": f"/bookings?project_id={project_id}"},
            )
        if await db.projects.find_one(
            {"company_id": user["company_id"], "code": changes["code"], "id": {"$ne": project_id}}, {"_id": 0, "id": 1}
        ):
            raise ApiError(409, f"Project code {changes['code']} already exists", "DUPLICATE_CODE")
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


@router.post("/{project_id}/cover", status_code=201)
async def upload_cover(
    project_id: str,
    request: Request,
    file: UploadFile = File(...),
    user: dict = Depends(require("masters.project.edit")),
):
    """Older single-cover upload: adds the photo and makes it the cover."""
    added = await add_photo(project_id, request, file, user)
    before = await db.projects.find_one({"id": project_id}, {"_id": 0})
    photos = _seed_photos(before)
    out = await _save_photos(project_id, before, photos, photos[-1]["id"], user, request, "project.cover.upload")
    return {**added, **out}


# REQ-181…183: several photos per project; one is the cover (banner + project hero), the rest are the gallery.
PHOTO_EXT = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
PHOTO_MSG = "Photo must be an image under 15 MB"


def _photo_out(p: dict) -> dict:
    return {"id": p["id"], "url": p["url"], "mime": p["mime"]}


def _with_cover(photos: list[dict], cover_id: str | None) -> dict:
    cover = next((x for x in photos if x["id"] == cover_id), None) or (photos[0] if photos else None)
    if not cover:
        return {
            "photos": [],
            "cover_photo_id": None,
            "cover_storage_key": None,
            "cover_mime": None,
            "cover_image_url": None,
        }
    return {
        "photos": photos,
        "cover_photo_id": cover["id"],
        "cover_storage_key": cover["storage_key"],
        "cover_mime": cover["mime"],
        "cover_image_url": f"/api/public/project-cover/{cover['project_id']}?v={cover['id'][:8]}",
    }


async def _save_photos(project_id: str, before: dict, photos: list[dict], cover_id, user, request, action):
    changes = _with_cover(photos, cover_id)
    await db.projects.update_one(
        {"id": project_id}, {"$set": {**changes, "updated_at": now_iso()}, "$inc": {"version": 1}}
    )
    await write_audit(
        user,
        action,
        "project",
        project_id,
        before={"photos": len(before.get("photos") or []), "cover_photo_id": before.get("cover_photo_id")},
        after={"photos": len(photos), "cover_photo_id": changes["cover_photo_id"]},
        ip=client_ip(request),
    )
    return {
        "photos": [_photo_out(x) for x in photos],
        "cover_photo_id": changes["cover_photo_id"],
        "cover_image_url": changes["cover_image_url"],
        "version": int(before.get("version") or 0) + 1,  # an open Edit form keeps saving against the current version
    }


def _seed_photos(p: dict) -> list[dict]:
    """A cover uploaded before multi-photo support becomes the first photo."""
    photos = list(p.get("photos") or [])
    if not photos and p.get("cover_storage_key"):
        photos = [
            {
                "id": "cover",
                "project_id": p["id"],
                "storage_key": p["cover_storage_key"],
                "mime": p.get("cover_mime") or "image/jpeg",
                "url": f"/api/public/project-photo/{p['id']}/cover",
            }
        ]
    return photos


@router.get("/{project_id}/photos")
async def list_photos(project_id: str, user: dict = Depends(require("masters.project.view"))):
    ensure_project_access(user, project_id)
    p = await get_or_404(db.projects, project_id, "Project", {"company_id": user["company_id"]})
    photos = _seed_photos(p)
    return {
        "photos": [_photo_out(x) for x in photos],
        "cover_photo_id": p.get("cover_photo_id") or (photos[0]["id"] if photos else None),
    }


@router.post("/{project_id}/photos", status_code=201)
async def add_photo(
    project_id: str,
    request: Request,
    file: UploadFile = File(...),
    user: dict = Depends(require("masters.project.edit")),
):
    ensure_project_access(user, project_id)
    before = await get_or_404(db.projects, project_id, "Project", {"company_id": user["company_id"]})
    mime = (file.content_type or "").split(";")[0]
    ext = PHOTO_EXT.get(mime)
    data = await file.read()
    if not ext or not data or len(data) > 15 * 1024 * 1024 or not sniff(data, mime):
        raise ApiError(422, PHOTO_MSG, "BAD_PHOTO")
    pid = uuid.uuid4().hex
    try:
        res = await put_object(f"{APP_NAME}/project-photos/{project_id}/{pid}.{ext}", data, mime)
    except Exception as e:
        raise ApiError(502, f"Object storage upload failed: {e}", "STORAGE_ERROR")
    photos = _seed_photos(before) + [
        {
            "id": pid,
            "project_id": project_id,
            "storage_key": res["path"],
            "mime": mime,
            "url": f"/api/public/project-photo/{project_id}/{pid}",
        }
    ]
    cover = before.get("cover_photo_id") or photos[0]["id"]
    return await _save_photos(project_id, before, photos, cover, user, request, "project.photo.add")


class PhotoOrderIn(StrictModel):
    ids: list[str]
    cover_id: str | None = None


@router.put("/{project_id}/photos/order")
async def order_photos(
    project_id: str, body: PhotoOrderIn, request: Request, user: dict = Depends(require("masters.project.edit"))
):
    ensure_project_access(user, project_id)
    before = await get_or_404(db.projects, project_id, "Project", {"company_id": user["company_id"]})
    photos = _seed_photos(before)
    by_id = {x["id"]: x for x in photos}
    if sorted(body.ids) != sorted(by_id) or (body.cover_id and body.cover_id not in by_id):
        raise ApiError(422, "Photo list is out of date — reopen the project and try again", "STALE_PHOTOS")
    return await _save_photos(
        project_id,
        before,
        [by_id[i] for i in body.ids],
        body.cover_id or before.get("cover_photo_id"),
        user,
        request,
        "project.photo.order",
    )


@router.delete("/{project_id}/photos/{photo_id}")
async def remove_photo(
    project_id: str, photo_id: str, request: Request, user: dict = Depends(require("masters.project.edit"))
):
    ensure_project_access(user, project_id)
    before = await get_or_404(db.projects, project_id, "Project", {"company_id": user["company_id"]})
    photos = _seed_photos(before)
    if photo_id not in {x["id"] for x in photos}:
        raise ApiError(404, "Photo not found", "NOT_FOUND")
    rest = [x for x in photos if x["id"] != photo_id]
    cover = before.get("cover_photo_id")
    return await _save_photos(
        project_id, before, rest, None if cover == photo_id else cover, user, request, "project.photo.remove"
    )
