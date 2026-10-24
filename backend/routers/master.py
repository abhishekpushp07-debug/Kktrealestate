import hashlib
import json
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Request, Response
from pydantic import Field, create_model, field_validator, model_validator

from crypto import decrypt_field, encrypt_field, mask
from db import db
from deps import require
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
    to_csv,
    write_audit,
)

router = APIRouter(prefix="/master", tags=["master"])

Facing = Literal["N", "S", "E", "W", "NE", "NW", "SE", "SW"]


class RoomTypeIn(StrictModel):
    name: str = Field(min_length=1, max_length=80)
    code: str = Field(min_length=1, max_length=30)
    icon: str | None = None
    sort_order: int = 0


class AreaTypeIn(StrictModel):
    name: str = Field(min_length=1, max_length=80)
    code: str = Field(min_length=1, max_length=30)
    sort_order: int = 0


class FlatTypeRoom(StrictModel):
    room_type_id: str
    label: str = Field(min_length=1, max_length=80)
    length_ft: float = Field(gt=0)
    width_ft: float = Field(gt=0)
    area_sqft: float | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def _auto_area(self):
        if self.area_sqft is None:
            self.area_sqft = round(self.length_ft * self.width_ft, 2)
        return self


class FlatTypeArea(StrictModel):
    area_type_id: str
    value_sqft: float = Field(gt=0)


class FlatTypeIn(StrictModel):
    name: str = Field(min_length=1, max_length=80)
    code: str = Field(min_length=1, max_length=30)
    bhk: float = Field(ge=0)
    facing: Facing | None = None
    description: str | None = None
    rooms: list[FlatTypeRoom] = Field(min_length=1)
    areas: list[FlatTypeArea] = Field(min_length=1)
    base_rate_per_sqft: float | None = Field(default=None, ge=0)
    base_price: float | None = Field(default=None, ge=0)
    spec_item_ids: list[str] = []

    @field_validator("areas")
    @classmethod
    def _unique_areas(cls, v):
        ids = [a.area_type_id for a in v]
        if len(ids) != len(set(ids)):
            raise ValueError("Each area type may appear only once")
        return v


class BlockTypeIn(StrictModel):
    name: str = Field(min_length=1, max_length=80)
    code: str = Field(min_length=1, max_length=30)
    has_floors: bool = True


class AmenityIn(StrictModel):
    name: str = Field(min_length=1, max_length=80)
    category: Literal["Lifestyle", "Sports", "Safety", "Convenience", "Green"]
    icon: str | None = None
    description: str | None = None


class Milestone(StrictModel):
    seq: int = Field(ge=1)
    name: str = Field(min_length=1, max_length=80)
    cumulative_percent: float = Field(gt=0, le=100)


class MilestoneTemplateIn(StrictModel):
    name: str = Field(min_length=1, max_length=80)
    milestones: list[Milestone] = Field(min_length=1)

    @field_validator("milestones")
    @classmethod
    def _increasing(cls, v):
        v = sorted(v, key=lambda m: m.seq)
        for i in range(1, len(v)):
            if v[i].cumulative_percent <= v[i - 1].cumulative_percent:
                raise ValueError("cumulative_percent must be strictly increasing")
        if v[-1].cumulative_percent != 100:
            raise ValueError("Last milestone must be 100%")
        return v


class ChargeTypeIn(StrictModel):
    name: str = Field(min_length=1, max_length=80)
    code: str = Field(min_length=1, max_length=30)
    default_amount: float | None = Field(default=None, ge=0)
    is_taxable: bool = False
    sort_order: int = 0


class PaymentModeIn(StrictModel):
    name: str = Field(min_length=1, max_length=80)
    code: str = Field(min_length=1, max_length=30)
    requires_reference: bool = False


class BankAccountIn(StrictModel):
    bank_name: str = Field(min_length=1, max_length=120)
    account_name: str = Field(min_length=1, max_length=120)
    account_number: str = Field(min_length=4, max_length=34)
    ifsc: str = Field(min_length=4, max_length=20)
    branch: str | None = None
    is_default: bool = False


class DocumentTypeIn(StrictModel):
    name: str = Field(min_length=1, max_length=80)
    code: str = Field(min_length=1, max_length=30)
    applies_to: Literal["customer", "booking", "project"]


class FloorPlanPosition(StrictModel):
    position: int = Field(ge=1)
    flat_type_id: str
    facing: Facing | None = None
    is_corner: bool = False


class FloorPlanTemplateIn(StrictModel):
    name: str = Field(min_length=1, max_length=80)
    code: str | None = Field(default=None, max_length=30)
    flats_per_floor: int = Field(ge=1, le=50)
    positions: list[FloorPlanPosition] = Field(min_length=1)

    @model_validator(mode="after")
    def _positions(self):
        pos = sorted(p.position for p in self.positions)
        if pos != list(range(1, self.flats_per_floor + 1)):
            raise ValueError(f"positions must cover 1..{self.flats_per_floor} exactly once")
        return self


