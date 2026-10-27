"""Phase 11B backend tests: dashboard/home + project_setup PUT sections with correct payload shapes."""
import os

import pytest
import requests

TEST_PASSWORD = os.environ["TEST_PASSWORD"]  # seeded-user password from backend/.env (loaded by conftest)

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://royal-realty-hub-2.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@kkt.in"
ADMIN_PASSWORD = TEST_PASSWORD

_cache = {}


@pytest.fixture(scope="module")
def auth_headers():
    if "h" in _cache:
        return _cache["h"]
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=20)
    assert r.status_code == 200, r.text
    _cache["h"] = {"Authorization": f"Bearer {r.json()['access_token']}", "Content-Type": "application/json"}
    return _cache["h"]


@pytest.fixture(scope="module")
def project_id(auth_headers):
    r = requests.get(f"{API}/projects", headers=auth_headers, timeout=20)
    assert r.status_code == 200
    body = r.json()
    items = body.get("items", body) if isinstance(body, dict) else body
    for p in items:
        if p.get("code") == "SGH":
            return p["id"]
    return items[0]["id"]


# -------- Dashboard Home --------
class TestDashboardHome:
    def test_get_dashboard_home_200(self, auth_headers):
        r = requests.get(f"{API}/dashboard/home", headers=auth_headers, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        # Response has projects/attention/totals/counts/collections_12m/recent (not "kpis" literally)
        for key in ("projects", "attention", "totals", "counts", "collections_12m", "recent", "spark"):
            assert key in data, f"missing {key}: {list(data.keys())}"
        assert isinstance(data["projects"], list)
        assert "overdue" in data["attention"]

    def test_dashboard_home_unauth(self):
        r = requests.get(f"{API}/dashboard/home", timeout=20)
        assert r.status_code in (401, 403)


# -------- Project Setup bundle --------
class TestProjectSetupBundle:
    def test_get_setup_shape(self, auth_headers, project_id):
        r = requests.get(f"{API}/projects/{project_id}/setup", headers=auth_headers, timeout=20)
        assert r.status_code == 200
        data = r.json()
        for key in ("towers", "stages", "plans", "pricing"):
            assert key in data


# -------- PUT setup/{section} with correct shapes --------
class TestProjectSetupSave:
    def test_put_stages_idempotent(self, auth_headers, project_id):
        r = requests.get(f"{API}/projects/{project_id}/setup", headers=auth_headers, timeout=20)
        seq = [{"stage_id": s["stage_id"], "seq": i + 1} for i, s in enumerate(r.json()["stages"]["project_sequence"])]
        body = {"project_sequence": seq}
        r2 = requests.put(f"{API}/projects/{project_id}/setup/stages", headers=auth_headers, json=body, timeout=30)
        assert r2.status_code == 200, f"stages PUT: {r2.status_code} {r2.text[:400]}"

    def test_put_plans_idempotent(self, auth_headers, project_id):
        r = requests.get(f"{API}/projects/{project_id}/setup", headers=auth_headers, timeout=20)
        assignments = [{"payment_plan_id": a["payment_plan_id"], "block_id": a.get("block_id"), "is_default": bool(a.get("is_default"))}
                       for a in r.json()["plans"]["assignments"]]
        body = {"assignments": assignments}
        r2 = requests.put(f"{API}/projects/{project_id}/setup/plans", headers=auth_headers, json=body, timeout=30)
        assert r2.status_code == 200, f"plans PUT: {r2.status_code} {r2.text[:400]}"
        # Verify preserved
        r3 = requests.get(f"{API}/projects/{project_id}/setup", headers=auth_headers, timeout=20)
        after = r3.json()["plans"]["assignments"]
        assert len(after) == len(assignments), f"assignments count changed {len(assignments)} -> {len(after)}"

    def test_put_pricing_idempotent(self, auth_headers, project_id):
        r = requests.get(f"{API}/projects/{project_id}/setup", headers=auth_headers, timeout=20)
        setup = r.json()
        block_rates = [{"block_id": t["id"], "rate_per_sqft": t.get("rate_per_sqft"), "floor_rise_per_sqft": t.get("floor_rise_per_sqft")}
                       for t in setup["towers"]]
        body = {"block_rates": block_rates}
        r2 = requests.put(f"{API}/projects/{project_id}/setup/pricing", headers=auth_headers, json=body, timeout=30)
        assert r2.status_code == 200, f"pricing PUT: {r2.status_code} {r2.text[:400]}"

    def test_put_towers_name_only(self, auth_headers, project_id):
        r = requests.get(f"{API}/projects/{project_id}/setup", headers=auth_headers, timeout=20)
        towers = r.json()["towers"]
        if not towers:
            pytest.skip("no towers")
        t = towers[0]
        body = {"towers": [{"id": t["id"], "name": t["name"], "version": t.get("version")}]}
        r2 = requests.put(f"{API}/projects/{project_id}/setup/towers", headers=auth_headers, json=body, timeout=30)
        # Same name — update_one may still bump version via $inc, so expect 200
        assert r2.status_code == 200, f"towers PUT: {r2.status_code} {r2.text[:400]}"


# -------- Flats inventory --------
class TestFlatsPagination:
    def test_flats_page_size_200(self, auth_headers, project_id):
        r = requests.get(f"{API}/flats", headers=auth_headers,
                         params={"project_id": project_id, "page_size": 200}, timeout=30)
        assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"
