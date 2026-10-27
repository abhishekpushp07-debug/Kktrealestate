"""D5: /api/admin/ops snapshot."""
import os

import requests

TEST_PASSWORD = os.environ["TEST_PASSWORD"]  # seeded-user password from backend/.env (loaded by conftest)

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")


def test_ops_snapshot_shape(admin_headers):
    requests.get(f"{BASE}/api/bookings?page_size=5", headers=admin_headers, timeout=15)
    r = requests.get(f"{BASE}/api/admin/ops", headers=admin_headers, timeout=15)
    assert r.status_code == 200, r.text[:200]
    d = r.json()
    assert {"uptime_s", "startup", "process", "requests", "jobs", "read_models", "db_pool"} <= set(d)
    assert "bookings" in d["requests"]["by_group"] and d["requests"]["by_group"]["bookings"]["p95_ms"] is not None
    assert d["db_pool"]["config"]["maxPoolSize"] >= 1 and "checked_out" in d["db_pool"]["live"]


def test_ops_requires_settings_manage():
    from tests.conftest import session_token
    sales_headers = {"Authorization": f"Bearer {session_token('sales@kkt.in', TEST_PASSWORD)}"}
    r = requests.get(f"{BASE}/api/admin/ops", headers=sales_headers, timeout=15)
    assert r.status_code in (403, 404)
