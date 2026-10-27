import csv
import io
from typing import Literal

from fastapi import APIRouter, Depends, File, Request, Response, UploadFile
from pymongo import UpdateOne

from db import db
from deps import ensure_project_access, require
from routers.master import AmenityIn, FlatTypeIn, validate_flat_type_payload
from utils import ApiError, base_doc, client_ip, new_id, now_iso, write_audit

router = APIRouter(prefix="/imports", tags=["imports"])
Kind = Literal["flat-types", "flat-pricing", "parking-slots", "amenities", "customers"]

TEMPLATES = {
    "flat-types": ["name", "code", "bhk", "facing", "base_rate_per_sqft", "base_price", "carpet_sqft", "builtup_sqft", "super_builtup_sqft", "rooms"],
    "flat-pricing": ["flat_number", "price", "rate_per_sqft"],
    "parking-slots": ["number", "type", "level", "price"],
    "amenities": ["name", "category", "icon", "description"],
    "customers": ["full_name", "email", "phone", "pan", "aadhaar_last4", "address_line1", "city", "state", "pincode"],
}
SAMPLES = {
    "flat-types": ["5BHK-Penthouse", "5BHK-PH", "5", "N", "5200", "", "2100", "2450", "3200", "Living:22x18;Master Bedroom:16x14;Kitchen:14x10"],
    "flat-pricing": ["A-101", "6500000", ""],
    "parking-slots": ["B1-P001", "Basement", "B1", "300000"],
    "amenities": ["Yoga Deck", "Lifestyle", "flower", "Rooftop yoga deck"],
    "customers": ["Rahul Mehta", "rahul@example.com", "9876543210", "ABCDE1234F", "1234", "12 MG Road", "Patna", "Bihar", "800001"],
}


def _num(v, field, errors, required=False):
    if v in (None, ""):
        if required:
            errors.append(f"{field} is required")
        return None
    try:
        return float(v)
    except ValueError:
        errors.append(f"{field} must be a number")
        return None


@router.get("/template/{kind}")
async def template(kind: Kind, user: dict = Depends(require("masters.project.view"))):
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(TEMPLATES[kind])
    w.writerow(SAMPLES[kind])
    return Response(buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": f"attachment; filename={kind}-template.csv"})


async def _parse(file: UploadFile) -> list[dict]:
    raw = await file.read()
    if len(raw) > 2 * 1024 * 1024:
        raise ApiError(413, "CSV too large (max 2 MB)", "PAYLOAD_TOO_LARGE")
    rows = list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))))
    if not rows:
        raise ApiError(422, "CSV has no data rows", "EMPTY_CSV")
    if len(rows) > 5000:
        raise ApiError(422, "Max 5000 rows per import", "TOO_MANY_ROWS")
    return rows


