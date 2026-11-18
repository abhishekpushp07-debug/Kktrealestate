"""Q-12 / JRN-31, 32, 34: the business day is the India calendar day (changes at 00:00 IST). Frozen-clock checks at 00:30 IST
and 05:29 IST (UTC date is still the previous day) across receipt, reversal, cancel→refund, forfeiture, Roznamcha,
cancellations report and Home tiles; a date the user picks is kept. The server clock is frozen with the seeder X-As-Of."""

import os
import random
import uuid
from datetime import UTC, datetime, time, timedelta

import pytest
import requests

from services import clock
from services.numbering import financial_year
from tests.flat_claims import own_flats

BASE = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE}/api"
BYPASS = {"X-Rate-Limit-Bypass": os.environ.get("LOGIN_RATE_LIMIT_BYPASS_TOKEN", "kkt-test-bypass-local")}
TEST_PASSWORD = os.environ["TEST_PASSWORD"]


def _at(d, hh, mm):
    return datetime.combine(d, time(hh, mm), tzinfo=clock.business_tz())


# ---------- the helper itself (no server) ----------
@pytest.mark.parametrize("hh,mm", [(0, 30), (5, 29)])
def test_today_is_the_india_day_in_the_utc_lag_window(hh, mm):
    d = clock.today() - timedelta(days=1)
    t = _at(d, hh, mm)
    assert t.astimezone(UTC).date() == d - timedelta(days=1)  # the UTC date still says yesterday
    tok = clock.AS_OF.set(t.astimezone(UTC))
    try:
        assert clock.today() == d and clock.today_iso() == d.isoformat()
        assert clock.day_of(clock.now().isoformat()) == d.isoformat()
        rng = clock.day_range(d)
        assert rng["$gte"] <= clock.now().isoformat() <= rng["$lte"]
        prev = clock.day_range(d - timedelta(days=1))
        assert not (prev["$gte"] <= clock.now().isoformat() <= prev["$lte"])
    finally:
        clock.AS_OF.reset(tok)


def test_day_helpers_bounds_and_passthrough():
    assert clock.day_of("2026-11-16") == "2026-11-16"
    assert clock.day_of("2026-11-15T18:30:00+00:00") == "2026-11-16"
    assert clock.day_of("2026-11-15T18:29:59.999999+00:00") == "2026-11-15"
    assert clock.day_start_utc("2026-11-16") == "2026-11-15T18:30:00+00:00"
    assert clock.day_end_utc("2026-11-16") == "2026-11-16T18:29:59.999999+00:00"
    assert clock.to_utc_iso(datetime(2026, 11, 16, 11, 0)) == "2026-11-16T05:30:00+00:00"  # naive = business time
    assert clock.business_tz().key == "Asia/Kolkata"


def test_financial_year_turns_at_india_midnight_on_1_april():
    tok = clock.AS_OF.set(_at(datetime(2027, 4, 1).date(), 0, 30).astimezone(UTC))
    try:
        assert financial_year() == "2728"
    finally:
        clock.AS_OF.reset(tok)


# ---------- end-to-end with the server clock frozen ----------
@pytest.fixture(scope="module")
def H():
    r = requests.post(
        f"{API}/auth/login", json={"email": "admin@kkt.in", "password": TEST_PASSWORD}, headers=BYPASS, timeout=30
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}", **BYPASS}


@pytest.fixture(scope="module")
def ctx(H):
    modes = {m["code"]: m for m in requests.get(f"{API}/master/payment-modes", headers=H, timeout=30).json()["items"]}
    bank = requests.get(f"{API}/master/bank-accounts", headers=H, timeout=30).json()["items"][0]
    mine = own_flats(API, H, 6)  # its own tower: no other test can book these flats
    cust = requests.get(f"{API}/customers", headers=H, params={"page_size": 10}, timeout=30).json()["items"]
    return {"modes": modes, "bank": bank, "flats": mine, "cust": cust[-1]}


def call(H, method, p, body=None, as_of=None, **params):
    h = {**H, "Idempotency-Key": str(uuid.uuid4())}
    if as_of is not None:
        h["X-As-Of"] = as_of.isoformat()
    r = requests.request(method, f"{API}{p}", headers=h, json=body, params=params, timeout=60)
    assert r.status_code in (200, 201), (method, p, r.status_code, r.text[:400])
    return r.json()


def _book(H, ctx, flat, booking_date, T):
    price = flat.get("price") or 5000000
    return call(
        H,
        "POST",
        "/bookings",
        {
            "flat_id": flat["id"],
            "customer_id": ctx["cust"]["id"],
            "booking_date": booking_date,
            "agreement_value": price,
            "cash_agreed": round(price * 0.6, 2),
            "account_agreed": round(price - round(price * 0.6, 2), 2),
            "remarks": "Q-12 business day",
        },
        as_of=T,
    )


def _cash(H, ctx, b, amount, pay_date, T):
    body = {
        "booking_id": b["id"],
        "payment_category": "Cash",
        "amount": amount,
        "payment_date": pay_date,
        "payment_mode_id": ctx["modes"]["CASH"]["id"],
        "remarks": "Q-12",
    }
    return call(H, "POST", "/payments", body, as_of=T)


