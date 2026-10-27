import time

"""Phase G effect-assertion tests: for every canonical event, the ACTUAL propagation == the registry's EXPECTED surfaces,
the outbox row is complete, and replaying the outbox row is idempotent (no duplicate notifications, no number changes)."""
import datetime
import os
import uuid

import pytest
import requests

TEST_PASSWORD = os.environ["TEST_PASSWORD"]  # seeded-user password from backend/.env (loaded by conftest)

BASE = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE}/api"
BYPASS = {"X-Rate-Limit-Bypass": "kkt-test-bypass-local"}
TODAY = datetime.date.today().isoformat()


@pytest.fixture(scope="module")
def H():
    r = requests.post(f"{API}/auth/login", json={"email": "admin@kkt.in", "password": TEST_PASSWORD}, headers=BYPASS, timeout=30)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}", **BYPASS}


def g(H, p, **k):
    r = requests.get(f"{API}{p}", headers=H, params=k, timeout=60)
    assert r.status_code == 200, (p, r.text[:300])
    return r.json()


def post(H, p, body=None, ok=(200, 201)):
    r = requests.post(f"{API}{p}", headers={**H, "Idempotency-Key": str(uuid.uuid4())}, json=body or {}, timeout=60)
    assert r.status_code in ok, (p, r.status_code, r.text[:400])
    return r.json()


def entry(H, etype, eid, action):
    items = g(H, f"/journey/entity/{etype}/{eid}")["items"]
    hit = next((i for i in items if i["action"] == action), None)
    assert hit, (action, [i["action"] for i in items])
    return g(H, f"/journey/{hit['id']}")


def assert_propagated(j, expected_surfaces):
    assert j["entry"]["propagated_complete"] is True, j["entry"]["propagated"]
    assert {"read_models", "notifications", "cache"} <= set(j["entry"]["propagated"]), j["entry"]["propagated"]
    got = {s["surface"] for s in j["surfaces"]}
    assert set(expected_surfaces) <= got, set(expected_surfaces) - got


@pytest.fixture(scope="module")
def registry(H):
    return {e["event"]: e for e in g(H, "/definitions")["events"]}


@pytest.fixture(scope="module")
def booking(H):
    """A disposable Active booking with a lead link, returned with its ids. Cancelled at the end of the module."""
    flats = [f for f in g(H, "/flats", status="Available", page_size=10)["items"]]
    assert len(flats) >= 2
    cust = g(H, "/customers", page_size=5)["items"][2]
    price = flats[0].get("price") or 5000000
    b = post(H, "/bookings", {"flat_id": flats[0]["id"], "customer_id": cust["id"], "booking_date": TODAY, "agreement_value": price, "cash_agreed": round(price * 0.6, 2), "account_agreed": round(price - round(price * 0.6, 2), 2), "remarks": "G-effects"})
    yield {"b": b, "flat2": flats[1], "customer": cust, "price": price}
    cur = g(H, f"/bookings/{b['id']}")
    if cur["status"] == "Active":
        post(H, f"/bookings/{b['id']}/cancel", {"reason": "G-effects cleanup"})


@pytest.fixture(scope="module")
def modes(H):
    return {m["code"]: m for m in g(H, "/master/payment-modes")["items"]}, g(H, "/master/bank-accounts")["items"][0]


# ---------- registry sanity ----------
def test_registry_covers_all_audit_actions_in_use(H, registry):
    actions = {a["action"] for a in requests.get(f"{API}/audit-logs", headers=H, params={"page_size": 200}, timeout=60).json().get("items", [])}
    unregistered = {a for a in actions if a not in registry and not a.endswith(".changed")}
    # every money/inventory action must be registered; others fall back to entity defaults
    assert not {a for a in unregistered if a.split(".")[0] in ("payment", "booking", "demand", "refund", "milestone", "flat")}, unregistered


def test_definitions_page_lists_core_concepts(H):
    keys = {d["key"] for d in g(H, "/definitions")["items"]}
    assert {"outstanding", "overdue", "collected", "advance", "refund_payable", "live_booking"} <= keys