async def _validate_rows(kind: str, rows: list[dict], project_id: str | None, user: dict) -> list[dict]:  # noqa: C901 — pre-existing (35); tracked in CR backlog
    out = []
    if kind == "flat-pricing":
        if not project_id:
            raise ApiError(422, "project_id is required for flat pricing import", "VALIDATION_ERROR")
        ensure_project_access(user, project_id)
        numbers = [r.get("flat_number", "").strip() for r in rows]
        flats = {f["flat_number"]: f for f in await db.flats.find({"project_id": project_id, "flat_number": {"$in": numbers}}, {"_id": 0, "id": 1, "flat_number": 1, "status": 1, "super_builtup_sqft": 1}).to_list(None)}
        seen = set()
        for i, r in enumerate(rows, start=2):
            errors, fn = [], r.get("flat_number", "").strip()
            f = flats.get(fn)
            if not fn:
                errors.append("flat_number is required")
            elif not f:
                errors.append(f"flat {fn} not found in project")
            elif f["status"] not in ("Available", "Hold", "Blocked"):
                errors.append(f"flat {fn} is {f['status']}; price locked by booking")
            if fn in seen:
                errors.append("duplicate flat_number in file")
            seen.add(fn)
            price, rate = _num(r.get("price"), "price", errors), _num(r.get("rate_per_sqft"), "rate_per_sqft", errors)
            if price is None and rate is None:
                errors.append("price or rate_per_sqft required")
            if rate is not None and f:
                price = round(rate * (f.get("super_builtup_sqft") or 0), 2)
            out.append({"row": i, "data": {"flat_number": fn, "flat_id": f["id"] if f else None, "price_paise": round(price * 100) if price is not None else None, "rate_per_sqft": rate}, "errors": errors})
    elif kind == "parking-slots":
        if not project_id:
            raise ApiError(422, "project_id is required for parking import", "VALIDATION_ERROR")
        ensure_project_access(user, project_id)
        existing = set(await db.parking_slots.distinct("number", {"project_id": project_id}))
        seen = set()
        for i, r in enumerate(rows, start=2):
            errors, n = [], r.get("number", "").strip()
            if not n:
                errors.append("number is required")
            if n in existing:
                errors.append(f"slot {n} already exists")
            if n in seen:
                errors.append("duplicate number in file")
            seen.add(n)
            t = r.get("type", "").strip().title()
            if t not in ("Covered", "Open", "Stilt", "Basement"):
                errors.append("type must be Covered/Open/Stilt/Basement")
            out.append({"row": i, "data": {"number": n, "type": t, "level": r.get("level") or None, "price": _num(r.get("price"), "price", errors)}, "errors": errors})
    elif kind == "amenities":
        names = set(await db.amenities.distinct("name", {"company_id": user["company_id"]}))
        for i, r in enumerate(rows, start=2):
            errors = []
            try:
                data = AmenityIn.model_validate({k: (r.get(k) or None) for k in ("name", "category", "icon", "description")}).model_dump()
                if data["name"] in names:
                    errors.append(f"amenity '{data['name']}' already exists")
            except Exception as e:
                data = dict(r)
                errors.append(str(e).split("\n")[1].strip() if "\n" in str(e) else str(e))
            out.append({"row": i, "data": data, "errors": errors})
    elif kind == "flat-types":
        ats = {a["code"]: a["id"] for a in await db.area_types.find({"company_id": user["company_id"], "is_active": True}, {"_id": 0, "id": 1, "code": 1}).to_list(None)}
        rts = {r["name"].lower(): r["id"] for r in await db.room_types.find({"company_id": user["company_id"], "is_active": True}, {"_id": 0, "id": 1, "name": 1}).to_list(None)}
        codes = set(await db.flat_types.distinct("code", {"company_id": user["company_id"]}))
        for i, r in enumerate(rows, start=2):
            errors, rooms = [], []
            for part in (r.get("rooms") or "").split(";"):
                if not part.strip():
                    continue
                try:
                    label, dims = part.split(":")
                    L, W = dims.lower().split("x")
                    rt = next((rid for name, rid in rts.items() if name in label.strip().lower() or label.strip().lower() in name), None) or rts.get("bedroom")
                    if not rt:
                        errors.append(f"room type not found for '{label}'")
                    rooms.append({"room_type_id": rt, "label": label.strip(), "length_ft": float(L), "width_ft": float(W)})
                except Exception:
                    errors.append(f"bad room spec '{part}' (use Label:LxW)")
            areas = [{"area_type_id": ats.get(c), "value_sqft": _num(r.get(k), k, errors)} for c, k in (("CARPET", "carpet_sqft"), ("BUILTUP", "builtup_sqft"), ("SUPER_BUILTUP", "super_builtup_sqft")) if r.get(k)]
            if any(a["area_type_id"] is None for a in areas):
                errors.append("area types CARPET/BUILTUP/SUPER_BUILTUP must exist")
            payload = {"name": r.get("name"), "code": (r.get("code") or "").upper(), "bhk": _num(r.get("bhk"), "bhk", errors, True), "facing": r.get("facing") or None,
                       "rooms": rooms, "areas": [a for a in areas if a["value_sqft"] is not None], "base_rate_per_sqft": _num(r.get("base_rate_per_sqft"), "base_rate_per_sqft", errors), "base_price": _num(r.get("base_price"), "base_price", errors)}
            if payload["code"] in codes:
                errors.append(f"code {payload['code']} already exists")
            if not errors:
                try:
                    payload = FlatTypeIn.model_validate(payload).model_dump()
                    await validate_flat_type_payload(payload)
                except ApiError as e:
                    errors.append(e.detail)
                except Exception as e:
                    errors.append(str(e).split("\n")[1].strip() if "\n" in str(e) else str(e))
            out.append({"row": i, "data": payload, "errors": errors})
    else:
        for i, r in enumerate(rows, start=2):
            errors = []
            if not r.get("full_name"):
                errors.append("full_name is required")
            if not (r.get("phone") or r.get("email")):
                errors.append("phone or email is required")
            out.append({"row": i, "data": dict(r), "errors": errors + ["customers collection arrives in Phase 2 — validation only"]})
    return out


