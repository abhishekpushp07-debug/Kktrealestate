"""Phase S2 API: agreement-signed endpoint + PaymentIn.allocation (auto|manual) validation."""

import datetime as dt
import os
import uuid
from pathlib import Path

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    for line in Path("/app/frontend/.env").read_text().splitlines(True):
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().rstrip("/")


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    r = sess.post(f"{BASE_URL}/api/auth/login", json={"email": "admin@kkt.in", "password": os.environ["TEST_PASSWORD"]})
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code}")
    sess.headers["Authorization"] = f"Bearer {r.json()['access_token']}"
    return sess


@pytest.fixture(scope="module")
def booking(s):
    items = s.get(f"{BASE_URL}/api/bookings", params={"status": "Active", "page_size": 200}).json()["items"]
    for b in items:
        if (b.get("summary") or {}).get("cash_due", 0) > 5000:
            return b
    pytest.skip("no active booking with cash due")


@pytest.fixture(scope="module")
def cash_mode(s):
    modes = s.get(f"{BASE_URL}/api/master/payment-modes").json()["items"]
    return next(m for m in modes if m["code"] == "CASH")


# Agreement signed endpoint
class TestAgreementSigned:
    def test_mark_whatsapp_then_restore(self, s, booking):
        bid = booking["id"]
        orig = booking.get("plan_acceptance") or {}
        if orig.get("marked_at"):  # 3E: re-marking is refused; the owner/admin corrects with a reason instead
            r = s.post(f"{BASE_URL}/api/bookings/{bid}/agreement-signed", json={"mode": "WhatsApp"})
            assert r.status_code == 409 and r.json()["code"] == "ALREADY_SIGNED", r.text
            r = s.post(
                f"{BASE_URL}/api/bookings/{bid}/agreement-signed/correct",
                json={"mode": "WhatsApp", "signed_on": orig["accepted_on"], "reason": "QA mode check"},
            )
        else:
            r = s.post(f"{BASE_URL}/api/bookings/{bid}/agreement-signed", json={"mode": "WhatsApp"})
        assert r.status_code == 200, r.text
        assert r.json()["plan_acceptance"]["mode"] == "WhatsApp"
        g = s.get(f"{BASE_URL}/api/bookings/{bid}").json()
        b = g.get("booking", g)
        assert b["plan_acceptance"]["mode"] == "WhatsApp"
        if orig.get("marked_at"):  # restore the original mode
            rr = s.post(
                f"{BASE_URL}/api/bookings/{bid}/agreement-signed/correct",
                json={
                    "mode": orig.get("mode") or "In person",
                    "signed_on": orig["accepted_on"],
                    "reason": "QA restore",
                },
            )
            assert rr.status_code == 200

    def test_invalid_mode_422(self, s, booking):
        r = s.post(f"{BASE_URL}/api/bookings/{booking['id']}/agreement-signed", json={"mode": "Pigeon"})
        assert r.status_code == 422

    def test_unknown_booking_404(self, s):
        r = s.post(f"{BASE_URL}/api/bookings/does-not-exist/agreement-signed", json={"mode": "Email"})
        assert r.status_code == 404


# Payment allocation field
class TestPaymentAllocation:
    def _body(self, booking, cash_mode, **kw):
        return {
            "booking_id": booking["id"],
            "against": "FLAT_VALUE",
            "payment_category": "Cash",
            "amount": 1000,
            "payment_date": dt.date.today().isoformat(),
            "payment_mode_id": cash_mode["id"],
            "remarks": "TEST_S2 allocation",
            **kw,
        }

    def test_invalid_allocation_422(self, s, booking, cash_mode):
        r = s.post(
            f"{BASE_URL}/api/payments",
            json=self._body(booking, cash_mode, allocation="foo"),
            headers={"Idempotency-Key": str(uuid.uuid4())},
        )
        assert r.status_code == 422, r.text

    def test_auto_allocation_persisted(self, s, booking, cash_mode):
        r = s.post(
            f"{BASE_URL}/api/payments",
            json=self._body(booking, cash_mode, allocation="auto"),
            headers={"Idempotency-Key": str(uuid.uuid4())},
        )
        assert r.status_code == 201, r.text
        p = r.json()
        p = p.get("payment", p)
        pid = p["id"]
        g = s.get(f"{BASE_URL}/api/payments/{pid}")
        assert g.status_code == 200
        print("stored payment", {k: g.json().get(k) for k in ("allocation", "status", "amount", "receipt_number")})
        assert g.json().get("allocation") == "auto" or p.get("allocation") == "auto", (g.json(), p)
