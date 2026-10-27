"""Phase B4 — backend sanity curl via requests."""
import os
import time

import pytest
import requests

TEST_PASSWORD = os.environ["TEST_PASSWORD"]  # seeded-user password from backend/.env (loaded by conftest)

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")

@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE}/api/auth/login", json={"email":"admin@kkt.in","password":TEST_PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]

@pytest.fixture(scope="module")
def H(token):
    return {"Authorization": f"Bearer {token}"}

def test_health_fast():
    t0 = time.time()
    r = requests.get(f"{BASE}/api/health", timeout=5)
    dt = time.time() - t0
    assert r.status_code == 200
    assert dt < 0.5, f"health took {dt:.3f}s"

def test_bookings_list(H):
    r = requests.get(f"{BASE}/api/bookings", headers=H, timeout=15)
    assert r.status_code == 200
    data = r.json()
    rows = data if isinstance(data, list) else data.get("items", data.get("bookings", []))
    assert len(rows) >= 1


def test_integrity_report_ok(H):
    body = None
    for _ in range(4):  # other xdist workers may be mid-write; summaries settle within a second
        r = requests.get(f"{BASE}/api/admin/integrity-report?fresh=1", headers=H, timeout=15)
        assert r.status_code == 200
        body = r.json()
        if body.get("ok") is True:
            break
        time.sleep(1.5)
    assert body.get("ok") is True, body.get("findings")
