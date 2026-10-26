from db import db
from uow import unit_of_work
from utils import ApiError, base_doc

AREA_CODES = {"CARPET": "carpet_sqft", "BUILTUP": "builtup_sqft", "SUPER_BUILTUP": "super_builtup_sqft"}


def floor_label(block: dict, floor: int) -> str:
    if floor == 0 and block.get("ground_floor_label"):
        return block["ground_floor_label"]
    return str(floor)


def flat_number(block: dict, floor: int, position: int, seq: int) -> str:
    pattern, code = block["numbering_pattern"], block["code"]
    fl = floor_label(block, floor)
    if pattern == "{block}-{floor}{pos2}":
        return f"{code}-{fl}{position:02d}"
    if pattern == "{floor}{pos2}":
        return f"{fl}{position:02d}"
    return f"{code}{seq}"


def floor_labels(block: dict) -> list[int]:
    """Physical floors numbered from floor_start, skipping numbers in skip_floors (e.g. 13)."""
    skip = set(block.get("skip_floors") or [])
    out, f = [], block.get("floor_start", 1)
    while len(out) < block["floors"]:
        if f not in skip:
            out.append(f)
        f += 1
    return out


def unit_floors(block: dict) -> list[int]:
    """Floors that carry sellable units: physical floors minus refuge/podium floors."""
    excluded = set(block.get("refuge_floors") or []) | set(block.get("podium_floors") or [])
    return [f for f in floor_labels(block) if f not in excluded]


def plan_for_floor(block: dict, floor: int) -> dict | None:
    for fp in block.get("floor_plans") or []:
        if fp["from_floor"] <= floor <= fp["to_floor"]:
            return fp
    return None


async def load_flat_types(flat_type_ids: list[str]) -> dict:
    ids = list(set(flat_type_ids))
    fts = await db.flat_types.find({"id": {"$in": ids}, "is_active": True}, {"_id": 0}).to_list(None)
    if len(fts) != len(ids):
        raise ApiError(400, "One or more flat types are invalid or inactive", "INVALID_FLAT_TYPE")
    room_ids = {r["room_type_id"] for ft in fts for r in ft["rooms"]}
    area_ids = {a["area_type_id"] for ft in fts for a in ft["areas"]}
    rts = {r["id"]: r for r in await db.room_types.find({"id": {"$in": list(room_ids)}}, {"_id": 0, "id": 1, "name": 1, "code": 1}).to_list(None)}
    ats = {a["id"]: a for a in await db.area_types.find({"id": {"$in": list(area_ids)}}, {"_id": 0, "id": 1, "name": 1, "code": 1}).to_list(None)}
    out = {}
    for ft in fts:
        ft["rooms_snapshot"] = [{**r, "room_type_name": rts.get(r["room_type_id"], {}).get("name"), "room_type_code": rts.get(r["room_type_id"], {}).get("code")} for r in ft["rooms"]]
        ft["areas_snapshot"] = [{**a, "area_type_name": ats.get(a["area_type_id"], {}).get("name"), "area_type_code": ats.get(a["area_type_id"], {}).get("code")} for a in ft["areas"]]
        ft["area_values"] = {AREA_CODES[a["area_type_code"]]: a["value_sqft"] for a in ft["areas_snapshot"] if a["area_type_code"] in AREA_CODES}
        out[ft["id"]] = ft
    return out


def compute_price(ft: dict, block: dict, floor: int) -> tuple[float | None, float | None, list[dict]]:
    sbu = ft["area_values"].get("super_builtup_sqft")
    if ft.get("base_price"):
        return None, round(ft["base_price"], 2), [{"label": "Base price (lump sum)", "amount": round(ft["base_price"], 2)}]
    base_rate = block.get("rate_per_sqft") or ft.get("base_rate_per_sqft")
    if base_rate is None or sbu is None:
        return base_rate, None, []
    rise_per = block.get("floor_rise_per_sqft") or 0
    rise_floors = max(0, floor - block.get("floor_start", 1))
    breakup = [{"label": f"Base ₹{base_rate:g}/sq.ft × {sbu:g}", "amount": round(base_rate * sbu, 2)}]
    if rise_per and rise_floors:
        breakup.append({"label": f"Floor rise ₹{rise_per:g} × {rise_floors} floors × {sbu:g}", "amount": round(rise_per * rise_floors * sbu, 2)})
    rate = base_rate + rise_per * rise_floors
    return round(rate, 2), round(sum(b["amount"] for b in breakup), 2), breakup


