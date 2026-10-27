"""Phase J1: 1M+ synthetic perf fixture in a SEPARATE DB (default kkt_scale). Direct bulk inserts are allowed here ONLY because it is a perf fixture;
validators (services.validators + services.invariants) are applied to the target DB first so every inserted doc must pass them, and an integrity sample runs at the end.
Shapes are cloned from template docs in the source DB (DB_NAME) so they match the app exactly; masters (company, users, roles, catalogue, modes, banks, plans) are copied verbatim.
Usage: python tools/scale_seed.py [--target kkt_scale] [--scale 1.0] [--drop]"""
import argparse
import asyncio
import json
import os
import random
import sys
import time
import uuid
from datetime import date, datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
from pymongo import MongoClient  # noqa: E402

R = random.Random(42)
SRC = os.environ["DB_NAME"]
MASTERS = ["companies", "users", "roles", "catalogue_items", "payment_modes", "bank_accounts", "flat_types", "block_types", "milestone_templates", "payment_plans", "payment_plan_assignments",
           "charge_types", "settings", "amenities", "rate_cards", "counters", "permissions", "user_direct_permissions"]
TARGETS = {"projects": 25, "blocks": 300, "flats": 60_000, "customers": 40_000, "bookings": 30_000, "payments": 1_000_000, "demands": 600_000, "ledger_entries": 2_000_000,
           "audit_logs": 3_000_000, "leads": 100_000, "service_tickets": 50_000, "documents": 200_000}
CITIES = ["Patna", "Ranchi", "Gaya", "Muzaffarpur", "Bhagalpur", "Darbhanga", "Hajipur", "Ara"]
FIRST = ["Amit", "Priya", "Rahul", "Sneha", "Vikas", "Anjali", "Rohit", "Neha", "Suresh", "Kavita", "Manoj", "Pooja", "Deepak", "Ritu", "Sanjay", "Meena"]
LAST = ["Kumar", "Singh", "Sinha", "Verma", "Yadav", "Jha", "Mishra", "Thakur", "Prasad", "Gupta", "Pandey", "Das"]


def iso(d):
    return d.isoformat()


def ts(d):
    return datetime(d.year, d.month, d.day, 5, 0, tzinfo=timezone.utc).isoformat()


def clone(tpl: dict, **over):
    doc = {**tpl, "id": str(uuid.uuid4()), **over}
    doc.pop("_id", None)
    return doc


def bulk(coll, docs, batch=20_000):
    n = 0
    for i in range(0, len(docs), batch):
        coll.insert_many(docs[i:i + batch], ordered=False)
        n += len(docs[i:i + batch])
    return n


async def apply_rules(target):
    os.environ["DB_NAME"] = target
    import importlib

    import db as dbmod
    importlib.reload(dbmod)
    from services import invariants, validators
    importlib.reload(validators)
    importlib.reload(invariants)
    await dbmod.ensure_indexes()
    await validators.apply_validators()
    await invariants.ensure_invariants()


