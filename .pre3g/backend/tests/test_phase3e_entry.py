"""Phase 3E Part 2 (REQ-218…232): missing entry screens' server rules — signed date, un-void, Roznamcha undo by
reversal, customer deactivate / merge / PAN check, visit outcome + per-weekday slots, front-desk service request."""

import uuid
from datetime import date, timedelta

from tests.conftest import BASE
from tools.connection_matrix import Api, World


def _api(h):
    return Api(BASE, h)


def test_agreement_signed_date_rules(admin_headers):
    api = _api(admin_headers)
    w = World(api)
    c = w.book()
    future = (date.fromisoformat(w.today) + timedelta(days=2)).isoformat()
    r = api.call("POST", f"/bookings/{c['bid']}/agreement-signed", {"signed_on": future}, ok=(422,))
    assert "future" in r.json()["detail"].lower() or "future" in r.text.lower()
    early = (date.fromisoformat(w.today) - timedelta(days=400)).isoformat()
    api.call("POST", f"/bookings/{c['bid']}/agreement-signed", {"signed_on": early}, ok=(422,))
    api.post(f"/bookings/{c['bid']}/agreement-signed", {"mode": "Email", "signed_on": w.today})
    assert api.get(f"/bookings/{c['bid']}")["plan_acceptance"]["accepted_on"] == w.today
    # re-marking is refused (409) and never overwrites; the date changes only via "Correct signed date"
    r = api.call("POST", f"/bookings/{c['bid']}/agreement-signed", {"signed_on": w.today}, ok=(409,))
    assert r.json()["code"] == "ALREADY_SIGNED"
    bdate = api.get(f"/bookings/{c['bid']}")["booking_date"][:10]
    api.call("POST", f"/bookings/{c['bid']}/agreement-signed/correct", {"signed_on": bdate}, ok=(422,))  # no reason
    acc = api.post(f"/bookings/{c['bid']}/agreement-signed/correct", {"signed_on": bdate, "reason": "QA typo in date"})[
        "plan_acceptance"
    ]
    assert acc["accepted_on"] == bdate and acc["correction_reason"] == "QA typo in date" and acc["marked_at"]
    rules = api.get(f"/bookings/{c['bid']}/actions")["actions"]
    assert rules["correct_signed"] is None


def test_unvoid_manual_bill_restores_with_reason_and_audit(admin_headers):
    api = _api(admin_headers)
    w = World(api)
    c = w.book()
    bal0 = api.get(f"/bookings/{c['bid']}")["summary"]["balance"]
    d = api.post(
        "/demands/manual",
        {"booking_id": c["bid"], "name": "QA 3E manual", "cash_amount": 1000, "due_date": w.today},
    )
    did = d.get("id") or d["demand"]["id"]
    api.post(f"/demands/{did}/void", {"reason": "QA wrong amount"})
    api.call("POST", f"/demands/{did}/unvoid", {"reason": "x"}, ok=(422,))
    r = api.post(f"/demands/{did}/unvoid", {"reason": "QA voided by mistake"})
    assert r["udhar_delta_paise"] == 100000
    assert api.get(f"/bookings/{c['bid']}")["summary"]["balance"] == bal0 + 1000
    api.call("POST", f"/demands/{did}/unvoid", {"reason": "again"}, ok=(409,))
    acts = [a["action"] for a in api.get("/audit-logs", entity_type="demand", entity_id=did)["items"]]
    assert "demand.unvoid" in acts


def test_roznamcha_contra_undo_posts_reversal_and_nets_zero(admin_headers):
    api = _api(admin_headers)
    w = World(api)
    before = api.get("/roznamcha", date=w.today)
    c = api.post(
        "/roznamcha/contra",
        {"date": w.today, "kind": "WITHDRAWAL", "amount": 777, "bank_account_id": w.bank["id"], "remarks": "QA 3E"},
    )
    rev = api.post(f"/roznamcha/contra/{c['id']}/undo", {"reason": "QA posted twice"})
    assert rev["amount_paise"] == -77700 and rev["reverses_id"] == c["id"]
    api.call("POST", f"/roznamcha/contra/{c['id']}/undo", {"reason": "again"}, ok=(409,))
    api.call("POST", f"/roznamcha/contra/{rev['id']}/undo", {"reason": "again"}, ok=(409,))
    after = api.get("/roznamcha", date=w.today)
    ids = {x["id"] for x in after["contra"]}
    assert {c["id"], rev["id"]} <= ids
    for b in (before, after):
        assert (
            b["opening_cash_paise"] + b["cash_received_paise"] + b["cash_withdrawals_paise"] - b["cash_paid_out_paise"]
            == b["closing_cash_paise"]
        )


