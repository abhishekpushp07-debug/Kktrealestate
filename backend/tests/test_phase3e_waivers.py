"""Phase 3E Part 5 (REQ-243…256): waiver request → approve / reject → cancel; money only on approval; ledger law,
cancellation refund on received money only, never a receipt."""

import pytest
import requests

from tests.conftest import BASE, TEST_PASSWORD
from tools.connection_matrix import Api, World


def _login(email):
    r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": TEST_PASSWORD}, timeout=30)
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _booking_with_account_bill(api, w):
    c = w.book()
    api.post(
        "/demands/manual", {"booking_id": c["bid"], "name": "QA 3E bill", "account_amount": 20000, "due_date": w.today}
    )
    return c


def test_waiver_request_pending_no_money_then_approve_credits_with_gst(admin_headers):
    api, acc = Api(BASE, admin_headers), Api(BASE, _login("accounts@kkt.in"))
    w = World(api)
    c = _booking_with_account_bill(api, w)
    b0 = api.get(f"/bookings/{c['bid']}")
    pays0 = api.get("/payments", booking_id=c["bid"])["total"]
    open_acc = b0["summary"]["account_due_paise"]
    assert open_acc >= 2000000
    acc.call(
        "POST",
        "/waivers",
        {
            "booking_id": c["bid"],
            "target": {"kind": "share", "share": "Account"},
            "amount": open_acc / 100 + 1,
            "reason": "QA over",
        },
        ok=(422,),
    )
    r = acc.post(
        "/waivers",
        {
            "booking_id": c["bid"],
            "target": {"kind": "share", "share": "Account"},
            "amount": 10000,
            "reason": "QA goodwill",
        },
    )
    assert r["status"] == "Pending" and r["waiver_number"].startswith("WV-")
    assert api.get(f"/bookings/{c['bid']}")["summary"]["balance_paise"] == b0["summary"]["balance_paise"]
    acc.call("POST", f"/waivers/{r['id']}/approve", ok=(403,))
    ok = api.post(f"/waivers/{r['id']}/approve")
    assert ok["status"] == "Approved" and ok["cn_number"].startswith("CN-") and ok["settles"]
    g = ok["gst_note"]["gst_paise"]
    s = api.get(f"/bookings/{c['bid']}")["summary"]
    assert s["account_waived_paise"] == 1000000 and s["waived_paise"] == 1000000 + g
    assert api.get("/payments", booking_id=c["bid"])["total"] == pays0  # never a receipt
    L = api.get(f"/bookings/{c['bid']}/ledger")
    assert any(x["type"] == "WAIVER" for x in L["rows"])
    pdf = requests.get(f"{BASE}/api/waivers/{r['id']}/credit-note.pdf", headers=admin_headers, timeout=30)
    assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"
    # cancel: exact reversal, numbers kept
    can = api.post(f"/waivers/{r['id']}/cancel", {"reason": "QA wrong booking"})
    assert can["status"] == "Cancelled" and can["cn_number"] == ok["cn_number"]
    s2 = api.get(f"/bookings/{c['bid']}")["summary"]
    assert s2["balance_paise"] == b0["summary"]["balance_paise"] and s2["waived_paise"] == 0
    reg = api.get("/reports/waiver-register", from_date=w.today, to_date=w.today)
    assert any(x["waiver_number"] == r["waiver_number"] and x["status"] == "Cancelled" for x in reg["rows"])


def test_reject_and_owner_self_approval(admin_headers):
    api, acc = Api(BASE, admin_headers), Api(BASE, _login("accounts@kkt.in"))
    w = World(api)
    c = _booking_with_account_bill(api, w)
    r = acc.post(
        "/waivers",
        {"booking_id": c["bid"], "target": {"kind": "share", "share": "Account"}, "amount": 500, "reason": "QA small"},
    )
    rej = api.post(f"/waivers/{r['id']}/reject", {"reason": "QA not justified"})
    assert rej["status"] == "Rejected"
    api.call("POST", f"/waivers/{r['id']}/approve", ok=(409,))
    own = api.post(
        "/waivers",
        {"booking_id": c["bid"], "target": {"kind": "share", "share": "Account"}, "amount": 700, "reason": "QA owner"},
    )
    assert own["status"] == "Approved" and own["self_approved"] is True


