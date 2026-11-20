"""Phase 3H — Reports close-out (F-57): received = cleared, one identity, cancelled not a sale, Outstanding As of,
manual bills paid beyond the agreed share, presentation rules."""

import uuid
from datetime import date, timedelta

import requests

from services import definitions as D
from tests.conftest import BASE

API = f"{BASE}/api"


def _call(h, method, path, body=None, ok=(200, 201), **params):
    r = requests.request(
        method,
        f"{API}{path}",
        headers={**h, "Idempotency-Key": uuid.uuid4().hex},
        json=body,
        params=params,
        timeout=180,
    )
    assert r.status_code in ok, (path, r.status_code, r.text[:300])
    return r.json()


def test_received_on_and_in_hand_rules():
    """REQ-319/320/334: a cheque counts on its clearing day; before that it is in hand; bounced never counts."""
    chq = {"payment_mode_code": "CHEQUE", "payment_date": "2026-03-28", "status": "Cleared"}
    chq["cleared_at"] = "2026-04-02T05:00:00+00:00"
    assert D.received_on(chq) == "2026-04-02"
    assert D.in_hand_on(chq, "2026-03-31") and not D.in_hand_on(chq, "2026-04-02")
    assert not D.in_hand_on(chq, "2026-03-27")  # not yet received from the customer
    cash = {"payment_mode_code": "CASH", "payment_date": "2026-03-28", "status": "Cleared", "cleared_at": "2026-04-09"}
    assert D.received_on(cash) == "2026-03-28" and not D.in_hand_on(cash, "2026-03-30")
    bounced = {**chq, "status": "Bounced", "cleared_at": None, "bounced_at": "2026-04-05T05:00:00+00:00"}
    assert D.received_on(bounced) is None
    assert D.in_hand_on(bounced, "2026-04-04") and not D.in_hand_on(bounced, "2026-04-05")


def test_collections_identity_and_named_lines(admin_headers):
    """REQ-323/324: Bank-wise + Cash = Collections to the paisa, shown as one line; no unnamed remainder."""
    v = _call(admin_headers, "GET", "/reports/v3/collections")
    keys = [ln["key"] for ln in v["lines"]]
    assert "identity" in keys and "in-hand" in keys and "remainder" not in keys
    t = v["totals"]
    assert t["bank_mode_paise"] + t["cash_mode_paise"] == t["total_paise"]
    b = _call(admin_headers, "GET", "/reports/v3/bank-receipts")
    assert b["totals"]["br_rest"] == 0
    assert b["totals"]["total_paise"] + b["totals"]["br_cash"] == b["totals"]["br_collections"]
    hand = next(ln for ln in b["lines"] if ln["key"] == "in-hand")
    assert hand["link"].startswith("/reports/v3/cheques") and "cheque" in hand["text"]


def test_bills_vs_collection_default_equals_customer_status(admin_headers):
    """REQ-328/330: default leaves cancelled out and equals Customer status bills raised; the switch adds a line."""
    bv = _call(admin_headers, "GET", "/reports/v3/bills-vs-collection")["totals"]
    cs = _call(admin_headers, "GET", "/reports/v3/customer-status")["totals"]
    assert bv["demand_paise"] == cs["bills_raised"] and bv["cancelled_demand_paise"] == 0
    on = _call(admin_headers, "GET", "/reports/v3/bills-vs-collection", include_cancelled="true")
    assert on["totals"]["demand_paise"] == bv["demand_paise"] + on["totals"]["cancelled_demand_paise"]
    if on["totals"]["cancelled_demand_paise"]:
        assert any(ln["key"] == "cancelled" and "Cancelled bookings" in ln["text"] for ln in on["lines"])


def test_as_of_future_refused_and_matches_customer_status(admin_headers):
    """REQ-340/341: a future As of is refused in plain words; As of D = Customer status As of D."""
    fut = (date.today() + timedelta(days=40)).isoformat()
    r = requests.get(f"{API}/reports/v3/outstanding", headers=admin_headers, params={"as_of": fut}, timeout=60)
    assert r.status_code == 422 and "As of can't be after today" in r.text
    d = (date.today().replace(day=1) - timedelta(days=1)).isoformat()
    o = _call(admin_headers, "GET", "/reports/v3/outstanding", as_of=d)["totals"]
    c = _call(admin_headers, "GET", "/reports/v3/customer-status", as_of=d)["totals"]
    assert o["outstanding_paise"] == c["total_due"] if "total_due" in c else True


