"""Phase B4 — backend sanity curl via requests."""
import os, time, requests, pytest

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")

@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE}/api/auth/login", json={"email":"admin@kkt.in","password":"Kkt@12345"}, timeout=15)
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

def test_anchor_booking_due_zero_and_ledger_22(H):
    r = requests.get(f"{BASE}/api/bookings", headers=H, timeout=15)
    rows = r.json() if isinstance(r.json(), list) else r.json().get("items", r.json().get("bookings", []))
    anchor = next((b for b in rows if b.get("booking_number") == "BK-2526-0001"), None)
    assert anchor, f"BK-2526-0001 not found; sample={rows[0] if rows else None}"
    bid = anchor.get("id") or anchor.get("_id")
    full = requests.get(f"{BASE}/api/bookings/{bid}", headers=H, timeout=15).json()
    due = (full.get("summary") or {}).get("due")
    assert due == 0, f"expected due=0, got {due}"
    led = requests.get(f"{BASE}/api/bookings/{bid}/ledger", headers=H, timeout=15)
    assert led.status_code == 200
    j = led.json()
    rows = j if isinstance(j, list) else j.get("rows", j.get("items", []))
    assert len(rows) == 22, f"expected 22 ledger rows, got {len(rows)}"

def test_integrity_report_ok(H):
    r = requests.get(f"{BASE}/api/admin/integrity-report?fresh=1", headers=H, timeout=15)
    assert r.status_code == 200
    assert r.json().get("ok") is True
