import os
"""Public, unauthenticated, read-only website API. Strict output projections; cached 60 s with ETag; 300/min/IP."""
import hashlib
import json
import re
from datetime import UTC, datetime
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, Request, Response
from pydantic import Field, field_validator

from db import db
from deps import enforce_rate_limit
from routers.cms import get_site
from services.kyc import normalize_phone
from services.numbering import generate_number
from storage import get_object
from utils import ApiError, StrictModel, base_doc, client_ip, now_iso, public_url, write_audit

router = APIRouter(prefix="/public", tags=["public"])
ALLOWED_TOUR_HOSTS = ("my.matterport.com", "kuula.co", "www.youtube.com", "youtube.com", "player.vimeo.com", "www.google.com", "maps.google.com")
TODAY = lambda: datetime.now(UTC).date().isoformat()


async def public_guard(request: Request):
    await enforce_rate_limit(f"public:{client_ip(request)}", 300, 60)


async def _company_id() -> str:
    c = await db.companies.find_one({}, {"_id": 0, "id": 1})
    return c["id"] if c else ""


def memo_public(fn):
    import functools

    from services import ttlcache

    @functools.wraps(fn)
    async def wrapper(*args, **kwargs):
        request: Request = kwargs.get("request") or next(a for a in args if isinstance(a, Request))
        key = "pub:" + request.headers.get("host", "") + str(request.url.path) + "?" + str(request.url.query)
        hit = ttlcache.get(key)
        if hit is not None:
            return cached(request, hit)
        resp = await fn(*args, **kwargs)
        if isinstance(resp, Response) and resp.status_code == 200 and resp.media_type == "application/json":
            ttlcache.put(key, resp.body.decode(), 20)
        return resp
    return wrapper


def cached(request: Request, payload) -> Response:
    body = json.dumps(payload, default=str, separators=(",", ":")) if not isinstance(payload, str) else payload
    etag = '"' + hashlib.md5(body.encode()).hexdigest() + '"'
    headers = {"Cache-Control": "public, max-age=60", "ETag": etag}
    if etag in [t.strip().removeprefix("W/") for t in request.headers.get("if-none-match", "").split(",")]:
        return Response(status_code=304, headers=headers)
    return Response(content=body, media_type="application/json", headers=headers)


def safe_embed(url: str | None) -> str | None:
    if not url:
        return None
    host = urlparse(url).netloc.lower()
    return url if host in ALLOWED_TOUR_HOSTS or host.endswith(".matterport.com") else None


def site_public(s: dict, request: Request | None = None) -> dict:
    keys = ("brand_name", "tagline", "logo_url", "favicon_url", "phone", "whatsapp", "email", "portal_url", "offices", "social", "trust_stats", "footer_text", "rera_disclaimer", "seo_title", "seo_description", "og_image_url", "ga_id", "meta_pixel_id", "site_live", "home")
    out = {k: s.get(k) for k in keys}
    configured = out.get("portal_url") or os.environ.get("PORTAL_PUBLIC_URL")
    out["portal_url"] = public_url(request, configured, "/portal/") if request else configured
    return out


def pick(doc: dict, keys: tuple) -> dict:
    return {k: doc.get(k) for k in keys}


async def _spec_items(ft_ids: list[str]) -> list[dict]:
    if not ft_ids:
        return []
    cats = {c["id"]: c["name"] for c in await db.spec_categories.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(None)}
    items = await db.spec_items.find({"$or": [{"flat_type_id": {"$in": ft_ids}}, {"flat_type_ids": {"$in": ft_ids}}, {"flat_type_id": None}]}, {"_id": 0}).to_list(None)
    out = []
    for s in items:
        s["category_name"] = cats.get(s.get("spec_category_id"), "General")
        for fid in (s.get("flat_type_ids") or [s.get("flat_type_id")] or ft_ids):
            out.append({**s, "flat_type_id": fid})
    return out


