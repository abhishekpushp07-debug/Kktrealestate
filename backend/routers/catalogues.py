"""Catalogues: generic dropdown masters (`catalogue_items`) + the compact bundle that lets forms open with zero extra requests."""
import csv
import hashlib
import io
import json
import re

from fastapi import APIRouter, Depends, Request, Response, UploadFile, File
from pydantic import Field

from db import db
from deps import get_current_user, project_scope_filter, require
from services import cache
from utils import ApiError, StrictModel, base_doc, client_ip, get_or_404, now_iso, write_audit

router = APIRouter(prefix="/catalogues", tags=["catalogues"])

INDIAN_STATES = ["Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
                 "Andaman and Nicobar Islands", "Chandigarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry"]
CITIES = {"Bihar": ["Patna", "Gaya", "Bhagalpur", "Muzaffarpur", "Darbhanga", "Purnia", "Arrah", "Begusarai", "Katihar", "Munger", "Chhapra", "Bihar Sharif", "Hajipur", "Sasaram", "Dehri", "Siwan", "Motihari", "Nawada", "Bagaha", "Buxar"],
          "Delhi": ["New Delhi"], "Maharashtra": ["Mumbai", "Pune", "Nagpur", "Nashik"], "Karnataka": ["Bengaluru", "Mysuru"], "Tamil Nadu": ["Chennai", "Coimbatore"], "Telangana": ["Hyderabad"], "West Bengal": ["Kolkata"],
          "Gujarat": ["Ahmedabad", "Surat", "Vadodara"], "Uttar Pradesh": ["Lucknow", "Noida", "Ghaziabad", "Kanpur", "Varanasi"], "Haryana": ["Gurugram", "Faridabad"], "Rajasthan": ["Jaipur"], "Jharkhand": ["Ranchi", "Jamshedpur", "Dhanbad"], "Madhya Pradesh": ["Bhopal", "Indore"], "Punjab": ["Chandigarh", "Ludhiana"], "Kerala": ["Kochi", "Thiruvananthapuram"], "Odisha": ["Bhubaneswar"], "Chhattisgarh": ["Raipur"]}
PATNA_LOCALITIES = ["Boring Road", "Kankarbagh", "Bailey Road", "Patliputra Colony", "Rajendra Nagar", "Fraser Road", "Danapur", "Gola Road", "Saguna More", "Rukanpura", "Ashiana Nagar", "Khagaul", "Phulwari Sharif", "Anisabad", "Gardanibagh", "Kidwaipuri", "Sri Krishna Puri", "Exhibition Road", "Kumhrar", "Bahadurpur", "Digha", "Kurji", "Jaganpura", "Bypass Road", "Saidpur"]
PATNA_PINCODES = {"Boring Road": "800001", "Kankarbagh": "800020", "Bailey Road": "800014", "Patliputra Colony": "800013", "Rajendra Nagar": "800016", "Fraser Road": "800001",
                  "Danapur": "801503", "Gola Road": "801503", "Saguna More": "801503", "Rukanpura": "800014", "Ashiana Nagar": "800025", "Khagaul": "801105", "Phulwari Sharif": "801505",
                  "Anisabad": "800002", "Gardanibagh": "800002", "Kidwaipuri": "800001", "Sri Krishna Puri": "800001", "Exhibition Road": "800001", "Kumhrar": "800026", "Bahadurpur": "800026",
                  "Digha": "800011", "Kurji": "800010", "Jaganpura": "800027", "Bypass Road": "800027", "Saidpur": "800004"}
BANKS = ["State Bank of India", "Punjab National Bank", "Bank of Baroda", "Canara Bank", "Union Bank of India", "Bank of India", "Indian Bank", "Central Bank of India", "UCO Bank", "Bank of Maharashtra", "Indian Overseas Bank", "Punjab & Sind Bank",
         "HDFC Bank", "ICICI Bank", "Axis Bank", "Kotak Mahindra Bank", "IndusInd Bank", "Yes Bank", "IDFC First Bank", "Federal Bank", "RBL Bank", "Bandhan Bank", "South Indian Bank", "Karur Vysya Bank", "City Union Bank", "DCB Bank", "IDBI Bank", "AU Small Finance Bank", "Ujjivan Small Finance Bank", "Jana Small Finance Bank",
         "LIC Housing Finance", "HDFC Ltd (Housing)", "PNB Housing Finance", "Bajaj Housing Finance", "Tata Capital Housing Finance", "Aditya Birla Housing Finance", "India Post Payments Bank", "Bihar Gramin Bank", "Dakshin Bihar Gramin Bank", "Uttar Bihar Gramin Bank"]

