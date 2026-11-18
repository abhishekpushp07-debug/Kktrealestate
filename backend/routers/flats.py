from typing import Literal

from fastapi import APIRouter, Depends, Request, Response
from pydantic import Field

from db import db
from deps import ensure_project_access, project_scope_filter, require, require_any
from models_out import FlatsOut, FlatsOutPage
from services import inventory as inv
from services import pricing as P
from services.counters import apply_status_delta, refresh_counts
from services.flat_generation import resnapshot_flat
from utils import (
    ApiError,
    ListParams,
    StrictModel,
    apply_update,
    client_ip,
    expected_version,
    get_or_404,
    now_iso,
    paginate,
    search_filter,
    to_csv,
    with_price,
    write_audit,
)

router = APIRouter(prefix="/flats", tags=["flats"])

MANUAL_STATUSES = {"Available", "Hold", "Blocked"}


class FlatUpdate(StrictModel):
    is_active: bool | None = None  # False = soft-retire (Available flats only; audited, counts refreshed)
    flat_number: str | None = Field(default=None, min_length=1, max_length=20)
    flat_type_id: str | None = None
    facing: Literal["N", "S", "E", "W", "NE", "NW", "SE", "SW"] | None = None
    rate_per_sqft: float | None = Field(default=None, ge=0)
    price: float | None = Field(default=None, ge=0)
    saleable_sqft: float | None = Field(
        default=None, gt=0
    )  # PS: pricing fields accepted here too (same service as /flats/{id}/pricing)
    pricing_mode: Literal["rate", "lump_sum"] | None = None
    maintenance: dict | None = None
    notes: str | None = None
    version: int | None = None


class FlatStatusIn(StrictModel):
    status: Literal["Available", "Hold", "Blocked", "Booked", "Sold"]
    reason: str | None = None
    expires_at: str | None = None  # required when status is Hold
    version: int | None = None


async def _enrich(items: list[dict]):
    bids = list({f["block_id"] for f in items})
    pids = list({f["project_id"] for f in items})
    bmap = {
        b["id"]: b
        for b in await db.blocks.find({"id": {"$in": bids}}, {"_id": 0, "id": 1, "name": 1, "code": 1}).to_list(None)
    }
    pmap = {
        p["id"]: p
        for p in await db.projects.find({"id": {"$in": pids}}, {"_id": 0, "id": 1, "name": 1, "code": 1}).to_list(None)
    }
    for f in items:
        f["block_name"] = bmap.get(f["block_id"], {}).get("name")
        f["block_code"] = bmap.get(f["block_id"], {}).get("code")
        f["project_name"] = pmap.get(f["project_id"], {}).get("name")
        f["project_code"] = pmap.get(f["project_id"], {}).get("code")
    return [with_price(i) for i in items]