async def _project_card(p: dict, flat_types: dict) -> dict:
    web = p.get("website") or {}
    ft_ids = await db.flats.distinct("flat_type_id", {"project_id": p["id"], "is_active": True})
    fts = sorted({flat_types[i]["bhk"] for i in ft_ids if i in flat_types and flat_types[i].get("bhk")})
    card = {"slug": web.get("slug"), "name": p["name"], "code": p["code"], "project_type": p.get("project_type"), "status": p.get("status"), "city": (p.get("address") or {}).get("city"), "locality": (p.get("address") or {}).get("line1"),
            "cover_image": (web.get("hero_images") or [None])[0], "configurations": " & ".join(f"{b}" for b in fts) + (" BHK" if fts else ""), "bhk_options": fts, "rera_number": p.get("rera_number"), "possession": p.get("expected_possession_date"),
            "show_prices": bool(web.get("show_prices")), "has_brochure": bool(web.get("brochure_document_id")) and web.get("brochure_gate_enabled") is not False, "total_units": (p.get("unit_counts") or {}).get("total", 0), "towers": p.get("block_count", 0), "highlights": (web.get("highlights") or [])[:3]}
    if web.get("show_prices"):
        if web.get("starting_price_override"):
            card["starting_price"] = web["starting_price_override"]
        else:
            m = await db.flats.find({"project_id": p["id"], "status": "Available", "price": {"$gt": 0}}, {"_id": 0, "price": 1}).sort("price", 1).limit(1).to_list(1)
            card["starting_price"] = m[0]["price"] if m else None
    return card


@router.get("/site")
@memo_public
async def site(request: Request, _=Depends(public_guard)):
    s = await get_site(await _company_id())
    return cached(request, site_public(s, request))


@router.get("/projects")
@memo_public
async def projects(request: Request, status: str | None = None, city: str | None = None, bhk: int | None = None, _=Depends(public_guard)):
    q = {"website.is_published": True, "is_active": True}
    if status:
        q["status"] = status
    if city:
        q["address.city"] = {"$regex": f"^{re.escape(city)}$", "$options": "i"}
    fts = {f["id"]: f for f in await db.flat_types.find({}, {"_id": 0, "id": 1, "bhk": 1}).to_list(None)}
    items = [await _project_card(p, fts) for p in await db.projects.find(q, {"_id": 0}).sort("name", 1).to_list(50)]
    if bhk:
        items = [i for i in items if bhk in i["bhk_options"]]
    return cached(request, {"items": items, "total": len(items)})