def build_flat(block: dict, ft: dict, floor: int, position: int, seq: int, user: dict | None, pos_meta: dict | None = None) -> dict:
    rate, price, breakup = compute_price(ft, block, floor)
    pos_meta = pos_meta or {}
    return {
        **base_doc(user, block["company_id"]),
        "project_id": block["project_id"], "block_id": block["id"], "flat_type_id": ft["id"], "flat_type_code": ft["code"],
        "flat_number": flat_number(block, floor, position, seq), "floor": floor, "floor_label": floor_label(block, floor), "position": position,
        "facing": pos_meta.get("facing") or ft.get("facing"), "is_corner": bool(pos_meta.get("is_corner")), "status": "Available",
        "rooms_snapshot": ft["rooms_snapshot"], "areas_snapshot": ft["areas_snapshot"],
        "carpet_sqft": ft["area_values"].get("carpet_sqft"), "builtup_sqft": ft["area_values"].get("builtup_sqft"), "super_builtup_sqft": ft["area_values"].get("super_builtup_sqft"),
        "rate_per_sqft": rate, "price_paise": round(price * 100) if price is not None else None, "price_breakup": breakup, "rate_card_id": None, "notes": None,
    }


async def resolve_positions(block: dict) -> dict[int, list[dict]]:
    """floor → [{position, flat_type_id, facing, is_corner}] using floor_plans (template or inline positions)."""
    tmpl_ids = [fp["floor_plan_template_id"] for fp in block.get("floor_plans") or [] if fp.get("floor_plan_template_id")]
    tmpls = {t["id"]: t for t in await db.floor_plan_templates.find({"id": {"$in": tmpl_ids}, "is_active": True}, {"_id": 0}).to_list(None)} if tmpl_ids else {}
    if len(tmpls) != len(set(tmpl_ids)):
        raise ApiError(400, "One or more floor plan templates are invalid or inactive", "INVALID_FLOOR_PLAN")
    out = {}
    for floor in unit_floors(block):
        fp = plan_for_floor(block, floor)
        if fp is None:
            raise ApiError(422, f"No floor plan covers floor {floor}", "FLOOR_PLAN_GAP")
        positions = tmpls[fp["floor_plan_template_id"]]["positions"] if fp.get("floor_plan_template_id") else fp["positions"]
        out[floor] = positions
    return out


async def generate_flats(block: dict, floors: list[int] | None, user: dict | None) -> list[dict]:
    plan = await resolve_positions(block)
    floors = [f for f in (floors if floors is not None else list(plan.keys())) if f in plan]
    fts = await load_flat_types([p["flat_type_id"] for ps in plan.values() for p in ps])
    docs, seq = [], 0
    for floor in sorted(plan.keys()):
        for p in sorted(plan[floor], key=lambda x: x["position"]):
            seq += 1
            if floor in floors:
                docs.append(build_flat(block, fts[p["flat_type_id"]], floor, p["position"], seq, user, p))
    if not docs:
        return []
    async with unit_of_work() as uow:
        ids = [d["id"] for d in docs]
        uow.on_rollback(lambda: db.flats.delete_many({"id": {"$in": ids}}))
        await db.flats.insert_many(docs, ordered=True, **uow.kw())
    from services.counters import refresh_counts
    await refresh_counts(block["id"], block["project_id"])
    for d in docs:
        d.pop("_id", None)
    return docs


async def resnapshot_flat(flat: dict, flat_type_id: str, block: dict) -> dict:
    ft = (await load_flat_types([flat_type_id]))[flat_type_id]
    rate, price, breakup = compute_price(ft, block, flat["floor"])
    return {"flat_type_id": ft["id"], "flat_type_code": ft["code"], "facing": ft.get("facing"), "rooms_snapshot": ft["rooms_snapshot"], "areas_snapshot": ft["areas_snapshot"],
            "carpet_sqft": ft["area_values"].get("carpet_sqft"), "builtup_sqft": ft["area_values"].get("builtup_sqft"), "super_builtup_sqft": ft["area_values"].get("super_builtup_sqft"),
            "rate_per_sqft": rate, "price_paise": round(price * 100) if price is not None else None, "price_breakup": breakup, "rate_card_id": None}