SIMPLE = {
    "salutation": ["Mr", "Mrs", "Ms", "Dr", "Prof", "Adv", "CA", "Er", "M/s", "Smt", "Shri"],
    "gender": ["Male", "Female", "Other", "Prefer not to say"],
    "residency": ["Resident Indian", "NRI", "PIO / OCI", "Foreign National"],
    "occupation": ["Salaried – Private", "Salaried – Government", "Salaried – PSU", "Business owner", "Self-employed professional", "Doctor", "Chartered Accountant", "Advocate", "Engineer", "Teacher / Professor", "Defence / Police", "Farmer / Agriculture", "Retired", "Homemaker", "Student", "Other"],
    "income_band": ["Below ₹5 L", "₹5–10 L", "₹10–25 L", "₹25–50 L", "₹50 L–1 Cr", "Above ₹1 Cr"],
    "customer_segment": ["End-user", "Investor", "First-time buyer", "Upgrader", "HNI", "NRI", "Senior citizen", "Joint family", "Working couple", "Rental income seeker"],
    "relation": ["Spouse", "Father", "Mother", "Son", "Daughter", "Brother", "Sister", "Father-in-law", "Mother-in-law", "Friend", "Business partner", "Other"],
    "lead_source": ["Walk-in", "Website", "Referral", "Broker", "Campaign", "Brochure", "Site Visit", "99acres", "MagicBricks", "Housing.com", "Facebook / Instagram", "Google Ads", "Hoarding", "Newspaper", "Exhibition", "Existing customer", "Channel partner"],
    "lost_reason": ["Budget mismatch", "Location not suitable", "Bought elsewhere", "Possession timeline", "Loan not approved", "Not responding", "Postponed decision", "Size / layout", "Price negotiation failed", "Other"],
    "budget_band": ["Below ₹25 L", "₹25–50 L", "₹50–75 L", "₹75 L–1 Cr", "₹1–1.5 Cr", "₹1.5–2.5 Cr", "Above ₹2.5 Cr"],
    "facing": ["East", "West", "North", "South", "North-East", "North-West", "South-East", "South-West"],
    "floor_preference": ["Low (1–3)", "Mid (4–8)", "High (9+)", "Penthouse", "Ground floor", "No preference"],
    "bhk_preference": ["1 BHK", "2 BHK", "2.5 BHK", "3 BHK", "3.5 BHK", "4 BHK", "Duplex", "Penthouse", "Villa", "Plot", "Shop / Commercial"],
    "designation": ["Director", "CEO", "GM", "Manager", "Senior Executive", "Executive", "Partner", "Proprietor", "Consultant", "Other"],
    "broker_channel": ["Individual broker", "Channel partner firm", "Online aggregator", "Loyalty / referral program"],
    "communication_type": ["Call", "Meeting", "WhatsApp", "Email", "Site visit", "Letter", "SMS", "Video call"],
    "communication_outcome": ["Interested", "Call back", "Not reachable", "Negotiating", "Not interested", "Converted", "Follow-up scheduled", "Information sent"],
    "visit_outcome": ["Very interested", "Interested", "Needs second visit", "Not interested", "Budget issue", "Family decision pending"],
    "cancellation_reason": ["Loan rejected", "Financial difficulty", "Relocation", "Bought elsewhere", "Delay in possession", "Personal reasons", "Switched unit", "Other"],
    "nationality": ["Indian", "Nepali", "Bangladeshi", "Sri Lankan", "American", "British", "Canadian", "Australian", "Emirati", "Other"],
    "company_type": ["Individual", "HUF", "Partnership firm", "LLP", "Private limited", "Public limited", "Trust / Society", "Government body"],
}
# structured masters exposed compactly in the same bundle (zero extra requests for forms)
STRUCTURED = {
    "flat_types": (db.flat_types, {"id": 1, "name": 1, "code": 1, "bhk": 1, "super_builtup_sqft": 1, "base_rate_per_sqft": 1}),
    "block_types": (db.block_types, {"id": 1, "name": 1, "code": 1}),
    "amenities": (db.amenities, {"id": 1, "name": 1, "code": 1}),
    "construction_stages": (db.construction_stages, {"id": 1, "name": 1, "code": 1, "seq_hint": 1, "is_possession": 1}),
    "payment_plans": (db.payment_plans, {"id": 1, "name": 1, "code": 1, "plan_type": 1}),
    "charge_types": (db.charge_types, {"id": 1, "name": 1, "code": 1, "gst_percent": 1, "default_amount": 1}),
    "payment_modes": (db.payment_modes, {"id": 1, "name": 1, "code": 1, "requires_reference": 1}),
    "bank_accounts": (db.bank_accounts, {"id": 1, "bank_name": 1, "label": 1, "ifsc": 1}),
    "plc_types": (db.plc_types, {"id": 1, "name": 1, "code": 1, "calc_mode": 1}),
    "spec_items": (db.spec_items, {"id": 1, "name": 1, "code": 1, "category_id": 1}),
    "floor_plan_templates": (db.floor_plan_templates, {"id": 1, "name": 1, "code": 1}),
    "document_types": (db.document_types, {"id": 1, "name": 1, "code": 1}),
    "service_categories": (db.service_categories, {"id": 1, "name": 1, "order": 1}),
    "users": (db.users, {"id": 1, "name": 1, "email": 1, "role_id": 1}),
    "roles": (db.roles, {"id": 1, "name": 1}),
}