@router.get("/projects/{slug}")
@memo_public
async def project_detail(slug: str, request: Request, _=Depends(public_guard)):
    p = await db.projects.find_one({"website.slug": slug, "website.is_published": True, "is_active": True}, {"_id": 0})
    if not p:
        raise ApiError(404, "Project not found", "NOT_FOUND")
    web = p.get("website") or {}
    show_prices = bool(web.get("show_prices"))
    fts_all = {f["id"]: f for f in await db.flat_types.find({}, {"_id": 0}).to_list(None)}
    card = await _project_card(p, fts_all)
    amen_ids = p.get("amenity_ids") or []
    amenities = [pick(a, ("name", "category", "icon", "description")) for a in await db.amenities.find({"id": {"$in": amen_ids}, "is_active": True}, {"_id": 0}).to_list(None)]
    room_types = {r["id"]: r["name"] for r in await db.room_types.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(None)}
    area_codes = {a["id"]: a["code"] for a in await db.area_types.find({}, {"_id": 0, "id": 1, "code": 1}).to_list(None)}
    ft_ids = await db.flats.distinct("flat_type_id", {"project_id": p["id"], "is_active": True})
    templates = {t["flat_type_id"]: t for t in await db.floor_plan_templates.find({"flat_type_id": {"$in": ft_ids}}, {"_id": 0, "flat_type_id": 1, "image_url": 1, "name": 1}).to_list(None)} if ft_ids else {}
    spec_items = await _spec_items(ft_ids)
    configs = []
    for fid in ft_ids:
        f = fts_all.get(fid)
        if not f:
            continue
        ar = {area_codes.get(a.get("area_type_id")): a.get("value_sqft") for a in f.get("areas") or []}
        cfg = {"name": f["name"], "code": f["code"], "bhk": f.get("bhk"), "carpet_sqft": ar.get("CARPET"), "builtup_sqft": ar.get("BUILTUP"), "super_builtup_sqft": ar.get("SUPER_BUILTUP"), "facing": f.get("facing"), "description": f.get("description"),
               "rooms": [{"room": room_types.get(r.get("room_type_id"), r.get("label")), "label": r.get("label"), "length_ft": r.get("length_ft"), "width_ft": r.get("width_ft")} for r in f.get("rooms") or []],
               "floor_plan_image": (templates.get(fid) or {}).get("image_url"), "specifications": {}}
        for s in spec_items:
            if s["flat_type_id"] == fid:
                cfg["specifications"].setdefault(s.get("category_name") or "General", []).append({"name": s["name"], "value": s.get("brand") or s.get("description")})
        if show_prices:
            m = await db.flats.find({"project_id": p["id"], "flat_type_id": fid, "status": "Available", "price": {"$gt": 0}}, {"_id": 0, "price": 1}).sort("price", 1).limit(1).to_list(1)
            cfg["starting_price"] = m[0]["price"] if m else None
        configs.append(cfg)
    availability = None
    if web.get("show_availability"):
        availability = []
        for b in await db.blocks.find({"project_id": p["id"], "is_active": True}, {"_id": 0}).sort("code", 1).to_list(50):
            flats = await db.flats.find({"block_id": b["id"], "is_active": True}, {"_id": 0, "flat_number": 1, "floor": 1, "floor_label": 1, "position": 1, "status": 1, "flat_type_code": 1, "price": 1}).sort([("floor", -1), ("position", 1)]).to_list(None)
            floors = {}
            for f in flats:
                unit = {"number": f["flat_number"], "type": f.get("flat_type_code"), "available": f["status"] == "Available"}
                if show_prices and f["status"] == "Available":
                    unit["price"] = f.get("price")
                floors.setdefault(f["floor"], {"floor": f["floor"], "label": f.get("floor_label") or str(f["floor"]), "units": []})["units"].append(unit)
            c = b.get("unit_counts") or {}
            availability.append({"name": b["name"], "code": b["code"], "total": c.get("total", 0), "available": c.get("available", 0), "construction_percent": b.get("construction_percent", 0) if web.get("show_construction_progress") else None,
                                 "milestones": [{"name": m["name"], "percent": m["cumulative_percent"], "done": m["status"] == "Completed"} for m in b.get("milestones") or []] if web.get("show_construction_progress") else None,
                                 "floors": sorted(floors.values(), key=lambda x: -x["floor"])})
    gallery = [pick(g, ("image_url", "caption", "category")) for g in await db.cms_gallery.find({"project_id": p["id"], "is_active": True}, {"_id": 0}).sort("order", 1).to_list(60)]
    brochure = None
    if web.get("brochure_document_id"):
        d = await db.documents.find_one({"id": web["brochure_document_id"], "is_active": True, "is_sensitive": {"$ne": True}}, {"_id": 0, "id": 1, "file_name": 1})
        brochure = {"url": f"/api/public/brochure/{d['id']}", "file_name": d["file_name"]} if d else None
    detail = {**card, "description": web.get("public_description") or p.get("description"), "highlights": web.get("highlights") or [], "hero_images": web.get("hero_images") or [], "address": pick(p.get("address") or {}, ("line1", "city", "state", "pincode")),
              "geo": p.get("geo"), "landmarks": p.get("landmarks") or [], "approvals": [a.get("name") if isinstance(a, dict) else a for a in p.get("approvals") or []], "land_area_sqft": p.get("land_area_sqft"),
              "amenities": amenities, "configurations": configs, "availability": availability, "videos": [v for v in (web.get("video_urls") or []) if safe_embed(v)], "virtual_tours": [v for v in (web.get("virtual_tour_urls") or []) if safe_embed(v)],
              "map_embed_url": safe_embed(web.get("map_embed_url")), "faqs": web.get("faqs") or [], "gallery": gallery, "brochure": brochure, "seo_title": web.get("seo_title"), "seo_description": web.get("seo_description"), "show_construction_progress": bool(web.get("show_construction_progress"))}
    return cached(request, detail)


