"""Phase 11E backend smoke: reports CSV + presets, master flat-types usage, roles PATCH, service status, quick-customer create."""
import os
import time

import pytest
import requests

TEST_PASSWORD = os.environ["TEST_PASSWORD"]  # seeded-user password from backend/.env (loaded by conftest)

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
ADMIN = {"email": "admin@kkt.in", "password": TEST_PASSWORD}


@pytest.fixture(scope="session")
def token():
    r = requests.post(f"{BASE}/api/auth/login", json=ADMIN, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def H(token):
    return {"Authorization": f"Bearer {token}"}


# ---------- Reports ----------
def test_reports_collections_csv(H):
    r = requests.get(f"{BASE}/api/reports/collections?format=csv", headers=H, timeout=30)
    assert r.status_code == 200, r.text
    ct = r.headers.get("content-type", "")
    assert "csv" in ct.lower(), ct
    assert len(r.content) > 0


def test_reports_presets_crud(H):
    name = f"TEST_preset_{int(time.time())}"
    # create
    r = requests.post(f"{BASE}/api/reports/presets",
                      headers=H, json={"name": name, "report_key": "collections", "filters": {"range": "fy"}}, timeout=15)
    assert r.status_code in (200, 201), r.text
    pid = r.json().get("id") or r.json().get("_id") or r.json().get("preset_id")
    assert pid, r.text
    # rename
    r2 = requests.patch(f"{BASE}/api/reports/presets/{pid}", headers=H, json={"name": name + "_renamed"}, timeout=15)
    assert r2.status_code == 200, r2.text
    # delete
    r3 = requests.delete(f"{BASE}/api/reports/presets/{pid}", headers=H, timeout=15)
    assert r3.status_code in (200, 204), r3.text


# ---------- Masters ----------
def test_flat_types_include_usage(H):
    r = requests.get(f"{BASE}/api/master/flat-types?include_usage=true", headers=H, timeout=20)
    assert r.status_code == 200, r.text
    data = r.json()
    items = data if isinstance(data, list) else data.get("items", data.get("data", []))
    assert len(items) > 0
    assert "usage_count" in items[0], items[0].keys()


# ---------- Users create/patch ----------
def _roles_map(H):
    r = requests.get(f"{BASE}/api/roles", headers=H, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    roles = data if isinstance(data, list) else data.get("items", [])
    return {(r.get("slug") or r.get("name") or "").lower(): r["id"] for r in roles}, roles


def test_roles_list(H):
    _, roles = _roles_map(H)
    assert len(roles) > 0


def test_create_and_update_user(H):
    rmap, _ = _roles_map(H)
    emp = rmap.get("employee") or rmap.get("sales")
    sales = rmap.get("sales") or emp
    assert emp and sales
    ts = int(time.time())
    email = f"qa.phase11e+{ts}@kkt.in"
    r = requests.post(f"{BASE}/api/users", headers=H, json={
        "name": "QA Phase 11E", "email": email, "password": "Test@12345", "role_id": emp
    }, timeout=20)
    assert r.status_code in (200, 201), r.text
    uid = r.json().get("id") or r.json().get("user_id")
    assert uid, r.text
    r2 = requests.patch(f"{BASE}/api/users/{uid}", headers=H, json={"role_id": sales}, timeout=15)
    assert r2.status_code == 200, r2.text


# ---------- Service kanban status ----------
def test_service_requests_list(H):
    r = requests.get(f"{BASE}/api/service-requests", headers=H, timeout=20)
    assert r.status_code == 200
    data = r.json()
    items = data if isinstance(data, list) else data.get("items", [])
    assert len(items) > 0


# ---------- Quick customer ----------
def test_quick_customer_create(H):
    ts = int(time.time())
    r = requests.post(f"{BASE}/api/customers", headers=H, json={
        "full_name": f"QC Phase 11E {ts}", "phone": f"90000{ts % 100000:05d}"
    }, timeout=20)
    assert r.status_code in (200, 201), r.text
    assert r.json().get("id") or r.json().get("customer_id") or r.json().get("code")