def _code(label: str) -> str:
    return re.sub(r"[^A-Z0-9]+", "_", label.upper()).strip("_")[:40] or "ITEM"


async def bump_version() -> int:
    doc = await db.settings.find_one_and_update({"key": "catalogues_version"}, {"$inc": {"value": 1}}, upsert=True, return_document=True)
    await cache.delete("catalogues:")
    return doc["value"]


async def current_version() -> int:
    doc = await db.settings.find_one({"key": "catalogues_version"}, {"_id": 0, "value": 1})
    return (doc or {}).get("value", 0)


async def seed_catalogues():
    """Idempotent: inserts missing system items only; never touches user edits."""
    company = await db.companies.find_one({}, {"_id": 0, "id": 1})
    if not company:
        return
    cid = company["id"]
    existing = {(d["type"], d["code"]) for d in await db.catalogue_items.find({"company_id": cid}, {"_id": 0, "type": 1, "code": 1}).to_list(None)}
    docs = []

    def add(t, label, parent_id=None, meta=None, order=0):
        code = _code(label)
        if (t, code) in existing:
            return None
        existing.add((t, code))
        d = {**base_doc(None, cid), "type": t, "code": code, "label": label, "parent_id": parent_id, "meta": meta or {}, "sort_order": order, "is_system": True}
        docs.append(d)
        return d["id"]

    for t, labels in SIMPLE.items():
        for i, l in enumerate(labels):
            add(t, l, order=i)
    for i, b in enumerate(BANKS):
        add("bank", b, order=i)
    state_ids = {}
    for i, s in enumerate(INDIAN_STATES):
        sid = add("state", s, order=i)
        state_ids[s] = sid or next((d["id"] for d in await db.catalogue_items.find({"company_id": cid, "type": "state", "code": _code(s)}, {"_id": 0, "id": 1}).to_list(1)), None)
    city_ids = {}
    for s, cities in CITIES.items():
        for i, c in enumerate(cities):
            cid_ = add("city", c, parent_id=state_ids.get(s), meta={"state": s}, order=i)
            city_ids[c] = cid_ or next((d["id"] for d in await db.catalogue_items.find({"company_id": cid, "type": "city", "code": _code(c)}, {"_id": 0, "id": 1}).to_list(1)), None)
    for i, l in enumerate(PATNA_LOCALITIES):
        add("locality", l, parent_id=city_ids.get("Patna"), meta={"city": "Patna", "pincode": PATNA_PINCODES[l]}, order=i)
    # backfill pincodes on already-seeded localities (idempotent)
    for l, pin in PATNA_PINCODES.items():
        await db.catalogue_items.update_many({"company_id": cid, "type": "locality", "code": _code(l), "meta.pincode": {"$exists": False}}, {"$set": {"meta.pincode": pin}})
    for i, sc in enumerate(await db.service_categories.find({}, {"_id": 0, "name": 1, "order": 1, "id": 1}).to_list(None)):
        add("service_category", sc["name"], meta={"legacy_id": sc["id"]}, order=sc.get("order", i))
    for i, dt in enumerate(await db.document_types.find({}, {"_id": 0, "name": 1, "code": 1, "id": 1}).to_list(None)):
        add("document_type", dt["name"], meta={"legacy_id": dt["id"], "legacy_code": dt.get("code")}, order=i)
    if docs:
        await db.catalogue_items.insert_many(docs)
        await bump_version()
    return len(docs)