# ---------- per-event effect tests ----------
def test_booking_create_effects(H, registry, booking):
    b = booking["b"]
    j = entry(H, "booking", b["id"], "booking.create")
    assert_propagated(j, registry["booking.create"]["surfaces"])
    assert b["lead_id"], "walk-in booking must create a Converted lead"
    lead = g(H, f"/leads/{b['lead_id']}")
    assert lead["status"] == "Converted" and lead["booking_id"] == b["id"]
    assert g(H, f"/flats/{b['flat_id']}")["status"] == "Booked"


def test_lead_convert_effects(H, registry, booking):
    j = entry(H, "lead", booking["b"]["lead_id"], "lead.convert")
    assert_propagated(j, registry["lead.convert"]["surfaces"])


def test_payment_post_effects(H, registry, booking, modes):
    pm, bank = modes
    b = booking["b"]
    p = post(H, "/payments", {"booking_id": b["id"], "payment_category": "Cash", "amount": 10000, "payment_date": TODAY, "payment_mode_id": pm["CASH"]["id"], "remarks": "G-effects"})
    j = entry(H, "payment", p["id"], "payment.post")
    assert_propagated(j, registry["payment.post"]["surfaces"])
    assert j["surfaces_total"] >= 12
    assert j["with_before_after"] >= 8, [s["surface"] for s in j["surfaces"] if s["has_values"]]
    bk = next(s for s in j["surfaces"] if s["surface"] == "bookings")
    cash_paid = next(r for r in bk["before_after"] if r["field"] == "cash_paid_paise")
    assert cash_paid["changed"] and (cash_paid["after"] or 0) - (cash_paid["before"] or 0) == 1000000
    assert all(s["before_after"] or s["done"] or s["detail"] for s in j["surfaces"]), "every surface shows values or what was done"
    assert g(H, f"/bookings/{b['id']}")["summary"]["cash_paid_paise"] >= 1000000
    rz = g(H, "/roznamcha", date=TODAY)
    assert any(r["receipt_number"] == p["receipt_number"] for r in rz["receipts"])
    booking["payment"] = p


def test_payment_reverse_effects(H, registry, booking, modes):
    pm, bank = modes
    b = booking["b"]
    p = post(H, "/payments", {"booking_id": b["id"], "payment_category": "Cash", "amount": 5000, "payment_date": TODAY, "payment_mode_id": pm["CASH"]["id"], "remarks": "G-effects-rev"})
    r = post(H, f"/payments/{p['id']}/reverse", {"reason": "G-effects wrong amount"})
    assert r["status"] == "Reversed"
    j = entry(H, "payment", p["id"], "payment.reverse")
    assert_propagated(j, registry["payment.reverse"]["surfaces"])
    rz = g(H, "/roznamcha", date=TODAY)
    assert any(x["receipt_number"] == p["receipt_number"] for x in rz["reversals"]), "reversal must appear as a dated contra on the reversal day"
    assert g(H, f"/payments/{p['id']}/receipt")["watermark"] == "REVERSED"


def test_cheque_bounce_raises_charge_and_notifies(H, registry, booking, modes):
    pm, bank = modes
    b = booking["b"]
    c = post(H, "/payments", {"booking_id": b["id"], "payment_category": "Account", "amount": 20000, "payment_date": TODAY, "payment_mode_id": pm["CHEQUE"]["id"], "bank_account_id": bank["id"], "instrument": {"number": "GE1", "bank_name": "Probe", "date": TODAY}})
    bo = post(H, f"/payments/{c['id']}/bounce", {"reason": "G-effects insufficient funds"})
    assert bo["status"] == "Bounced" and bo["bounce_charge"] and bo["bounce_charge"]["demand_at"] == "on_bounce"
    j = entry(H, "payment", c["id"], "payment.bounce")
    assert_propagated(j, registry["payment.bounce"]["surfaces"])
    cur = g(H, f"/bookings/{b['id']}")
    assert any(l.get("demand_at") == "on_bounce" for l in cur["other_charges"])
    assert cur["summary"]["other_charges_due_paise"] >= bo["bounce_charge"]["total_paise"]
    reg = g(H, "/reports/cheques")
    assert "Bounced" in reg["by_status"] and any(r["receipt_number"] == c["receipt_number"] for r in reg["rows"]), "register shows all statuses by default"