@router.get("/flat-types")
async def flat_types(request: Request, _=Depends(public_guard)):
    items = [pick(f, ("id", "name", "code", "bhk")) for f in await db.flat_types.find({"is_active": True}, {"_id": 0}).sort("bhk", 1).to_list(50)]
    return cached(request, {"items": items})


@router.get("/published-projects")
async def published_projects(request: Request, _=Depends(public_guard)):
    items = [{"id": p["id"], "name": p["name"], "slug": p["website"]["slug"]} for p in await db.projects.find({"website.is_published": True}, {"_id": 0, "id": 1, "name": 1, "website.slug": 1}).to_list(50)]
    return cached(request, {"items": items})


@router.get("/posts")
@memo_public
async def posts(request: Request, tag: str | None = None, _=Depends(public_guard)):
    q = {"status": "Published", "is_active": True, "publish_at": {"$lte": now_iso()}}
    if tag:
        q["tags"] = tag
    items = [pick(p, ("slug", "title", "excerpt", "cover_url", "author", "publish_at", "tags")) for p in await db.cms_posts.find(q, {"_id": 0}).sort("publish_at", -1).to_list(50)]
    return cached(request, {"items": items})


@router.get("/posts/{slug}")
async def post(slug: str, request: Request, _=Depends(public_guard)):
    p = await db.cms_posts.find_one({"slug": slug, "status": "Published", "is_active": True}, {"_id": 0})
    if not p:
        raise ApiError(404, "Post not found", "NOT_FOUND")
    related = [pick(r, ("slug", "title", "cover_url", "publish_at")) for r in await db.cms_posts.find({"status": "Published", "slug": {"$ne": slug}, "tags": {"$in": p.get("tags") or []}}, {"_id": 0}).limit(3).to_list(3)]
    return cached(request, {**pick(p, ("slug", "title", "excerpt", "cover_url", "author", "publish_at", "tags", "body", "seo_title", "seo_description")), "related": related})


@router.get("/pages/{slug}")
async def page(slug: str, request: Request, _=Depends(public_guard)):
    p = await db.cms_pages.find_one({"slug": slug, "is_active": True}, {"_id": 0})
    if not p:
        raise ApiError(404, "Page not found", "NOT_FOUND")
    return cached(request, pick(p, ("slug", "title", "body", "sections", "seo_title", "seo_description", "updated_at")))


@router.get("/home")
@memo_public
async def home(request: Request, _=Depends(public_guard)):
    cid = await _company_id()
    s = await get_site(cid)
    today = TODAY()
    banners = [pick(b, ("image_url", "video_url", "headline", "subheadline", "cta_label", "cta_link", "cta2_label", "cta2_link")) for b in await db.cms_banners.find({"is_active": True, "$and": [{"$or": [{"from_date": None}, {"from_date": {"$lte": today}}]}, {"$or": [{"to_date": None}, {"to_date": {"$gte": today}}]}]}, {"_id": 0}).sort("order", 1).to_list(10)]
    fts = {f["id"]: f for f in await db.flat_types.find({}, {"_id": 0, "id": 1, "bhk": 1}).to_list(None)}
    fq = {"website.is_published": True, "is_active": True}
    feat_ids = (s.get("home") or {}).get("featured_project_ids") or []
    if feat_ids:
        fq["id"] = {"$in": feat_ids}
    featured = [await _project_card(p, fts) for p in await db.projects.find(fq, {"_id": 0}).to_list(6)]
    testimonials = [pick(t, ("name", "designation", "photo_url", "quote", "rating", "project_name")) for t in await db.cms_testimonials.find({"is_active": True}, {"_id": 0}).sort("order", 1).to_list(12)]
    posts_ = [pick(p, ("slug", "title", "excerpt", "cover_url", "author", "publish_at", "tags")) for p in await db.cms_posts.find({"status": "Published", "is_active": True}, {"_id": 0}).sort("publish_at", -1).limit(3).to_list(3)]
    people = [pick(p, ("name", "designation", "photo_url", "bio")) for p in await db.cms_people.find({"is_active": True}, {"_id": 0}).sort("order", 1).to_list(12)]
    return cached(request, {"site": site_public(s, request), "banners": banners, "featured_projects": featured, "testimonials": testimonials, "posts": posts_, "people": people})


