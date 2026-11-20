"""Phase 3I REQ-355: Bills raised and Home ageing are kept ready per booking (booking markers in the database). After a
save on server A, the next read on A and on a second server B re-reads only the bookings the save moved — and must
equal a read computed from source records (a filter set never read before, so nothing kept applies)."""

import itertools
import os
import uuid
from datetime import date

import pytest
import requests
from pymongo import MongoClient

from services import definitions
from tests.conftest import BASE, TEST_DB, TEST_PORT
from tests.test_phase3i_noise_surfaces import spawn_backend

PORT3 = TEST_PORT + 8
_FRESH = itertools.count(1)
pytestmark = pytest.mark.load_sensitive  # whole-company totals: nothing else may write between the two reads


@pytest.fixture(scope="module")
def server_b():
    with spawn_backend(PORT3) as b:
        yield b


def _reg(base, h, **q):
    r = requests.get(f"{base}/api/demands/register", headers=h, params=q, timeout=120)
    assert r.status_code == 200, r.text[:200]
    return r.json()


def _fresh(base, h, **q):
    """Same rows as `q` (no bill is dated after 9999), but a key never computed before → read from source."""
    return _reg(base, h, **q, date_to=f"9999-12-{next(_FRESH) % 28 + 1:02d}")


def _pay(h, bid, amount=1000):
    md = {m["code"]: m["id"] for m in requests.get(f"{BASE}/api/master/payment-modes", headers=h).json()["items"]}
    r = requests.post(
        f"{BASE}/api/payments",
        json={
            "booking_id": bid,
            "amount": amount,
            "payment_date": date.today().isoformat(),
            "payment_mode_id": md["CASH"],
            "allocation": "auto",
            "remarks": "3I kept-ready",
        },
        headers={**h, "Idempotency-Key": uuid.uuid4().hex},
        timeout=60,
    )
    assert r.status_code == 201, r.text[:200]
    return r.json()


def _same(a: dict, b: dict):
    assert a["totals"] == b["totals"] and a["reconcile"] == b["reconcile"] and a["row_count"] == b["row_count"]
    assert a == b


@pytest.mark.parametrize("scope", ["company", "project"])
def test_bills_raised_after_receipt_and_reversal_equals_source_on_both_servers(
    admin_headers, work_booking, server_b, scope
):
    q = {"project_id": work_booking["project_id"]} if scope == "project" else {}
    for base in (BASE, server_b):
        _reg(base, admin_headers, **q)  # kept-ready state on both servers
    pay = _pay(admin_headers, work_booking["id"])
    after = [_reg(base, admin_headers, **q) for base in (BASE, server_b)]
    src = _fresh(BASE, admin_headers, **q)
    for x in after:
        _same(x, src)
    r = requests.post(
        f"{BASE}/api/payments/{pay['id']}/reverse", json={"reason": "3I kept-ready"}, headers=admin_headers
    )
    assert r.status_code == 200, r.text[:200]
    after = [_reg(base, admin_headers, **q) for base in (server_b, BASE)]
    src = _fresh(server_b, admin_headers, **q)
    for x in after:
        _same(x, src)


def test_home_ageing_after_receipt_equals_outstanding_from_source_on_both_servers(
    admin_headers, work_booking, server_b
):
    mongo = MongoClient(os.environ["MONGO_URL"])[TEST_DB]

    def ageing(base):
        r = requests.get(f"{base}/api/home/bundle", params={"period": "month"}, headers=admin_headers, timeout=120)
        assert r.status_code == 200
        return r.json()["widgets"]["ageing"]["data"]

    for base in (BASE, server_b):
        ageing(base)  # per-booking bands kept on both servers
    pay = _pay(admin_headers, work_booking["id"], 2500)
    cid = mongo.bookings.find_one({"id": work_booking["id"]})["company_id"]
    lt = [p["id"] for p in mongo.projects.find({"company_id": cid, "load_test": True}, {"id": 1})]
    match = definitions.live_bookings_match({"company_id": cid, "project_id": {"$nin": lt}})
    want = sum(
        definitions.outstanding(b.get("summary") or {})["total_paise"]
        for b in mongo.bookings.find(match, {"_id": 0, "summary": 1})
    )
    for base in (BASE, server_b):
        assert ageing(base)["total"]["amount_paise"] == want
    requests.post(f"{BASE}/api/payments/{pay['id']}/reverse", json={"reason": "3I kept-ready"}, headers=admin_headers)