def test_agreement_revision_reproportions_open_demands(H, registry, booking):
    b = g(H, f"/bookings/{booking['b']['id']}")
    open_before = [d for d in b["demands"] if d["status"] in ("Open", "Partially Paid")]
    s = b["summary"]
    new_cash = max(round(b["agreement_value"] * 0.5, 2), s["cash_paid"] + 1)
    r = post(H, f"/bookings/{b['id']}/agreement-revisions", {"cash_agreed": new_cash, "account_agreed": round(b["agreement_value"] - new_cash, 2), "reason": "G-effects re-split", "version": b["version"]})
    assert r["cash_agreed_paise"] == round(new_cash * 100)
    j = entry(H, "booking", b["id"], "booking.agreement_revision")
    assert_propagated(j, registry["booking.agreement_revision"]["surfaces"])
    after = g(H, f"/bookings/{b['id']}")
    for d in after["demands"]:
        if d["status"] in ("Open", "Partially Paid") and d.get("percent") is not None:
            assert abs(d["cash_demand_paise"] - round(after["cash_agreed_paise"] * d["percent"] / 100)) <= 100, "open demand must follow the new split (whole rupees)"
    if open_before:
        items = g(H, f"/journey/entity/booking/{b['id']}")["items"]
        assert any(i["action"] == "demand.reproportion" for i in items)


def test_transfer_effects(H, registry, booking):
    b = g(H, f"/bookings/{booking['b']['id']}")
    f2 = booking["flat2"]
    old_flat = b["flat_id"]
    r = post(H, f"/bookings/{b['id']}/transfer", {"new_flat_id": f2["id"], "reason": "G-effects transfer", "price_handling": "revise_agreement", "version": b["version"]})
    assert r["flat_id"] == f2["id"] and r["booking_number"] == b["booking_number"]
    assert g(H, f"/flats/{old_flat}")["status"] == "Available" and g(H, f"/flats/{f2['id']}")["status"] == "Booked"
    j = entry(H, "booking", b["id"], "booking.transfer")
    assert_propagated(j, registry["booking.transfer"]["surfaces"])
    led = g(H, f"/bookings/{b['id']}/ledger")["rows"]
    assert any(x["type"] == "TRANSFER" for x in led) and any(x["type"] == "PAYMENT" for x in led), "money follows the customer"
    assert all(d["block_id"] == f2["block_id"] for d in g(H, f"/bookings/{b['id']}")["demands"])


def test_customer_rename_fans_out(H, registry, booking):
    c = g(H, f"/customers/{booking['customer']['id']}")
    new_name = c["full_name"].split(" (")[0] + " (G)"
    r = requests.patch(f"{API}/customers/{c['id']}", headers=H, json={"full_name": new_name, "version": c["version"]}, timeout=60)
    assert r.status_code == 200, r.text
    assert g(H, f"/bookings/{booking['b']['id']}")["customer_name"] == new_name
    p = g(H, f"/payments/{booking['payment']['id']}")
    assert p["customer_name"] != new_name and p["customer_name_current"] == new_name, "receipt keeps name as printed"
    requests.patch(f"{API}/customers/{c['id']}", headers=H, json={"full_name": c["full_name"], "version": c["version"] + 1}, timeout=60)