def main(target: str, scale: float, drop: bool):
    t0 = time.time()
    cli = MongoClient(os.environ["MONGO_URL"])
    src, dst = cli[SRC], cli[target]
    if drop:
        cli.drop_database(target)
    for m in MASTERS:
        docs = list(src[m].find({}, {"_id": 0}))
        if docs and dst[m].estimated_document_count() == 0:
            dst[m].insert_many(docs, ordered=False)
    print(f"[masters copied] {round(time.time() - t0)}s", flush=True)
    asyncio.run(apply_rules(target))
    print(f"[validators + invariants applied on {target}] {round(time.time() - t0)}s", flush=True)
    T = {k: max(2, int(v * scale)) for k, v in TARGETS.items()}
    tpl = {c: src[c].find_one({}, {"_id": 0}) for c in TARGETS}
    company = src.companies.find_one({}, {"_id": 0})
    cid = company["id"]
    users = [u["id"] for u in src.users.find({}, {"id": 1})]
    fts = list(src.flat_types.find({}, {"_id": 0}))
    plan_snap = tpl["bookings"].get("payment_plan_snapshot")
    today = date(2026, 10, 26)

    # projects / blocks / flats
    projects = [clone(tpl["projects"], name=f"Scale {CITIES[i % 8]} {i + 1}", code=f"S{i + 1:02d}", block_count=T["blocks"] // T["projects"], unit_counts={}, cover_image_url=None) for i in range(T["projects"])]
    bulk(dst.projects, projects)
    blocks = []
    for i in range(T["blocks"]):
        p = projects[i % len(projects)]
        blocks.append(clone(tpl["blocks"], project_id=p["id"], name=f"Tower {i + 1}", code=f"T{i + 1}", floors=20, flats_per_floor=10, unit_counts={}))
    bulk(dst.blocks, blocks)
    flats = []
    per_block = T["flats"] // len(blocks)
    for b in blocks:
        for k in range(per_block):
            ft = fts[k % len(fts)] if fts else {}
            floor = k // 10 + 1
            rate = R.choice([3800, 4200, 4600, 5100])
            sb = R.choice([950, 1100, 1450, 1650])
            flats.append(clone(tpl["flats"], project_id=b["project_id"], block_id=b["id"], flat_type_id=ft.get("id", tpl["flats"]["flat_type_id"]), flat_type_code=ft.get("code", "2BHK"),
                               flat_number=f"{b['code']}-{floor}{k % 10 + 1:02d}", floor=floor, floor_label=str(floor), position=k % 10 + 1, status="Available", super_builtup_sqft=sb, rate_per_sqft=rate, price_paise=sb * rate * 100))
    bulk(dst.flats, flats)
    print(f"[projects/blocks/flats] {len(projects)}/{len(blocks)}/{len(flats)} {round(time.time() - t0)}s", flush=True)

    customers = []
    for i in range(T["customers"]):
        d0 = today - timedelta(days=R.randint(30, 900))
        customers.append(clone(tpl["customers"], full_name=f"{R.choice(FIRST)} {R.choice(LAST)}", phone=f"+919{i:09d}"[:13], email=f"scale{i}@example.com", customer_code=f"CUST-S-{i + 1:06d}",
                               created_at=ts(d0), updated_at=ts(d0), pan=None, pan_hash=None, aadhaar=None, assigned_sales_user_id=R.choice(users), kyc_status=R.choice(["Verified", "Pending", "Verified"])))
    bulk(dst.customers, customers)
    print(f"[customers] {len(customers)} {round(time.time() - t0)}s", flush=True)

    # bookings: one Active per flat (unique partial index), cash+account == agreement
    bookings, payments, demands, ledger = [], [], [], []
    pay_per = max(1, T["payments"] // T["bookings"])
    dem_per = max(1, T["demands"] // T["bookings"])
    pay_tpl, dem_tpl, led_tpl = tpl["payments"], tpl["demands"], tpl["ledger_entries"]
    mode_ids = [m for m in src.payment_modes.find({}, {"_id": 0, "id": 1, "name": 1, "code": 1})]
    seq = 0
    rcpt = 0
    for i in range(T["bookings"]):
        f = flats[i]
        c = customers[i % len(customers)]
        b = next(x for x in blocks if x["id"] == f["block_id"]) if i < 50 else blocks[(i // per_block) % len(blocks)]
        p = next(x for x in projects if x["id"] == b["project_id"])
        agv = f["price_paise"]
        cash = agv * 60 // 100
        bd = today - timedelta(days=R.randint(10, 700))
        bk = clone(tpl["bookings"], booking_number=f"BK-S-{i + 1:06d}", project_id=p["id"], project_code=p["code"], project_name=p["name"], block_id=b["id"], block_code=b["code"], block_name=b["name"],
                   flat_id=f["id"], customer_id=c["id"], customer_name=c["full_name"], customer_code=c["customer_code"], customer_phone=c["phone"], booking_date=iso(bd), agreement_value_paise=agv,
                   cash_agreed_paise=cash, account_agreed_paise=agv - cash, status="Active", created_at=ts(bd), updated_at=ts(bd), payment_plan_snapshot=plan_snap, version=1)
        f["status"] = "Booked"
        bookings.append(bk)
        raised_c = raised_a = paid_c = paid_a = 0
        for k in range(dem_per):
            pc = cash // dem_per
            pa = (agv - cash) // dem_per
            raised_c += pc
            raised_a += pa
            dd = bd + timedelta(days=30 * k)
            seq += 1
            demands.append(clone(dem_tpl, booking_id=bk["id"], customer_id=c["id"], project_id=p["id"], block_id=b["id"], flat_id=f["id"], demand_number=f"DM-S-{seq:07d}", installment_seq=k + 1,
                                 installment_name=f"Installment {k + 1}", cash_demand_paise=pc, account_demand_paise=pa, total_demand_paise=pc + pa, demand_date=iso(dd), due_date=iso(dd + timedelta(days=15)),
                                 status="Paid" if k < dem_per - 1 else "Open", paid_paise=(pc + pa) if k < dem_per - 1 else 0, voided=False, posted_at=ts(dd), created_at=ts(dd)))
            ledger.append(clone(led_tpl, booking_id=bk["id"], seq=2 * k + 1, at=ts(dd), date=iso(dd), type="DEMAND", amount_paise=pc + pa, udhar_paise=pc + pa, jama_paise=0, ref=f"DM-S-{seq:07d}",
                                cash_order_raised_paise=raised_c, account_order_raised_paise=raised_a, udhar_cash_paise=pc, udhar_account_paise=pa, balance_paise=raised_c + raised_a - paid_c - paid_a))
        for k in range(pay_per):
            cat = "Cash" if k % 2 == 0 else "Account"
            cap = cash if cat == "Cash" else agv - cash
            amt = max(1, min(cap // pay_per, cap - (paid_c if cat == "Cash" else paid_a)))
            if amt <= 0:
                continue
            if cat == "Cash":
                paid_c += amt
            else:
                paid_a += amt
            pd_ = bd + timedelta(days=30 * k + 5)
            m = mode_ids[k % len(mode_ids)]
            payments.append(clone(pay_tpl, receipt_number=f"KKT/S/{(rcpt := rcpt + 1):08d}", booking_id=bk["id"], booking_number=bk["booking_number"], customer_id=c["id"], customer_name=c["full_name"],
                                  project_id=p["id"], project_code=p["code"], block_id=b["id"], block_code=b["code"], flat_id=f["id"], flat_number=f["flat_number"], against="FLAT_VALUE", payment_category=cat,
                                  amount_paise=amt, payment_date=iso(pd_), cleared_at=ts(pd_), status="Cleared", payment_mode_id=m["id"], payment_mode_name=m.get("name"), payment_mode_code=m.get("code"),
                                  idempotency_key=str(uuid.uuid4()), created_at=ts(pd_), updated_at=ts(pd_), version=1))
            ledger.append(clone(led_tpl, booking_id=bk["id"], seq=2 * dem_per + k + 1, at=ts(pd_), date=iso(pd_), type="PAYMENT", category=cat, amount_paise=amt, udhar_paise=0, jama_paise=amt,
                                ref=payments[-1]["receipt_number"], cash_paid_cum_paise=paid_c, account_paid_cum_paise=paid_a, mode=m.get("name"), balance_paise=raised_c + raised_a - paid_c - paid_a))
        bk["summary"] = {"cash_paid_paise": paid_c, "account_paid_paise": paid_a, "outstanding_paise": max(0, raised_c - paid_c) + max(0, raised_a - paid_a), "advance_paise": max(0, paid_c - raised_c) + max(0, paid_a - raised_a),
                         "net_balance_paise": raised_c + raised_a - paid_c - paid_a, "balance_paise": raised_c + raised_a - paid_c - paid_a}
        if len(payments) >= 200_000:
            bulk(dst.payments, payments); payments.clear()
            bulk(dst.demands, demands); demands.clear()
            bulk(dst.ledger_entries, ledger); ledger.clear()
            print(f"  … bookings {i + 1} {round(time.time() - t0)}s", flush=True)
    bulk(dst.bookings, bookings)
    bulk(dst.payments, payments); bulk(dst.demands, demands); bulk(dst.ledger_entries, ledger)
    dst.flats.update_many({"id": {"$in": [b["flat_id"] for b in bookings]}}, {"$set": {"status": "Booked"}})
    print(f"[bookings/payments/demands/ledger] {len(bookings)} {round(time.time() - t0)}s", flush=True)

    # audit logs: 3M mostly payment.post / booking.update
    a_tpl = tpl["audit_logs"]
    buf = []
    actions = ["payment.post", "booking.update", "customer.update", "demand.raise", "lead.update", "flat.status"]
    for i in range(T["audit_logs"]):
        bk = bookings[i % len(bookings)]
        d0 = today - timedelta(days=R.randint(0, 700))
        buf.append(clone(a_tpl, company_id=cid, actor_id=R.choice(users), actor_name="Scale User", action=actions[i % len(actions)], entity_type="booking", entity_id=bk["id"], before=None,
                         after={"k": i}, changed_fields=["k"], created_at=ts(d0), propagated={"legacy": ts(d0)}, propagated_complete=True))
        if len(buf) >= 200_000:
            bulk(dst.audit_logs, buf); buf.clear()
            print(f"  … audit {i + 1} {round(time.time() - t0)}s", flush=True)
    bulk(dst.audit_logs, buf); buf.clear()

    l_tpl = tpl["leads"]
    leads = [clone(l_tpl, name=f"{R.choice(FIRST)} {R.choice(LAST)}", phone=f"+918{i:09d}"[:13], project_id=projects[i % len(projects)]["id"], lead_number=f"LD-S-{i + 1:06d}",
                   status=R.choice(["New", "Contacted", "Site Visit", "Negotiation", "Lost", "Converted"]), assigned_to=R.choice(users), stage_history=[], follow_ups=[], activities=[], converted_customer_id=None, booking_id=None,
                   created_at=ts(today - timedelta(days=R.randint(0, 600)))) for i in range(T["leads"])]
    bulk(dst.leads, leads)
    tickets = [{"id": str(uuid.uuid4()), "company_id": cid, "ticket_number": f"SR-S-{i + 1:06d}", "booking_id": bookings[i % len(bookings)]["id"], "customer_id": bookings[i % len(bookings)]["customer_id"],
                "project_id": bookings[i % len(bookings)]["project_id"], "category": R.choice(["Plumbing", "Electrical", "Civil", "Documentation"]), "priority": R.choice(["Low", "Medium", "High"]),
                "status": R.choice(["Open", "In Progress", "Resolved", "Closed"]), "title": f"Issue {i + 1}", "created_at": ts(today - timedelta(days=R.randint(0, 400))), "version": 1, "is_active": True} for i in range(T["service_tickets"])]
    bulk(dst.service_tickets, tickets)
    docs = [{"id": str(uuid.uuid4()), "company_id": cid, "entity_type": "booking", "entity_id": bookings[i % len(bookings)]["id"], "project_id": bookings[i % len(bookings)]["project_id"], "kind": R.choice(["KYC", "Agreement", "Receipt", "Photo"]),
             "filename": f"doc-{i}.pdf", "content_type": "application/pdf", "size_bytes": R.randint(20_000, 5_000_000), "storage_key": f"scale/{i // 1000}/{uuid.uuid4().hex}.pdf", "sha256": uuid.uuid4().hex * 2,
             "legal_hold": i % 500 == 0, "retention_until": None, "created_at": ts(today - timedelta(days=R.randint(0, 700))), "created_by": R.choice(users), "version": 1} for i in range(T["documents"])]
    bulk(dst.documents, docs)
    print(f"[audit/leads/tickets/documents] {round(time.time() - t0)}s", flush=True)

    # integrity sampling: 200 random bookings → Σdemands == Σledger DEMAND, Σpayments == Σledger RECEIPT, summary matches
    bad = 0
    for bk in R.sample(bookings, min(200, len(bookings))):
        sd = sum(d["total_demand_paise"] for d in dst.demands.find({"booking_id": bk["id"], "voided": False}, {"total_demand_paise": 1}))
        sl = sum(l["amount_paise"] for l in dst.ledger_entries.find({"booking_id": bk["id"], "type": "DEMAND"}, {"amount_paise": 1}))
        sp = sum(p["amount_paise"] for p in dst.payments.find({"booking_id": bk["id"], "status": "Cleared"}, {"amount_paise": 1}))
        sr = sum(l["amount_paise"] for l in dst.ledger_entries.find({"booking_id": bk["id"], "type": "PAYMENT"}, {"amount_paise": 1}))
        if sd != sl or sp != sr or bk["summary"]["net_balance_paise"] != sd - sp:
            bad += 1
    stats = {c: {"count": dst[c].estimated_document_count(), "size_mb": round(dst.command("collStats", c)["size"] / 1048576, 1), "storage_mb": round(dst.command("collStats", c)["storageSize"] / 1048576, 1)} for c in TARGETS}
    total_mb = round(dst.command("dbStats")["storageSize"] / 1048576, 1)
    out = {"target": target, "scale": scale, "build_s": round(time.time() - t0), "integrity_sample": {"checked": min(200, len(bookings)), "mismatches": bad}, "db_storage_mb": total_mb, "collections": stats}
    os.makedirs("/app/memory/qa/scale", exist_ok=True)
    json.dump(out, open("/app/memory/qa/scale/seed_report.json", "w"), indent=2)
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", default="kkt_scale")
    ap.add_argument("--scale", type=float, default=1.0)
    ap.add_argument("--drop", action="store_true")
    a = ap.parse_args()
    assert a.target not in (SRC, "kkt_test"), "never seed the preview/test DB"
    main(a.target, a.scale, a.drop)