def test_cancellation_refund_counts_received_money_only(admin_headers):
    api = Api(BASE, admin_headers)
    w = World(api)
    c = _booking_with_account_bill(api, w)
    p0 = api.get(f"/bookings/{c['bid']}/cancellation-preview")
    api.post(
        "/waivers",
        {
            "booking_id": c["bid"],
            "target": {"kind": "share", "share": "Account"},
            "amount": 3000,
            "reason": "QA owner waiver",
        },
    )
    p1 = api.get(f"/bookings/{c['bid']}/cancellation-preview")
    assert p1["received_paise"] == p0["received_paise"]


def test_other_charge_waiver_targets_its_line_and_ledger_law_holds(admin_headers):
    api = Api(BASE, admin_headers)
    w = World(api)
    c = w.book()
    b = api.get(f"/bookings/{c['bid']}")
    line = next((x for x in b["other_charges"] if x["demanded_paise"] - x["paid_paise"] > 10000), None)
    if line is None:
        api.post(
            "/demands/manual",
            {
                "booking_id": c["bid"],
                "kind": "other_charge",
                "name": "QA 3E club",
                "cash_amount": 5000,
                "due_date": w.today,
            },
        )
        b = api.get(f"/bookings/{c['bid']}")
        line = next(x for x in b["other_charges"] if x["demanded_paise"] - x["paid_paise"] > 10000)
    open0 = line["demanded_paise"] - line["paid_paise"]
    ok = api.post(
        "/waivers",
        {
            "booking_id": c["bid"],
            "target": {"kind": "line", "line_id": line["line_id"]},
            "amount": 100,
            "reason": "QA charge waiver",
        },
    )
    assert ok["status"] == "Approved" and ok["entries"][0]["line_id"] == line["line_id"]
    b2 = api.get(f"/bookings/{c['bid']}")
    l2 = next(x for x in b2["other_charges"] if x["line_id"] == line["line_id"])
    assert l2["demanded_paise"] - l2["paid_paise"] == open0 - 10000
    s = b2["summary"]
    rows = api.get(f"/bookings/{c['bid']}/ledger")["rows"]
    assert (
        sum(r["udhar_paise"] for r in rows) - sum(r["jama_paise"] for r in rows)
        == s["total_udhar_paise"] - s["total_jama_paise"]
    )
    assert s["other_waived_paise"] == 10000


@pytest.mark.load_sensitive  # company-wide totals: nothing else may post between the two reads
def test_account_waiver_on_paid_gst_is_whole_rupees_and_advances_equal_outstanding(admin_headers):
    """3I close-out (owner decision A): an Account waiver whose agreement GST is already paid holds the GST credit as
    an other-charge advance; the Advances report counts it, so its total == Outstanding "advance held"."""
    api = Api(BASE, admin_headers)
    w = World(api)
    f = w.flat()
    b = api.post(
        "/bookings",
        {
            "flat_id": f["id"],
            "customer_id": w.customer()["id"],
            "booking_date": w.today,
            "agreement_value": f["price"],
            "cash_agreed": 0,
            "account_agreed": f["price"],
            "agreement_gst_percent": 5,
            "remarks": "connection matrix",
        },
    )
    c = {"bid": b["id"]}
    due = api.get(f"/bookings/{c['bid']}")["summary"]["outstanding_paise"]
    if due:
        w.pay(c, due / 100, mode="NEFT_RTGS", category="Account", allocation="auto", instrument={"number": "UTRQA3E"})
    api.post(
        "/demands/manual", {"booking_id": c["bid"], "name": "QA 3E bill", "account_amount": 20000, "due_date": w.today}
    )
    ok = api.post(
        "/waivers",
        {
            "booking_id": c["bid"],
            "target": {"kind": "share", "share": "Account"},
            "amount": 15000,
            "reason": "QA paid GST",
        },
    )
    note = ok["gst_note"]
    assert ok["status"] == "Approved" and note["gst_paise"] > 0 and note["gst_paise"] % 100 == 0
    assert note.get("held_as_advance_paise", 0) > 0
    s = api.get(f"/bookings/{c['bid']}")["summary"]
    assert s["other_charges_due_paise"] < 0
    adv = api.get("/reports/advances")
    mine = next(r for r in adv["rows"] if r["booking_number"] == b["booking_number"])
    assert mine["other_advance_paise"] == -s["other_charges_due_paise"]
    assert adv["totals"]["total_advance_paise"] == api.get("/reports/outstanding-v2")["totals"]["advance_paise"]
    api.post(f"/waivers/{ok['id']}/cancel", {"reason": "QA cleanup"})
    api.post(
        f"/bookings/{c['bid']}/cancel", {"reason": "QA cleanup", "version": api.get(f"/bookings/{c['bid']}")["version"]}
    )