async def bundle(company_id: str, user: dict | None = None) -> dict:
    version = await current_version()
    key = f"catalogues:{company_id}:{version}:{'*' if not user or '*' in (user.get('project_scope') or []) else hashlib.md5(','.join(sorted(user['project_scope'])).encode()).hexdigest()[:8]}"
    hit = await cache.get(key)
    if hit:
        return hit
    types: dict[str, list] = {}
    async for d in db.catalogue_items.find({"company_id": company_id, "is_active": True}, {"_id": 0, "id": 1, "type": 1, "code": 1, "label": 1, "parent_id": 1, "meta": 1}).sort([("type", 1), ("sort_order", 1), ("label", 1)]).batch_size(500):
        types.setdefault(d.pop("type"), []).append(d)
    for name, (coll, proj) in STRUCTURED.items():
        q = {"is_active": True}
        rows = await coll.find(q, {"_id": 0, **proj}).sort("name", 1).to_list(500)
        types[name] = [{"id": r["id"], "label": r.get("name") or r.get("label") or r.get("bank_name"), "code": r.get("code"), "meta": {k: v for k, v in r.items() if k not in ("id", "name", "code", "label")}} for r in rows]
    pf = project_scope_filter(user, "id") if user else {}
    projects = await db.projects.find({"company_id": company_id, "is_active": True, **pf}, {"_id": 0, "id": 1, "name": 1, "code": 1, "status": 1}).sort("name", 1).to_list(200)
    blocks = await db.blocks.find({"company_id": company_id, "is_active": True, **(project_scope_filter(user) if user else {})}, {"_id": 0, "id": 1, "name": 1, "code": 1, "project_id": 1, "construction_percent": 1}).sort("name", 1).to_list(1000)
    types["projects"] = [{"id": p["id"], "label": p["name"], "code": p["code"], "meta": {"status": p.get("status")}} for p in projects]
    types["blocks"] = [{"id": b["id"], "label": b["name"], "code": b["code"], "parent_id": b["project_id"], "meta": {"construction_percent": b.get("construction_percent", 0)}} for b in blocks]
    out = {"version": version, "types": types}
    await cache.set(key, out, 300)
    return out


def etag_response(request: Request, payload: dict, max_age: int = 300) -> Response:
    body = json.dumps(payload, separators=(",", ":"), default=str)
    tag = '"' + hashlib.sha1(body.encode()).hexdigest()[:32] + '"'
    headers = {"ETag": tag, "Cache-Control": f"private, max-age={max_age}", "Vary": "Authorization"}
    if request.headers.get("if-none-match") == tag:
        return Response(status_code=304, headers=headers)
    return Response(content=body, media_type="application/json", headers=headers)


@router.get("")
async def get_bundle(request: Request, user: dict = Depends(require("masters.catalogue.view"))):
    from services import ttlcache
    data = await ttlcache.cached(f"bundle:{ttlcache.scope_key(user)}:{await current_version()}", 15, lambda: bundle(user["company_id"], user))
    return etag_response(request, data)


@router.get("/{ctype}")
async def get_type(ctype: str, include_inactive: bool = False, parent_id: str | None = None, user: dict = Depends(require("masters.catalogue.view"))):
    q = {"company_id": user["company_id"], "type": ctype, **({} if include_inactive else {"is_active": True}), **({"parent_id": parent_id} if parent_id else {})}
    items = await db.catalogue_items.find(q, {"_id": 0}).sort([("sort_order", 1), ("label", 1)]).to_list(2000)
    return {"type": ctype, "items": items, "total": len(items), "version": await current_version()}


class ItemIn(StrictModel):
    label: str = Field(min_length=1, max_length=80)
    code: str | None = Field(default=None, max_length=40)
    parent_id: str | None = None
    meta: dict = {}
    sort_order: int | None = None


class ItemPatch(StrictModel):
    label: str | None = Field(default=None, min_length=1, max_length=80)
    parent_id: str | None = None
    meta: dict | None = None
    sort_order: int | None = None
    is_active: bool | None = None
    version: int | None = None


@router.post("/{ctype}/items", status_code=201)
async def add_item(ctype: str, body: ItemIn, request: Request, user: dict = Depends(require("masters.catalogue.create"))):
    if not re.fullmatch(r"[a-z_]{2,40}", ctype):
        raise ApiError(422, "Invalid catalogue type", "VALIDATION_ERROR")
    code = _code(body.code or body.label)
    if await db.catalogue_items.find_one({"company_id": user["company_id"], "type": ctype, "code": code}):
        raise ApiError(409, f"'{body.label}' already exists in {ctype}", "DUPLICATE_NAME")
    if body.parent_id and not await db.catalogue_items.find_one({"id": body.parent_id, "company_id": user["company_id"]}):
        raise ApiError(422, "parent_id not found", "VALIDATION_ERROR")
    order = body.sort_order if body.sort_order is not None else (await db.catalogue_items.count_documents({"company_id": user["company_id"], "type": ctype})) + 1
    d = {**base_doc(user, user["company_id"]), "type": ctype, "code": code, "label": body.label, "parent_id": body.parent_id, "meta": body.meta, "sort_order": order, "is_system": False}
    await db.catalogue_items.insert_one(d)
    d.pop("_id", None)
    d["version_bundle"] = await bump_version()
    await write_audit(user, "catalogue.add", "catalogue_item", d["id"], after={"type": ctype, "label": body.label}, ip=client_ip(request))
    return d


