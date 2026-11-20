# F2 (hold expiry mandatory everywhere) + F1 reseed status — public-URL regression (preview DB, cleans up its holds)
import os
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")
if not BASE_URL:
    for line in open("/app/frontend/.env"):
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip()
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"


def _until(days=2):
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


@pytest.fixture(scope="module")
def h():
    r = requests.post(f"{API}/auth/login", json={"email": "admin@kkt.in", "password": "Kkt@12345"}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code} {r.text[:200]}")
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def flats(h):
    """Two Available flats, preferring GGV Villa Block P."""
    r = requests.get(f"{API}/flats", headers=h, params={"status": "Available", "page_size": 200}, timeout=60)
    assert r.status_code == 200, r.text[:300]
    items = r.json()["items"]
    pref = [f for f in items if "P" == str(f.get("block_name") or f.get("block_code") or "").split()[-1:][0:1] and False]
    villa = [f for f in items if "villa" in str(f.get("project_name", "")).lower() or "ggv" in str(f.get("project_code", "")).lower()]
    blockp = [f for f in villa if "p" in str(f.get("block_name", "")).lower().split()[-1:]] if villa else []
    pool = blockp or villa or items
    # need two in the same block for bulk-status
    by_block = {}
    for f in pool:
        by_block.setdefault(f["block_id"], []).append(f)
    grp = max(by_block.values(), key=len)
    assert len(grp) >= 3, "need 3 Available flats in one block"
    print("USING", [(f.get("project_name"), f.get("block_name"), f.get("flat_number"), f["id"]) for f in grp[:3]])
    yield grp[:3]
    for f in grp[:3]:  # cleanup: back to Available
        cur = requests.get(f"{API}/flats/{f['id']}", headers=h, timeout=30).json()
        if cur.get("status") == "Hold":
            requests.patch(f"{API}/flats/{f['id']}/status", headers=h,
                           json={"status": "Available", "version": cur.get("version")}, timeout=30)


def _get(h, fid):
    return requests.get(f"{API}/flats/{fid}", headers=h, timeout=30).json()


class TestFlatStatusHold:
    def test_patch_hold_without_expiry_422(self, h, flats):
        f = flats[0]
        before = _get(h, f["id"])
        r = requests.patch(f"{API}/flats/{f['id']}/status", headers=h,
                           json={"status": "Hold", "reason": "TEST_hold", "version": before.get("version")}, timeout=30)
        assert r.status_code == 422, r.text
        assert "Hold expiry is required" in r.text
        after = _get(h, f["id"])
        assert after["status"] == "Available" and after.get("version") == before.get("version")

    def test_patch_hold_past_expiry_422(self, h, flats):
        f = flats[0]
        r = requests.patch(f"{API}/flats/{f['id']}/status", headers=h,
                           json={"status": "Hold", "expires_at": _until(-1)}, timeout=30)
        assert r.status_code == 422, r.text

    def test_patch_hold_with_expiry_then_release(self, h, flats):
        f = flats[0]
        cur = _get(h, f["id"])
        r = requests.patch(f"{API}/flats/{f['id']}/status", headers=h,
                           json={"status": "Hold", "reason": "TEST_hold", "expires_at": _until(), "version": cur.get("version")},
                           timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "Hold" and d["hold"]["expires_at"]
        g = _get(h, f["id"])
        assert g["status"] == "Hold" and g["hold"]["expires_at"]
        r = requests.patch(f"{API}/flats/{f['id']}/status", headers=h,
                           json={"status": "Available", "version": g.get("version")}, timeout=30)
        assert r.status_code == 200, r.text
        g = _get(h, f["id"])
        assert g["status"] == "Available" and not g.get("hold")


class TestBulkStatusHold:
    def test_bulk_hold_without_expiry_422(self, h, flats):
        f = flats[1]
        r = requests.post(f"{API}/blocks/{f['block_id']}/bulk-status", headers=h,
                          json={"flat_ids": [flats[1]["id"], flats[2]["id"]], "status": "Hold", "reason": "TEST_bulk"}, timeout=30)
        assert r.status_code == 422, r.text
        assert "Hold expiry is required" in r.text
        assert _get(h, flats[1]["id"])["status"] == "Available"
        assert _get(h, flats[2]["id"])["status"] == "Available"

    def test_bulk_hold_with_expiry_then_release(self, h, flats):
        f = flats[1]
        ids = [flats[1]["id"], flats[2]["id"]]
        r = requests.post(f"{API}/blocks/{f['block_id']}/bulk-status", headers=h,
                          json={"flat_ids": ids, "status": "Hold", "reason": "TEST_bulk", "expires_at": _until()}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["flats_updated"] == 2
        for i in ids:
            g = _get(h, i)
            assert g["status"] == "Hold" and g["hold"]["expires_at"]
        r = requests.post(f"{API}/blocks/{f['block_id']}/bulk-status", headers=h,
                          json={"flat_ids": ids, "status": "Available"}, timeout=30)
        assert r.status_code == 200, r.text
        for i in ids:
            g = _get(h, i)
            assert g["status"] == "Available" and not g.get("hold")


class TestInventoryHold:
    def test_inventory_bulk_hold_without_expiry_422(self, h, flats):
        reasons = requests.get(f"{API}/hold-reasons", headers=h, timeout=30)
        rid = None
        if reasons.status_code == 200:
            j = reasons.json()
            lst = j.get("items", j) if isinstance(j, dict) else j
            rid = lst[0]["id"] if lst else None
        r = requests.post(f"{API}/inventory/bulk", headers=h,
                          json={"flat_ids": [flats[0]["id"]], "action": "hold", "reason_id": rid, "note": "TEST_inv"}, timeout=30)
        assert r.status_code == 422, r.text
        assert "Hold expiry is required" in r.text
        assert _get(h, flats[0]["id"])["status"] == "Available"


class TestTransferHold:
    def test_transfer_old_unit_hold_without_expiry_422(self, h, flats):
        r = requests.get(f"{API}/bookings", headers=h, params={"status": "Active", "page_size": 50}, timeout=60)
        assert r.status_code == 200
        b = r.json()["items"][-1]
        r = requests.post(f"{API}/bookings/{b['id']}/transfer", headers=h,
                          json={"new_flat_id": flats[0]["id"], "reason": "TEST_transfer", "old_flat_status": "Hold"}, timeout=30)
        assert r.status_code == 422, r.text
        assert "Hold expiry is required" in r.text
        b2 = requests.get(f"{API}/bookings/{b['id']}", headers=h, timeout=30).json()
        assert b2["flat_id"] == b["flat_id"]
        assert _get(h, flats[0]["id"])["status"] == "Available"


class TestReseedStatus:
    def test_reseed_status(self, h):
        r = requests.get(f"{API}/admin/reseed/status", headers=h, timeout=30)
        assert r.status_code == 200, r.text
        print("RESEED STATUS", r.text[:500])


class TestLegacyHolds:
    def test_story_holds_readable(self, h):
        r = requests.get(f"{API}/flats", headers=h, params={"status": "Hold", "page_size": 200}, timeout=60)
        assert r.status_code == 200
        items = r.json()["items"]
        print("HOLDS", [(f.get("flat_number"), (f.get("hold") or {}).get("expires_at")) for f in items])
        assert len(items) >= 3