class PlcTypeIn(StrictModel):
    name: str = Field(min_length=1, max_length=80)
    code: str = Field(min_length=1, max_length=30)
    calc: Literal["per_sqft", "fixed", "percent"]
    description: str | None = None
    sort_order: int = 0


class SpecCategoryIn(StrictModel):
    name: str = Field(min_length=1, max_length=80)
    code: str = Field(min_length=1, max_length=30)
    sort_order: int = 0


class SpecItemIn(StrictModel):
    name: str = Field(min_length=1, max_length=120)
    spec_category_id: str
    description: str | None = None
    brand: str | None = None


def _partial(model):
    fields = {}
    for name, f in model.model_fields.items():
        fields[name] = (Optional[f.annotation], Field(default=None))
    fields["is_active"] = (Optional[bool], Field(default=None))
    fields["version"] = (Optional[int], Field(default=None))
    m = create_model(model.__name__.replace("In", "Update"), __base__=StrictModel, **fields)
    return m


async def _usage_room_type(doc_id):
    return await db.flat_types.count_documents({"is_active": True, "rooms.room_type_id": doc_id}), "flat type(s)"


async def _usage_area_type(doc_id):
    return await db.flat_types.count_documents({"is_active": True, "areas.area_type_id": doc_id}), "flat type(s)"


async def _usage_flat_type(doc_id):
    n = await db.flats.count_documents({"is_active": True, "flat_type_id": doc_id})
    b = await db.blocks.count_documents({"is_active": True, "position_flat_types.flat_type_id": doc_id})
    return n + b, "flat(s)/block(s)"


async def _usage_block_type(doc_id):
    return await db.blocks.count_documents({"is_active": True, "block_type_id": doc_id}), "block(s)"


async def _usage_amenity(doc_id):
    return await db.projects.count_documents({"is_active": True, "amenity_ids": doc_id}), "project(s)"


async def _usage_milestone_template(doc_id):
    p = await db.projects.count_documents({"is_active": True, "milestone_template_id": doc_id})
    b = await db.blocks.count_documents({"is_active": True, "milestone_template_id": doc_id})
    return p + b, "project(s)/block(s)"


async def _usage_none(doc_id):
    return 0, ""


async def _usage_floor_plan(doc_id):
    return await db.blocks.count_documents({"is_active": True, "floor_plans.floor_plan_template_id": doc_id}), "block(s)"


async def _usage_plc(doc_id):
    return await db.rate_cards.count_documents({"is_active": True, "plc_rules.plc_type_id": doc_id}), "rate card(s)"


async def _usage_spec_cat(doc_id):
    return await db.spec_items.count_documents({"is_active": True, "spec_category_id": doc_id}), "spec item(s)"


async def _usage_spec_item(doc_id):
    return await db.flat_types.count_documents({"is_active": True, "spec_item_ids": doc_id}), "flat type(s)"


MASTERS = {
    "floor-plan-templates": ("floor_plan_templates", FloorPlanTemplateIn, ["name", "code"], _usage_floor_plan, "Floor Plan Template"),
    "plc-types": ("plc_types", PlcTypeIn, ["name", "code"], _usage_plc, "PLC Type"),
    "spec-categories": ("spec_categories", SpecCategoryIn, ["name", "code"], _usage_spec_cat, "Specification Category"),
    "spec-items": ("spec_items", SpecItemIn, ["name", "brand"], _usage_spec_item, "Specification Item"),
    "room-types": ("room_types", RoomTypeIn, ["name", "code"], _usage_room_type, "Room Type"),
    "area-types": ("area_types", AreaTypeIn, ["name", "code"], _usage_area_type, "Area Type"),
    "flat-types": ("flat_types", FlatTypeIn, ["name", "code"], _usage_flat_type, "Flat Type"),
    "block-types": ("block_types", BlockTypeIn, ["name", "code"], _usage_block_type, "Block Type"),
    "amenities": ("amenities", AmenityIn, ["name", "category"], _usage_amenity, "Amenity"),
    "milestone-templates": ("milestone_templates", MilestoneTemplateIn, ["name"], _usage_milestone_template, "Milestone Template"),
    "charge-types": ("charge_types", ChargeTypeIn, ["name", "code"], _usage_none, "Charge Type"),
    "payment-modes": ("payment_modes", PaymentModeIn, ["name", "code"], _usage_none, "Payment Mode"),
    "bank-accounts": ("bank_accounts", BankAccountIn, ["bank_name", "account_name", "ifsc"], _usage_none, "Bank Account"),
    "document-types": ("document_types", DocumentTypeIn, ["name", "code"], _usage_none, "Document Type"),
}


