import asyncio
import logging

from crypto import encrypt_field
from db import db, ensure_indexes
from permissions import SYSTEM_ROLES
from services.flat_generation import generate_flats, unit_floors
from utils import base_doc, now_iso, write_audit

logger = logging.getLogger("kkt.seed")
SEED_PASSWORD = "Kkt@12345"


async def _insert(coll: str, company_id: str, data: dict, entity_type: str | None = None) -> dict:
    doc = {**base_doc(None, company_id), **data}
    await db[coll].insert_one(doc)
    doc.pop("_id", None)
    await write_audit(None, f"{entity_type or coll}.create", entity_type or coll, doc["id"], after=doc, company_id=company_id)
    return doc


async def seed_if_empty():
    if await db.users.count_documents({}) > 0:
        return
    logger.info("Seeding database...")
    await seed()


async def seed():
    from routers.auth import hash_password

    company = await _insert("companies", "", {
        "name": "Shree Ganesh Builders", "brand": "KKT", "legal_name": "Shree Ganesh Builders Pvt. Ltd.",
        "address": {"line1": "Boring Road", "city": "Patna", "state": "Bihar", "pincode": "800001"},
        "gstin": "10AABCS1234F1Z5", "rera_registration": "BRERAP00123", "logo_url": None,
        "financial_year_start_month": 4, "receipt_prefix": "SGB",
        "bank_account": {"bank_name": "State Bank of India", "account_name": "Shree Ganesh Builders Pvt Ltd", "account_number_enc": encrypt_field("38201234567890"), "ifsc": "SBIN0001234", "branch": "Boring Road, Patna"},
    }, "company")
    cid = company["id"]
    await db.companies.update_one({"id": cid}, {"$set": {"company_id": cid}})

    roles = {}
    for name, spec in SYSTEM_ROLES.items():
        roles[name] = await _insert("roles", cid, {"name": name, "description": spec["description"], "permissions": spec["permissions"], "is_system": True}, "role")

    pw = hash_password(SEED_PASSWORD)

    def user(name, email, role, scope):
        return {"name": name, "email": email, "phone": None, "role_id": roles[role]["id"], "project_scope": scope, "password_hash": pw, "failed_attempts": 0, "locked_until": None}

    # masters
    room_types = {}
    for i, (name, code, icon) in enumerate([
        ("Living Room", "LIVING", "sofa"), ("Dining", "DINING", "utensils"), ("Master Bedroom", "MBED", "bed-double"),
        ("Bedroom", "BED", "bed"), ("Kitchen", "KITCHEN", "cooking-pot"), ("Bathroom", "BATH", "bath"),
        ("Balcony", "BALCONY", "sun"), ("Study", "STUDY", "book-open"),
    ]):
        room_types[code] = await _insert("room_types", cid, {"name": name, "code": code, "icon": icon, "sort_order": i + 1})
    area_types = {}
    for i, (name, code) in enumerate([("Carpet Area", "CARPET"), ("Built-up Area", "BUILTUP"), ("Super Built-up Area", "SUPER_BUILTUP"), ("Balcony Area", "BALCONY"), ("Terrace Area", "TERRACE"), ("Parking Area", "PARKING")]):
        area_types[code] = await _insert("area_types", cid, {"name": name, "code": code, "sort_order": i + 1})
    block_types = {}
    for name, code, hf in [("Tower", "TOWER", True), ("Villa", "VILLA", False), ("Row House", "ROWHOUSE", False), ("Duplex", "DUPLEX", True), ("Commercial", "COMMERCIAL", True)]:
        block_types[code] = await _insert("block_types", cid, {"name": name, "code": code, "has_floors": hf})
    amenities = {}
    for name, cat, icon, desc in [
        ("Swimming Pool", "Lifestyle", "waves", "Temperature-controlled pool with deck"), ("Clubhouse", "Lifestyle", "building", "Multi-purpose club with lounge"),
        ("Gymnasium", "Sports", "dumbbell", "Fully equipped modern gym"), ("Badminton Court", "Sports", "trophy", "Indoor badminton court"),
        ("Children's Play Area", "Lifestyle", "baby", "Safe play zone for kids"), ("24x7 Security", "Safety", "shield-check", "CCTV and guarded entry"),
        ("Fire Safety System", "Safety", "flame", "Sprinklers and hydrants on all floors"), ("Power Backup", "Convenience", "zap", "100% DG backup for common areas"),
        ("Covered Parking", "Convenience", "car", "Basement and stilt parking"), ("Lift", "Convenience", "arrow-up-down", "High-speed passenger lifts"),
        ("Landscaped Garden", "Green", "trees", "Central landscaped lawn"), ("Rainwater Harvesting", "Green", "cloud-rain", "Recharge pits across campus"),
    ]:
        amenities[name] = await _insert("amenities", cid, {"name": name, "category": cat, "icon": icon, "description": desc})
    std_clp = await _insert("milestone_templates", cid, {"name": "Standard CLP", "milestones": [
        {"seq": i + 1, "name": n, "cumulative_percent": p} for i, (n, p) in enumerate([
            ("Booking", 10), ("Foundation", 15), ("Plinth", 25), ("1st Slab", 30), ("3rd Slab", 40), ("Top Slab", 50),
            ("Brickwork", 60), ("Plaster", 75), ("Finishing", 85), ("Possession", 100)])]})
    villa_clp = await _insert("milestone_templates", cid, {"name": "Villa CLP", "milestones": [
        {"seq": i + 1, "name": n, "cumulative_percent": p} for i, (n, p) in enumerate([
            ("Booking", 15), ("Foundation", 30), ("Ground Floor Slab", 45), ("First Floor Slab", 60), ("Brickwork & Plaster", 75), ("Finishing", 90), ("Possession", 100)])]})
    for i, (name, code, amt, tax) in enumerate([
        ("Registry Charges", "REGISTRY", None, False), ("Maintenance Deposit", "MAINT_DEPOSIT", 60000, False), ("GST", "GST", None, False),
        ("Car Parking", "PARKING", 250000, True), ("Club Membership", "CLUB", 100000, True), ("Legal Charges", "LEGAL", 15000, True),
        ("Electricity/Water Connection", "EWC", 50000, True)]):
        await _insert("charge_types", cid, {"name": name, "code": code, "default_amount": amt, "is_taxable": tax, "sort_order": i + 1})
    for name, code, ref in [("Cash", "CASH", False), ("Cheque", "CHEQUE", True), ("NEFT / RTGS", "NEFT_RTGS", True), ("UPI", "UPI", True), ("Demand Draft", "DD", True), ("Loan Disbursement", "LOAN_DISBURSEMENT", True)]:
        await _insert("payment_modes", cid, {"name": name, "code": code, "requires_reference": ref})
    await _insert("bank_accounts", cid, {"bank_name": "State Bank of India", "account_name": "Shree Ganesh Builders Pvt Ltd", "account_number_enc": encrypt_field("38201234567890"), "ifsc": "SBIN0001234", "branch": "Boring Road, Patna", "is_default": True})
    for name, code, applies in [("PAN Card", "PAN", "customer"), ("Aadhaar Card", "AADHAAR", "customer"), ("Passport Photo", "PHOTO", "customer"), ("Booking Form", "BOOKING_FORM", "booking"), ("Agreement to Sale", "AGREEMENT", "booking"), ("RERA Certificate", "RERA_CERT", "project")]:
        await _insert("document_types", cid, {"name": name, "code": code, "applies_to": applies})

    def room(code, label, l, w):
        return {"room_type_id": room_types[code]["id"], "label": label, "length_ft": l, "width_ft": w, "area_sqft": round(l * w, 2)}

    def areas(carpet, builtup, sbu, balcony):
        return [{"area_type_id": area_types["CARPET"]["id"], "value_sqft": carpet}, {"area_type_id": area_types["BUILTUP"]["id"], "value_sqft": builtup},
                {"area_type_id": area_types["SUPER_BUILTUP"]["id"], "value_sqft": sbu}, {"area_type_id": area_types["BALCONY"]["id"], "value_sqft": balcony}]

    ft = {}
    ft["2BHK-A"] = await _insert("flat_types", cid, {"name": "2BHK-A", "code": "2BHK-A", "bhk": 2, "facing": "E", "description": "Compact 2 BHK with balcony",
        "rooms": [room("LIVING", "Living Room", 16, 12), room("MBED", "Master Bedroom", 14, 11), room("BED", "Bedroom 2", 12, 10), room("KITCHEN", "Kitchen", 10, 8), room("BATH", "Bathroom 1", 7, 5), room("BATH", "Bathroom 2", 6, 5), room("BALCONY", "Balcony", 10, 4)],
        "areas": areas(680, 790, 1050, 40), "base_rate_per_sqft": 4000, "base_price": None})
    ft["2BHK-B"] = await _insert("flat_types", cid, {"name": "2BHK-B", "code": "2BHK-B", "bhk": 2, "facing": "W", "description": "Spacious 2 BHK with dining",
        "rooms": [room("LIVING", "Living Room", 17, 12), room("DINING", "Dining", 10, 8), room("MBED", "Master Bedroom", 14, 12), room("BED", "Bedroom 2", 12, 11), room("KITCHEN", "Kitchen", 10, 8), room("BATH", "Bathroom 1", 7, 5), room("BATH", "Bathroom 2", 6, 5), room("BALCONY", "Balcony", 10, 4)],
        "areas": areas(730, 850, 1120, 40), "base_rate_per_sqft": 4100, "base_price": None})
    ft["3BHK-A"] = await _insert("flat_types", cid, {"name": "3BHK-A", "code": "3BHK-A", "bhk": 3, "facing": "N", "description": "3 BHK with two balconies",
        "rooms": [room("LIVING", "Living Room", 18, 13), room("DINING", "Dining", 11, 9), room("MBED", "Master Bedroom", 15, 12), room("BED", "Bedroom 2", 12, 11), room("BED", "Bedroom 3", 11, 10), room("KITCHEN", "Kitchen", 11, 8), room("BATH", "Bathroom 1", 8, 5), room("BATH", "Bathroom 2", 7, 5), room("BALCONY", "Balcony 1", 10, 4), room("BALCONY", "Balcony 2", 8, 4)],
        "areas": areas(950, 1100, 1450, 72), "base_rate_per_sqft": 4200, "base_price": None})
    ft["3BHK-B"] = await _insert("flat_types", cid, {"name": "3BHK-B", "code": "3BHK-B", "bhk": 3, "facing": "S", "description": "Premium 3 BHK with study",
        "rooms": [room("LIVING", "Living Room", 19, 14), room("DINING", "Dining", 12, 9), room("MBED", "Master Bedroom", 16, 12), room("BED", "Bedroom 2", 13, 11), room("BED", "Bedroom 3", 12, 11), room("STUDY", "Study", 9, 8), room("KITCHEN", "Kitchen", 12, 8), room("BATH", "Bathroom 1", 8, 6), room("BATH", "Bathroom 2", 7, 5), room("BATH", "Bathroom 3", 6, 5), room("BALCONY", "Balcony", 12, 4)],
        "areas": areas(1060, 1230, 1620, 48), "base_rate_per_sqft": 4400, "base_price": None})
    ft["4BHK-Villa"] = await _insert("flat_types", cid, {"name": "4BHK-Villa", "code": "4BHK-VILLA", "bhk": 4, "facing": "E", "description": "Independent duplex villa with garden",
        "rooms": [room("LIVING", "Living Room", 22, 16), room("DINING", "Dining", 14, 11), room("MBED", "Master Bedroom", 18, 14), room("BED", "Bedroom 2", 14, 12), room("BED", "Bedroom 3", 14, 12), room("BED", "Bedroom 4", 13, 12), room("STUDY", "Study", 10, 10), room("KITCHEN", "Kitchen", 14, 10), room("BATH", "Bathroom 1", 9, 6), room("BATH", "Bathroom 2", 8, 6), room("BATH", "Bathroom 3", 7, 5), room("BATH", "Bathroom 4", 7, 5), room("BALCONY", "Terrace", 16, 8)],
        "areas": [{"area_type_id": area_types["CARPET"]["id"], "value_sqft": 1650}, {"area_type_id": area_types["BUILTUP"]["id"], "value_sqft": 1980}, {"area_type_id": area_types["SUPER_BUILTUP"]["id"], "value_sqft": 2400}, {"area_type_id": area_types["TERRACE"]["id"], "value_sqft": 128}, {"area_type_id": area_types["PARKING"]["id"], "value_sqft": 180}],
        "base_rate_per_sqft": None, "base_price": 10500000})

    sgh = await _insert("projects", cid, {
        "name": "Shree Ganesh Heights", "code": "SGH", "description": "Premium high-rise residential towers in the heart of Patna with world-class amenities.",
        "project_type": "Residential", "address": {"line1": "Bailey Road, Near Saguna More", "city": "Patna", "state": "Bihar", "pincode": "801503"},
        "rera_number": "BRERAP00123", "launch_date": "2025-10-15", "expected_possession_date": "2028-12-31", "status": "Under Construction",
        "amenity_ids": [a["id"] for a in amenities.values()], "milestone_template_id": std_clp["id"], "cover_image_url": None, "default_cash_percent": 60,
        "is_published": False, "show_prices": False, "show_availability": False}, "project")
    ggv = await _insert("projects", cid, {
        "name": "Ganesh Green Villas", "code": "GGV", "description": "Gated community of 4 BHK duplex villas with private gardens.",
        "project_type": "Residential", "address": {"line1": "Danapur-Bihta Road", "city": "Patna", "state": "Bihar", "pincode": "801103"},
        "rera_number": "BRERAP00188", "launch_date": "2026-01-10", "expected_possession_date": "2028-06-30", "status": "Planning", "default_cash_percent": 0,
        "amenity_ids": [amenities[n]["id"] for n in ("Clubhouse", "24x7 Security", "Landscaped Garden", "Rainwater Harvesting", "Power Backup", "Children's Play Area")],
        "milestone_template_id": villa_clp["id"], "cover_image_url": None, "is_published": False, "show_prices": False, "show_availability": False}, "project")

    async def block(project, name, code, bt, floors, fpf, pattern, pfts, mt, rate, rise):
        b = await _insert("blocks", cid, {"project_id": project["id"], "block_type_id": block_types[bt]["id"], "name": name, "code": code, "floors": floors,
            "flats_per_floor": fpf, "floor_start": 1, "numbering_pattern": pattern, "position_flat_types": pfts,
            "floor_plans": [{"from_floor": 1, "to_floor": floors, "floor_plan_template_id": None, "positions": pfts}],
            "skip_floors": [], "refuge_floors": [], "podium_floors": [], "ground_floor_label": None, "milestone_template_id": mt["id"],
            "rate_per_sqft": rate, "floor_rise_per_sqft": rise, "status": "Under Construction" if project is sgh else "Planning", "construction_percent": 0}, "block")
        flats = await generate_flats(b, None, None)
        await write_audit(None, "block.generate_flats", "block", b["id"], after={"flats": len(flats)}, company_id=cid)
        return b, flats

    ta, ta_flats = await block(sgh, "Tower A", "A", "TOWER", 8, 4, "{block}-{floor}{pos2}", [{"position": 1, "flat_type_id": ft["3BHK-A"]["id"]}, {"position": 2, "flat_type_id": ft["3BHK-A"]["id"]}, {"position": 3, "flat_type_id": ft["2BHK-A"]["id"]}, {"position": 4, "flat_type_id": ft["2BHK-A"]["id"]}], std_clp, 4200, 25)
    tb, tb_flats = await block(sgh, "Tower B", "B", "TOWER", 8, 4, "{block}-{floor}{pos2}", [{"position": 1, "flat_type_id": ft["3BHK-B"]["id"]}, {"position": 2, "flat_type_id": ft["3BHK-B"]["id"]}, {"position": 3, "flat_type_id": ft["2BHK-B"]["id"]}, {"position": 4, "flat_type_id": ft["2BHK-B"]["id"]}], std_clp, 4400, 25)
    vb, vb_flats = await block(ggv, "Villa Block V", "V", "VILLA", 1, 12, "{block}{seq}", [{"position": i, "flat_type_id": ft["4BHK-Villa"]["id"]} for i in range(1, 13)], villa_clp, None, None)

    for number, status, reason in [("A-101", "Hold", "Reserved for channel partner"), ("A-304", "Hold", "Token received, awaiting booking"), ("A-801", "Blocked", "Builder's own"), ("B-203", "Hold", "Site visit follow-up"), ("B-802", "Blocked", "Sample flat"), ("V3", "Hold", "NRI enquiry")]:
        f = await db.flats.find_one({"flat_number": number, "company_id": cid}, {"_id": 0})
        if f:
            await db.flats.update_one({"id": f["id"]}, {"$set": {"status": status, "status_reason": reason, "status_changed_at": now_iso(), "updated_at": now_iso()}})
            await write_audit(None, "flat.status", "flat", f["id"], before={"id": f["id"], "flat_number": number, "status": "Available"}, after={"id": f["id"], "flat_number": number, "status": status, "reason": reason}, company_id=cid)

    for data in [
        user("Rajesh Kumar", "admin@kkt.in", "Super Admin", ["*"]),
        user("Priya Sharma", "projectadmin@kkt.in", "Project Admin", [sgh["id"]]),
        user("Amit Verma", "accounts@kkt.in", "Accounts", ["*"]),
        user("Neha Singh", "sales@kkt.in", "Sales", ["*"]),
        user("Sunil Yadav", "employee@kkt.in", "Employee", ["*"]),
    ]:
        await _insert("users", cid, data, "user")
    logger.info("Seed complete: %d flats", await db.flats.count_documents({}))