@router.post("/{kind}/preview")
async def preview(kind: Kind, request: Request, project_id: str | None = None, file: UploadFile = File(...), user: dict = Depends(require("masters.flat.create"))):
    rows = await _validate_rows(kind, await _parse(file), project_id, user)
    invalid = [r for r in rows if r["errors"]]
    token = None
    if not invalid:
        token = new_id()
        await db.import_batches.insert_one({"id": token, "kind": kind, "project_id": project_id, "user_id": user["id"], "rows": [r["data"] for r in rows], "created_at": now_iso()})
    return {"kind": kind, "total": len(rows), "valid": len(rows) - len(invalid), "invalid": len(invalid), "rows": rows, "confirm_token": token,
            "policy": "all-or-nothing: confirm is only possible when every row is valid"}


@router.post("/{kind}/confirm")
async def confirm(kind: Kind, request: Request, confirm_token: str, user: dict = Depends(require("masters.flat.create"))):
    batch = await db.import_batches.find_one({"id": confirm_token, "kind": kind, "user_id": user["id"]}, {"_id": 0})
    if not batch:
        raise ApiError(404, "Import batch not found or expired; run preview again", "NOT_FOUND")
    rows, n = batch["rows"], 0
    if kind == "flat-pricing":
        ops = [UpdateOne({"id": r["flat_id"], "status": {"$in": ["Available", "Hold", "Blocked"]}}, {"$set": {"price": r["price"], "rate_per_sqft": r["rate_per_sqft"], "price_breakup": [{"label": "Imported price", "amount": r["price"]}], "rate_card_id": None, "updated_at": now_iso()}, "$inc": {"version": 1}}) for r in rows]
        n = (await db.flats.bulk_write(ops)).modified_count if ops else 0
    elif kind == "parking-slots":
        docs = [{**base_doc(user, user["company_id"]), "project_id": batch["project_id"], **r, "status": "Available", "flat_id": None} for r in rows]
        await db.parking_slots.insert_many(docs)
        n = len(docs)
    elif kind == "amenities":
        docs = [{**base_doc(user, user["company_id"]), **r} for r in rows]
        await db.amenities.insert_many(docs)
        n = len(docs)
    elif kind == "flat-types":
        docs = [{**base_doc(user, user["company_id"]), **r} for r in rows]
        await db.flat_types.insert_many(docs)
        n = len(docs)
    else:
        raise ApiError(409, "Customer import becomes available in Phase 2", "NOT_AVAILABLE")
    await db.import_batches.delete_one({"id": confirm_token})
    await write_audit(user, f"import.{kind}", "import", confirm_token, after={"rows": n, "project_id": batch.get("project_id")}, ip=client_ip(request))
    return {"written": n}
