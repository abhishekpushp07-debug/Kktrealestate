from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import Field, model_validator
from pymongo import UpdateOne

from db import db
from deps import ensure_project_access, require
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
    write_audit,
)

router = APIRouter(prefix="/projects/{project_id}/rate-cards", tags=["rate-cards"])


class RateLine(StrictModel):
    flat_type_id: str
    rate_per_sqft: float | None = Field(default=None, ge=0)
    lump_sum: float | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def _one(self):
        if (self.rate_per_sqft is None) == (self.lump_sum is None):
            raise ValueError("Provide exactly one of rate_per_sqft or lump_sum")
        return self


class PlcRule(StrictModel):
    plc_type_id: str
    value: float = Field(ge=0)
    applies: Literal["all", "floors_gte", "corner", "facing_in", "top_floor"] = "all"
    floor_gte: int | None = None
    facings: list[str] | None = None
    per_floor: bool = False


class RateCardIn(StrictModel):
    name: str = Field(min_length=1, max_length=80)
    effective_from: str
    rates: list[RateLine] = Field(min_length=1)
    plc_rules: list[PlcRule] = []
    notes: str | None = None


class RateCardUpdate(StrictModel):
    name: str | None = None
    effective_from: str | None = None
    rates: list[RateLine] | None = None
    plc_rules: list[PlcRule] | None = None
    notes: str | None = None
    version: int | None = None


async def _validate(data: dict):
    ftids = [r["flat_type_id"] for r in data.get("rates", [])]
    if ftids and await db.flat_types.count_documents({"id": {"$in": ftids}, "is_active": True}) != len(set(ftids)):
        raise ApiError(400, "One or more flat types are invalid", "INVALID_FLAT_TYPE")
    pids = [p["plc_type_id"] for p in data.get("plc_rules", [])]
    if pids and await db.plc_types.count_documents({"id": {"$in": pids}, "is_active": True}) != len(set(pids)):
        raise ApiError(400, "One or more PLC types are invalid", "INVALID_PLC_TYPE")


def price_flat(flat: dict, rc: dict, plc_types: dict, block: dict, top_floor: int) -> tuple[float, list[dict], float | None]:
    line = next((r for r in rc["rates"] if r["flat_type_id"] == flat["flat_type_id"]), None)
    if not line:
        return None, [], None
    sbu = flat.get("super_builtup_sqft") or 0
    if line.get("lump_sum") is not None:
        base = line["lump_sum"]
        breakup = [{"label": "Base price (lump sum)", "amount": round(base, 2)}]
        rate = None
    else:
        base = line["rate_per_sqft"] * sbu
        breakup = [{"label": f"Base ₹{line['rate_per_sqft']:g}/sq.ft × {sbu:g}", "amount": round(base, 2)}]
        rate = line["rate_per_sqft"]
    for rule in rc.get("plc_rules", []):
        pt = plc_types.get(rule["plc_type_id"])
        if not pt:
            continue
        a = rule["applies"]
        floors_above = max(0, flat["floor"] - block.get("floor_start", 1))
        if a == "floors_gte" and flat["floor"] < (rule.get("floor_gte") or 0):
            continue
        if a == "corner" and not flat.get("is_corner"):
            continue
        if a == "facing_in" and flat.get("facing") not in (rule.get("facings") or []):
            continue
        if a == "top_floor" and flat["floor"] != top_floor:
            continue
        mult = floors_above if rule.get("per_floor") else 1
        if mult == 0:
            continue
        if pt["calc"] == "per_sqft":
            amt = rule["value"] * sbu * mult
            label = f"{pt['name']} ₹{rule['value']:g}/sq.ft" + (f" × {mult} floors" if rule.get("per_floor") else "")
        elif pt["calc"] == "percent":
            amt = base * rule["value"] / 100 * mult
            label = f"{pt['name']} {rule['value']:g}%"
        else:
            amt = rule["value"] * mult
            label = f"{pt['name']}"
        breakup.append({"label": label, "amount": round(amt, 2)})
    total = round(sum(b["amount"] for b in breakup), 2)
    return total, breakup, (round(total / sbu, 2) if sbu and rate is not None else rate)


@router.get("")
async def list_rate_cards(project_id: str, params: ListParams = Depends(), user: dict = Depends(require("project.read"))):
    ensure_project_access(user, project_id)
    res = await paginate(db.rate_cards, {"project_id": project_id, "is_active": True}, params, [("effective_from", -1), ("id", 1)])
    return res


@router.post("", status_code=201)
async def create_rate_card(project_id: str, body: RateCardIn, request: Request, user: dict = Depends(require("flat.write"))):
    ensure_project_access(user, project_id)
    await get_or_404(db.projects, project_id, "Project", {"company_id": user["company_id"]})
    data = body.model_dump()
    await _validate(data)
    doc = {**base_doc(user, user["company_id"]), **data, "project_id": project_id, "status": "Draft", "activated_at": None, "superseded_by": None, "applied_at": None, "applied_count": 0}
    await db.rate_cards.insert_one(doc)
    doc.pop("_id", None)
    await write_audit(user, "rate_card.create", "rate_card", doc["id"], after=doc, ip=client_ip(request))
    return doc


