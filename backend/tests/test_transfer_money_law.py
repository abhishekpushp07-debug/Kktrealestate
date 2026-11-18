"""D1 / HANDOFF §3 money law: for every booking Σ Bill raised − Σ Received == Outstanding − Advance, also after a transfer
(with and without a prior agreement revision): booking summary, booking ledger, outstanding report and Customer 360."""

import os
import uuid

import pytest
import requests

from services import clock
from tests.flat_claims import own_flats

BASE = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE}/api"
BYPASS = {"X-Rate-Limit-Bypass": os.environ.get("LOGIN_RATE_LIMIT_BYPASS_TOKEN", "kkt-test-bypass-local")}


@pytest.fixture(scope="module")
def H():
    r = requests.post(
        f"{API}/auth/login",
        json={"email": "admin@kkt.in", "password": os.environ["TEST_PASSWORD"]},
        headers=BYPASS,
        timeout=30,
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}", **BYPASS}


def call(H, method, p, body=None, **params):
    h = {**H, "Idempotency-Key": str(uuid.uuid4())}
    r = requests.request(method, f"{API}{p}", headers=h, json=body, params=params, timeout=60)
    assert r.status_code in (200, 201), (method, p, r.status_code, r.text[:400])
    return r.json()


def assert_law(H, bid, customer_id):
    b = call(H, "GET", f"/bookings/{bid}")
    s = b["summary"]
    assert s["total_udhar_paise"] - s["total_jama_paise"] == s["outstanding_paise"] - s["advance_paise"], s
    rows = call(H, "GET", f"/bookings/{bid}/ledger")["rows"]
    assert sum(r["udhar_paise"] for r in rows) - sum(r["jama_paise"] for r in rows) == s["net_balance_paise"]
    rep = call(H, "GET", "/reports/outstanding-v2")["rows"]
    row = next(r for r in rep if r["group"] == b["booking_number"])
    assert row["udhar_paise"] - row["jama_paise"] == row["outstanding_paise"] - row["advance_paise"], row
    assert row["net_balance_paise"] == s["net_balance_paise"]
    c360 = call(H, "GET", f"/customers/{customer_id}/panels")["summary"]
    assert c360["udhar_paise"] - c360["jama_paise"] == c360["balance_paise"], c360
    return b


@pytest.mark.parametrize("revise_first", [False, True])
def test_transfer_keeps_the_money_law(H, revise_first):
    f1, f2 = own_flats(API, H, 2)  # its own tower: never competes with other tests for shared flat supply
    cust = call(H, "GET", "/customers", page_size=12)["items"][-2 - revise_first]
    price = f1["price"]
    today = clock.today_iso()
    b = call(
        H,
        "POST",
        "/bookings",
        {
            "flat_id": f1["id"],
            "customer_id": cust["id"],
            "booking_date": today,
            "agreement_value": price,
            "cash_agreed": round(price * 0.6, 2),
            "account_agreed": round(price - round(price * 0.6, 2), 2),
            "remarks": "D1 transfer law",
        },
    )
    try:
        modes = {m["code"]: m for m in call(H, "GET", "/master/payment-modes")["items"]}
        raised = call(H, "GET", f"/bookings/{b['id']}")["summary"]
        assert raised["total_udhar_paise"] > 0, "booking instalment raised a bill"
        cash_room = (round(price * 0.6 * 100) - raised["cash_order_raised_paise"]) // 100
        assert cash_room > 1, raised
        extra = min(5000, cash_room - 1)  # leaves a Cash advance within the agreed Cash bucket
        part = max(1, raised["cash_order_raised_paise"] // 200)
        for amt in (part, raised["cash_order_raised_paise"] // 100 - part + extra):  # partial, then into advance
            call(
                H,
                "POST",
                "/payments",
                {
                    "booking_id": b["id"],
                    "payment_category": "Cash",
                    "amount": amt,
                    "payment_date": today,
                    "payment_mode_id": modes["CASH"]["id"],
                    "remarks": "D1",
                },
            )
        before = assert_law(H, b["id"], cust["id"])
        assert before["summary"]["advance_paise"] > 0, before["summary"]
        if revise_first:
            av = before["agreement_value"]
            call(
                H,
                "POST",
                f"/bookings/{b['id']}/agreement-revisions",
                {
                    "cash_agreed": round(av * 0.5, 2),
                    "account_agreed": round(av - round(av * 0.5, 2), 2),
                    "reason": "D1 re-split",
                },
            )
            assert_law(H, b["id"], cust["id"])
        cur = call(H, "GET", f"/bookings/{b['id']}")
        call(
            H,
            "POST",
            f"/bookings/{b['id']}/transfer",
            {
                "new_flat_id": f2["id"],
                "reason": "D1 transfer",
                "price_handling": "revise_agreement",
                "version": cur["version"],
            },
        )
        after = assert_law(H, b["id"], cust["id"])
        assert after["flat_id"] == f2["id"] and after["agreement_value_paise"] == round(f2["price"] * 100)
        assert after["summary"]["paid_paise"] == before["summary"]["paid_paise"], "money follows the customer"
    finally:  # never leave a half-finished booking for other tests
        call(H, "POST", f"/bookings/{b['id']}/cancel", {"reason": "D1 cleanup", "deduction": 0})
