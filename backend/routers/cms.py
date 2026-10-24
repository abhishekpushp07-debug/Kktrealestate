"""Website CMS (ERP side). Permissions cms.read / cms.write. Media via object storage, streamed publicly at /api/public/media/{id}."""
import re
import uuid
from typing import Any

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from pydantic import Field

from db import db
from deps import ensure_project_access, require
from services import ttlcache
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
    now_iso,
    paginate,
    search_filter,
    write_audit,
)

router = APIRouter(prefix="/cms", tags=["cms"])

# collection name -> (list sort, searchable fields)
COLLECTIONS = {
    "banners": ("order", ["headline"]),
    "testimonials": ("order", ["name", "quote"]),
    "gallery": ("order", ["caption"]),
    "posts": ("-created_at", ["title", "excerpt", "tags"]),
    "pages": ("slug", ["title", "slug"]),
    "people": ("order", ["name", "designation"]),
    "faqs": ("order", ["question"]),
}
DEFAULT_SITE = {
    "brand_name": "Shree Ganesh Builders", "tagline": "Homes built on trust", "logo_url": None, "favicon_url": None, "phone": "+916122234567", "whatsapp": "+919430000000", "email": "sales@shreeganeshbuilders.in",
    "offices": [], "social": {}, "trust_stats": [], "footer_text": "", "rera_disclaimer": "", "seo_title": "", "seo_description": "", "og_image_url": None, "ga_id": None, "meta_pixel_id": None,
    "round_robin_assignment": True, "site_live": True, "home": {"value_props": [], "featured_project_ids": [], "walkthrough_video_url": None, "sections": {}},
}