@pytest.mark.parametrize("hh,mm,slot", [(0, 30, 0), (5, 29, 3)])
def test_late_night_entries_land_on_the_india_day(H, ctx, hh, mm, slot):
    D = clock.today() - timedelta(days=1)
    T, d, prev = _at(D, hh, mm), D.isoformat(), (D - timedelta(days=1)).isoformat()
    f1, f2 = ctx["flats"][slot], ctx["flats"][slot + 1]
    # receipt + reversal (JRN-31): the form date = today (D); the stamps and Roznamcha land on D, not on the UTC date
    b = _book(H, ctx, f1, d, T)
    keep = _cash(H, ctx, b, 7000, d, T)
    wrong = _cash(H, ctx, b, 3000, d, T)
    assert keep["payment_date"] == d and clock.day_of(keep.get("posted_at") or keep["created_at"]) == d
    rv = call(H, "POST", f"/payments/{wrong['id']}/reverse", {"reason": "Q-12 wrong amount"}, as_of=T)
    assert rv["status"] == "Reversed" and clock.day_of(rv["reversal"]["at"]) == d
    led = call(H, "GET", f"/bookings/{b['id']}/ledger")["rows"]
    assert {x["date"] for x in led if x["type"] in ("PAYMENT", "REVERSAL")} == {d}, led
    rz = call(H, "GET", "/roznamcha", date=d)
    assert any(x["receipt_number"] == wrong["receipt_number"] for x in rz["reversals"])
    assert any(x["receipt_number"] == keep["receipt_number"] for x in rz["receipts"])
    assert not any(
        x["receipt_number"] == wrong["receipt_number"] for x in call(H, "GET", "/roznamcha", date=prev)["reversals"]
    )
    groups = {
        g["group"]
        for g in call(H, "GET", "/reports/collections-v2", from_date=d, to_date=d, group_by="receipt")["rows"]
    }
    assert {keep["receipt_number"], f"{wrong['receipt_number']} (reversal)"} <= groups, groups
    # Home tiles under the frozen clock: today's money + follow-ups due today (JRN-33 rule)
    lead = call(
        H, "POST", "/leads", {"name": "Q12 Follow Up", "phone": f"9{random.randint(100000000, 999999999)}"}, as_of=T
    )
    due = _at(D, 11, 0).isoformat()
    call(H, "POST", f"/leads/{lead['id']}/follow-ups", {"note": "Q-12 call back", "next_follow_up_at": due}, as_of=T)
    due_ids = {x["id"] for x in call(H, "GET", "/leads", as_of=T, due_today="true", page_size=200)["items"]}
    assert lead["id"] in due_ids
    earlier = {
        x["id"]
        for x in call(H, "GET", "/leads", as_of=_at(D - timedelta(days=1), 12, 0), due_today="true", page_size=200)[
            "items"
        ]
    }
    assert lead["id"] not in earlier
    home = call(H, "GET", "/dashboard", as_of=T)
    assert home["collections"]["today"]["total_paise"] >= 700000 and home["collections"]["today"]["count"] >= 1
    assert home["follow_ups_due"]["count"] >= 1
    # cancel → refund: cancellation and refund are stamped D; the cancellations report for D has the booking, D-1 does not
    c = call(H, "POST", f"/bookings/{b['id']}/cancel", {"reason": "Q-12 cancel", "deduction": 1000}, as_of=T)
    assert clock.day_of(c["cancellation"]["at"]) == d and c["refund"]["amount_paise"] > 0
    pd = call(
        H,
        "POST",
        f"/refunds/{c['refund']['id']}/pay",
        {"paid_date": d, "mode": "NEFT_RTGS", "bank_account_id": ctx["bank"]["id"], "reference": "Q12-UTR"},
        as_of=T,
    )
    assert pd["status"] == "Paid" and pd["paid_date"] == d
    # forfeiture: deduction == received
    b2 = _book(H, ctx, f2, d, T)
    _cash(H, ctx, b2, 20000, d, T)
    c2 = call(H, "POST", f"/bookings/{b2['id']}/cancel", {"reason": "Q-12 forfeit", "deduction": 20000}, as_of=T)
    assert c2["refund"]["kind"] == "forfeiture" and clock.day_of(c2["cancellation"]["at"]) == d
    rep = {r["booking_number"]: r for r in call(H, "GET", "/reports/cancellations", from_date=d, to_date=d)["rows"]}
    assert (
        rep[b["booking_number"]]["refund_status"] == "Paid" and rep[b2["booking_number"]]["forfeiture_paise"] == 2000000
    )
    old = {r["booking_number"] for r in call(H, "GET", "/reports/cancellations", from_date=prev, to_date=prev)["rows"]}
    assert not {b["booking_number"], b2["booking_number"]} & old
    assert call(H, "GET", "/roznamcha", date=d)["refunds_paise"] >= c["refund"]["amount_paise"]


def test_a_picked_date_is_kept(H, ctx):
    """JRN-32: a payment dated yesterday on the form keeps yesterday, also when saved at 00:30 IST."""
    D = clock.today()
    T, y = _at(D, 0, 30), (D - timedelta(days=1)).isoformat()
    if T > datetime.now(UTC):
        T = _at(D - timedelta(days=1), 0, 30)
        D, y = D - timedelta(days=1), (D - timedelta(days=2)).isoformat()
    b = _book(H, ctx, ctx["flats"][5], y, T)
    try:
        p = _cash(H, ctx, b, 4000, y, T)
        assert p["payment_date"] == y
        rz_y = call(H, "GET", "/roznamcha", date=y)["receipts"]
        assert any(x["receipt_number"] == p["receipt_number"] for x in rz_y)
        rz_d = call(H, "GET", "/roznamcha", date=D.isoformat())["receipts"]
        assert not any(x["receipt_number"] == p["receipt_number"] for x in rz_d)
    finally:  # never leave a live test booking behind (startup-migration test copies the DB)
        call(H, "POST", f"/bookings/{b['id']}/cancel", {"reason": "JRN-32 cleanup", "deduction": 0})
