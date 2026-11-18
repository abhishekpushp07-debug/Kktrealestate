"""§3M consistency fixes. REQ-167: an explicit 0 cancellation deduction is saved as 0 (= preview); blank uses the
policy, from the same function. REQ-168: undoing a stage stamps the removed bills' auto-generated letters VOID."""

import time
import uuid

import pytest

from tests.conftest import BASE
from tests.flat_claims import own_flats
from tools import connection_matrix as cm


@pytest.fixture(scope="module")
def world(admin_headers):
    api = cm.Api(BASE, admin_headers)
    flats = own_flats(api.base, api.h, 3, rate=4300)
    modes = {m["code"]: m for m in api.get("/master/payment-modes")["items"]}
    return api, flats, modes, api.get("/master/bank-accounts")["items"][0], cm._today(api)


def _book_and_pay(world, i):
    api, flats, modes, bank, today = world
    f, tag = flats[i], uuid.uuid4().hex[:6]
    cust = api.post("/customers", {"full_name": f"Phase3M QA {tag}", "phone": f"+9195{int(tag, 16) % 10**8:08d}"})
    b = api.post(
        "/bookings",
        {
            "flat_id": f["id"],
            "customer_id": cust["id"],
            "booking_date": today,
            "agreement_value": f["price"],
            "cash_agreed": 0,
            "account_agreed": f["price"],
        },
    )
    api.post(
        "/payments",
        {
            "booking_id": b["id"],
            "amount": 200000,
            "payment_date": today,
            "payment_mode_id": modes["NEFT_RTGS"]["id"],
            "bank_account_id": bank["id"],
            "payment_category": "Account",
            "instrument": {"number": f"UTR{tag}"},
        },
    )
    return api, api.get(f"/bookings/{b['id']}")


@pytest.mark.parametrize("explicit", [True, False], ids=["explicit-0", "blank-policy"])
def test_cancel_deduction_saved_equals_preview(world, explicit):
    api, b = _book_and_pay(world, 0 if explicit else 1)
    pv = api.get(f"/bookings/{b['id']}/cancellation-preview", **({"deduction": 0} if explicit else {}))
    body = {"reason": "REQ-167 check", "version": b["version"], **({"deduction": 0} if explicit else {})}
    api.post(f"/bookings/{b['id']}/cancel", body)
    saved = api.get(f"/bookings/{b['id']}")["cancellation"]
    assert saved["deduction_paise"] == pv["deduction_paise"], (saved, pv)
    assert saved["refund_paise"] == pv["refund_paise"], (saved, pv)
    if explicit:
        assert saved["deduction_paise"] == 0
    else:
        assert pv["deduction_paise"] > 0, "policy deduction expected on a paid booking"


def test_stage_undo_voids_the_removed_bills_letters(world):
    api, b = _book_and_pay(world, 2)
    today = world[4]
    ins = [i for i in b["payment_plan_snapshot"]["installments"] if i["trigger_type"] == "ON_STAGE"]
    stages = {s["stage_id"]: s for s in api.get(f"/blocks/{b['block_id']}/construction")["stages"]}
    target = min((i for i in ins if stages[i["trigger_stage_id"]]["status"] != "Completed"), key=lambda i: i["seq"])
    before = {d["id"] for d in api.get(f"/reports/statement/{b['id']}")["demands"]}
    api.post(
        f"/blocks/{b['block_id']}/construction/stage", {"stage_id": target["trigger_stage_id"], "completed_on": today}
    )
    new = [d for d in api.get(f"/reports/statement/{b['id']}")["demands"] if d["id"] not in before]
    assert new, "stage raised no bill"
    numbers = {d["demand_number"] for d in new}
    docs = lambda: [  # noqa: E731
        d
        for d in api.get("/docgen/register", booking_id=b["id"], type="demand", limit=100)["items"]
        if d.get("number") in numbers
    ]
    for _ in range(40):  # letters are generated right after the response
        if docs():
            break
        time.sleep(0.5)
    assert docs() and not any(d.get("voided") for d in docs()), "auto bill letter expected after the stage"
    blk = api.get(f"/blocks/{b['block_id']}")
    api.post(f"/blocks/{b['block_id']}/construction/undo", {"reason": "REQ-168 check", "version": blk["version"]})
    assert docs() and all(d.get("voided") for d in docs()), docs()