def test_customer_deactivate_blocked_with_live_booking_then_merge_keeps_money(admin_headers):
    api = _api(admin_headers)
    w = World(api)
    c = w.book()
    r = api.call("POST", f"/customers/{c['cid']}/deactivate", {"reason": "QA dup"}, ok=(409,))
    assert "live booking" in r.text
    tag = uuid.uuid4().hex[:6]
    a = api.post("/customers", {"full_name": f"QA 3E Keep {tag}", "phone": f"+9197{int(tag, 16) % 10**8:08d}"})
    b = api.post("/customers", {"full_name": f"QA 3E Dup {tag}", "phone": f"+9196{int(tag, 16) % 10**8:08d}"})
    api.post(f"/customers/{b['id']}/deactivate", {"reason": "QA test"})
    assert api.get(f"/customers/{b['id']}")["is_active"] is False
    api.post(f"/customers/{b['id']}/reactivate")
    bk = w.book(cust=b)
    m = api.post("/customers/merge", {"survivor_id": a["id"], "merged_id": b["id"], "reason": "QA duplicate"})
    assert m["identical"] and m["moved"]["bookings.customer_id"] == 1
    assert api.get(f"/bookings/{bk['bid']}")["customer_id"] == a["id"]
    gone = api.get(f"/customers/{b['id']}")
    assert gone["merged_into"] == a["id"] and gone["is_active"] is False
    api.call("POST", f"/customers/{b['id']}/reactivate", ok=(409,))


def test_check_duplicate_phone(admin_headers):
    api = _api(admin_headers)
    tag = uuid.uuid4().hex[:6]
    phone = f"+9195{int(tag, 16) % 10**8:08d}"
    a = api.post("/customers", {"full_name": f"QA 3E Pan {tag}", "phone": phone})
    assert api.get("/customers/check-duplicate", phone=phone)["phone"]["id"] == a["id"]
    assert api.get("/customers/check-duplicate", phone=phone, exclude_id=a["id"])["phone"] is None


def test_day_cfg_overrides_and_holidays():
    from routers.visits import day_cfg

    cfg = {"start_time": "10:00", "end_time": "18:00", "slot_minutes": 60, "capacity_per_slot": 3}
    cfg["day_slots"] = {"0": {"start_time": "11:00", "capacity_per_slot": 1}}
    mon, tue = date(2026, 11, 16), date(2026, 11, 17)
    assert day_cfg(cfg, mon)["start_time"] == "11:00" and day_cfg(cfg, mon)["capacity_per_slot"] == 1
    assert day_cfg(cfg, mon)["end_time"] == "18:00"
    assert day_cfg(cfg, tue)["start_time"] == "10:00"


def test_front_desk_service_request_with_assignee(admin_headers):
    api = _api(admin_headers)
    w = World(api)
    c = w.book()
    cat = api.get("/service-requests/categories")["items"][0]["name"]
    me = api.get("/auth/me")
    sr = api.post(
        "/service-requests",
        {
            "customer_id": c["cid"],
            "booking_id": c["bid"],
            "category": cat,
            "priority": "High",
            "subject": "QA 3E leaking tap",
            "description": "QA front desk",
            "assigned_to": me["id"],
        },
    )
    assert sr["assigned_to"] == me["id"]
    other = w.customer()
    api.call(
        "POST",
        "/service-requests",
        {"customer_id": other["id"], "booking_id": c["bid"], "category": cat, "subject": "QA x", "description": "QA x"},
        ok=(422,),
    )


def _merge_pair(api, w):
    tag = uuid.uuid4().hex[:6]
    a = api.post("/customers", {"full_name": f"QA 3E MA {tag}", "phone": f"+9193{int(tag, 16) % 10**8:08d}"})
    b = api.post("/customers", {"full_name": f"QA 3E MB {tag}", "phone": f"+9192{int(tag, 16) % 10**8:08d}"})
    bk = w.book(cust=b)
    return a, b, bk


def _snapshot(api, a, b):
    def one(c):
        x = api.get(f"/customers/{c['id']}")
        bks = api.get("/bookings", customer_id=c["id"], page_size=50)["items"]
        return (x.get("is_active"), x.get("merged_into"), sorted(k["id"] for k in bks))

    return one(a), one(b)