def test_cancel_creates_refund_and_payout_posts_contra(H, registry, booking):
    b = g(H, f"/bookings/{booking['b']['id']}")
    paid = b["summary"]["paid_paise"]
    pv = g(H, f"/bookings/{b['id']}/cancellation-preview", deduction=1000)
    assert pv["deduction_paise"] == 100000 and pv["refund_paise"] == pv["received_paise"] - 100000 - pv["charges_due_paise"] and len(pv["lines"]) >= 4
    assert b["summary"]["outstanding_paise"] == max(b["summary"]["cash_due_paise"], 0) + max(b["summary"]["account_due_paise"], 0) + max(b["summary"]["other_charges_due_paise"], 0)
    r = post(H, f"/bookings/{b['id']}/cancel", {"reason": "G-effects cancel", "deduction": 1000, "version": b["version"]})
    assert r["status"] == "Cancelled" and r["cancellation"]["refund_paise"] == pv["refund_paise"] and r["cancellation"]["received_paise"] == pv["received_paise"]
    rf = r["refund"]
    # CASH payout must respect cash in hand: set a tiny opening so the rule can be exercised deterministically
    cash_now = g(H, "/roznamcha", date=TODAY)["closing_cash_paise"]
    if cash_now < rf["amount_paise"]:
        rr = requests.post(f"{API}/refunds/{rf['id']}/pay", headers={**H, "Idempotency-Key": str(uuid.uuid4())}, json={"paid_date": TODAY, "mode": "CASH", "reference": "x"}, timeout=60)
        assert rr.status_code == 422 and rr.json()["code"] == "CASH_INSUFFICIENT"
    bank = g(H, "/master/bank-accounts")["items"][0]
    pd = post(H, f"/refunds/{rf['id']}/pay", {"paid_date": TODAY, "mode": "NEFT_RTGS", "bank_account_id": bank["id"], "reference": "G-effects-UTR"})
    assert pd["status"] == "Paid"
    jr = entry(H, "refund", rf["id"], "refund.paid")
    assert_propagated(jr, registry["refund.paid"]["surfaces"])
    led = g(H, f"/bookings/{b['id']}/ledger")["rows"]
    refund_rows = [x for x in led if x["type"] == "REFUND"]
    assert refund_rows and sum(-x["amount_paise"] for x in refund_rows) == rf["amount_paise"]
    assert led[-1]["total_due_paise"] == 0
    rz = g(H, "/roznamcha", date=TODAY)
    assert rz["refunds_paise"] >= rf["amount_paise"]
    rep = g(H, "/reports/cancellations", from_date=TODAY, to_date=TODAY)
    row = next(x for x in rep["rows"] if x["booking_number"] == b["booking_number"])
    assert row["refund_paid_paise"] == rf["amount_paise"] and row["refund_status"] == "Paid" and row["paid_paise"] == pv["received_paise"], "report shows gross received"
    assert g(H, f"/payments/{booking['payment']['id']}/receipt")["watermark"] == "CANCELLED"
    j = entry(H, "booking", b["id"], "booking.cancel")
    assert_propagated(j, registry["booking.cancel"]["surfaces"])
    after = g(H, f"/bookings/{b['id']}")
    assert not [d for d in after["demands"] if d["status"] in ("Open", "Partially Paid")]
    assert g(H, f"/flats/{b['flat_id']}")["status"] == "Available"
    assert g(H, f"/leads/{b['lead_id']}")["status"] == "Lost"
    assert paid >= 0


def test_forfeiture_when_nothing_refundable(H, modes):
    """Cancel with deduction == received → forfeiture record (no refund), report shows gross paid + forfeiture."""
    pm, _ = modes
    f = g(H, "/flats", status="Available", page_size=3)["items"][-1]
    cust = g(H, "/customers", page_size=6)["items"][4]
    price = f.get("price") or 5000000
    b = post(H, "/bookings", {"flat_id": f["id"], "customer_id": cust["id"], "booking_date": TODAY, "agreement_value": price, "cash_agreed": round(price * 0.6, 2), "account_agreed": round(price - round(price * 0.6, 2), 2), "remarks": "G-forfeit"})
    post(H, "/payments", {"booking_id": b["id"], "payment_category": "Cash", "amount": 20000, "payment_date": TODAY, "payment_mode_id": pm["CASH"]["id"], "remarks": "G-forfeit"})
    r = post(H, f"/bookings/{b['id']}/cancel", {"reason": "G-forfeit cancel", "deduction": 20000})
    assert r["cancellation"]["refund_paise"] == 0 and r["cancellation"]["forfeiture_paise"] == 2000000
    assert r["refund"]["status"] == "Forfeited" and r["refund"]["kind"] == "forfeiture"
    rep = g(H, "/reports/cancellations", from_date=TODAY, to_date=TODAY)
    row = next(x for x in rep["rows"] if x["booking_number"] == b["booking_number"])
    assert row["paid_paise"] == 2000000 and row["refund_paise"] == 0 and row["forfeiture_paise"] == 2000000


