"""JRN-28: never on production, never on top of a running rebuild.
The skipped case starts ONE real story reseed (heavy) — run this file deliberately, once."""
import time
import httpx
from conftest import BASE, _pw

COLS = ("bookings", "payments", "demands", "flats")


def _counts():
    from pymongo import MongoClient
    db = MongoClient("mongodb://localhost:27017")["test_database"]
    return {c: db[c].count_documents({}) for c in COLS}


def _fresh():
    r = httpx.post(f"{BASE}/auth/login", json={"email": "admin@kkt.in", "password": _pw()}, timeout=30)
    if r.status_code != 200:
        return None
    return httpx.Client(base_url=BASE, headers={"Authorization": "Bearer " + r.json()["access_token"]}, timeout=60)


def _wait_idle(api=None, limit=900):
    t = time.time()
    while time.time() - t < limit:
        c = _fresh()
        if c:
            st = c.get("/admin/demo-refresh")
            rs = c.get("/admin/reseed/status")
            if st.status_code == 200 and rs.status_code == 200:
                st, rs = st.json(), rs.json()
                if not st.get("running") and rs.get("status") != "running" and not rs.get("running"):
                    return st
        time.sleep(10)
    raise AssertionError("still running after wait")


def test_production_host_disabled_changes_nothing(api):
    _wait_idle(api)
    before = _counts()
    r = api.post("/admin/demo-refresh/run", json={"check_host": "billpe.com"})
    assert r.status_code == 200, r.text[:300]
    assert r.json()["outcome"] == "disabled: billpe.com is not a demo host", r.json()
    st = api.get("/admin/demo-refresh").json()
    assert st["last"]["outcome"].startswith("disabled:") and not st["running"]
    assert _counts() == before


def test_run_needs_permission():
    r = httpx.post(f"{BASE}/auth/login", json={"email": "sales@kkt.in", "password": _pw()}, timeout=30)
    assert r.status_code == 200
    r = httpx.post(f"{BASE}/admin/demo-refresh/run", json={}, headers={"Authorization": "Bearer " + r.json()["access_token"]}, timeout=30)
    assert r.status_code == 403, r.text[:200]


def test_skipped_while_reseed_runs(api):
    _wait_idle(api)
    r = api.post("/admin/reseed", json={"confirm": "RESEED", "story": True})
    assert r.status_code in (200, 202), r.text[:300]
    deadline = time.time() + 60
    while time.time() < deadline:
        rs = api.get("/admin/reseed/status").json()
        if rs.get("running") or rs.get("status") == "running":
            break
        time.sleep(1)
    c, r2 = None, None
    while time.time() < deadline + 240 and not c:  # the reseed recreates users: log in again as soon as admin exists
        c = _fresh()
        time.sleep(0 if c else 1)
    r2 = c.post("/admin/demo-refresh/run", json={})
    assert r2.status_code == 200, r2.text[:300]
    assert r2.json()["outcome"] == "skipped: reseed running", r2.json()
    st = _wait_idle(api)
    hist = st["history"]
    assert any(h["outcome"] == "skipped: reseed running" for h in hist[:3]), hist[:3]