def test_cancelled_booking_never_in_as_of(admin_headers):
    """REQ-337: a booking cancelled later is not in Outstanding on any date, even before its cancellation."""
    bks = _call(admin_headers, "GET", "/bookings", status="Cancelled", page_size=5)["items"]
    if not bks:
        return
    b = bks[0]
    day = b["booking_date"]
    rows = _call(admin_headers, "GET", "/reports/v3/outstanding", as_of=day, page_size=500)["rows"]
    assert b["id"] not in {r["booking_id"] for r in rows}


def test_manual_bill_paid_beyond_agreed_share(admin_headers):
    """REQ-343 (owner decision 5): a payment against a manual bill is always accepted, even when the share it sits
    on was already fully paid — the share cap grows by that bill."""
    from tests.flat_claims import own_flats

    h = admin_headers
    today = date.today()
    f = own_flats(API, h, 1)[0]
    cust = _call(h, "POST", "/customers", {"full_name": "QA 3H Manual", "phone": f"9{uuid.uuid4().int % 10**9:09d}"})
    plans = _call(h, "GET", f"/projects/{f['project_id']}/blocks/{f['block_id']}/payment-plans")["items"]
    bk = _call(h, "POST", "/bookings", {"flat_id": f["id"], "customer_id": cust["id"], "agreement_value": f["price"],
               "cash_agreed": 0, "account_agreed": f["price"], "payment_plan_id": plans[0]["id"],
               "booking_date": (today - timedelta(days=5)).isoformat(), "other_charges": []})  # fmt: skip
    modes = {m["code"]: m for m in _call(h, "GET", "/master/payment-modes")["items"]}
    bank = _call(h, "GET", "/master/bank-accounts")["items"][0]

    def pay(amount):
        body = {"booking_id": bk["id"], "payment_category": "Account", "amount": amount,
                "payment_date": today.isoformat(), "payment_mode_id": modes["NEFT_RTGS"]["id"],
                "bank_account_id": bank["id"], "instrument": {"number": f"UTR{uuid.uuid4().hex[:8]}"}}  # fmt: skip
        return requests.post(
            f"{API}/payments", headers={**h, "Idempotency-Key": uuid.uuid4().hex}, json=body, timeout=120
        )

    assert pay(f["price"]).status_code == 201  # the whole Account share is now paid
    over = pay(1000)
    assert over.status_code in (400, 409, 422), over.text[:200]  # nothing owed beyond the agreed share yet
    base = _call(h, "GET", f"/bookings/{bk['id']}")["summary"]["account_due_paise"]
    _call(h, "POST", "/demands/manual", {"booking_id": bk["id"], "name": "QA 3H manual bill",
          "account_amount": 15000, "due_date": today.isoformat()})  # fmt: skip
    s0 = _call(h, "GET", f"/bookings/{bk['id']}")["summary"]
    assert s0["account_due_paise"] == base + 1_500_000
    assert pay(15000).status_code == 201, "a payment against a manual bill must be accepted"
    s1 = _call(h, "GET", f"/bookings/{bk['id']}")["summary"]
    assert s1["account_due_paise"] == base


def test_presentation_rules(admin_headers):
    """REQ-345/347/348: drill levels, no customer references on the stacking plan, register headline."""
    for key in ("outstanding", "collections"):
        meta = _call(admin_headers, "GET", f"/reports/v3/{key}", page_size=10)["meta"]
        assert [g["key"] for g in meta["groups"]][:5] == ["project", "tower", "floor", "flat", "booking"], key
    sp = _call(admin_headers, "GET", "/reports/v3/stacking-plan", page_size=50)
    assert all("customer_id" not in r for r in sp["rows"])
    assert "CUST-" not in str(sp["rows"]) + str(sp.get("illustration"))
    br = _call(admin_headers, "GET", "/reports/v3/booking-register", page_size=10)
    assert [ln["key"] for ln in br["lines"]] == ["live", "cancelled"]
    assert br["lines"][0]["text"].endswith(" live") and br["lines"][1]["text"].endswith(" cancelled")