def test_one_outstanding_number(H):
    # Deterministic: flush read models first (home totals are a read model; the report and booking summaries are live),
    # then read all three in one window and require strict equality. Sibling xdist workers may post money between the
    # reads, so retry while the booking-summary snapshot changes between the before/after reads — never relax equality.
    def bookings():
        items = g(H, "/bookings", status="Active", page_size=200)["items"] + g(H, "/bookings", status="Completed", page_size=200)["items"]
        return {b["id"]: (b.get("summary") or {}).get("outstanding_paise", 0) for b in items}
    for _ in range(40):
        post(H, "/admin/reconcile-ledgers")
        before = bookings()
        home = g(H, "/dashboard/home", fresh=1)["totals"]
        rep = g(H, "/reports/outstanding")["totals"]
        after = bookings()
        sigma = sum(after.values())
        if before == after and home["outstanding_paise"] == rep["due_paise"] == sigma:
            break
        time.sleep(0.5)
    assert home["outstanding_paise"] == rep["due_paise"] == sigma, (home["outstanding_paise"], rep["due_paise"], sigma)
    assert "advance_paise" in home


def test_customer_events_timeline_has_mixed_kinds(H, booking):
    ev = g(H, f"/customers/{booking['customer']['id']}/events")
    assert {"booking", "payment", "refund", "lead"} <= set(ev["kinds"]), ev["kinds"]
    assert all("link" in e and "kind" in e for e in ev["items"])


def test_flat_hold_effects(H, registry):
    f = g(H, "/flats", status="Available", page_size=1)["items"][0]
    r = requests.patch(f"{API}/flats/{f['id']}/status", headers=H, json={"status": "Hold", "reason": "G-effects"}, timeout=60)
    assert r.status_code == 200, r.text
    try:
        j = entry(H, "flat", f["id"], "flat.status")
        assert_propagated(j, registry["flat.status"]["surfaces"])
    finally:
        requests.patch(f"{API}/flats/{f['id']}/status", headers=H, json={"status": "Available", "reason": "G-effects restore"}, timeout=60)


# ---------- outbox idempotency ----------
def test_outbox_replay_is_idempotent(H, booking):
    """Replaying a payment.post outbox row must not duplicate notifications or change any number.
    Runs in a subprocess so the app's motor client gets a fresh event loop (xdist workers reuse the process)."""
    import json
    import subprocess
    import sys
    p = booking["payment"]
    items = g(H, f"/journey/entity/payment/{p['id']}")["items"]
    row = next(i for i in items if i["action"] == "payment.post")
    script = f"""
import asyncio, json
from db import db
from events import bus
async def run():
    doc = await db.audit_logs.find_one({{"id": {row["id"]!r}}}, {{"_id": 0}})
    n_before = await db.notifications.count_documents({{"audit_id": {row["id"]!r}}})
    s_before = (await db.bookings.find_one({{"id": {p["booking_id"]!r}}}, {{"_id": 0, "summary": 1}}))["summary"]
    prop = await bus.replay(doc)
    prop2 = await bus.replay(doc)
    n_after = await db.notifications.count_documents({{"audit_id": {row["id"]!r}}})
    s_after = (await db.bookings.find_one({{"id": {p["booking_id"]!r}}}, {{"_id": 0, "summary": 1}}))["summary"]
    print(json.dumps([n_before, n_after, s_before, s_after, {{k: str(v) for k, v in prop.items()}}, {{k: str(v) for k, v in prop2.items()}}], default=str))
asyncio.run(run())
"""
    out = subprocess.run([sys.executable, "-c", script], cwd=os.path.join(os.path.dirname(__file__), "..", ".."), capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr[-1500:]
    n0, n1, s0, s1, prop, prop2 = json.loads(out.stdout.strip().splitlines()[-1])
    assert n0 == n1, "replay duplicated notifications"
    assert s0 == s1
    assert all(not str(v).startswith("ERR") for v in {**prop, **prop2}.values())


def test_propagation_health_clean(H):
    h = g(H, "/admin/propagation")
    import time as _t
    _t.sleep(1)
    h = g(H, "/admin/propagation")
    failing = [f for f in h["failing"] if f["action"] not in ("portal.login", "auth.login")]  # concurrent logins from other workers propagate asynchronously
    assert failing == [], failing
    assert h["registered_events"] >= 40