@router.get("", response_model=FlatsOutPage, response_model_exclude_unset=True)
async def list_flats(
    params: ListParams = Depends(),
    project_id: str | None = None,
    block_id: str | None = None,
    floor: int | None = None,
    status: str | None = None,
    flat_type_id: str | None = None,
    bookable_for: str | None = None,
    category: str | None = None,
    display: str | None = None,
    hold_expiring: bool | None = None,
    user: dict = Depends(require("masters.project.view")),
):
    q = {
        "company_id": user["company_id"],
        **project_scope_filter(user),
        **search_filter(params.search, ["flat_number", "flat_type_code"]),
    }
    if project_id:
        ensure_project_access(user, project_id)
        q["project_id"] = project_id
    if block_id:
        q["block_id"] = block_id
    if floor is not None:
        q["floor"] = floor
    if status:
        wanted = status.split(",")
        if inv.can_see_real(user):
            q["status"] = {"$in": wanted}
        else:  # display layer: a masked Available flat must not surface under status=Available (and vice-versa)
            disp = [d for d, s in inv.DISPLAY_TO_STATUS.items() if s in wanted]
            q["$or"] = [
                {"display_override": True, "display_state": {"$in": disp}},
                {"display_override": {"$ne": True}, "status": {"$in": [k for k, v in inv.MIRROR.items() if v in disp]}},
            ]
    if (
        bookable_for is not None
    ):  # booking wizard: saleable + (Available or Hold for this customer / RM), never masked-as-sold/hidden
        q.update(inv.bookable_filter(bookable_for or None, user))
    if category:
        q["allocation_category_code"] = {"$in": category.split(",")}
    if display and inv.can_see_real(user):
        q["$or"] = [{"display_override": True, "display_state": {"$in": display.split(",")}}] + (
            [
                {
                    "display_override": {"$ne": True},
                    "status": {"$in": [k for k, v in inv.MIRROR.items() if v in display.split(",")]},
                }
            ]
        )
    if hold_expiring:
        q["status"] = "Hold"
        from services.home_filters import hold_expiry_cutoff

        q["hold.expires_at"] = {"$lte": hold_expiry_cutoff()}
    if flat_type_id:
        q["flat_type_id"] = flat_type_id
    if not params.include_inactive:
        q["is_active"] = True
    sort = params.sort_spec(["flat_number", "floor", "status", "price_paise", "saleable_sqft", "created_at"], "floor")
    if params.sort in ("name", "floor"):
        sort = [("block_id", 1), ("floor", 1), ("position", 1)]
    res = await paginate(db.flats, q, params, sort, {"rooms_snapshot": 0, "areas_snapshot": 0})
    if res.pop("_csv", False):
        await _enrich(res["items"])
        res["items"] = inv.shape_list(res["items"], user)
        return Response(
            to_csv(
                [with_price(i) for i in res["items"]],
                [
                    "flat_number",
                    "project_code",
                    "block_code",
                    "floor",
                    "position",
                    "flat_type_code",
                    "facing",
                    "status",
                    "saleable_sqft",
                    "rate_per_sqft",
                    "price",
                    "pricing_status",
                ],
            ),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=flats.csv"},
        )
    res["items"] = await _enrich(res["items"])
    res["items"] = inv.shape_list([with_price(i) for i in res["items"]], user)
    return res


async def _load_flat(flat_id: str, user: dict) -> dict:
    flat = await get_or_404(db.flats, flat_id, "Flat", {"company_id": user["company_id"]})
    ensure_project_access(user, flat["project_id"])
    shaped = inv.shape(flat, user)
    if shaped is None:
        raise ApiError(404, "Flat not found", "NOT_FOUND")
    return with_price(shaped)


@router.get("/{flat_id}", response_model=FlatsOut, response_model_exclude_unset=True)
async def get_flat(flat_id: str, user: dict = Depends(require("masters.project.view"))):
    flat = await _load_flat(flat_id, user)
    flat = (await _enrich([flat]))[0]
    ft = await db.flat_types.find_one({"id": flat["flat_type_id"]}, {"_id": 0, "id": 1, "name": 1, "code": 1, "bhk": 1})
    flat["flat_type"] = ft
    if flat.get("flat_type_id"):
        ftd = await db.flat_types.find_one({"id": flat["flat_type_id"]}, {"_id": 0, "spec_item_ids": 1})
        specs = await db.spec_items.find(
            {"id": {"$in": (ftd or {}).get("spec_item_ids") or []}},
            {"_id": 0, "id": 1, "name": 1, "brand": 1, "spec_category_id": 1},
        ).to_list(None)
        cats = {
            c["id"]: c["name"]
            for c in await db.spec_categories.find(
                {"id": {"$in": [s["spec_category_id"] for s in specs]}}, {"_id": 0, "id": 1, "name": 1}
            ).to_list(None)
        }
        flat["specifications"] = [{**s, "category": cats.get(s["spec_category_id"])} for s in specs]
    if flat.get("rate_card_id"):
        flat["rate_card"] = await db.rate_cards.find_one(
            {"id": flat["rate_card_id"]}, {"_id": 0, "id": 1, "name": 1, "status": 1}
        )
    # PS: same pricing-sheet shape as GET /flats/{id}/pricing so the drawer never shows nulls
    setup = P.setup_of(await db.projects.find_one({"id": flat["project_id"]}, {"_id": 0, "pricing_setup": 1}))
    flat["parking_slots"] = await db.parking_slots.find(
        {"flat_id": flat["id"], "is_active": True},
        {"_id": 0, "id": 1, "number": 1, "type": 1, "level": 1, "price": 1, "status": 1},
    ).to_list(50)
    flat["maintenance_effective"] = {**setup["maintenance"], **(flat.get("maintenance") or {})}
    flat["maintenance_amount"] = P.maintenance_amount(flat, setup)
    flat["lock"] = P.lock_of(flat)
    return with_price(flat)