def slugify(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")[:80]


class CmsItem(StrictModel):
    data: dict[str, Any]
    version: int | None = None


class SiteSettingsIn(StrictModel):
    data: dict[str, Any]
    version: int | None = None


class ProjectWebsiteIn(StrictModel):
    is_published: bool | None = None
    slug: str | None = Field(default=None, max_length=80)
    show_prices: bool | None = None
    show_availability: bool | None = None
    show_construction_progress: bool | None = None
    starting_price_override: float | None = None
    hero_images: list[str] | None = None
    highlights: list[str] | None = None
    video_urls: list[str] | None = None
    virtual_tour_urls: list[str] | None = None
    map_embed_url: str | None = None
    brochure_document_id: str | None = None
    faqs: list[dict[str, str]] | None = None
    seo_title: str | None = None
    seo_description: str | None = None
    public_description: str | None = None
    version: int | None = None


async def get_site(company_id: str) -> dict:
    doc = await db.site_settings.find_one({"company_id": company_id}, {"_id": 0})
    if not doc:
        doc = {**base_doc(None, company_id), **DEFAULT_SITE}
        await db.site_settings.insert_one(doc)
        doc.pop("_id", None)
    return doc


@router.get("/site")
async def site(user: dict = Depends(require("cms.read"))):
    return await get_site(user["company_id"])


@router.patch("/site")
async def update_site(body: SiteSettingsIn, request: Request, user: dict = Depends(require("cms.write"))):
    before = await get_site(user["company_id"])
    changes = {k: v for k, v in body.data.items() if k in DEFAULT_SITE}
    after = await apply_update(db.site_settings, before, changes, expected_version(request, body.version), "Site settings")
    ttlcache.invalidate("pub:")
    await write_audit(user, "cms.site.update", "site_settings", before["id"], before={k: before.get(k) for k in changes}, after=changes, ip=client_ip(request))
    return after


@router.post("/media", status_code=201)
async def upload_media(request: Request, file: UploadFile = File(...), caption: str | None = Form(None), user: dict = Depends(require("cms.write"))):
    mime = (file.content_type or "").split(";")[0]
    ext = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/svg+xml": "svg", "image/x-icon": "ico", "application/pdf": "pdf"}.get(mime)
    if not ext:
        raise ApiError(422, "Only JPG/PNG/WEBP/SVG/ICO/PDF allowed", "UNSUPPORTED_MEDIA")
    data = await file.read()
    if not sniff(data, mime):
        raise ApiError(422, "File content does not match its type", "UNSUPPORTED_MEDIA")
    if len(data) > 15 * 1024 * 1024 or not data:
        raise ApiError(413, "File must be 1 byte – 15 MB", "PAYLOAD_TOO_LARGE")
    path = f"{APP_NAME}/cms/{uuid.uuid4()}.{ext}"
    try:
        res = await put_object(path, data, mime)
    except Exception as e:
        raise ApiError(502, f"Object storage upload failed: {e}", "STORAGE_ERROR")
    doc = {**base_doc(user, user["company_id"]), "file_name": file.filename, "mime": mime, "size": len(data), "storage_key": res["path"], "caption": caption}
    await db.cms_media.insert_one(doc)
    doc.pop("_id", None)
    doc["url"] = f"/api/public/media/{doc['id']}"
    ttlcache.invalidate("pub:")
    await write_audit(user, "cms.media.upload", "cms_media", doc["id"], after={"file_name": file.filename, "size": len(data)}, ip=client_ip(request))
    return doc


@router.get("/{coll}")
async def list_items(coll: str, params: ListParams = Depends(), project_id: str | None = None, status: str | None = None, user: dict = Depends(require("cms.read"))):
    if coll not in COLLECTIONS:
        raise ApiError(404, "Unknown CMS collection", "NOT_FOUND")
    sort, fields = COLLECTIONS[coll]
    q = {"company_id": user["company_id"], **search_filter(params.search, fields)}
    if project_id:
        q["project_id"] = project_id
    if status:
        q["status"] = status
    return await paginate(db[f"cms_{coll}"], q, params, params.sort_spec(["order", "created_at", "title", "name", "status", "slug", "publish_at"], sort))


@router.post("/{coll}", status_code=201)
async def create_item(coll: str, body: CmsItem, request: Request, user: dict = Depends(require("cms.write"))):
    if coll not in COLLECTIONS:
        raise ApiError(404, "Unknown CMS collection", "NOT_FOUND")
    data = dict(body.data)
    if coll in ("posts", "pages"):
        data["slug"] = slugify(data.get("slug") or data.get("title"))
        if await db[f"cms_{coll}"].find_one({"company_id": user["company_id"], "slug": data["slug"]}):
            raise ApiError(409, f"Slug '{data['slug']}' already exists", "DUPLICATE_SLUG")
        data.setdefault("status", "Draft")
    data.setdefault("is_active", True)
    data.setdefault("order", await db[f"cms_{coll}"].count_documents({"company_id": user["company_id"]}) + 1)
    doc = {**base_doc(user, user["company_id"]), **data}
    await db[f"cms_{coll}"].insert_one(doc)
    doc.pop("_id", None)
    ttlcache.invalidate("pub:")
    await write_audit(user, f"cms.{coll}.create", f"cms_{coll}", doc["id"], after=doc, ip=client_ip(request))
    return doc


@router.patch("/{coll}/{item_id}")
async def update_item(coll: str, item_id: str, body: CmsItem, request: Request, user: dict = Depends(require("cms.write"))):
    if coll not in COLLECTIONS:
        raise ApiError(404, "Unknown CMS collection", "NOT_FOUND")
    before = await get_or_404(db[f"cms_{coll}"], item_id, "Item", {"company_id": user["company_id"]})
    changes = {k: v for k, v in body.data.items() if k not in ("id", "company_id", "created_at", "version")}
    if coll in ("posts", "pages") and "slug" in changes:
        changes["slug"] = slugify(changes["slug"])
    if coll == "posts" and changes.get("status") == "Published" and before.get("status") != "Published":
        changes.setdefault("publish_at", now_iso())
    after = await apply_update(db[f"cms_{coll}"], before, changes, expected_version(request, body.version), "Item")
    ttlcache.invalidate("pub:")
    await write_audit(user, f"cms.{coll}.update", f"cms_{coll}", item_id, before={k: before.get(k) for k in changes}, after=changes, ip=client_ip(request))
    return after


@router.delete("/{coll}/{item_id}")
async def delete_item(coll: str, item_id: str, request: Request, user: dict = Depends(require("cms.write"))):
    if coll not in COLLECTIONS:
        raise ApiError(404, "Unknown CMS collection", "NOT_FOUND")
    before = await get_or_404(db[f"cms_{coll}"], item_id, "Item", {"company_id": user["company_id"]})
    await db[f"cms_{coll}"].delete_one({"id": item_id})
    ttlcache.invalidate("pub:")
    await write_audit(user, f"cms.{coll}.delete", f"cms_{coll}", item_id, before=before, ip=client_ip(request))
    return {"ok": True}


@router.get("/projects/{project_id}/website")
async def project_website(project_id: str, user: dict = Depends(require("project.read"))):
    p = await get_or_404(db.projects, project_id, "Project", {"company_id": user["company_id"]})
    ensure_project_access(user, project_id)
    return {"id": p["id"], "version": p["version"], "website": p.get("website") or {"is_published": False, "slug": slugify(p["name"])}}


@router.patch("/projects/{project_id}/website")
async def update_project_website(project_id: str, body: ProjectWebsiteIn, request: Request, user: dict = Depends(require("project.write"))):
    p = await get_or_404(db.projects, project_id, "Project", {"company_id": user["company_id"]})
    ensure_project_access(user, project_id)
    web = {**(p.get("website") or {}), **{k: v for k, v in body.model_dump(exclude_unset=True).items() if k != "version"}}
    web["slug"] = slugify(web.get("slug") or p["name"])
    if await db.projects.find_one({"company_id": p["company_id"], "website.slug": web["slug"], "id": {"$ne": project_id}}):
        raise ApiError(409, f"Slug '{web['slug']}' already used", "DUPLICATE_SLUG")
    if web.get("is_published"):
        missing = [m for m, ok in (("hero image", bool(web.get("hero_images"))), ("description", bool(web.get("public_description") or p.get("description"))), ("location", bool(p.get("address", {}).get("city") or p.get("geo")))) if not ok]
        if missing:
            raise ApiError(422, "Cannot publish without: " + ", ".join(missing), "PUBLISH_BLOCKED")
    after = await apply_update(db.projects, p, {"website": web}, expected_version(request, body.version), "Project")
    ttlcache.invalidate("pub:")
    await write_audit(user, "cms.project.website", "project", project_id, before={"website": p.get("website")}, after={"website": web}, ip=client_ip(request))
    return {"id": after["id"], "version": after["version"], "website": web}
