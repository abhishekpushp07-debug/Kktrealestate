"""Phase 2 seed: customers, leads, milestones, bookings, demands, payments. Idempotent; coherent (nothing random)."""
import logging
from datetime import date, timedelta

from db import db
from services.counters import recompute_all
from services.kyc import seal, verhoeff_generate
from services.ledger import create_demand, raise_other_charges, rebuild
from services.money import pct_of, to_paise
from services.numbering import generate_number
from utils import base_doc, new_id, write_audit

logger = logging.getLogger("kkt.seed2")


def _ts(d: date, hour: int = 10, minute: int = 0) -> str:
    return f"{d.isoformat()}T{hour:02d}:{minute:02d}:00+00:00"


def _aadhaar(prefix11: str) -> str:
    return verhoeff_generate(prefix11)


async def seed_phase2():
    if await db.settings.find_one({"key": "seed_phase2_done"}):
        return
    company = await db.companies.find_one({}, {"_id": 0})
    if not company:
        return
    cid = company["id"]
    logger.info("Applying Phase 2 seed...")
    await db.companies.update_one({"id": cid}, {"$set": {"demand_due_days": 15, "authorised_signatory_name": "Rajesh Kumar", "default_gst_percent": 18, "letterhead_tagline": "Building trust, delivering homes", "letterhead_phone": "+91 612 2234567", "letterhead_email": "accounts@kktconstructions.in",
                                                         "booking_number_format": "BK-{FY}-{SEQ}", "receipt_number_format": "{PREFIX}/{FY}/{SEQ}", "customer_number_format": "CUST-{FY}-{SEQ}", "demand_number_format": "DM-{FY}-{SEQ}"}})
    # role permission sync (Sales loses kyc_view; Accounts/Project Admin gain)
    from permissions import SYSTEM_ROLES
    for name, spec in SYSTEM_ROLES.items():
        await db.roles.update_one({"name": name, "is_system": True}, {"$set": {"permissions": spec["permissions"]}})
    await db.settings.update_one({"key": "roles_version"}, {"$inc": {"value": 1}}, upsert=True)
    # housekeeping from tester leftovers
    a103 = await db.flats.find_one({"flat_number": "A-103"}, {"_id": 0})
    if a103 and a103["status"] in ("Hold", "Blocked"):
        await db.flats.update_one({"id": a103["id"]}, {"$set": {"status": "Available", "status_reason": None}})

    users = {u["email"]: u for u in await db.users.find({}, {"_id": 0, "id": 1, "email": 1, "name": 1}).to_list(None)}
    sales, admin, accounts = users["sales@kkt.in"], users["admin@kkt.in"], users["accounts@kkt.in"]
    sgh = await db.projects.find_one({"code": "SGH"}, {"_id": 0})
    ggv = await db.projects.find_one({"code": "GGV"}, {"_id": 0})
    blocks = {b["code"]: b for b in await db.blocks.find({"project_id": {"$in": [sgh["id"], ggv["id"]]}}, {"_id": 0}).to_list(None)}
    villa_type = await db.block_types.find_one({"code": {"$in": ["VILLA", "VILLA_ROW"]}}, {"_id": 0}) or await db.block_types.find_one({"has_floors": False}, {"_id": 0})
    std_clp = await db.milestone_templates.find_one({"name": "Standard CLP"}, {"_id": 0})
    villa_clp = await db.milestone_templates.find_one({"name": "Villa CLP"}, {"_id": 0})
    modes = {m["code"]: m for m in await db.payment_modes.find({}, {"_id": 0}).to_list(None)}
    bank = await db.bank_accounts.find_one({"company_id": cid}, {"_id": 0})
    cts = {c["code"]: c for c in await db.charge_types.find({}, {"_id": 0}).to_list(None)}
    ft_villa = await db.flat_types.find_one({"code": {"$regex": "VILLA|4BHK"}}, {"_id": 0}) or await db.flat_types.find_one({}, {"_id": 0})

    # ---- Premium villa block P (owner example, 100% complete) ----
    if "P" not in blocks:
        p_block = {**base_doc(None, cid), "project_id": ggv["id"], "name": "Villa Block P (Premium)", "code": "P", "block_type_id": villa_type["id"], "floors": 1, "flats_per_floor": 6, "floor_start": 1,
                   "numbering_pattern": "{block}{pos}", "status": "Completed", "milestone_template_id": std_clp["id"], "floor_plans": [], "position_flat_types": [], "skip_floors": [], "refuge_floors": [], "podium_floors": [],
                   "construction_percent": 100, "description": "Six premium lump-sum villas", "rate_per_sqft": None}
        await db.blocks.insert_one(p_block)
        p_block.pop("_id", None)
        flats = []
        for i in range(1, 7):
            flats.append({**base_doc(None, cid), "project_id": ggv["id"], "block_id": p_block["id"], "flat_number": f"P{i}", "floor": 1, "floor_label": "G", "position": i, "flat_type_id": ft_villa["id"], "flat_type_code": ft_villa["code"],
                          "status": "Available", "price_paise": 1000000000, "rate_per_sqft": None, "super_builtup_sqft": ft_villa.get("super_builtup_sqft") or 2400, "carpet_sqft": ft_villa.get("carpet_sqft"), "builtup_sqft": ft_villa.get("builtup_sqft"),
                          "facing": "E" if i % 2 else "W", "is_corner": i in (1, 6), "price_breakup": [{"label": "Lump sum", "amount": 10000000.0}], "project_code": "GGV", "block_code": "P"})
        await db.flats.insert_many(flats)
        blocks["P"] = p_block
        await write_audit(None, "block.create", "block", p_block["id"], after={"code": "P", "flats_generated": 6}, company_id=cid)

    # ---- milestones snapshot + completion levels ----
    base_day = date(2025, 11, 1)
    targets = {"A": "Top Slab", "B": "Plinth", "C": "Booking", "V": "Brickwork & Plaster", "P": "Possession"}
    for code, upto in targets.items():
        b = blocks.get(code)
        if not b:
            continue
        mt = villa_clp if code == "V" else std_clp
        ms = []
        pct, day = 0, base_day
        reached = False
        for m in mt["milestones"]:
            done = not reached
            day = base_day + timedelta(days=30 * (m["seq"] - 1))
            ms.append({"seq": m["seq"], "name": m["name"], "cumulative_percent": m["cumulative_percent"], "status": "Completed" if done else "Pending",
                       "completed_on": day.isoformat() if done else None, "completed_at": _ts(day, 9) if done else None, "completed_by": admin["id"] if done else None, "completed_by_name": admin["name"] if done else None, "notes": None})
            if done:
                pct = m["cumulative_percent"]
            if m["name"] == upto:
                reached = True
        await db.blocks.update_one({"id": b["id"]}, {"$set": {"milestones": ms, "construction_percent": pct, "milestone_template_id": mt["id"]}})
        b["milestones"], b["construction_percent"] = ms, pct

    # ---- customers ----
    people = [
        ("Mr", "Amit Kumar Sinha", "Ramesh Sinha", "9431012345", "amit.sinha@example.com", "Referral", "10-25L", "Kankarbagh", "ABCPS1234K", "23456789012"),
        ("Mrs", "Priya Verma", "Sanjay Verma", "9431023456", "priya.verma@example.com", "Website", "5-10L", "Boring Road", "ABCPV2345L", "34567890123"),
        ("Mr", "Rahul Ranjan", "Shyam Ranjan", "9431034567", "rahul.ranjan@example.com", "Walk-in", "25-50L", "Patliputra Colony", "ABCPR3456M", "45678901234"),
        ("Dr", "Sunita Devi", "Mahesh Prasad", "9431045678", "sunita.devi@example.com", "Broker", "50L-1Cr", "Rajendra Nagar", "ABCPD4567N", "56789012345"),
        ("Mr", "Vikash Choudhary", "Dinesh Choudhary", "9431056789", "vikash.c@example.com", "Campaign", "10-25L", "Bailey Road", "ABCPC5678P", "67890123456"),
        ("Ms", "Neha Singh", "Ajay Singh", "9431067890", "neha.singh@example.com", "Website", "5-10L", "Danapur", "ABCPS6789Q", "78901234567"),
        ("Mr", "Manoj Tiwari", "Harish Tiwari", "9431078901", "manoj.t@example.com", "Referral", "25-50L", "Ashiana Nagar", "ABCPT7890R", "89012345678"),
        ("Mrs", "Kavita Jha", "Rakesh Jha", "9431089012", "kavita.jha@example.com", "Walk-in", "10-25L", "Kidwaipuri", "ABCPJ8901S", "90123456789"),
        ("Mr", "Santosh Yadav", "Bhola Yadav", "9431090123", "santosh.y@example.com", "Broker", ">1Cr", "Gola Road", "ABCPY9012T", "21234567890"),
        ("Mr", "Deepak Mishra", "Om Prakash Mishra", "9431001234", "deepak.m@example.com", "Campaign", "10-25L", "Khagaul", "ABCPM0123U", "32345678901"),
        ("Mrs", "Anjali Gupta", "Rohit Gupta", "9431012346", "anjali.g@example.com", "Referral", "25-50L", "Fraser Road", "ABCPG1235V", "43456789012"),
        ("Mr", "Ravi Shankar Prasad", "Lal Babu Prasad", "9431023457", "ravi.sp@example.com", "Website", "50L-1Cr", "Exhibition Road", "ABCPP2346W", "54567890123"),
    ]
    customers = []
    for i, (sal, name, father, phone, email, source, band, area, pan, aad11) in enumerate(people):
        existing = await db.customers.find_one({"phone": "+91" + phone}, {"_id": 0})
        if existing:
            customers.append(existing)
            continue
        co = []
        if i in (0, 3, 8):
            co.append(seal({"name": f"{'Rekha' if i == 0 else 'Alok' if i == 3 else 'Meera'} {name.split()[-1]}", "relation": "Spouse", "phone": f"+9194310{55000 + i:05d}", "pan": f"XYZPA{1000 + i}Z", "aadhaar": _aadhaar(f"9{i:02d}12345678")}))
        doc = {**base_doc(None, cid), "customer_code": await generate_number("customer", company, base_day), "salutation": sal, "full_name": name, "father_or_spouse_name": father, "dob": f"19{70 + i}-0{(i % 9) + 1}-15", "gender": "Female" if sal in ("Mrs", "Ms") else "Male",
               "phone": "+91" + phone, "alt_phone": None, "email": email, "address_current": {"line1": f"{10 + i}, {area}", "city": "Patna", "state": "Bihar", "pincode": "800001"}, "address_permanent": {"line1": f"{10 + i}, {area}", "city": "Patna", "state": "Bihar", "pincode": "800001"},
               "permanent_same_as_current": True, "occupation": ["Business", "Service", "Doctor", "Government"][i % 4], "company_name": None, "annual_income_band": band, "source": source, "assigned_sales_user_id": sales["id"],
               "bank": seal({"bank_name": "State Bank of India", "account_number": f"3820{1000000 + i * 7919:010d}", "ifsc": "SBIN0001234"}, ("account_number",)), "nominee": {"name": father, "relation": "Father", "dob": None},
               "co_applicants": co, "kyc_status": ["Verified", "Submitted", "Pending", "Verified"][i % 4], "kyc_verified_by": accounts["id"] if i % 4 in (0, 3) else None, "kyc_verified_at": _ts(base_day) if i % 4 in (0, 3) else None, "notes": None, "tags": []}
        doc = {**doc, **seal({"pan": pan, "aadhaar": _aadhaar(aad11)})}
        await db.customers.insert_one(doc)
        doc.pop("_id", None)
        await write_audit(None, "customer.create", "customer", doc["id"], after={"customer_code": doc["customer_code"], "full_name": name}, company_id=cid)
        customers.append(doc)

    # ---- leads ----
    if await db.leads.count_documents({}) == 0:
        stages = ["New", "Contacted", "Site Visit Scheduled", "Site Visit Done", "Negotiation", "Lost", "Contacted", "New"]
        names = [("Arvind Kumar", "9430011111"), ("Pooja Sharma", "9430022222"), ("Nitish Raj", "9430033333"), ("Shalini Prasad", "9430044444"), ("Gaurav Sinha", "9430055555"), ("Rina Kumari", "9430066666"), ("Abhishek Anand", "9430077777"), ("Madhu Bala", "9430088888")]
        today = date.today()
        for i, ((n, ph), st) in enumerate(zip(names, stages)):
            hist = [{"status": s, "at": _ts(today - timedelta(days=20 - j * 3)), "by": sales["id"], "note": None} for j, s in enumerate(["New", "Contacted", "Site Visit Scheduled", "Site Visit Done", "Negotiation", "Lost"][: max(1, ["New", "Contacted", "Site Visit Scheduled", "Site Visit Done", "Negotiation", "Lost"].index(st) + 1)])]
            nxt = _ts(today, 11) if i in (0, 1, 6) else _ts(today + timedelta(days=2 + i), 11) if st not in ("Lost",) else None
            doc = {**base_doc(None, cid), "lead_number": await generate_number("lead", company, today), "name": n, "phone": "+91" + ph, "email": f"{n.split()[0].lower()}@example.com", "project_id": sgh["id"] if i % 2 == 0 else ggv["id"], "flat_type_id": None,
                   "budget_min": 4000000, "budget_max": 7000000 + i * 500000, "source": ["Website", "Walk-in", "Referral", "Broker", "Campaign"][i % 5], "status": st, "stage_history": hist, "assigned_to": sales["id"], "notes": None,
                   "follow_ups": [{"at": _ts(today - timedelta(days=3)), "note": "Shared brochure and price list", "next_follow_up_at": nxt, "by": sales["id"], "by_name": sales["name"]}], "next_follow_up_at": nxt,
                   "lost_reason": "Budget mismatch" if st == "Lost" else None, "converted_customer_id": None}
            await db.leads.insert_one(doc)

    # ---- bookings ----
    async def book(flat_number, cust, booking_day, total, cash, account, charges=(), slots=0, sales_uid=None, remarks=None):
        flat = await db.flats.find_one({"flat_number": flat_number}, {"_id": 0})
        if not flat or flat["status"] not in ("Available", "Hold"):
            return None
        blk = await db.blocks.find_one({"id": flat["block_id"]}, {"_id": 0})
        proj = await db.projects.find_one({"id": flat["project_id"]}, {"_id": 0})
        ms = blk.get("milestones") or []
        lines = []
        for code, demand_at in charges:
            ct = cts[code]
            amt = to_paise(ct.get("default_amount") or 50000)
            gst = pct_of(amt, 18) if ct.get("is_taxable") else 0
            lines.append({"line_id": new_id(), "charge_type_id": ct["id"], "name": ct["name"], "code": code, "amount_paise": amt, "gst_percent": 18 if ct.get("is_taxable") else 0, "gst_paise": gst, "total_paise": amt + gst, "demand_at": demand_at, "demanded_paise": 0, "paid_paise": 0, "demanded_at": None})
        slot_ids = []
        if slots:
            free = await db.parking_slots.find({"project_id": proj["id"], "status": "Available"}, {"_id": 0, "id": 1}).limit(slots).to_list(slots)
            slot_ids = [s["id"] for s in free]
        ts = _ts(booking_day, 10)
        doc = {**base_doc(None, cid), "booking_number": await generate_number("booking", company, booking_day), "project_id": proj["id"], "project_code": proj["code"], "project_name": proj["name"], "block_id": blk["id"], "block_code": blk["code"], "block_name": blk["name"], "flat_id": flat["id"],
               "customer_id": cust["id"], "customer_name": cust["full_name"], "customer_code": cust["customer_code"], "customer_phone": cust.get("phone"), "co_applicant_customer_ids": [], "booking_date": booking_day.isoformat(),
               "agreement_value_paise": to_paise(total), "cash_agreed_paise": to_paise(cash), "account_agreed_paise": to_paise(account), "rate_per_sqft": flat.get("rate_per_sqft"),
               "flat_snapshot": {"flat_number": flat["flat_number"], "flat_type_code": flat.get("flat_type_code"), "flat_type_id": flat.get("flat_type_id"), "super_builtup_sqft": flat.get("super_builtup_sqft"), "floor": flat.get("floor"), "price": (flat.get("price_paise") or 0) / 100 or None},
               "milestone_template_snapshot": [{"seq": m["seq"], "name": m["name"], "cumulative_percent": m["cumulative_percent"]} for m in ms], "construction_percent": 0, "other_charges": lines, "parking_slot_ids": slot_ids,
               "sales_user_id": sales_uid or sales["id"], "lead_id": None, "broker_name": None, "remarks": remarks, "status": "Active", "cancellation": None, "agreement_revisions": [], "summary": {}, "created_at": ts, "updated_at": ts}
        await db.bookings.insert_one(doc)
        doc.pop("_id", None)
        await db.flats.update_one({"id": flat["id"]}, {"$set": {"status": "Booked", "booking_id": doc["id"], "status_changed_at": ts}})
        if slot_ids:
            await db.parking_slots.update_many({"id": {"$in": slot_ids}}, {"$set": {"status": "Allotted", "booking_id": doc["id"], "customer_id": cust["id"]}})
        lines = raise_other_charges(doc, "on_booking", ts)
        if lines:
            await db.bookings.update_one({"id": doc["id"]}, {"$set": {"other_charges": lines}})
        await write_audit(None, "booking.create", "booking", doc["id"], after={"booking_number": doc["booking_number"], "flat": flat_number, "customer": cust["full_name"]}, company_id=cid)
        return doc

    async def demands_for(booking, upto_seq=None, day_offset=0):
        """Raise demands for milestones completed in the block (in order), as if posted at completion."""
        blk = await db.blocks.find_one({"id": booking["block_id"]}, {"_id": 0})
        created = []
        for m in blk.get("milestones") or []:
            if m["status"] != "Completed" or (upto_seq and m["seq"] > upto_seq):
                continue
            d = date.fromisoformat(m["completed_on"]) + timedelta(days=day_offset)
            b = await db.bookings.find_one({"id": booking["id"]}, {"_id": 0})
            dm = await create_demand(b, company, m, d, 15, _ts(d, 9, 30))
            if dm:
                created.append(dm)
        return created

    async def pay(booking, day, amount, category=None, mode="NEFT_RTGS", status=None, against="FLAT_VALUE", line_id=None, inst=None, hour=14):
        m = modes[mode]
        st = status or ("Cleared" if mode in ("CASH", "UPI", "NEFT_RTGS", "LOAN_DISBURSEMENT") else "Pending")
        ts = _ts(day, hour)
        p = {**base_doc(None, cid), "receipt_number": await generate_number("receipt", company, day, 5), "booking_id": booking["id"], "booking_number": booking["booking_number"], "customer_id": booking["customer_id"], "customer_name": booking["customer_name"],
             "project_id": booking["project_id"], "project_code": booking["project_code"], "block_id": booking["block_id"], "block_code": booking["block_code"], "flat_id": booking["flat_id"], "flat_number": booking["flat_snapshot"]["flat_number"],
             "against": against, "payment_category": category if against == "FLAT_VALUE" else None, "other_charge_line_id": line_id, "other_charge_name": next((l["name"] for l in booking["other_charges"] if l["line_id"] == line_id), None) if line_id else None,
             "amount_paise": to_paise(amount), "payment_date": day.isoformat(), "payment_mode_id": m["id"], "payment_mode_code": m["code"], "payment_mode_name": m["name"],
             "instrument": inst or ({"number": f"{'CHQ' if mode in ('CHEQUE', 'DD') else 'UTR'}{day.strftime('%y%m%d')}{int(amount) % 997:03d}", "date": day.isoformat(), "bank_name": "HDFC Bank", "branch": "Patna"} if mode != "CASH" else None),
             "bank_account_id": bank["id"] if mode != "CASH" else None, "bank_account_name": f"{bank['bank_name']} ****7890" if mode != "CASH" else None, "remarks": None, "received_by": accounts["id"], "received_by_name": accounts["name"],
             "status": st, "cleared_at": ts if st == "Cleared" else None, "bounced_at": None, "reversal": None, "idempotency_key": None, "posted_at": ts, "created_at": ts, "updated_at": ts}
        await db.payments.insert_one(p)
        p.pop("_id", None)
        await write_audit(None, "payment.post", "booking", booking["id"], after={"receipt_number": p["receipt_number"], "amount_paise": p["amount_paise"], "category": p["payment_category"], "status": st}, company_id=cid)
        return p

    if await db.bookings.count_documents({}) == 0:
        # 1) Owner example: P1, 60L cash / 40L account, 10 milestones, 10 payments interleaved
        ex = await book("P1", customers[0], base_day, 10000000, 6000000, 4000000, charges=[("MAINT_DEPOSIT", "on_possession")], slots=1, remarks="Owner reference ledger example")
        plan = [("Account", 400000), ("Cash", 800000), ("Account", 1200000), ("Cash", 500000), ("Cash", 1000000), ("Account", 1500000), ("Cash", 700000), ("Cash", 2000000), ("Account", 900000), ("Cash", 1000000)]
        blk = await db.blocks.find_one({"id": ex["block_id"]}, {"_id": 0})
        for m, (cat, amt) in zip(blk["milestones"], plan):
            d = date.fromisoformat(m["completed_on"])
            b = await db.bookings.find_one({"id": ex["id"]}, {"_id": 0})
            await create_demand(b, company, m, d, 15, _ts(d, 9, 30))
            if m["cumulative_percent"] >= 100:
                b = await db.bookings.find_one({"id": ex["id"]}, {"_id": 0})
                lines = raise_other_charges(b, "on_possession", _ts(d, 9, 45))
                if lines:
                    await db.bookings.update_one({"id": ex["id"]}, {"$set": {"other_charges": lines}})
            await pay(ex, d + timedelta(days=2), amt, cat, "NEFT_RTGS" if cat == "Account" else "CASH")
        b = await db.bookings.find_one({"id": ex["id"]}, {"_id": 0})
        maint = b["other_charges"][0]
        last = date.fromisoformat(blk["milestones"][-1]["completed_on"]) + timedelta(days=3)
        await pay(ex, last, maint["total_paise"] / 100, None, "UPI", against="OTHER_CHARGE", line_id=maint["line_id"])
        await rebuild(ex["id"])
        ts = _ts(last + timedelta(days=1), 12)
        await db.bookings.update_one({"id": ex["id"]}, {"$set": {"status": "Completed", "completed_at": ts, "completed_by": admin["id"], "completion_notes": "Handover done"}})
        await db.flats.update_one({"id": ex["flat_id"]}, {"$set": {"status": "Sold", "status_changed_at": ts}})
        await write_audit(None, "booking.complete", "booking", ex["id"], after={"status": "Completed"}, company_id=cid)
        await db.settings.update_one({"key": "example_booking_id"}, {"$set": {"value": ex["id"]}}, upsert=True)

        # 2..10) Other bookings
        specs = [
            ("A-201", 1, date(2025, 11, 20), 6500000, 3000000, 3500000, [("PARKING", "on_booking"), ("CLUB", "on_booking"), ("REGISTRY", "manual")], 1, [("Cash", 1000000, "CASH"), ("Account", 1200000, "NEFT_RTGS")], "chq_pending"),
            ("A-302", 2, date(2025, 12, 5), 7200000, 2200000, 5000000, [("PARKING", "on_booking")], 1, [("Account", 3000000, "LOAN_DISBURSEMENT"), ("Cash", 600000, "CASH")], None),
            ("A-402", 3, date(2026, 1, 12), 7000000, 3500000, 3500000, [("CLUB", "on_booking"), ("LEGAL", "on_booking")], 0, [("Cash", 1500000, "CASH"), ("Account", 1750000, "NEFT_RTGS")], "reversal"),
            ("A-503", 4, date(2026, 2, 1), 4800000, 1800000, 3000000, [], 0, [("Account", 1200000, "UPI")], "revision"),
            ("B-301", 5, date(2026, 1, 20), 6800000, 2800000, 4000000, [("PARKING", "on_booking")], 1, [("Cash", 700000, "CASH"), ("Account", 1000000, "NEFT_RTGS")], "bounced"),
            ("B-402", 6, date(2026, 2, 15), 7100000, 3100000, 4000000, [], 0, [("Account", 1775000, "NEFT_RTGS")], None),
            ("C-301", 7, date(2026, 3, 2), 7600000, 2600000, 5000000, [("LEGAL", "on_booking")], 1, [("Cash", 260000, "CASH"), ("Account", 500000, "UPI")], None),
            ("V2", 8, date(2025, 12, 18), 11000000, 5000000, 6000000, [("EWC", "on_possession")], 1, [("Account", 4500000, "LOAN_DISBURSEMENT"), ("Cash", 3750000, "CASH")], None),
            ("V5", 9, date(2026, 1, 8), 10500000, 4500000, 6000000, [], 0, [("Account", 1500000, "NEFT_RTGS")], "cancelled"),
        ]
        for flat_no, ci, bday, total, cash, acct, charges, slots, pays, special in specs:
            bk = await book(flat_no, customers[ci], bday, total, cash, acct, charges, slots)
            if not bk:
                continue
            await demands_for(bk)
            bk = await db.bookings.find_one({"id": bk["id"]}, {"_id": 0})
            for i, (cat, amt, mode) in enumerate(pays):
                await pay(bk, bday + timedelta(days=5 + i * 20), amt, cat, mode)
            if charges and bk["other_charges"] and bk["other_charges"][0].get("demanded_at"):
                line = bk["other_charges"][0]
                await pay(bk, bday + timedelta(days=7), line["total_paise"] / 200, None, "UPI", against="OTHER_CHARGE", line_id=line["line_id"])
            if special == "chq_pending":
                await pay(bk, date.today() - timedelta(days=2), 500000, "Account", "CHEQUE", status="Pending")
            if special == "bounced":
                p = await pay(bk, bday + timedelta(days=40), 400000, "Cash", "CHEQUE", status="Pending")
                await db.payments.update_one({"id": p["id"]}, {"$set": {"status": "Bounced", "bounced_at": _ts(bday + timedelta(days=45)), "bounce_reason": "Insufficient funds"}})
            if special == "reversal":
                p = await pay(bk, bday + timedelta(days=50), 250000, "Cash", "CASH")
                rts = _ts(bday + timedelta(days=51), 11)
                await db.payments.update_one({"id": p["id"]}, {"$set": {"status": "Reversed", "receipt_cancelled": True, "reversal": {"reason": "Posted against wrong booking", "at": rts, "by": accounts["id"], "by_name": accounts["name"]}}})
            if special == "revision":
                b = await db.bookings.find_one({"id": bk["id"]}, {"_id": 0})
                rev = {"id": new_id(), "at": _ts(bday + timedelta(days=30), 15), "by": admin["id"], "by_name": admin["name"], "reason": "Customer opted for higher bank loan component",
                       "before": {"cash_agreed_paise": b["cash_agreed_paise"], "account_agreed_paise": b["account_agreed_paise"], "agreement_value_paise": b["agreement_value_paise"]},
                       "after": {"cash_agreed_paise": to_paise(1300000), "account_agreed_paise": to_paise(3500000), "agreement_value_paise": to_paise(4800000)}}
                await db.bookings.update_one({"id": bk["id"]}, {"$set": {"cash_agreed_paise": to_paise(1300000), "account_agreed_paise": to_paise(3500000)}, "$push": {"agreement_revisions": rev}})
            if special == "cancelled":
                cts_ = _ts(bday + timedelta(days=60), 16)
                await db.bookings.update_one({"id": bk["id"]}, {"$set": {"status": "Cancelled", "cancellation": {"at": cts_, "by": admin["id"], "by_name": admin["name"], "reason": "Customer relocated abroad", "refund_paise": to_paise(1400000), "deduction_paise": to_paise(100000)}}})
                await db.flats.update_one({"id": bk["flat_id"]}, {"$set": {"status": "Available", "booking_id": None}})
                await db.parking_slots.update_many({"booking_id": bk["id"]}, {"$set": {"status": "Available", "booking_id": None, "customer_id": None}})
                await db.demands.update_many({"booking_id": bk["id"], "status": {"$ne": "Paid"}}, {"$set": {"status": "Cancelled"}})
            await rebuild(bk["id"])
        # contra entry so roznamcha shows a deposit
        await db.contra_entries.insert_one({**base_doc(None, cid), "date": date(2025, 11, 5).isoformat(), "kind": "DEPOSIT", "amount_paise": to_paise(500000), "bank_account_id": bank["id"], "bank_name": bank["bank_name"], "remarks": "Cash deposited at SBI Boring Road", "by_name": accounts["name"]})

    await recompute_all()
    await db.settings.update_one({"key": "seed_phase2_done"}, {"$set": {"value": True}}, upsert=True)
    logger.info("Phase 2 seed complete")
