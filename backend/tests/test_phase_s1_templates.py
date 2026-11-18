"""Phase S1 — templates: Floor/Tower/Stage/Payment templates, one-action tower creation, re-apply touches unbooked flats only, missing-stage 422, Plans read."""

import os
import re
import uuid

import requests

from tests.conftest import BASE

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _get(h, path):
    r = requests.get(f"{BASE}/api{path}", headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def _post(h, path, body, code=201):
    r = requests.post(f"{BASE}/api{path}", json=body, headers=h)
    assert r.status_code == code, f"{path}: {r.status_code} {r.text[:300]}"
    return r.json()


def test_templates_end_to_end(admin_headers):
    h = admin_headers
    fts = _get(h, "/master/flat-types?page_size=50")["items"]
    assert len(fts) >= 2
    stages = [s for s in _get(h, "/master/construction-stages?page_size=100")["items"] if s["is_active"]]
    booking = next(s for s in stages if s.get("auto_complete_on_booking") or s["code"] == "BOOKING")
    others = [s for s in stages if s["id"] != booking["id"]][:4]
    assert len(others) >= 3
    tag = uuid.uuid4().hex[:5]

    f1 = _post(
        h,
        "/floor-templates",
        {
            "name": f"S1 mix {tag}",
            "positions": [
                {"pos": 1, "flat_type_id": fts[0]["id"]},
                {"pos": 2, "flat_type_id": fts[0]["id"]},
                {"pos": 3, "flat_type_id": fts[1]["id"]},
            ],
        },
    )
    assert f1["flats_per_floor"] == 3 and f1["use_type_defaults"] is False and f1["preview"].startswith("3 flats: ")
    f2 = _post(
        h,
        "/floor-templates",
        {
            "name": f"S1 two {tag}",
            "positions": [{"pos": 1, "flat_type_id": fts[1]["id"]}, {"pos": 2, "flat_type_id": fts[1]["id"]}],
        },
    )
    r = requests.post(
        f"{BASE}/api/floor-templates",
        json={
            "name": "gap",
            "positions": [{"pos": 1, "flat_type_id": fts[0]["id"]}, {"pos": 3, "flat_type_id": fts[0]["id"]}],
        },
        headers=h,
    )
    assert r.status_code == 422

    sp = _post(
        h,
        "/stage-plan-templates",
        {"name": f"S1 stages {tag}", "stage_ids": [booking["id"]] + [s["id"] for s in others[:3]]},
    )
    assert [s["seq"] for s in sp["stages"]] == [1, 2, 3, 4]
    pp = _post(
        h,
        "/payment-plan-templates",
        {
            "name": f"S1 CLP {tag}",
            "installments": [
                {"label": "Booking", "percent": 10, "trigger": "on_booking"},
                {"label": others[0]["name"], "percent": 40, "trigger": "stage", "stage_id": others[0]["id"]},
                {"label": others[1]["name"], "percent": 40, "trigger": "stage", "stage_id": others[1]["id"]},
                {"label": "Handover", "percent": 10, "trigger": "days_after_booking", "days": 365},
            ],
        },
    )
    r = requests.post(
        f"{BASE}/api/payment-plan-templates",
        json={"name": "bad", "installments": [{"label": "A", "percent": 60, "trigger": "on_booking"}]},
        headers=h,
    )
    assert r.status_code == 422 and "100" in r.text
    pp_missing = _post(
        h,
        "/payment-plan-templates",
        {
            "name": f"S1 needs stage {tag}",
            "installments": [
                {"label": "Booking", "percent": 50, "trigger": "on_booking"},
                {"label": others[3]["name"], "percent": 50, "trigger": "stage", "stage_id": others[3]["id"]},
            ],
        },
    )

    tt = _post(
        h,
        "/tower-templates",
        {
            "name": f"S1 tower {tag}",
            "floors": 4,
            "floor_start": 1,
            "numbering_pattern": "{block}-{floor}{pos2}",
            "floor_map": [
                {"from": 1, "to": 2, "floor_template_id": f1["id"]},
                {"from": 3, "to": 3, "floor_template_id": f2["id"]},
            ],
            "default_stage_plan_template_id": sp["id"],
            "default_payment_plan_template_ids": [pp["id"]],
            "default_payment_plan_template_id": pp["id"],
        },
    )
    assert tt["preview"].startswith("4 floors · 8 flats · ") and "(default)" in tt["preview"]
    r = requests.post(
        f"{BASE}/api/tower-templates",
        json={
            "name": "overlap",
            "floors": 3,
            "floor_map": [
                {"from": 1, "to": 2, "floor_template_id": f1["id"]},
                {"from": 2, "to": 3, "floor_template_id": f2["id"]},
            ],
        },
        headers=h,
    )
    assert r.status_code == 422

    proj = _post(
        h,
        "/projects",
        {
            "name": f"S1 Proj {tag}",
            "code": f"S1{tag.upper()}"[:10],
            "project_type": "Residential",
            "address": {"city": "Indore"},
        },
    )
    res = _post(
        h,
        f"/projects/{proj['id']}/towers-from-template",
        {"name": "Tower T", "code": "T", "tower_template_id": tt["id"]},
    )
    assert res["floors_applied"] == 3 and res["flats_created"] == 8 and res["stage_plan"]["name"] == sp["name"], res
    assert [p["is_default"] for p in res["payment_plans"]] == [True] and res["warnings"] == []
    bid = res["block"]["id"]
    flats = _get(h, f"/flats?block_id={bid}&page_size=50")["items"]
    assert len(flats) == 8 and all(f.get("price") in (None, 0) for f in flats), "nothing pre-filled silently"
    assert sorted(f["flat_number"] for f in flats if f["floor"] == 3) == ["T-301", "T-302"]
    floor4 = [f for f in flats if f["floor"] == 4]
    assert floor4 == [], "gap in floor map stays empty for custom design later"

    plans = _get(h, f"/projects/{proj['id']}/plans")["towers"]
    assert plans[0]["stage_plan"]["template_id"] == sp["id"] and plans[0]["stage_plan"]["count"] == 4
    assert [(p["is_default"], p["template_id"]) for p in plans[0]["payment_plans"]] == [(True, pp["id"])]

    r = requests.post(
        f"{BASE}/api/blocks/{bid}/apply-payment-plan-template", json={"template_id": pp_missing["id"]}, headers=h
    )
    assert r.status_code == 422 and r.json()["code"] == "MISSING_STAGES" and others[3]["name"] in r.text

    # book one flat on floor 3, then re-apply a different floor template → only the unbooked flat changes
    cust = _post(h, "/customers", {"full_name": f"S1 buyer {tag}", "phone": f"9{uuid.uuid4().int % 10**9:09d}"})
    target = next(f for f in flats if f["floor"] == 3)
    requests.patch(
        f"{BASE}/api/flats/{target['id']}/pricing",
        json={"saleable_sqft": 900, "rate_per_sqft": 4000, "pricing_mode": "rate"},
        headers=h,
    ).raise_for_status()
    bk = requests.post(
        f"{BASE}/api/bookings",
        json={
            "flat_id": target["id"],
            "customer_id": cust["id"],
            "booking_date": "2026-09-01",
            "agreement_value": 3600000,
            "cash_agreed": 1600000,
            "account_agreed": 2000000,
            "other_charges": [],
            "agreement_gst_percent": 0,
        },
        headers=h,
    )
    assert bk.status_code == 201, bk.text
    r = requests.post(
        f"{BASE}/api/blocks/{bid}/floors/3/apply-template", json={"floor_template_id": f1["id"]}, headers=h
    )
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["kept_locked"] == [target["flat_number"]] and out["created"] == 1 and out["updated"] == 1
    after = {f["flat_number"]: f for f in _get(h, f"/flats?block_id={bid}&page_size=50")["items"] if f["floor"] == 3}
    assert (
        after[target["flat_number"]]["status"] == "Booked"
        and after[target["flat_number"]]["flat_type_id"] == target["flat_type_id"]
    )
    assert len(after) == 3

    full = requests.get(f"{BASE}/api/bookings/{bk.json()['id']}", headers=h).json()
    assert full.get("payment_plan_snapshot"), "booking on a template-built tower must snapshot the tower's default plan"
    requests.post(
        f"{BASE}/api/bookings/{full['id']}/cancel",
        json={"reason": "S1 test cleanup", "version": full["version"]},
        headers=h,
    ).raise_for_status()

    # 4-floor empty tower without template
    res2 = _post(h, f"/projects/{proj['id']}/towers-from-template", {"name": "Tower U", "code": "U", "floors": 2})
    assert res2["flats_created"] == 0 and res2["block"]["floors"] == 2


def test_no_internal_words_on_project_and_masters_pages():
    """Owner wording: staff never see override / version / pricing_status / readiness / propagation on Project or Masters pages."""
    hits = []
    bases = [
        os.path.join(ROOT, "frontend", "src", d)
        for d in (
            "pages/masters",
            "pages/v2",
            "components/structure",
            "components/project",
            "components/common/PricingSetupTab.jsx",
        )
    ]
    for base in bases:
        files = (
            [base]
            if base.endswith(".jsx")
            else [os.path.join(dp, f) for dp, _, fn in os.walk(base) for f in fn if f.endswith(".jsx")]
        )
        for path in files:
            if not os.path.exists(path):
                continue
            with open(path) as fh:
                for i, line in enumerate(fh, 1):
                    for m in re.finditer(
                        r">[^<{]*?\b(override|pricing_status|readiness|propagation|outbox)\b[^<{]*<", line, re.I
                    ):
                        hits.append(f"{os.path.relpath(path, ROOT)}:{i}: {m.group(0)[:70]}")
                    for m in re.finditer(r">[^<{]*\bv\{[a-z.]*version\}", line):
                        hits.append(f"{os.path.relpath(path, ROOT)}:{i}: {m.group(0)[:70]}")
    assert hits == [], hits


def test_tower_from_template_never_silent_about_payment_plans(admin_headers):
    """Seeded tower templates carry a default payment plan; a plan whose stage is missing from the stage plan yields a visible warning, not silence."""
    h = admin_headers
    seeded = [
        t for t in _get(h, "/tower-templates")["items"] if t.get("seeded") and t.get("default_stage_plan_template_id")
    ]
    assert seeded, "seed must produce tower templates"
    for t in seeded:
        assert t["default_payment_plan_template_id"] in t["default_payment_plan_template_ids"], t["name"]
    stages = [s for s in _get(h, "/master/construction-stages?page_size=100")["items"] if s["is_active"]]
    booking = next(s for s in stages if s.get("auto_complete_on_booking") or s["code"] == "BOOKING")
    others = [s for s in stages if s["id"] != booking["id"]][:3]
    tag = uuid.uuid4().hex[:5]
    fts = _get(h, "/master/flat-types?page_size=50")["items"]
    f1 = _post(
        h, "/floor-templates", {"name": f"S1 warn {tag}", "positions": [{"pos": 1, "flat_type_id": fts[0]["id"]}]}
    )
    sp = _post(h, "/stage-plan-templates", {"name": f"S1 short {tag}", "stage_ids": [booking["id"], others[0]["id"]]})
    pp = _post(
        h,
        "/payment-plan-templates",
        {
            "name": f"S1 needs {others[2]['name']} {tag}",
            "installments": [
                {"label": "Booking", "percent": 50, "trigger": "on_booking"},
                {"label": others[2]["name"], "percent": 50, "trigger": "stage", "stage_id": others[2]["id"]},
            ],
        },
    )
    tt = _post(
        h,
        "/tower-templates",
        {
            "name": f"S1 warn tower {tag}",
            "floors": 2,
            "floor_map": [{"from": 1, "to": 2, "floor_template_id": f1["id"]}],
            "default_stage_plan_template_id": sp["id"],
            "default_payment_plan_template_ids": [pp["id"]],
            "default_payment_plan_template_id": pp["id"],
        },
    )
    proj = _post(
        h,
        "/projects",
        {
            "name": f"S1 Warn {tag}",
            "code": f"W{tag.upper()}"[:10],
            "project_type": "Residential",
            "address": {"city": "Indore"},
        },
    )
    res = _post(
        h,
        f"/projects/{proj['id']}/towers-from-template",
        {"name": "Tower W", "code": "W", "tower_template_id": tt["id"]},
    )
    assert (
        res["payment_plans"] == []
        and len(res["warnings"]) == 1
        and pp["name"] in res["warnings"][0]
        and others[2]["name"] in res["warnings"][0]
    ), res
    tt2 = _post(
        h,
        "/tower-templates",
        {
            "name": f"S1 nopay {tag}",
            "floors": 1,
            "floor_map": [{"from": 1, "to": 1, "floor_template_id": f1["id"]}],
            "default_stage_plan_template_id": sp["id"],
        },
    )
    res2 = _post(
        h,
        f"/projects/{proj['id']}/towers-from-template",
        {"name": "Tower X", "code": "X", "tower_template_id": tt2["id"]},
    )
    assert any("No payment plan" in w for w in res2["warnings"]), res2


def test_payment_allocation_flag_and_agreement_signed(admin_headers):
    items = requests.get(f"{BASE}/api/bookings?page_size=1&status=Active", headers=admin_headers).json()["items"]
    if not items:
        return
    bid = items[0]["id"]
    r = requests.post(f"{BASE}/api/bookings/{bid}/agreement-signed", json={"mode": "WhatsApp"}, headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json()["plan_acceptance"]["mode"] == "WhatsApp"
    assert (
        requests.get(f"{BASE}/api/bookings/{bid}", headers=admin_headers).json()["plan_acceptance"]["mode"]
        == "WhatsApp"
    )