@router.patch("/{flat_id}")
async def update_flat(
    flat_id: str, body: FlatUpdate, request: Request, user: dict = Depends(require("masters.flat.edit"))
):
    before = await _load_flat(flat_id, user)
    changes = body.model_dump(exclude_unset=True)
    changes.pop("version", None)
    if not changes:
        raise ApiError(400, "No changes supplied", "NO_CHANGES")
    if "flat_number" in changes:
        changes["flat_number"] = changes["flat_number"].strip()
        if changes["flat_number"] != before["flat_number"] and await db.flats.find_one(
            {"block_id": before["block_id"], "flat_number": changes["flat_number"], "id": {"$ne": flat_id}},
            {"_id": 0, "id": 1},
        ):
            raise ApiError(
                409, f"Duplicate: flat number {changes['flat_number']} already exists in this tower", "DUPLICATE_FLAT"
            )
    if "flat_type_id" in changes and changes["flat_type_id"] != before["flat_type_id"]:
        if before["status"] != "Available":
            raise ApiError(409, "Flat type can only be changed while the flat is Available", "NOT_AVAILABLE")
        block = await db.blocks.find_one({"id": before["block_id"]}, {"_id": 0})
        changes.update(await resnapshot_flat(before, changes["flat_type_id"], block))
        if before.get("saleable_sqft") or before.get("price_paise"):
            changes.update(pricing_review="flat type changed — verify saleable area / rate", pricing_status="review")
    if any(k in changes for k in ("saleable_sqft", "pricing_mode", "maintenance")) or (
        "rate_per_sqft" in changes and before.get("pricing_mode")
    ):
        # PS: one pricing engine — rate × saleable / lump sum, maintenance method, pricing_status (a bare `price`
        # override keeps the manual/revert flow below)
        block = await db.blocks.find_one({"id": before["block_id"]}, {"_id": 0})
        setup = P.setup_of(await db.projects.find_one({"id": before["project_id"]}, {"_id": 0, "pricing_setup": 1}))
        if before.get("booking_id") or before["status"] in P.LOCKED_STATUSES:
            P.ensure_unlocked(before)
        if "price" in changes and changes["price"] is not None:
            changes["price_paise"] = round(changes["price"] * 100)
            changes.setdefault("pricing_mode", "lump_sum")
        if "rate_per_sqft" in changes or "saleable_sqft" in changes:
            changes.setdefault("pricing_mode", "rate")
        changes.pop("price", None)
        if (
            any(k in changes for k in ("saleable_sqft", "rate_per_sqft", "price_paise"))
            and before.get("pricing_review")
            and "pricing_review" not in changes
        ):
            changes["pricing_review"] = None
        changes.update(P.compute({**before, **changes}, block, setup))
    elif "rate_per_sqft" in changes and changes["rate_per_sqft"] is not None and "price" not in changes:
        changes["price_paise"] = round(
            changes["rate_per_sqft"] * ((before.get("saleable_sqft") or before.get("super_builtup_sqft")) or 0) * 100
        )
        changes["price_breakup"] = [
            {
                "label": f"Rate ₹{changes['rate_per_sqft']:g}/sq.ft × {(before.get('saleable_sqft') or before.get('super_builtup_sqft') or 0):g}",
                "amount": changes["price_paise"] / 100,
            }
        ]
    elif "price" in changes and changes["price"] is not None:
        changes["price_paise"] = round(changes["price"] * 100)
        rc_breakup = before.get("rate_card_breakup") or (
            before.get("price_breakup")
            if before.get("price_source", "rate_card") in ("rate_card", "rate")
            and not any(b.get("label") == "Manual price" for b in before.get("price_breakup") or [])
            else None
        )
        formula_paise = round(
            (before.get("rate_per_sqft") or 0)
            * ((before.get("saleable_sqft") or before.get("super_builtup_sqft")) or 0)
            * 100
        )
        if (
            rc_breakup is None and formula_paise
        ):  # legacy manual rows kept no breakup: the rate-card formula is the source of truth
            rc_breakup, rc_price = (
                [
                    {
                        "label": (
                            f"Base ₹{before.get('rate_per_sqft'):g}/sq.ft × "
                            f"{(before.get('saleable_sqft') or before.get('super_builtup_sqft') or 0):g}"
                        ),
                        "amount": formula_paise / 100,
                    }
                ],
                formula_paise,
            )
        else:
            rc_price = (
                before.get("rate_card_price_paise")
                if before.get("rate_card_price_paise") is not None
                else (
                    before.get("price_paise")
                    if before.get("price_source", "rate_card") in ("rate_card", "rate")
                    else None
                )
            )
        if rc_breakup is not None and rc_price is not None and changes["price_paise"] == rc_price:
            # reverting to the exact rate-card value restores the original breakup
            changes.update(
                {
                    "price_breakup": rc_breakup,
                    "price_source": "rate_card",
                    "rate_card_breakup": None,
                    "rate_card_price_paise": None,
                }
            )
        else:
            changes.update(
                {"price_breakup": [{"label": "Manual price", "amount": changes["price"]}], "price_source": "manual"}
            )
            if (
                rc_breakup is not None and before.get("rate_card_breakup") is None
            ):  # first override: retain the rate-card breakup
                changes.update({"rate_card_breakup": rc_breakup, "rate_card_price_paise": rc_price})
    changes.pop("price", None)
    if changes.get("is_active") is False:
        if before["status"] != "Available" or before.get("booking_id"):
            raise ApiError(409, f"Cannot retire {before['flat_number']}: status is {before['status']}", "IN_USE")
        changes["deleted_at"] = now_iso()
    if changes.get("is_active") is True:
        changes["deleted_at"] = None
    after = await apply_update(db.flats, before, changes, expected_version(request, body.version), "Flat")
    if "is_active" in changes:
        await refresh_counts(before["block_id"], before["project_id"])
    await write_audit(
        user,
        "flat.retire" if changes.get("is_active") is False else "flat.update",
        "flat",
        flat_id,
        before=before,
        after=after,
        ip=client_ip(request),
    )
    return with_price((await _enrich([after]))[0])


