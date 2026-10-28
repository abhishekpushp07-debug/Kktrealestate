"""Phase X.6 — home layout: default, schema validation, per-user isolation, permission filtering, reset."""
import os

import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL") or "http://127.0.0.1:8001"
pytestmark = pytest.mark.skipif(not os.environ.get("KKT_TEST_EXTERNAL", "1"), reason="external")


def _hdr(email, pw_env="ADMIN_PASSWORD"):
    r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": os.environ["TEST_PASSWORD"]}, timeout=30)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json().get('access_token') or r.json().get('token')}"}


def test_default_then_save_then_isolation_then_reset():
    A = _hdr("admin@kkt.in")
    S = _hdr("sales@kkt.in", "SALES_PASSWORD")
    requests.delete(f"{BASE}/api/me/home-layout", headers=A, timeout=30)
    g = requests.get(f"{BASE}/api/me/home-layout", headers=A, timeout=30).json()
    assert g["is_default"] and [w["id"] for w in g["widgets"]] == ["today", "trends", "projects", "collections_chart", "ageing", "attention", "activity", "tower_sales"]
    before_sales = requests.get(f"{BASE}/api/me/home-layout", headers=S, timeout=30).json()
    new = [{"id": "attention", "size": "L", "visible": True}, {"id": "today", "size": "S", "visible": True}, {"id": "projects", "size": "M", "visible": False}]
    p = requests.put(f"{BASE}/api/me/home-layout", json={"widgets": new, "version": g["version"]}, headers=A, timeout=30)
    assert p.status_code == 200, p.text
    j = p.json()
    assert not j["is_default"] and j["version"] == g["version"] + 1 and [w["id"] for w in j["widgets"]][:3] == ["attention", "today", "projects"]
    assert j["widgets"][2]["visible"] is False and len(j["widgets"]) == 8  # unmentioned widgets are appended
    again = requests.get(f"{BASE}/api/me/home-layout", headers=A, timeout=30).json()
    assert again["widgets"] == j["widgets"]
    # other user unaffected
    assert requests.get(f"{BASE}/api/me/home-layout", headers=S, timeout=30).json()["widgets"] == before_sales["widgets"]
    # stale version → 409
    assert requests.put(f"{BASE}/api/me/home-layout", json={"widgets": new, "version": g["version"]}, headers=A, timeout=30).status_code == 409
    r = requests.delete(f"{BASE}/api/me/home-layout", headers=A, timeout=30).json()
    assert r["is_default"]


def test_schema_validation_and_permission_filter():
    A = _hdr("admin@kkt.in")
    S = _hdr("sales@kkt.in", "SALES_PASSWORD")
    for bad in [{"widgets": []}, {"widgets": [{"id": "nope"}]}, {"widgets": [{"id": "today"}, {"id": "today"}]}, {"widgets": [{"id": "today", "size": "XL"}]}, {"widgets": [{"id": "today", "colour": "red"}]}]:
        assert requests.put(f"{BASE}/api/me/home-layout", json=bad, headers=A, timeout=30).status_code == 422, bad
    sales = requests.get(f"{BASE}/api/me/home-layout", headers=S, timeout=30).json()
    ids = {w["id"] for w in sales["widgets"]}
    assert {a["id"] for a in sales["available"]} == ids
    admin_ids = [w["id"] for w in requests.get(f"{BASE}/api/me/home-layout", headers=A, timeout=30).json()["widgets"]]
    denied = [i for i in admin_ids if i not in ids]
    assert denied, "Sales should lack at least one admin widget"
    assert requests.put(f"{BASE}/api/me/home-layout", json={"widgets": [{"id": denied[0]}]}, headers=S, timeout=30).status_code == 403
    E = _hdr("employee@kkt.in", "EMPLOYEE_PASSWORD")
    assert requests.get(f"{BASE}/api/me/home-layout", headers=E, timeout=30).status_code == 403