@router.get("/gallery")
async def gallery(request: Request, _=Depends(public_guard)):
    projects = {p["id"]: {"name": p["name"], "slug": (p.get("website") or {}).get("slug")} for p in await db.projects.find({"website.is_published": True}, {"_id": 0, "id": 1, "name": 1, "website.slug": 1}).to_list(50)}
    items = [{**pick(g, ("image_url", "caption", "category")), "project": projects.get(g.get("project_id"))} for g in await db.cms_gallery.find({"is_active": True}, {"_id": 0}).sort("order", 1).to_list(200)]
    return cached(request, {"items": items, "categories": sorted({i["category"] for i in items if i.get("category")})})


def _media_response(request: Request, data: bytes, ctype: str) -> Response:
    from services.thumbs import etag_for
    etag = etag_for(data)
    headers = {"Cache-Control": "public, max-age=31536000, immutable", "ETag": etag, "Vary": "Accept"}
    if request.headers.get("if-none-match", "").replace("W/", "") == etag:
        return Response(status_code=304, headers=headers)
    return Response(content=data, media_type=ctype, headers=headers)


@router.get("/media/photo/{photo_id}")
async def construction_photo(photo_id: str, request: Request, size: str | None = None, _=Depends(public_guard)):
    m = await db.construction_photos.find_one({"id": photo_id, "is_active": True, "$or": [{"visible_to_customers": True}, {"show_on_website": True}]}, {"_id": 0})
    if not m:
        raise ApiError(404, "Not found", "NOT_FOUND")
    from services.thumbs import get_variant, SIZES
    data, ctype = await get_variant(m["storage_key"], size)
    return _media_response(request, data, ctype if size in SIZES else (m["mime"] or ctype))


@router.get("/media/{media_id}")
async def media(media_id: str, request: Request, size: str | None = None, _=Depends(public_guard)):
    m = await db.cms_media.find_one({"id": media_id}, {"_id": 0})
    if not m:
        raise ApiError(404, "Not found", "NOT_FOUND")
    from services.thumbs import get_variant, SIZES
    data, ctype = await get_variant(m["storage_key"], size)
    return _media_response(request, data, ctype if size in SIZES else (m["mime"] or ctype))


@router.get("/brochure/{doc_id}")
async def brochure(doc_id: str, _=Depends(public_guard)):
    if "." in doc_id:  # signed lead-gate token (Phase 9)
        from routers.visits import brochure_download
        return await brochure_download(doc_id)
    d = await db.documents.find_one({"id": doc_id, "is_active": True, "is_sensitive": {"$ne": True}}, {"_id": 0})
    p = await db.projects.find_one({"website.brochure_document_id": doc_id, "website.is_published": True}, {"_id": 0, "id": 1}) if d else None
    if not d or not p:
        raise ApiError(404, "Not found", "NOT_FOUND")
    data, ctype = await get_object(d["storage_key"])
    return Response(content=data, media_type=d["mime"] or ctype, headers={"Content-Disposition": f'attachment; filename="{d["file_name"]}"', "Cache-Control": "public, max-age=3600"})


