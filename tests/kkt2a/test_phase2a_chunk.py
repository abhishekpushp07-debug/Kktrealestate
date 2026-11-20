# Phase 2 chunk 2A regression: Home freshness, booking journey, create-booking speed/consistency, hold sweep, after-commit drain.
# Runs against the PREVIEW public URL. Everything created here is cleaned up (payment reversed, booking cancelled, hold released).
import os
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE:
    for line in open("/app/frontend/.env"):
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE = line.split("=", 1)[1].strip().rstrip("/")
API = BASE + "/api"
ST = {}  # shared state across ordered tests


def _tok():
    r = requests.post(API + "/auth/login", json={"email": "admin@kkt.in", "password": "Kkt@12345"}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


H = {"Authorization": "Bearer " + _tok()}


def call(m, p, body=None, **params):
    h = dict(H)
    if m != "GET":
        h["Idempotency-Key"] = str(uuid.uuid4())
    t0 = time.perf_counter()
    r = requests.request(m, API + p, headers=h, json=body, params=params or None, timeout=60)
    r.elapsed_s = time.perf_counter() - t0
    return r


def home_paid():
    r = call("GET", "/dashboard/home")
    assert r.status_code == 200
    return r.json()["totals"]["paid_paise"]


def today():
    return call("GET", "/dashboard/home").json().get("business_day") or datetime.now().date().isoformat()


# ---- regression
def test_openapi():
    r = call("GET", "/openapi.json")
    assert r.status_code == 200 and "paths" in r.json()


# ---- after-commit drain endpoint
def test_after_commit_drain():
    r = call("POST", "/admin/ops/after-commit/drain")
    print("drain", r.status_code, r.text[:200], f"{r.elapsed_s:.2f}s")
    assert r.status_code == 200 and r.json() == {"pending": 0}


def test_drain_needs_permission():
    r = requests.post(API + "/auth/login", json={"email": "employee@kkt.in", "password": "Kkt@12345"}, timeout=30)
    if r.status_code != 200:
        pytest.skip("employee login unavailable")
    h = {"Authorization": "Bearer " + r.json()["access_token"], "Idempotency-Key": str(uuid.uuid4())}
    r1 = requests.post(API + "/admin/ops/after-commit/drain", headers=h, timeout=30)
    r2 = requests.post(API + "/inventory/holds/expire-sweep", headers={**h, "Idempotency-Key": str(uuid.uuid4())}, timeout=30)
    print("employee drain", r1.status_code, "sweep", r2.status_code)
    assert r1.status_code == 403 and r2.status_code == 403


# ---- create booking speed + consistency
def test_create_booking_fast_and_consistent():
    day = today()
    ST["day"] = day
    flats = call("GET", "/flats", status="Available", page_size=200).json()["items"]
    cands = [f for f in flats if f["project_code"] == "GGV" and f.get("price") and f.get("bookable", True)]
    assert cands, "no Available GGV P flat"
    f = cands[0]
    ST["flat"] = f
    ST["hold_flat"] = cands[1] if len(cands) > 1 else None
    tag = uuid.uuid4().hex[:6]
    c = call("POST", "/customers", {"full_name": f"TEST_2A {tag}", "phone": f"+9197{int(tag, 16) % 10**8:08d}"})
    assert c.status_code in (200, 201), c.text
    ST["cust"] = c.json()["id"]
    price = f["price"]
    body = {
        "flat_id": f["id"], "customer_id": ST["cust"], "booking_date": day, "agreement_value": price,
        "cash_agreed": round(price / 2, 2), "account_agreed": round(price - round(price / 2, 2), 2),
        "remarks": "TEST_2A chunk",
    }
    r = call("POST", "/bookings", body)
    print("create booking", r.status_code, f"{r.elapsed_s:.3f}s", "Server-Timing:", r.headers.get("Server-Timing"))
    assert r.status_code == 201, r.text[:400]
    b = r.json()
    ST["bid"] = b["id"]
    ST["bno"] = b.get("booking_number")
    st = r.headers.get("Server-Timing", "")
    assert "bk_dues" in st and "bk_uow" in st, st
    assert r.elapsed_s < 1.5, f"create booking took {r.elapsed_s:.2f}s"
    g = call("GET", f"/bookings/{ST['bid']}").json()
    print("summary", {k: v for k, v in (g.get("summary") or {}).items() if "bill" in k or "paid" in k})
    assert (g.get("summary") or {}).get("total_bill_raised_paise", 0) > 0
    led = call("GET", f"/bookings/{ST['bid']}/ledger").json()
    rows = led.get("rows") or led.get("items") or led.get("entries") or []
    print("ledger keys", list(led.keys())[:10], "rows", len(rows))
    assert len(rows) > 0


def test_auto_documents_appear():
    assert ST.get("bid")
    types = set()
    t0 = time.time()
    while time.time() - t0 < 10:
        it = call("GET", "/docgen/register", booking_id=ST["bid"], page_size=50).json().get("items", [])
        types = {d["type"] for d in it}
        if len(types) >= 3:
            break
        time.sleep(0.5)
    print("docs after", round(time.time() - t0, 1), "s:", types)
    assert types, "no auto documents"


# ---- home freshness after Cash payment
def test_home_paid_fresh_after_payment():
    assert ST.get("bid")
    before = home_paid()
    ST["paid_before"] = before
    modes = {m["code"]: m["id"] for m in call("GET", "/master/payment-modes").json()["items"]}
    r = call("POST", "/payments", {
        "booking_id": ST["bid"], "payment_category": "Cash", "amount": 2500, "payment_date": ST["day"],
        "payment_mode_id": modes["CASH"], "remarks": "TEST_2A payment"})
    print("payment", r.status_code, f"{r.elapsed_s:.3f}s", r.text[:150])
    assert r.status_code == 201, r.text
    ST["pay"] = r.json()["id"]
    seen = []
    t0 = time.time()
    for _ in range(14):  # read immediately and repeatedly for ~12 s (the old bug re-cached stale totals for 10 s)
        seen.append((round(time.time() - t0, 1), home_paid() - before))
        time.sleep(0.8)
    print("home paid delta over time", seen)
    fresh = [s for s in seen if s[0] <= 5 and s[1] == 250000]
    assert fresh, "Home paid never reflected the payment within 5 s"
    first_ok = next(s[0] for s in seen if s[1] == 250000)
    later = [s for s in seen if s[0] >= first_ok]
    assert all(s[1] == 250000 for s in later), f"Home regressed after being fresh: {seen}"


# ---- booking journey shows payment entries + before/after
def test_journey_lists_payment_and_values():
    assert ST.get("pay")
    j = call("GET", f"/journey/entity/booking/{ST['bid']}").json()["items"]
    acts = [x["action"] for x in j]
    print("journey actions", acts)
    pe = next((x for x in j if x["action"] == "payment.post"), None)
    assert pe, acts
    ST["audit"] = pe["id"]
    r = call("GET", f"/journey/{pe['id']}")
    d = r.json()
    print("journey detail", r.status_code, f"{r.elapsed_s:.2f}s", "with_before_after", d.get("with_before_after"),
          "snapshot", d.get("snapshot_available"))
    assert d["with_before_after"] > 0


def test_reverse_payment_home_returns():
    assert ST.get("pay")
    r = call("POST", f"/payments/{ST['pay']}/reverse", {"reason": "TEST_2A cleanup reverse"})
    print("reverse", r.status_code, r.text[:150])
    assert r.status_code in (200, 201), r.text
    ST["reversed"] = True
    t0, ok = time.time(), False
    while time.time() - t0 < 5:
        if home_paid() == ST["paid_before"]:
            ok = True
            break
        time.sleep(0.5)
    print("home back after", round(time.time() - t0, 1), "s ok=", ok)
    assert ok
    acts = [x["action"] for x in call("GET", f"/journey/entity/booking/{ST['bid']}").json()["items"]]
    print("journey after reverse", acts)
    assert "payment.reverse" in acts


def test_cancel_booking():
    assert ST.get("bid")
    v = call("GET", f"/bookings/{ST['bid']}").json()["version"]
    r = call("POST", f"/bookings/{ST['bid']}/cancel", {"reason": "TEST_2A cleanup", "deduction": 0, "version": v})
    print("cancel", r.status_code, r.text[:200])
    assert r.status_code in (200, 201)
    ST["cancelled"] = True
    fl = call("GET", f"/flats/{ST['flat']['id']}").json()
    print("flat after cancel", fl.get("status"))
    assert fl.get("status") == "Available"


# ---- hold expiry sweep
def test_hold_expiry_sweep():
    f = ST.get("hold_flat")
    if not f:
        pytest.skip("no 2nd flat")
    reason = call("GET", "/master/hold-reasons").json()["items"][0]["id"]
    until = (datetime.now(timezone.utc) + timedelta(seconds=4)).isoformat()
    r = call("POST", "/inventory/bulk", {"flat_ids": [f["id"]], "action": "hold", "reason_id": reason,
                                         "expires_at": until, "note": "TEST_2A hold"})
    print("hold", r.status_code, r.text[:200])
    assert r.status_code in (200, 201)
    try:
        assert call("GET", f"/flats/{f['id']}").json()["status"] == "Hold"
        early = call("POST", "/inventory/holds/expire-sweep")
        print("early sweep", early.status_code, early.text[:200])
        assert call("GET", f"/flats/{f['id']}").json()["status"] == "Hold", "released before expiry"
        time.sleep(6)
        s = call("POST", "/inventory/holds/expire-sweep")
        print("sweep", s.status_code, s.text[:300])
        assert s.status_code == 200
        assert call("GET", f"/flats/{f['id']}").json()["status"] == "Available"
    finally:
        if call("GET", f"/flats/{f['id']}").json()["status"] == "Hold":
            call("POST", "/inventory/bulk", {"flat_ids": [f["id"]], "action": "release", "note": "TEST_2A release"})


@pytest.fixture(scope="module", autouse=True)
def _cleanup():
    yield
    if ST.get("pay") and not ST.get("reversed"):
        call("POST", f"/payments/{ST['pay']}/reverse", {"reason": "TEST_2A cleanup reverse"})
    if ST.get("bid") and not ST.get("cancelled"):
        v = call("GET", f"/bookings/{ST['bid']}").json()["version"]
        call("POST", f"/bookings/{ST['bid']}/cancel", {"reason": "TEST_2A cleanup", "deduction": 0, "version": v})