async def validate_flat_type_payload(data: dict):
    room_ids = list({r["room_type_id"] for r in data.get("rooms", [])})
    area_ids = list({a["area_type_id"] for a in data.get("areas", [])})
    if room_ids:
        n = await db.room_types.count_documents({"id": {"$in": room_ids}, "is_active": True})
        if n != len(room_ids):
            raise ApiError(400, "One or more room types are invalid or inactive", "INVALID_ROOM_TYPE")
    if area_ids:
        ats = await db.area_types.find({"id": {"$in": area_ids}, "is_active": True}, {"_id": 0, "id": 1, "code": 1}).to_list(None)
        if len(ats) != len(area_ids):
            raise ApiError(400, "One or more area types are invalid or inactive", "INVALID_AREA_TYPE")
        code_by_id = {a["id"]: a["code"] for a in ats}
        vals = {code_by_id[a["area_type_id"]]: a["value_sqft"] for a in data["areas"]}
        carpet, builtup, sbu = vals.get("CARPET"), vals.get("BUILTUP"), vals.get("SUPER_BUILTUP")
        if carpet is not None and builtup is not None and carpet > builtup:
            raise ApiError(422, f"Carpet area ({carpet}) cannot exceed built-up area ({builtup})", "AREA_HIERARCHY")
        if builtup is not None and sbu is not None and builtup > sbu:
            raise ApiError(422, f"Built-up area ({builtup}) cannot exceed super built-up area ({sbu})", "AREA_HIERARCHY")
        if carpet is not None and sbu is not None and carpet > sbu:
            raise ApiError(422, f"Carpet area ({carpet}) cannot exceed super built-up area ({sbu})", "AREA_HIERARCHY")
    if data.get("spec_item_ids"):
        n = await db.spec_items.count_documents({"id": {"$in": data["spec_item_ids"]}, "is_active": True})
        if n != len(set(data["spec_item_ids"])):
            raise ApiError(400, "One or more specification items are invalid or inactive", "INVALID_SPEC_ITEM")


def _present_bank(doc: dict) -> dict:
    d = dict(doc)
    enc = d.pop("account_number_enc", None)
    d["account_number_masked"] = mask(decrypt_field(enc))
    return d


def _prepare_bank_in(data: dict) -> dict:
    if "account_number" in data and data["account_number"] is not None:
        data["account_number_enc"] = encrypt_field(data.pop("account_number"))
    else:
        data.pop("account_number", None)
    return data