@router.patch("/{ctype}/items/{item_id}")
async def patch_item(ctype: str, item_id: str, body: ItemPatch, request: Request, user: dict = Depends(require("masters.catalogue.edit"))):
    before = await get_or_404(db.catalogue_items, item_id, "Catalogue item", {"company_id": user["company_id"], "type": ctype})
    changes = {k: v for k, v in body.model_dump(exclude_none=True).items() if k != "version"}
    if before.get("is_system") and "label" in changes and before["label"] != changes["label"]:
        changes["meta"] = {**(before.get("meta") or {}), "system_label": before["label"]}
    changes["updated_at"] = now_iso()
    q = {"id": item_id, **({"version": body.version} if body.version is not None else {})}
    res = await db.catalogue_items.find_one_and_update(q, {"$set": changes, "$inc": {"version": 1}}, projection={"_id": 0}, return_document=True)
    if not res:
        raise ApiError(409, "Item was modified by someone else. Reload and retry.", "VERSION_CONFLICT")
    await bump_version()
    await write_audit(user, "catalogue.update", "catalogue_item", item_id, before={"label": before["label"], "is_active": before["is_active"]}, after=changes, ip=client_ip(request))
    return res


class ReorderIn(StrictModel):
    ids: list[str]


@router.post("/{ctype}/reorder")
async def reorder(ctype: str, body: ReorderIn, request: Request, user: dict = Depends(require("masters.catalogue.edit"))):
    for i, iid in enumerate(body.ids):
        await db.catalogue_items.update_one({"id": iid, "company_id": user["company_id"], "type": ctype}, {"$set": {"sort_order": i, "updated_at": now_iso()}})
    await bump_version()
    await write_audit(user, "catalogue.reorder", "catalogue_item", ctype, after={"count": len(body.ids)}, ip=client_ip(request))
    return {"ok": True}


@router.get("/{ctype}/export.csv")
async def export_csv(ctype: str, user: dict = Depends(require("masters.catalogue.view"))):
    items = await db.catalogue_items.find({"company_id": user["company_id"], "type": ctype}, {"_id": 0}).sort("sort_order", 1).to_list(5000)
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=["code", "label", "parent_code", "sort_order", "is_active"], extrasaction="ignore")
    w.writeheader()
    parents = {d["id"]: d["code"] for d in await db.catalogue_items.find({"id": {"$in": [i["parent_id"] for i in items if i.get("parent_id")]}}, {"_id": 0, "id": 1, "code": 1}).to_list(None)}
    for i in items:
        w.writerow({**i, "parent_code": parents.get(i.get("parent_id"))})
    return Response(buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": f"attachment; filename={ctype}.csv"})


@router.post("/{ctype}/import")
async def import_csv(ctype: str, request: Request, file: UploadFile = File(...), user: dict = Depends(require("masters.catalogue.create"))):
    rows = list(csv.DictReader(io.StringIO((await file.read()).decode("utf-8-sig"))))
    added = updated = 0
    for i, r in enumerate(rows):
        label = (r.get("label") or "").strip()
        if not label:
            continue
        code = _code(r.get("code") or label)
        parent = await db.catalogue_items.find_one({"company_id": user["company_id"], "code": _code(r["parent_code"])}, {"_id": 0, "id": 1}) if r.get("parent_code") else None
        upd = {"label": label, "parent_id": parent["id"] if parent else None, "sort_order": int(r.get("sort_order") or i), "is_active": str(r.get("is_active", "true")).lower() not in ("false", "0", "no"), "updated_at": now_iso()}
        res = await db.catalogue_items.update_one({"company_id": user["company_id"], "type": ctype, "code": code}, {"$set": upd, "$setOnInsert": {**base_doc(user, user["company_id"]), "type": ctype, "code": code, "meta": {}, "is_system": False}}, upsert=True)
        added += 1 if res.upserted_id else 0
        updated += 0 if res.upserted_id else 1
    await bump_version()
    await write_audit(user, "catalogue.import", "catalogue_item", ctype, after={"added": added, "updated": updated}, ip=client_ip(request))
    return {"added": added, "updated": updated}
