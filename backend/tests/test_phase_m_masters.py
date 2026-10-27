"""Phase M: Stage master → named Stage Plan → project+tower Payment Plan (% rows) → booking → Construction update raises Udhar; Jama via receipt; Undo voids. Two-sided ledger law."""
import uuid

import pytest
import requests

from tests.conftest import BASE as ROOT, session_token

BASE = f"{ROOT}/api"


def _get(h, p, **q):
    r = requests.get(f"{BASE}{p}", headers=h, params=q, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def admin():
    return {"Authorization": f"Bearer {session_token('admin@kkt.in', 'Kkt@12345')}"}


@pytest.fixture(scope="module")
def ctx(admin):
    projects = _get(admin, "/projects", page_size=50)["items"]
    proj = projects[0]
    ft = _get(admin, "/master/flat-types", page_size=50)["items"][0]
    code = f"P{uuid.uuid4().hex[:2].upper()}"
    tower = requests.post(f"{BASE}/blocks", headers=admin, json={"project_id": proj["id"], "block_type_id": _get(admin, "/master/block-types", page_size=50)["items"][0]["id"], "name": f"PM-{code}", "code": code, "floors": 2, "flats_per_floor": 2, "floor_start": 1,
                                                                 "numbering_pattern": "{block}-{floor}{pos2}", "position_flat_types": [{"position": 1, "flat_type_id": ft["id"]}, {"position": 2, "flat_type_id": ft["id"]}], "rate_per_sqft": 4000, "floor_rise_per_sqft": 50}, timeout=60)
    assert tower.status_code == 201, tower.text
    return {"admin": admin, "project": proj, "tower": tower.json()}


def test_stage_master_quick_add_and_booking_pseudo_stage(ctx):
    h = ctx["admin"]
    r = requests.post(f"{BASE}/master/construction-stages", headers=h, json={"name": f"Basement {uuid.uuid4().hex[:3]}", "code": f"BSM{uuid.uuid4().hex[:3].upper()}", "seq_hint": 15}, timeout=30)
    assert r.status_code == 201, r.text
    ctx["basement"] = r.json()
    _get(h, "/stage-plans")  # ensures the Booking pseudo-stage
    stages = _get(h, "/master/construction-stages", page_size=100)["items"]
    booking = next(s for s in stages if s["code"] == "BOOKING")
    assert booking["auto_complete_on_booking"] is True
    ctx["stages"] = stages
    ctx["booking_stage"] = booking


def test_stage_plan_create_sets_tower_sequence(ctx):
    h, st = ctx["admin"], ctx["stages"]
    names = {s["name"]: s for s in st}
    poss = next((s for s in st if s.get("is_possession")), None)
    pick = [ctx["booking_stage"]] + [s for s in st if s["code"] not in ("BOOKING",) and not s.get("is_possession")][:4] + ([poss] if poss else [])
    pick.insert(2, ctx["basement"])
    ids = []
    for s in pick:
        if s["id"] not in ids:
            ids.append(s["id"])
    body = {"name": "zed", "project_id": ctx["project"]["id"], "block_id": ctx["tower"]["id"], "stage_ids": ids}
    dup = requests.post(f"{BASE}/stage-plans", headers=h, json={**body, "stage_ids": ids + [ids[1]]}, timeout=30)
    assert dup.status_code == 422 and "twice" in dup.text
    r = requests.post(f"{BASE}/stage-plans", headers=h, json=body, timeout=30)
    assert r.status_code == 201, r.text
    ctx["sp"] = r.json()
    again = requests.post(f"{BASE}/stage-plans", headers=h, json={**body, "name": "zed2"}, timeout=30)
    assert again.status_code == 409 and again.json()["code"] == "STAGE_PLAN_EXISTS"
    cs = _get(h, f"/blocks/{ctx['tower']['id']}/construction")
    assert [s["stage_id"] for s in cs["stages"]] == ids
    assert all(s["status"] == "Pending" for s in cs["stages"])
    assert _get(h, f"/stage-plans/{ctx['sp']['id']}")["stages"][0]["name"] == "Booking"
    used = _get(h, f"/master/construction-stages/{ctx['basement']['id']}/where-used")
    assert used["count"] >= 1 and any(x["type"] == "stage_plan" for x in used["references"])


def test_payment_plan_validation_and_create(ctx):
    h, sp = ctx["admin"], ctx["sp"]
    ids = sp["stage_ids"]
    base = {"name": "Flexi 10x10", "project_id": ctx["project"]["id"], "block_id": ctx["tower"]["id"], "stage_plan_id": sp["id"]}
    rows95 = [{"stage_id": s, "percent": p} for s, p in zip(ids, [10, 20, 20, 20, 15, 10, 0][: len(ids)])]
    r = requests.post(f"{BASE}/payment-plans/structured", headers=h, json={**base, "rows": rows95}, timeout=30)
    assert r.status_code == 422 and "100.00%" in r.text, r.text
    r = requests.post(f"{BASE}/payment-plans/structured", headers=h, json={**base, "rows": rows95 + [{"stage_id": ids[1], "percent": 5}]}, timeout=30)
    assert r.status_code == 422 and "twice" in r.text
    rows95[-1]["percent"] += 5
    rows100 = rows95
    assert round(sum(x["percent"] for x in rows100), 2) == 100
    r = requests.post(f"{BASE}/payment-plans/structured", headers=h, json={**base, "rows": rows100}, timeout=30)
    assert r.status_code == 201, r.text
    plan = r.json()
    ctx["plan"] = plan
    assert plan["block_id"] == ctx["tower"]["id"] and plan["stage_plan_name"] == "zed"
    assert plan["installments"][0]["trigger_type"] == "ON_BOOKING"
    assert all(i["trigger_type"] == "ON_STAGE" and i["trigger_stage_id"] for i in plan["installments"][1:])
    r = requests.post(f"{BASE}/payment-plans/structured", headers=h, json={**base, "rows": rows100}, timeout=30)
    assert r.status_code == 409 and r.json()["code"] == "DUPLICATE_NAME"
    wiz = _get(h, f"/projects/{ctx['project']['id']}/blocks/{ctx['tower']['id']}/payment-plans")["items"]
    assert any(p["id"] == plan["id"] for p in wiz)
    assert all(p.get("block_id") in (None, ctx["tower"]["id"]) for p in wiz)
    # not offered on another tower
    other = next((b for b in _get(h, "/blocks", project_id=ctx["project"]["id"], page_size=50)["items"] if b["id"] != ctx["tower"]["id"]), None)
    if other:
        assert all(p["id"] != plan["id"] for p in _get(h, f"/projects/{ctx['project']['id']}/blocks/{other['id']}/payment-plans")["items"])


def test_stage_removal_blocked_when_referenced(ctx):
    h, sp = ctx["admin"], ctx["sp"]
    r = requests.patch(f"{BASE}/stage-plans/{sp['id']}", headers=h, json={"name": "zed", "project_id": sp["project_id"], "block_id": sp["block_id"], "stage_ids": sp["stage_ids"][:-1]}, timeout=30)
    assert r.status_code == 409 and r.json()["code"] == "STAGE_IN_USE", r.text
    r = requests.delete(f"{BASE}/stage-plans/{sp['id']}", headers=h, timeout=30)
    assert r.status_code == 409
    used = _get(h, f"/stage-plans/{sp['id']}/where-used")
    assert any(x["type"] == "payment_plan" for x in used["references"])


def _book(ctx):
    h = ctx["admin"]
    flats = _get(h, "/flats", block_id=ctx["tower"]["id"], status="Available", page_size=5)["items"]
    assert flats, "tower has no flats"
    cust = requests.post(f"{BASE}/customers", headers=h, json={"full_name": f"PM Buyer {uuid.uuid4().hex[:4]}", "phone": f"9{uuid.uuid4().int % 10**9:09d}"}, timeout=30)
    assert cust.status_code == 201, cust.text
    body = {"customer_id": cust.json()["id"], "flat_id": flats[0]["id"], "payment_plan_id": ctx["plan"]["id"], "agreement_value": 5_000_000, "cash_agreed": 2_500_000, "account_agreed": 2_500_000, "booking_date": "2026-10-20"}
    r = requests.post(f"{BASE}/bookings", headers={**h, "Idempotency-Key": str(uuid.uuid4())}, json=body, timeout=60)
    assert r.status_code == 201, r.text
    return r.json()


def test_owner_flow_udhar_jama_balance(ctx):
    h = ctx["admin"]
    b = _book(ctx)
    ctx["booking"] = b
    led = _get(h, f"/bookings/{b['id']}/ledger")
    rows = led["rows"]
    assert rows and rows[0]["type"] == "DEMAND" and rows[0]["udhar_paise"] > 0 and rows[0]["jama_paise"] == 0  # Booking row
    bal0 = rows[-1]["balance_paise"]
    # construction update: stage 2 (first real stage) — preview then confirm
    stage = _get(h, f"/blocks/{ctx['tower']['id']}/construction")["stages"][1]
    pv = _get(h, f"/blocks/{ctx['tower']['id']}/stages/{stage['stage_id']}/preview")
    assert pv["bookings_count"] >= 1 and pv["stage_plan_name"] == "zed" and pv["total_paise"] > 0
    mine = next(x for x in pv["bookings"] if x["booking_id"] == b["id"])
    pct = next(i["percent"] for i in ctx["plan"]["installments"] if i.get("trigger_stage_id") == stage["stage_id"])
    assert mine["total_paise"] == round(b["cash_agreed_paise"] * pct / 100) + round(b["account_agreed_paise"] * pct / 100)
    r = requests.post(f"{BASE}/blocks/{ctx['tower']['id']}/construction/stage", headers=h, json={"stage_id": stage["stage_id"], "completed_on": "2026-10-25"}, timeout=60)
    assert r.status_code == 200, r.text
    assert r.json()["demands_raised"] >= 1
    led = _get(h, f"/bookings/{b['id']}/ledger")
    dem = [x for x in led["rows"] if x["type"] == "DEMAND"]
    assert len(dem) == 2 and stage["name"] in dem[-1]["note"] and dem[-1]["udhar_paise"] == mine["total_paise"]
    assert led["rows"][-1]["balance_paise"] == bal0 + mine["total_paise"]
    # Jama: post a cash receipt
    modes = {m["code"]: m for m in _get(h, "/master/payment-modes", page_size=50)["items"]}
    r = requests.post(f"{BASE}/payments", headers={**h, "Idempotency-Key": str(uuid.uuid4())}, json={"booking_id": b["id"], "amount": 100_000, "payment_mode_id": modes["CASH"]["id"], "payment_category": "Cash", "payment_date": "2026-10-26"}, timeout=60)
    assert r.status_code == 201, r.text
    pay = r.json()
    led = _get(h, f"/bookings/{b['id']}/ledger")
    jama = [x for x in led["rows"] if x["type"] == "PAYMENT"]
    mine_j = next((x for x in jama if x.get("ref_id") == pay["id"] or x.get("payment_id") == pay["id"] or x.get("id") == pay["id"]), None) or next(x for x in jama if x["jama_paise"] == 1_00_000_00)
    assert mine_j["jama_paise"] == 1_00_000_00 and mine_j["mode"] == "Cash"
    s = led["booking"]["summary"]
    assert s["total_udhar_paise"] - s["total_jama_paise"] == s["balance_paise"] == s["outstanding_paise"] - s["advance_paise"]
    assert led["rows"][-1]["balance_paise"] == s["balance_paise"]
    # Undo → Udhar row voided, balance back
    r = requests.post(f"{BASE}/blocks/{ctx['tower']['id']}/construction/undo", headers=h, json={"reason": "phase M test undo"}, timeout=60)
    assert r.status_code == 200, r.text
    led = _get(h, f"/bookings/{b['id']}/ledger")
    assert len([x for x in led["rows"] if x["type"] == "DEMAND"]) == 1
    s = led["booking"]["summary"]
    assert s["total_udhar_paise"] == rows[0]["udhar_paise"] and s["balance_paise"] == s["outstanding_paise"] - s["advance_paise"]


def test_ledger_csv_has_two_sided_columns(ctx):
    r = requests.get(f"{BASE}/bookings/{ctx['booking']['id']}/ledger", headers=ctx["admin"], params={"format": "csv"}, timeout=30)
    assert r.status_code == 200
    head = r.text.splitlines()[0]
    for col in ("udhar", "jama", "mode", "balance"):
        assert col in head


def test_registry_has_phase_m_codes(admin):  # noqa: F811
    reg = _get(admin, "/admin/access/registry")
    codes = {r["code"] for r in reg["items"]}
    assert {"masters.stage_plan.view", "masters.stage_plan.create", "construction.update.view", "construction.update.complete", "construction.update.undo"} <= codes
    assert reg["unregistered"] == []