@router.patch("/{flat_id}/status")
async def change_status(
    flat_id: str,
    body: FlatStatusIn,
    request: Request,
    user: dict = Depends(require_any("sales.hold.create", "sales.hold.release")),
):
    before = await _load_flat(flat_id, user)
    if body.status not in MANUAL_STATUSES:
        raise ApiError(
            409, f"Status {body.status} is set by the booking engine and cannot be set manually", "STATUS_NOT_MANUAL"
        )
    if before["status"] not in MANUAL_STATUSES:
        raise ApiError(409, f"Flat is {before['status']}; status is controlled by the booking", "STATUS_LOCKED")
    if before["status"] == body.status:
        raise ApiError(409, f"Flat is already {body.status}", "NO_CHANGE")
    from routers.inventory import hold_doc

    hold = hold_doc(body.expires_at, user, body.reason) if body.status == "Hold" else None
    await db.flats.update_one(
        {"id": flat_id},
        {
            "$set": {
                "status": body.status,
                "hold": hold,
                "status_reason": body.reason,
                "status_changed_at": now_iso(),
                "status_changed_by": user["id"],
                "updated_at": now_iso(),
            },
            "$inc": {"version": 1},
        },
    )
    await apply_status_delta(before["block_id"], before["project_id"], before["status"], body.status)
    after = await db.flats.find_one({"id": flat_id}, {"_id": 0})
    await write_audit(
        user,
        "flat.status",
        "flat",
        flat_id,
        before={"id": flat_id, "flat_number": before["flat_number"], "status": before["status"]},
        after={"id": flat_id, "flat_number": after["flat_number"], "status": after["status"], "reason": body.reason},
        ip=client_ip(request),
    )
    return with_price((await _enrich([after]))[0])
