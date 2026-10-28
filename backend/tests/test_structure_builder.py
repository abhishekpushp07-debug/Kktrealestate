"""Phase X.3 — Structure builder: composite read, readiness, floors preview, single flat + duplicate rejection, masking for Sales."""
import os
import uuid

import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL") or "http://127.0.0.1:8001"
pytestmark = pytest.mark.skipif(not os.environ.get("KKT_TEST_EXTERNAL", "1"), reason="external")


def _hdr(email, pw_env="ADMIN_PASSWORD"):
    pw = os.environ.get(pw_env) or "Kkt@12345"
    r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": pw}, timeout=30)
    assert r.status_code == 200, r.text
    tok = r.json().get("access_token") or r.json().get("token")
    return {"Authorization": f"Bearer {tok}"}


def _project(H):
    items = requests.get(f"{BASE}/api/projects?page_size=50", headers=H, timeout=30).json()["items"]
    return next(p for p in items if p.get("code") == "SGH")["id"]


def test_structure_tree_counts_and_readiness():
    H = _hdr("admin@kkt.in")
    pid = _project(H)
    r = requests.get(f"{BASE}/api/projects/{pid}/structure", headers=H, timeout=60)
    assert r.status_code == 200
    j = r.json()
    assert j["readiness"]["open_items"] == len(j["readiness"]["project_checks"]) + sum(len(t["checks"]) for t in j["towers"])
    for t in j["towers"]:
        flats = [f for fl in t["floors_list"] for f in fl["flats"]]
        assert t["units"]["total"] == len(flats) == sum(t["units"]["by_status"].values())
        assert t["units"]["masked"] is False
        for f in flats:
            assert "price" in f or f.get("price_paise") is None  # rupee twin for UI


def test_structure_masks_real_status_for_sales():
    pid = _project(_hdr("admin@kkt.in"))
    S = _hdr("sales@kkt.in", "SALES_PASSWORD")
    r = requests.get(f"{BASE}/api/projects/{pid}/structure", headers=S, timeout=60)
    assert r.status_code == 200
    for t in r.json()["towers"]:
        assert t["units"]["masked"] is True
        for fl in t["floors_list"]:
            for f in fl["flats"]:
                assert "inventory_state" not in f and "booking_id" not in f and "display_override" not in f


def test_floors_preview_and_single_flat_duplicate():
    H = _hdr("admin@kkt.in")
    pid = _project(H)
    towers = requests.get(f"{BASE}/api/projects/{pid}/structure", headers=H, timeout=60).json()["towers"]
    t = next(x for x in towers if x["units"]["total"] > 0)
    ft = requests.get(f"{BASE}/api/master/flat-types?page_size=5", headers=H, timeout=30).json()["items"][0]["id"]
    pv = requests.post(f"{BASE}/api/blocks/{t['id']}/floors/preview", json={"count": 2, "flats_per_floor": 3, "flat_type_id": ft}, headers=H, timeout=60)
    assert pv.status_code == 200, pv.text
    j = pv.json()
    assert j["count"] == 6 and len(j["floors"]) == 2 and len(j["flat_numbers"]) == 6 and j["duplicates"] == []
    # dry run writes nothing
    assert requests.get(f"{BASE}/api/projects/{pid}/structure", headers=H, timeout=60).json()["towers"][towers.index(t)]["units"]["total"] == t["units"]["total"]
    existing = t["floors_list"][0]["flats"][0]
    dup = requests.post(f"{BASE}/api/blocks/{t['id']}/flats", json={"floor": existing["floor"], "position": existing["position"], "flat_type_id": ft}, headers=H, timeout=60)
    assert dup.status_code == 409 and dup.json()["code"] == "DUPLICATE_FLAT"
    dup2 = requests.post(f"{BASE}/api/blocks/{t['id']}/flats", json={"floor": existing["floor"], "position": 49, "flat_type_id": ft, "flat_number": existing["flat_number"]}, headers=H, timeout=60)
    assert dup2.status_code == 409 and existing["flat_number"] in dup2.json()["detail"]
    out = requests.post(f"{BASE}/api/blocks/{t['id']}/flats", json={"floor": existing["floor"], "position": 2, "flat_type_id": ft, "flat_number": f"PX-{uuid.uuid4().hex[:6]}"}, headers=H, timeout=60)
    assert out.status_code in (201, 409)  # 409 only if position 2 already exists on that floor
    if out.status_code == 201:
        f = out.json()
        assert f["status"] == "Available" and f["allocation_category_code"] == "BUILDER"
        after = requests.get(f"{BASE}/api/projects/{pid}/structure", headers=H, timeout=60).json()["towers"][towers.index(t)]
        assert after["units"]["total"] == t["units"]["total"] + 1
        ren = requests.patch(f"{BASE}/api/flats/{f['id']}", json={"flat_number": existing["flat_number"], "version": f["version"]}, headers=H, timeout=60)
        assert ren.status_code == 409 and ren.json()["code"] == "DUPLICATE_FLAT"
        requests.patch(f"{BASE}/api/flats/{f['id']}/status", json={"status": "Blocked", "reason": "test artefact", "version": f["version"]}, headers=H, timeout=60)


def test_structure_zero_access_employee_is_403():
    pid = _project(_hdr("admin@kkt.in"))
    E = _hdr("employee@kkt.in", "EMPLOYEE_PASSWORD")
    assert requests.get(f"{BASE}/api/projects/{pid}/structure", headers=E, timeout=30).status_code == 403
