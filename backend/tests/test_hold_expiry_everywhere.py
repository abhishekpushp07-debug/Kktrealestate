"""F2 (owner rule): every path that puts a flat on Hold refuses without an expiry — flat status PATCH, tower bulk
status, transfer's old unit, inventory bulk. Plus: a second reseed while one runs returns 409 (no overlap)."""

from datetime import datetime, timedelta, timezone

import pytest
import requests

from core.errors import ApiError
from routers import admin
from tests.conftest import BASE, TEST_PASSWORD, session_token
from tests.flat_claims import own_flats

API = f"{BASE}/api"


def _h():
    return {"Authorization": f"Bearer {session_token('admin@kkt.in', TEST_PASSWORD)}"}


def _until(days=2):
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


def test_flat_status_and_bulk_status_refuse_hold_without_expiry():
    h = _h()
    f1, f2 = own_flats(API, h, 2)
    r = requests.patch(f"{API}/flats/{f1['id']}/status", headers=h, json={"status": "Hold"}, timeout=30)
    assert r.status_code == 422 and r.json()["code"] == "HOLD_EXPIRY_REQUIRED"
    assert "Hold expiry is required" in r.json()["detail"]
    r = requests.post(
        f"{API}/blocks/{f2['block_id']}/bulk-status",
        headers=h,
        json={"flat_ids": [f2["id"]], "status": "Hold"},
        timeout=30,
    )
    assert r.status_code == 422 and r.json()["code"] == "HOLD_EXPIRY_REQUIRED"
    assert requests.get(f"{API}/flats/{f2['id']}", headers=h, timeout=30).json()["status"] == "Available"  # untouched

    until = _until()
    r = requests.patch(
        f"{API}/flats/{f1['id']}/status", headers=h, json={"status": "Hold", "expires_at": until}, timeout=30
    )
    assert r.status_code == 200 and r.json()["status"] == "Hold" and r.json()["hold"]["expires_at"]
    r = requests.post(
        f"{API}/blocks/{f2['block_id']}/bulk-status",
        headers=h,
        json={"flat_ids": [f2["id"]], "status": "Hold", "expires_at": until},
        timeout=30,
    )
    assert r.status_code == 200
    held = requests.get(f"{API}/flats/{f2['id']}", headers=h, timeout=30).json()
    assert held["status"] == "Hold" and held["hold"]["expires_at"]
    for f in (f1, f2):  # releasing clears the hold
        cur = requests.get(f"{API}/flats/{f['id']}", headers=h, timeout=30).json()
        r = requests.patch(f"{API}/flats/{f['id']}/status", headers=h, json={"status": "Available"}, timeout=30)
        assert r.status_code == 200 and not r.json().get("hold"), cur


def test_transfer_refuses_old_unit_on_hold_without_expiry():
    import uuid

    h = _h()
    f1, f2 = own_flats(API, h, 2)
    # xdist: our own QA customer — booking a story customer (e.g. portal persona Priya) puts a new booking first in
    # her portal list, and test_phase_a_print reads that list on the other worker
    cust = requests.post(
        f"{API}/customers",
        json={"full_name": f"QA Hold {uuid.uuid4().hex[:5]}", "phone": f"+9196{uuid.uuid4().int % 10**8:08d}"},
        headers={**h, "Idempotency-Key": str(uuid.uuid4())},
        timeout=30,
    ).json()
    price = f1["price"]
    body = {
        "flat_id": f1["id"],
        "customer_id": cust["id"],
        "booking_date": datetime.now(timezone.utc).date().isoformat(),
        "agreement_value": price,
        "cash_agreed": round(price * 0.6, 2),
        "account_agreed": round(price - round(price * 0.6, 2), 2),
        "remarks": "F2 transfer hold",
    }
    hk = lambda: {**h, "Idempotency-Key": str(uuid.uuid4())}  # noqa: E731
    b = requests.post(f"{API}/bookings", headers=hk(), json=body, timeout=60).json()
    try:
        move = {
            "new_flat_id": f2["id"],
            "reason": "F2 check",
            "price_handling": "keep_agreement",
            "old_flat_status": "Hold",
        }
        r = requests.post(f"{API}/bookings/{b['id']}/transfer", headers=hk(), json=move, timeout=60)
        assert r.status_code == 422 and r.json()["code"] == "HOLD_EXPIRY_REQUIRED", r.text
        assert (
            requests.get(f"{API}/bookings/{b['id']}", headers=h, timeout=30).json()["flat_id"] == f1["id"]
        )  # nothing moved
        r = requests.post(
            f"{API}/bookings/{b['id']}/transfer",
            headers=hk(),
            json={**move, "old_flat_hold_expires_at": _until()},
            timeout=60,
        )
        assert r.status_code == 200, r.text
        old = requests.get(f"{API}/flats/{f1['id']}", headers=h, timeout=30).json()
        assert old["status"] == "Hold" and old["hold"]["expires_at"]
    finally:
        requests.post(
            f"{API}/bookings/{b['id']}/cancel", headers=hk(), json={"reason": "F2 cleanup", "deduction": 0}, timeout=60
        )


def test_hold_doc_refuses_without_expiry():
    from routers.inventory import hold_doc

    with pytest.raises(ApiError) as e:
        hold_doc(None, {"id": "u"}, None)
    assert e.value.status_code == 422 and "Hold expiry is required" in str(e.value.detail)
    assert hold_doc(_until(), {"id": "u"}, "n")["expires_at"]


def test_second_reseed_while_one_runs_is_409():
    admin._reseed_lock_acquire()
    try:
        with pytest.raises(ApiError) as e:
            admin._reseed_lock_acquire()
        assert e.value.status_code == 409 and e.value.code == "RESEED_RUNNING"
    finally:
        admin._reseed_lock_release()
    admin._reseed_lock_acquire()  # free again once the first finishes
    admin._reseed_lock_release()