def test_merge_crash_midway_rolls_back_exactly_or_resumes(admin_headers):
    import asyncio
    import os

    from motor.motor_asyncio import AsyncIOMotorClient

    from services import customer_merge as cm

    api = _api(admin_headers)
    w = World(api)
    a, b, bk = _merge_pair(api, w)
    before = _snapshot(api, a, b)
    me = api.get("/auth/me")

    async def crash_then():
        cl = AsyncIOMotorClient(os.environ["MONGO_URL"])
        d = cl[os.environ["DB_NAME"]]
        keep = await d.customers.find_one({"id": a["id"]}, {"_id": 0})
        gone = await d.customers.find_one({"id": b["id"]}, {"_id": 0})
        j = await cm.plan(keep, gone, {"id": me["id"], "company_id": keep["company_id"]}, "QA crash", d)
        assert len(j["steps"]) >= 2
        try:
            await cm.apply(j, d, fail_after=1)
        except RuntimeError:
            pass
        j = await d.customer_merges.find_one({"id": j["id"]}, {"_id": 0})
        assert j["status"] == "applying" and j["steps"][0]["done"] and not j["steps"][1]["done"]
        cl.close()
        return j["id"]

    mid = asyncio.run(crash_then())
    api.call("POST", "/customers/merge", {"survivor_id": a["id"], "merged_id": b["id"], "reason": "QA dup"}, ok=(409,))
    assert api.post(f"/customers/merges/{mid}/rollback")["status"] == "rolled_back"
    assert _snapshot(api, a, b) == before
    mid = asyncio.run(crash_then())
    r = api.post(f"/customers/merges/{mid}/resume")
    assert r["identical"] and r["survivor"]["customer_code"] == a["customer_code"]
    assert api.get(f"/bookings/{bk['bid']}")["customer_id"] == a["id"]
    hits = api.get("/customers", search=b["customer_code"])["items"]
    assert [h["id"] for h in hits] == [a["id"]]


def test_merge_blocked_by_two_verified_pans(admin_headers):
    import os

    import pymongo

    api = _api(admin_headers)
    tag = uuid.uuid4().hex[:6]
    a = api.post("/customers", {"full_name": f"QA 3E PA {tag}", "phone": f"+9191{int(tag, 16) % 10**8:08d}"})
    b = api.post("/customers", {"full_name": f"QA 3E PB {tag}", "phone": f"+9190{int(tag, 16) % 10**8:08d}"})
    d = pymongo.MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    d.customers.update_one({"id": a["id"]}, {"$set": {"pan_hash": "qa-h1", "kyc_status": "Verified"}})
    d.customers.update_one({"id": b["id"]}, {"$set": {"pan_hash": "qa-h2", "kyc_status": "Verified"}})
    r = api.call(
        "POST", "/customers/merge", {"survivor_id": a["id"], "merged_id": b["id"], "reason": "QA dup"}, ok=(409,)
    )
    assert r.json()["code"] == "KYC_CONFLICT"


def _money_view(api, bid):
    b = api.get(f"/bookings/{bid}")
    L = api.get(f"/bookings/{bid}/ledger")
    keep = ("agreement_value_paise", "cash_agreed_paise", "account_agreed_paise", "summary", "other_charges")
    out = {k: b.get(k) for k in keep}
    for line in out["other_charges"] or []:
        line.pop("parts", None)
    led = {k: v for k, v in L.items() if k not in ("generated_at", "booking")}
    for r in led.get("rows") or []:
        r.pop("id", None)  # ledger rows are rebuilt with new ids; the money in them must be identical
    return out, led, {k: L["booking"].get(k) for k in keep if k in L["booking"]}


def test_discount_snapshot_reason_rule_and_zero_money_effect(admin_headers):
    import os

    import pymongo

    api = _api(admin_headers)
    w = World(api)
    flat, cust = w.flat(), w.customer()
    agreed = round(flat["price"] - 50000, 2)
    body = {
        "flat_id": flat["id"],
        "customer_id": cust["id"],
        "booking_date": w.today,
        "agreement_value": agreed,
        "cash_agreed": round(agreed * 0.2, 2),
        "account_agreed": round(agreed - round(agreed * 0.2, 2), 2),
    }
    r = api.call("POST", "/bookings", body, ok=(422,))
    assert "discount reason" in r.text.lower()
    bk = api.post("/bookings", {**body, "discount_reason": "QA festival offer"})
    d = api.get(f"/bookings/{bk['id']}")["discount"]
    assert d["amount_paise"] == 5000000 and d["reason"] == "QA festival offer"
    assert d["list_paise"] == round(flat["price"] * 100) and d["percent"] > 0
    before = _money_view(api, bk["id"])
    db = pymongo.MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    db.bookings.update_one({"id": bk["id"]}, {"$unset": {"discount": "", "discount_events": ""}})
    api.post(f"/bookings/{bk['id']}/recompute", {})
    assert _money_view(api, bk["id"]) == before  # the discount record has zero money effect
    reg = api.get("/reports/discount-register", group_by="booking", from_date=w.today, to_date=w.today)
    assert reg["formula"] == "list − agreed = discount" and "discount_paise" in reg["totals"]