@router.get("/{rc_id}")
async def get_rate_card(project_id: str, rc_id: str, user: dict = Depends(require("project.read"))):
    ensure_project_access(user, project_id)
    rc = await get_or_404(db.rate_cards, rc_id, "Rate card", {"project_id": project_id})
    fts = {f["id"]: f for f in await db.flat_types.find({"id": {"$in": [r["flat_type_id"] for r in rc["rates"]]}}, {"_id": 0, "id": 1, "name": 1, "code": 1}).to_list(None)}
    pts = {p["id"]: p for p in await db.plc_types.find({"id": {"$in": [r["plc_type_id"] for r in rc["plc_rules"]]}}, {"_id": 0, "id": 1, "name": 1, "calc": 1}).to_list(None)}
    for r in rc["rates"]:
        r["flat_type"] = fts.get(r["flat_type_id"])
    for r in rc["plc_rules"]:
        r["plc_type"] = pts.get(r["plc_type_id"])
    return rc


@router.patch("/{rc_id}")
async def update_rate_card(project_id: str, rc_id: str, body: RateCardUpdate, request: Request, user: dict = Depends(require("flat.write"))):
    ensure_project_access(user, project_id)
    before = await get_or_404(db.rate_cards, rc_id, "Rate card", {"project_id": project_id})
    if before["status"] != "Draft":
        raise ApiError(409, "Only Draft rate cards can be edited; create a new card to supersede", "NOT_DRAFT")
    changes = body.model_dump(exclude_unset=True)
    await _validate({**before, **changes})
    after = await apply_update(db.rate_cards, before, changes, expected_version(request, body.version), "Rate card")
    await write_audit(user, "rate_card.update", "rate_card", rc_id, before=before, after=after, ip=client_ip(request))
    return after


@router.post("/{rc_id}/activate")
async def activate_rate_card(project_id: str, rc_id: str, request: Request, user: dict = Depends(require("flat.write"))):
    ensure_project_access(user, project_id)
    rc = await get_or_404(db.rate_cards, rc_id, "Rate card", {"project_id": project_id})
    if rc["status"] == "Active":
        return rc
    await db.rate_cards.update_many({"project_id": project_id, "status": "Active"}, {"$set": {"status": "Superseded", "superseded_by": rc_id, "updated_at": now_iso()}, "$inc": {"version": 1}})
    after = await db.rate_cards.find_one_and_update({"id": rc_id}, {"$set": {"status": "Active", "activated_at": now_iso(), "updated_at": now_iso()}, "$inc": {"version": 1}}, projection={"_id": 0}, return_document=True)
    await write_audit(user, "rate_card.activate", "rate_card", rc_id, before=rc, after=after, ip=client_ip(request))
    return after


@router.post("/{rc_id}/apply")
async def apply_rate_card(project_id: str, rc_id: str, request: Request, user: dict = Depends(require("flat.write"))):
    """Recompute price + breakup for Available flats only. Hold/Booked/Sold/Blocked keep their price."""
    ensure_project_access(user, project_id)
    rc = await get_or_404(db.rate_cards, rc_id, "Rate card", {"project_id": project_id})
    if rc["status"] != "Active":
        raise ApiError(409, "Activate the rate card before applying", "NOT_ACTIVE")
    plc_types = {p["id"]: p for p in await db.plc_types.find({"id": {"$in": [r["plc_type_id"] for r in rc["plc_rules"]]}}, {"_id": 0}).to_list(None)}
    blocks = {b["id"]: b for b in await db.blocks.find({"project_id": project_id, "is_active": True}, {"_id": 0, "id": 1, "floor_start": 1, "floors": 1, "skip_floors": 1}).to_list(None)}
    flats = await db.flats.find({"project_id": project_id, "status": "Available", "is_active": True}, {"_id": 0, "id": 1, "flat_type_id": 1, "floor": 1, "super_builtup_sqft": 1, "is_corner": 1, "facing": 1, "block_id": 1}).to_list(None)
    tops = {}
    for f in flats:
        tops[f["block_id"]] = max(tops.get(f["block_id"], 0), f["floor"])
    ops, skipped = [], 0
    for f in flats:
        total, breakup, rate = price_flat(f, rc, plc_types, blocks.get(f["block_id"], {}), tops.get(f["block_id"], 0))
        if total is None:
            skipped += 1
            continue
        ops.append(UpdateOne({"id": f["id"], "status": "Available"}, {"$set": {"price": total, "price_breakup": breakup, "rate_per_sqft": rate, "rate_card_id": rc_id, "updated_at": now_iso()}, "$inc": {"version": 1}}))
    updated = (await db.flats.bulk_write(ops)).modified_count if ops else 0
    await db.rate_cards.update_one({"id": rc_id}, {"$set": {"applied_at": now_iso(), "applied_count": updated}})
    await write_audit(user, "rate_card.apply", "rate_card", rc_id, after={"flats_updated": updated, "skipped_no_rate": skipped}, ip=client_ip(request))
    return {"flats_updated": updated, "skipped_no_rate": skipped, "untouched_non_available": await db.flats.count_documents({"project_id": project_id, "status": {"$ne": "Available"}})}
