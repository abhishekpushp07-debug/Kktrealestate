"""Owner's ledger law on a refunded other charge (Σ Udhar − Σ Jama == outstanding − advance on every booking):
book → bill the other charge → pay it → cancel → refund the other-charge part (full and partial) → the law holds on the
booking ledger and summary, Customer 360, Outstanding report and Project statement."""

import uuid

import pytest

from tests.conftest import BASE
from tests.flat_claims import own_flats
from tools import connection_matrix as cm


def _tower_outstanding(api, ctx):  # tower-scoped: other workers share the project
    t = api.get("/reports/outstanding-v2", project_id=ctx["pid"], block_id=ctx["blid"])["totals"]
    return {k: t.get(f"{k}_paise") for k in ("outstanding", "advance", "bill_raised", "received")}


def _law(s):
    return s["total_udhar_paise"] - s["total_jama_paise"] == s["outstanding_paise"] - s["advance_paise"]


@pytest.fixture(scope="module")
def world(admin_headers):
    api = cm.Api(BASE, admin_headers)
    flats = own_flats(api.base, api.h, 2, rate=4100)
    modes = {m["code"]: m for m in api.get("/master/payment-modes")["items"]}
    return api, flats, modes, api.get("/master/bank-accounts")["items"][0], cm._today(api)


@pytest.mark.parametrize("deduction", [0, 1], ids=["full", "partial"])
def test_refund_of_other_charge_keeps_the_law(world, deduction):
    api, flats, modes, bank, today = world
    f = flats[deduction]
    tag = uuid.uuid4().hex[:6]
    cust = api.post("/customers", {"full_name": f"Refund Law {tag}", "phone": f"+9196{int(tag, 16) % 10**8:08d}"})
    price = f["price"]
    b = api.post(
        "/bookings",
        {
            "flat_id": f["id"],
            "customer_id": cust["id"],
            "booking_date": today,
            "agreement_value": price,
            "cash_agreed": 0,
            "account_agreed": price,
        },
    )
    line = next(x for x in api.get(f"/bookings/{b['id']}")["other_charges"] if (x.get("demanded_paise") or 0) > 0)
    api.post(
        "/payments",
        {
            "booking_id": b["id"],
            "against": "OTHER_CHARGE",
            "other_charge_line_id": line["line_id"],
            "amount": line["demanded_paise"] / 100,
            "payment_date": today,
            "payment_mode_id": modes["NEFT_RTGS"]["id"],
            "bank_account_id": bank["id"],
            "instrument": {"number": f"UTR{tag}"},
        },
    )
    ctx = {"pid": f["project_id"], "blid": f["block_id"], "today": today}
    v = api.get(f"/bookings/{b['id']}")["version"]
    api.post(f"/bookings/{b['id']}/cancel", {"reason": "refund law", "deduction": deduction, "version": v})
    rf = next(r for r in api.get(f"/bookings/{b['id']}/refunds")["items"] if r["status"] == "Pending")
    assert rf["split"]["Other"] > 0, rf
    out0, ps0 = _tower_outstanding(api, ctx), cm.s_pstatement(api, ctx)
    api.post(
        f"/refunds/{rf['id']}/pay",
        {"paid_date": today, "mode": "NEFT_RTGS", "bank_account_id": bank["id"], "reference": f"RF{tag}"},
    )
    bk = api.get(f"/bookings/{b['id']}")
    s = bk["summary"]
    assert _law(s), s
    rows = api.get(f"/bookings/{b['id']}/ledger")["rows"]
    assert any(r["type"] == "REFUND" and r.get("category") == "Other" for r in rows), rows
    assert sum(r["udhar_paise"] for r in rows) - sum(r["jama_paise"] for r in rows) == (
        s["outstanding_paise"] - s["advance_paise"]
    )
    e = next(x for x in api.get(f"/customers/{cust['id']}")["bookings"] if x["id"] == b["id"])
    assert _law(e["summary"]), e["summary"]
    assert _tower_outstanding(api, ctx) == out0  # paying a refund never moves dues on live bookings
    assert cm.s_pstatement(api, ctx) == ps0
    assert s["outstanding_paise"] == 0, s