def _register(kind: str, coll_name: str, InModel, search_fields: list[str], usage_fn, label: str):
    UpdateModel = _partial(InModel)
    coll = db[coll_name]
    is_bank = coll_name == "bank_accounts"
    is_flat_type = coll_name == "flat_types"
    has_code = "code" in InModel.model_fields

    def present(doc):
        return _present_bank(doc) if is_bank else doc

    async def _dup_check(company_id: str, data: dict, exclude_id: str | None = None):
        ors = [{"name": data["name"]}] if data.get("name") else []
        if has_code and data.get("code"):
            ors.append({"code": data["code"]})
        if not ors:
            return
        q = {"company_id": company_id, "$or": ors}
        if exclude_id:
            q["id"] = {"$ne": exclude_id}
        if await coll.find_one(q):
            raise ApiError(409, f"{label} with the same name or code already exists", "DUPLICATE")

    async def list_items(request: Request, response: Response, params: ListParams = Depends(), user: dict = Depends(require("master.read"))):
        q = {"company_id": user["company_id"], **search_filter(params.search, search_fields)}
        if not params.include_inactive:
            q["is_active"] = True
        sort = params.sort_spec(search_fields + ["sort_order", "created_at", "updated_at"], search_fields[0])
        if "sort_order" in InModel.model_fields and params.sort == "name":
            sort = [("sort_order", 1), ("name", 1)]
        res = await paginate(coll, q, params, sort)
        res["items"] = [present(d) for d in res["items"]]
        if res.pop("_csv", False):
            return Response(to_csv(res["items"]), media_type="text/csv", headers={"Content-Disposition": f"attachment; filename={coll_name}.csv"})
        etag = '"' + hashlib.md5(json.dumps(res, sort_keys=True, default=str).encode()).hexdigest() + '"'
        if request.headers.get("if-none-match") == etag:
            return Response(status_code=304, headers={"ETag": etag, "Cache-Control": "private, max-age=60"})
        response.headers["ETag"] = etag
        response.headers["Cache-Control"] = "private, max-age=60"
        return res

    async def create_item(body: InModel, request: Request, user: dict = Depends(require("master.write"))):
        data = body.model_dump()
        if has_code:
            data["code"] = data["code"].upper()
        await _dup_check(user["company_id"], data)
        if is_flat_type:
            await validate_flat_type_payload(data)
        if is_bank:
            data = _prepare_bank_in(data)
            if data.get("is_default"):
                await coll.update_many({"company_id": user["company_id"]}, {"$set": {"is_default": False}})
        doc = {**base_doc(user, user["company_id"]), **data}
        await coll.insert_one(doc)
        doc.pop("_id", None)
        out = present(doc)
        await write_audit(user, f"{coll_name}.create", coll_name, doc["id"], after=out, ip=client_ip(request))
        return out

    async def get_item(item_id: str, user: dict = Depends(require("master.read"))):
        return present(await get_or_404(coll, item_id, label, {"company_id": user["company_id"]}))

    async def update_item(item_id: str, body: UpdateModel, request: Request, user: dict = Depends(require("master.write"))):
        before = await get_or_404(coll, item_id, label, {"company_id": user["company_id"]})
        changes = body.model_dump(exclude_unset=True)
        if not changes:
            raise ApiError(400, "No changes supplied", "NO_CHANGES")
        if changes.get("is_active") is False:
            await _deactivate_check(item_id)
        if has_code and changes.get("code"):
            changes["code"] = changes["code"].upper()
        await _dup_check(user["company_id"], changes, exclude_id=item_id)
        if is_flat_type:
            merged = {**before, **changes}
            if "rooms" in changes or "areas" in changes:
                InModel.model_validate({k: merged[k] for k in InModel.model_fields if k in merged})
            await validate_flat_type_payload(merged)
        if is_bank:
            changes = _prepare_bank_in(changes)
            if changes.get("is_default"):
                await coll.update_many({"company_id": user["company_id"], "id": {"$ne": item_id}}, {"$set": {"is_default": False}})
        changes["updated_at"] = now_iso()
        if changes.get("is_active") is False:
            changes["deleted_at"] = now_iso()
        elif changes.get("is_active") is True:
            changes["deleted_at"] = None
        after = await apply_update(coll, before, changes, expected_version(request, changes.get("version")), label)
        await write_audit(user, f"{coll_name}.update", coll_name, item_id, before=present(before), after=present(after), ip=client_ip(request))
        return present(after)

    async def _deactivate_check(item_id: str):
        count, what = await usage_fn(item_id)
        if count:
            raise ApiError(409, f"Cannot deactivate: this {label.lower()} is used by {count} active {what}", "IN_USE")

    async def deactivate_item(item_id: str, request: Request, user: dict = Depends(require("master.write"))):
        before = await get_or_404(coll, item_id, label, {"company_id": user["company_id"]})
        await _deactivate_check(item_id)
        await coll.update_one({"id": item_id}, {"$set": {"is_active": False, "deleted_at": now_iso(), "updated_at": now_iso()}, "$inc": {"version": 1}})
        after = await coll.find_one({"id": item_id}, {"_id": 0})
        await write_audit(user, f"{coll_name}.deactivate", coll_name, item_id, before=present(before), after=present(after), ip=client_ip(request))
        return present(after)

    async def activate_item(item_id: str, request: Request, user: dict = Depends(require("master.write"))):
        before = await get_or_404(coll, item_id, label, {"company_id": user["company_id"]})
        await coll.update_one({"id": item_id}, {"$set": {"is_active": True, "deleted_at": None, "updated_at": now_iso()}, "$inc": {"version": 1}})
        after = await coll.find_one({"id": item_id}, {"_id": 0})
        await write_audit(user, f"{coll_name}.restore", coll_name, item_id, before=present(before), after=present(after), ip=client_ip(request))
        return present(after)

    tag = f"master:{kind}"
    router.add_api_route(f"/{kind}", list_items, methods=["GET"], name=f"list_{coll_name}", tags=[tag])
    router.add_api_route(f"/{kind}", create_item, methods=["POST"], status_code=201, name=f"create_{coll_name}", tags=[tag])
    router.add_api_route(f"/{kind}/{{item_id}}", get_item, methods=["GET"], name=f"get_{coll_name}", tags=[tag])
    router.add_api_route(f"/{kind}/{{item_id}}", update_item, methods=["PATCH"], name=f"update_{coll_name}", tags=[tag])
    router.add_api_route(f"/{kind}/{{item_id}}/deactivate", deactivate_item, methods=["POST"], name=f"deactivate_{coll_name}", tags=[tag])
    router.add_api_route(f"/{kind}/{{item_id}}/activate", activate_item, methods=["POST"], name=f"activate_{coll_name}", tags=[tag])
    router.add_api_route(f"/{kind}/{{item_id}}/restore", activate_item, methods=["POST"], name=f"restore_{coll_name}", tags=[tag])


for _kind, (_coll, _model, _fields, _usage, _label) in MASTERS.items():
    _register(_kind, _coll, _model, _fields, _usage, _label)