class EnquiryIn(StrictModel):
    name: str = Field(min_length=2, max_length=120)
    phone: str
    email: str | None = Field(default=None, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    project_slug: str | None = None
    flat_type_id: str | None = None
    flat_number: str | None = None
    message: str | None = Field(default=None, max_length=1000)
    consent: bool = True
    website: str | None = Field(default=None, max_length=200)  # honeypot
    utm: dict[str, str] | None = None

    @field_validator("phone")
    @classmethod
    def _ph(cls, v):
        return normalize_phone(v)


@router.post("/enquiries", status_code=200)
async def enquiry(body: EnquiryIn, request: Request):
    ip = client_ip(request)
    await enforce_rate_limit(f"enquiry:{ip}", 5, 60)
    if body.website:  # honeypot filled → silently drop
        return {"ok": True, "reference": None}
    if not body.consent:
        raise ApiError(422, "Consent is required", "VALIDATION_ERROR")
    cid = await _company_id()
    company = await db.companies.find_one({"id": cid}, {"_id": 0})
    project = await db.projects.find_one({"website.slug": body.project_slug, "website.is_published": True}, {"_id": 0, "id": 1, "name": 1}) if body.project_slug else None
    flat = await db.flats.find_one({"project_id": project["id"], "flat_number": body.flat_number}, {"_id": 0, "id": 1, "flat_type_id": 1}) if project and body.flat_number else None
    s = await get_site(cid)
    assigned = None
    if s.get("round_robin_assignment"):
        sales_role = await db.roles.find_one({"name": "Sales"}, {"_id": 0, "id": 1})
        reps = await db.users.find({"company_id": cid, "is_active": True, "role_id": sales_role["id"]}, {"_id": 0, "id": 1}).sort("id", 1).to_list(50) if sales_role else []
        if reps:
            c = await db.counters.find_one_and_update({"scope": "round_robin", "key": "sales"}, {"$inc": {"seq": 1}}, upsert=True, return_document=True)
            assigned = reps[c["seq"] % len(reps)]["id"]
    ts = now_iso()
    lead = {**base_doc(None, cid), "lead_number": await generate_number("lead", company), "name": body.name, "phone": body.phone, "email": body.email, "project_id": project["id"] if project else None, "project_name": project["name"] if project else None,
            "flat_type_id": body.flat_type_id or (flat or {}).get("flat_type_id"), "flat_id": (flat or {}).get("id"), "flat_number": body.flat_number if flat else None, "budget_min": None, "budget_max": None, "source": "Website", "status": "New",
            "stage_history": [{"status": "New", "at": ts, "by": None, "note": "Website enquiry"}], "assigned_to": assigned, "notes": body.message, "follow_ups": [], "next_follow_up_at": None, "lost_reason": None, "converted_customer_id": None,
            "utm": body.utm or {}, "ip": ip, "is_read": False}
    await db.leads.insert_one(lead)
    await write_audit(None, "lead.create", "lead", lead["id"], after={"lead_number": lead["lead_number"], "source": "Website", "project": lead["project_name"]}, company_id=cid)
    return {"ok": True, "reference": lead["lead_number"]}


@router.get("/sitemap.xml")
async def sitemap(request: Request):
    base = str(request.base_url).rstrip("/")
    if request.headers.get("x-forwarded-host"):
        base = f"{request.headers.get('x-forwarded-proto', 'https')}://{request.headers['x-forwarded-host']}"
    urls = [f"{base}/", f"{base}/projects", f"{base}/about", f"{base}/gallery", f"{base}/blog", f"{base}/contact", f"{base}/privacy", f"{base}/disclaimer"]
    urls += [f"{base}/projects/{p['website']['slug']}" for p in await db.projects.find({"website.is_published": True}, {"_id": 0, "website.slug": 1}).to_list(100)]
    urls += [f"{base}/blog/{p['slug']}" for p in await db.cms_posts.find({"status": "Published", "is_active": True}, {"_id": 0, "slug": 1}).to_list(200)]
    xml = '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + "".join(f"<url><loc>{u}</loc></url>" for u in urls) + "</urlset>"
    return Response(content=xml, media_type="application/xml", headers={"Cache-Control": "public, max-age=3600"})


@router.get("/robots.txt")
async def robots(request: Request):
    return Response(content=f"User-agent: *\nAllow: /\nDisallow: /erp/\nSitemap: {str(request.base_url).rstrip('/')}/api/public/sitemap.xml\n", media_type="text/plain")