if __name__ == "__main__":
    async def _main():
        await ensure_indexes()
        if await db.users.count_documents({}) > 0:
            print("Database already seeded")
        else:
            await seed()
            print("Seeded")
        await seed_phase15()
        print("Phase 1.5 seed applied")
    asyncio.run(_main())


async def seed_phase15():
    """Idempotent Phase 1.5 additions: floor plans, Tower C, PLC + rate cards, parking, specifications."""
    if await db.settings.find_one({"key": "seed_phase15_done"}):
        return
    company = await db.companies.find_one({}, {"_id": 0})
    if not company:
        return
    cid = company["id"]
    logger.info("Applying Phase 1.5 seed...")
    # version/deleted_at backfill
    for c in ("users", "roles", "projects", "blocks", "flats", "companies", "room_types", "area_types", "flat_types", "block_types", "amenities", "milestone_templates", "charge_types", "payment_modes", "bank_accounts", "document_types"):
        await db[c].update_many({"version": {"$exists": False}}, {"$set": {"version": 1, "deleted_at": None}})
    await db.users.update_many({"mfa_enabled": {"$exists": False}}, {"$set": {"mfa_enabled": False, "must_change_password": False, "password_history": []}})
    ft = {f["code"]: f for f in await db.flat_types.find({"company_id": cid}, {"_id": 0}).to_list(None)}
    sgh = await db.projects.find_one({"code": "SGH"}, {"_id": 0})
    ggv = await db.projects.find_one({"code": "GGV"}, {"_id": 0})
    tower = await db.block_types.find_one({"code": "TOWER"}, {"_id": 0})
    std_clp = await db.milestone_templates.find_one({"name": "Standard CLP"}, {"_id": 0})

    def pos(*codes):
        return [{"position": i + 1, "flat_type_id": ft[c]["id"], "facing": fc, "is_corner": i in (0, len(codes) - 1)} for i, (c, fc) in enumerate(codes)]

    plans = {}
    for name, code, fpf, positions in [
        ("Typical A", "TYP-A", 4, pos(("3BHK-A", "N"), ("3BHK-A", "E"), ("2BHK-A", "W"), ("2BHK-A", "S"))),
        ("Typical A2 (upper)", "TYP-A2", 4, pos(("3BHK-A", "N"), ("3BHK-A", "E"), ("3BHK-B", "W"), ("2BHK-A", "S"))),
        ("Typical B", "TYP-B", 4, pos(("3BHK-B", "N"), ("3BHK-B", "E"), ("2BHK-B", "W"), ("2BHK-B", "S"))),
        ("Villa Row", "VILLA-12", 12, [{"position": i, "flat_type_id": ft["4BHK-VILLA"]["id"], "facing": "E" if i % 2 else "W", "is_corner": i in (1, 12)} for i in range(1, 13)]),
    ]:
        plans[code] = await _insert("floor_plan_templates", cid, {"name": name, "code": code, "flats_per_floor": fpf, "positions": positions})
    # migrate seeded blocks to floor-plan ranges
    ta = await db.blocks.find_one({"project_id": sgh["id"], "code": "A"}, {"_id": 0})
    tb = await db.blocks.find_one({"project_id": sgh["id"], "code": "B"}, {"_id": 0})
    vb = await db.blocks.find_one({"project_id": ggv["id"], "code": "V"}, {"_id": 0})
    common = {"skip_floors": [], "refuge_floors": [], "podium_floors": [], "ground_floor_label": None}
    if ta:
        await db.blocks.update_one({"id": ta["id"]}, {"$set": {**common, "floor_plans": [{"from_floor": 1, "to_floor": 5, "floor_plan_template_id": plans["TYP-A"]["id"], "positions": None}, {"from_floor": 6, "to_floor": 8, "floor_plan_template_id": plans["TYP-A2"]["id"], "positions": None}]}})
        # position 3 on floors 6-8 becomes 3BHK-B (re-snapshot only Available flats)
        ta = await db.blocks.find_one({"id": ta["id"]}, {"_id": 0})
        from services.flat_generation import resnapshot_flat
        async for f in db.flats.find({"block_id": ta["id"], "floor": {"$gte": 6}, "position": 3, "status": "Available"}, {"_id": 0}):
            await db.flats.update_one({"id": f["id"]}, {"$set": {**(await resnapshot_flat(f, ft["3BHK-B"]["id"], ta)), "is_corner": False}})
        await db.flats.update_many({"block_id": ta["id"], "position": {"$in": [1, 4]}}, {"$set": {"is_corner": True}})
    if tb:
        await db.blocks.update_one({"id": tb["id"]}, {"$set": {**common, "floor_plans": [{"from_floor": 1, "to_floor": 8, "floor_plan_template_id": plans["TYP-B"]["id"], "positions": None}]}})
        await db.flats.update_many({"block_id": tb["id"], "position": {"$in": [1, 4]}}, {"$set": {"is_corner": True}})
    if vb:
        await db.blocks.update_one({"id": vb["id"]}, {"$set": {**common, "floor_plans": [{"from_floor": 1, "to_floor": 1, "floor_plan_template_id": plans["VILLA-12"]["id"], "positions": None}]}})
    # Tower C: 15 floors, skip 13, refuge 7
    if not await db.blocks.find_one({"project_id": sgh["id"], "code": "C"}):
        tc = await _insert("blocks", cid, {"project_id": sgh["id"], "block_type_id": tower["id"], "name": "Tower C", "code": "C", "floors": 15, "flats_per_floor": 4, "floor_start": 1,
            "ground_floor_label": None, "skip_floors": [13], "refuge_floors": [7], "podium_floors": [], "numbering_pattern": "{block}-{floor}{pos2}", "position_flat_types": [],
            "floor_plans": [{"from_floor": 1, "to_floor": 16, "floor_plan_template_id": plans["TYP-A"]["id"], "positions": None}],
            "milestone_template_id": std_clp["id"], "rate_per_sqft": 4300, "floor_rise_per_sqft": 30, "status": "Planning", "construction_percent": 0}, "block")
        flats = await generate_flats(tc, None, None)
        await write_audit(None, "block.generate_flats", "block", tc["id"], after={"flats": len(flats)}, company_id=cid)
    # PLC types
    plc = {}
    for i, (name, code, calc) in enumerate([("Floor Rise", "FLOOR_RISE", "per_sqft"), ("Corner", "CORNER", "per_sqft"), ("Park Facing", "PARK_FACING", "per_sqft"), ("Road Facing", "ROAD_FACING", "per_sqft"), ("Top Floor", "TOP_FLOOR", "percent"), ("Vastu", "VASTU", "fixed")]):
        plc[code] = await _insert("plc_types", cid, {"name": name, "code": code, "calc": calc, "description": None, "sort_order": i + 1})
    # Rate cards (active + applied)
    from routers.rate_cards import price_flat
    for proj, name, rates, rules in [
        (sgh, "SGH Launch Rate Card FY26", [{"flat_type_id": ft["2BHK-A"]["id"], "rate_per_sqft": 4200, "lump_sum": None}, {"flat_type_id": ft["2BHK-B"]["id"], "rate_per_sqft": 4400, "lump_sum": None}, {"flat_type_id": ft["3BHK-A"]["id"], "rate_per_sqft": 4300, "lump_sum": None}, {"flat_type_id": ft["3BHK-B"]["id"], "rate_per_sqft": 4500, "lump_sum": None}],
         [{"plc_type_id": plc["FLOOR_RISE"]["id"], "value": 25, "applies": "all", "floor_gte": None, "facings": None, "per_floor": True}, {"plc_type_id": plc["CORNER"]["id"], "value": 100, "applies": "corner", "floor_gte": None, "facings": None, "per_floor": False}, {"plc_type_id": plc["PARK_FACING"]["id"], "value": 150, "applies": "facing_in", "floor_gte": None, "facings": ["N", "E"], "per_floor": False}]),
        (ggv, "GGV Villa Rate Card FY26", [{"flat_type_id": ft["4BHK-VILLA"]["id"], "rate_per_sqft": None, "lump_sum": 10500000}],
         [{"plc_type_id": plc["CORNER"]["id"], "value": 250000, "applies": "corner", "floor_gte": None, "facings": None, "per_floor": False}, {"plc_type_id": plc["VASTU"]["id"], "value": 150000, "applies": "facing_in", "floor_gte": None, "facings": ["E"], "per_floor": False}]),
    ]:
        plc["VASTU"]["calc"] = "fixed"
        rc = await _insert("rate_cards", cid, {"project_id": proj["id"], "name": name, "effective_from": "2026-04-01", "rates": rates, "plc_rules": rules, "notes": "Seeded", "status": "Active", "activated_at": now_iso(), "superseded_by": None, "applied_at": now_iso(), "applied_count": 0}, "rate_card")
        plc_types = {p["id"]: p for p in plc.values()}
        blocks = {b["id"]: b for b in await db.blocks.find({"project_id": proj["id"]}, {"_id": 0}).to_list(None)}
        n = 0
        async for f in db.flats.find({"project_id": proj["id"], "status": "Available"}, {"_id": 0}):
            top = max(unit_floors(blocks[f["block_id"]]))
            total, breakup, rate = price_flat(f, rc, plc_types, blocks[f["block_id"]], top)
            if total is not None:
                await db.flats.update_one({"id": f["id"]}, {"$set": {"price": total, "price_breakup": breakup, "rate_per_sqft": rate, "rate_card_id": rc["id"]}})
                n += 1
        await db.rate_cards.update_one({"id": rc["id"]}, {"$set": {"applied_count": n}})
    # Parking
    for proj, prefix, typ, level, price, count, start in [(sgh, "SB", "Basement", "B1", 350000, 60, 1), (sgh, "SS", "Stilt", "Stilt", 250000, 40, 1), (sgh, "SO", "Open", "Ground", 150000, 20, 1), (ggv, "VP", "Covered", "Villa", 0, 12, 1)]:
        docs = [{**base_doc(None, cid), "project_id": proj["id"], "number": f"{prefix}{str(start + i).zfill(3)}", "type": typ, "level": level, "price": price or None, "status": "Available", "flat_id": None} for i in range(count)]
        await db.parking_slots.insert_many(docs)
    await write_audit(None, "parking_slot.bulk_generate", "project", sgh["id"], after={"count": 120}, company_id=cid)
    await write_audit(None, "parking_slot.bulk_generate", "project", ggv["id"], after={"count": 12}, company_id=cid)
    # Specifications
    cats, items = {}, {}
    for i, (name, code) in enumerate([("Flooring", "FLOORING"), ("Kitchen", "KITCHEN"), ("Doors & Windows", "DOORS_WINDOWS"), ("Electrical", "ELECTRICAL"), ("Bathroom", "BATHROOM"), ("Paint", "PAINT")]):
        cats[code] = await _insert("spec_categories", cid, {"name": name, "code": code, "sort_order": i + 1})
    for cat, name, brand in [("FLOORING", "Vitrified tiles 800×800", "Kajaria"), ("FLOORING", "Italian marble (villa)", "Imported"), ("KITCHEN", "Granite platform with SS sink", "Nirali"), ("KITCHEN", "Modular kitchen (villa)", "Hettich"),
                             ("DOORS_WINDOWS", "UPVC windows", "Fenesta"), ("DOORS_WINDOWS", "Teak main door", "Local"), ("ELECTRICAL", "Modular switches", "Legrand"), ("ELECTRICAL", "Copper wiring", "Polycab"),
                             ("BATHROOM", "CP fittings", "Jaquar"), ("BATHROOM", "Anti-skid ceramic tiles", "Somany"), ("PAINT", "Acrylic emulsion interior", "Asian Paints"), ("PAINT", "Weatherproof exterior", "Dulux")]:
        items[name] = await _insert("spec_items", cid, {"name": name, "spec_category_id": cats[cat]["id"], "description": None, "brand": brand})
    std = [items[n]["id"] for n in ("Vitrified tiles 800×800", "Granite platform with SS sink", "UPVC windows", "Teak main door", "Modular switches", "Copper wiring", "CP fittings", "Anti-skid ceramic tiles", "Acrylic emulsion interior", "Weatherproof exterior")]
    villa = [items[n]["id"] for n in ("Italian marble (villa)", "Modular kitchen (villa)", "UPVC windows", "Teak main door", "Modular switches", "Copper wiring", "CP fittings", "Anti-skid ceramic tiles", "Acrylic emulsion interior", "Weatherproof exterior")]
    for code, f in ft.items():
        await db.flat_types.update_one({"id": f["id"]}, {"$set": {"spec_item_ids": villa if "VILLA" in code else std}})
    # project enrichment
    bank = await db.bank_accounts.find_one({"company_id": cid}, {"_id": 0, "id": 1})
    admin = await db.users.find_one({"email": "admin@kkt.in"}, {"_id": 0, "id": 1})
    pa = await db.users.find_one({"email": "projectadmin@kkt.in"}, {"_id": 0, "id": 1})
    await db.projects.update_one({"id": sgh["id"]}, {"$set": {"geo": {"lat": 25.6093, "lng": 85.0822}, "landmarks": [{"name": "Patna Junction", "distance_km": 7.5}, {"name": "AIIMS Patna", "distance_km": 4.2}, {"name": "Saguna More Metro", "distance_km": 1.1}],
        "approvals": [{"name": "RERA", "number": "BRERAP00123", "date": "2025-09-01"}, {"name": "Building Plan", "number": "PMC/BP/2025/118", "date": "2025-07-15"}, {"name": "Fire NOC", "number": "FS/PAT/2025/221", "date": "2025-08-20"}],
        "team": [u["id"] for u in (admin, pa) if u], "escrow_bank_account_id": bank["id"] if bank else None, "land_area_sqft": 217800, "phases": [{"name": "Phase 1", "block_ids": [b["id"] for b in (ta, tb) if b]}, {"name": "Phase 2", "block_ids": []}]}})
    await db.projects.update_one({"id": ggv["id"]}, {"$set": {"geo": {"lat": 25.5735, "lng": 84.9951}, "landmarks": [{"name": "Danapur Station", "distance_km": 3.8}, {"name": "Bihta Airport (upcoming)", "distance_km": 9.0}],
        "approvals": [{"name": "RERA", "number": "BRERAP00188", "date": "2025-12-10"}], "team": [admin["id"]] if admin else [], "escrow_bank_account_id": bank["id"] if bank else None, "land_area_sqft": 130680, "phases": []}})
    await db.settings.update_one({"key": "seed_phase15_done"}, {"$set": {"value": True}}, upsert=True)
    logger.info("Phase 1.5 seed complete")
