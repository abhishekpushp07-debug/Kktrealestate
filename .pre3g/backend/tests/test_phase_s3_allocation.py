"""Phase S3.1 — server-side automatic allocation: oldest open bill first across instalments and charge lines; reversal undoes every allocation."""

import uuid

import requests

from tests.conftest import BASE


def _get(h, path):
    r = requests.get(f"{BASE}/api{path}", headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def _post(h, path, body, code=201):
    r = requests.post(f"{BASE}/api{path}", json=body, headers={**h, "Idempotency-Key": uuid.uuid4().hex})
    assert r.status_code == code, f"{path}: {r.status_code} {r.text[:400]}"
    return r.json()


def _booking_without_plan(h, tag, cash=0, account=5000000):
    """Fresh project → empty tower → one floor from a floor template → price a flat → booking (no payment plan ⇒ no automatic bills)."""
    fts = _get(h, "/master/flat-types?page_size=50")["items"]
    ft = _post(
        h,
        "/floor-templates",
        {
            "name": f"S3 one {tag}",
            "positions": [{"pos": 1, "flat_type_id": fts[0]["id"]}, {"pos": 2, "flat_type_id": fts[0]["id"]}],
        },
    )
    proj = _post(
        h,
        "/projects",
        {
            "name": f"S3 Alloc {tag}",
            "code": f"S3{tag.upper()}"[:10],
            "project_type": "Residential",
            "address": {"city": "Indore"},
        },
    )
    res = _post(h, f"/projects/{proj['id']}/towers-from-template", {"name": "Tower S3", "code": "S3", "floors": 1})
    bid = res["block"]["id"]
    r = requests.post(
        f"{BASE}/api/blocks/{bid}/floors/1/apply-template", json={"floor_template_id": ft["id"]}, headers=h
    )
    assert r.status_code == 200, r.text
    flat = _get(h, f"/flats?block_id={bid}&page_size=10")["items"][0]
    requests.patch(
        f"{BASE}/api/flats/{flat['id']}/pricing",
        json={"saleable_sqft": 1000, "rate_per_sqft": 5000, "pricing_mode": "rate"},
        headers=h,
    ).raise_for_status()
    cust = _post(h, "/customers", {"full_name": f"S3 payer {tag}", "phone": f"9{uuid.uuid4().int % 10**9:09d}"})
    bk = _post(
        h,
        "/bookings",
        {
            "flat_id": flat["id"],
            "customer_id": cust["id"],
            "booking_date": "2026-01-15",
            "agreement_value": 5000000,
            "cash_agreed": cash,
            "account_agreed": account,
            "other_charges": [],
            "agreement_gst_percent": 0,
        },
    )
    return bk


def _demand(h, bk, name, amount, due):
    return _post(
        h,
        "/demands/manual",
        {"booking_id": bk["id"], "name": name, "account_amount": amount, "due_date": due, "demand_date": "2026-02-01"},
    )


def _reg(h, bk):
    """Demand statuses as the booking page / register show them (paid_paise is the ledger projection)."""
    return {
        d["demand_number"]: {**d, "balance_paise": d["total_demand_paise"] - (d.get("paid_paise") or 0)}
        for d in _get(h, f"/bookings/{bk['id']}")["demands"]
    }


def test_auto_allocation_oldest_first_then_advance_and_reversal(admin_headers):
    h = admin_headers
    tag = uuid.uuid4().hex[:5]
    bk = _booking_without_plan(h, tag)
    d1 = _demand(h, bk, "Instalment 1", 450000, "2026-03-01")
    d_park = _demand(h, bk, "Parking", 50000, "2026-03-01")
    d2 = _demand(h, bk, "Instalment 2", 300000, "2026-04-01")
    modes = _get(h, "/master/payment-modes?page_size=50")["items"]
    neft = next(m for m in modes if m["code"] == "NEFT_RTGS")
    bank = _get(h, "/master/bank-accounts?page_size=10")["items"][0]

    pv = _post(
        h,
        "/payments/allocation-preview",
        {"booking_id": bk["id"], "amount": 520000, "payment_mode_id": neft["id"]},
        200,
    )
    assert pv["bucket"] == "Account" and pv["advance_paise"] == 0
    assert [(a["demand_number"], a["amount_paise"]) for a in pv["allocations"]] == [
        (d1["demand_number"], 45000000),
        (d_park["demand_number"], 5000000),
        (d2["demand_number"], 2000000),
    ]

    p1 = _post(
        h,
        "/payments",
        {
            "booking_id": bk["id"],
            "allocation": "auto",
            "amount": 520000,
            "payment_date": "2026-03-05",
            "payment_mode_id": neft["id"],
            "bank_account_id": bank["id"],
            "instrument": {"number": f"UTR{tag}"},
        },
    )
    assert p1["status"] == "Cleared" and len(p1["allocations"]) == 3 and p1["allocations"] == pv["allocations"]
    reg = _reg(h, bk)
    assert reg[d1["demand_number"]]["status"] == "Paid" and reg[d_park["demand_number"]]["status"] == "Paid"
    assert (
        reg[d2["demand_number"]]["status"] == "Partially Paid" and reg[d2["demand_number"]]["balance_paise"] == 28000000
    )
    full = _get(h, f"/bookings/{bk['id']}")
    assert full["summary"]["balance_paise"] == 28000000 and full["summary"]["account_paid_paise"] == 52000000
    led = _get(h, f"/bookings/{bk['id']}/ledger")
    rows = [r for r in (led.get("rows") or led.get("items") or []) if r.get("ref") == p1["receipt_number"]]
    assert len(rows) == 3, "split receipt must produce one ledger row per allocation"
    pdf = requests.get(f"{BASE}/api/payments/{p1['id']}/receipt.pdf", headers=h)
    assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"

    p2 = _post(
        h,
        "/payments",
        {
            "booking_id": bk["id"],
            "allocation": "auto",
            "amount": 300000,
            "payment_date": "2026-04-05",
            "payment_mode_id": neft["id"],
            "bank_account_id": bank["id"],
            "instrument": {"number": f"UTR2{tag}"},
        },
    )
    assert [(a["kind"], a["amount_paise"]) for a in p2["allocations"]] == [
        ("FLAT_VALUE", 28000000),
        ("ADVANCE", 2000000),
    ]
    reg = _reg(h, bk)
    assert reg[d2["demand_number"]]["status"] == "Paid"
    full = _get(h, f"/bookings/{bk['id']}")
    assert full["summary"]["balance_paise"] == -2000000 and full["summary"]["account_paid_paise"] == 82000000

    # reversal of the split receipt undoes all three allocations
    r = requests.post(
        f"{BASE}/api/payments/{p1['id']}/reverse", json={"reason": "S3 test reversal of split receipt"}, headers=h
    )
    assert r.status_code == 200, r.text
    reg = _reg(h, bk)
    assert reg[d1["demand_number"]]["status"] in ("Partially Paid", "Open") and reg[d_park["demand_number"]][
        "status"
    ] in ("Open", "Partially Paid", "Paid")
    full = _get(h, f"/bookings/{bk['id']}")
    assert full["summary"]["account_paid_paise"] == 30000000 and full["summary"]["balance_paise"] == 50000000

    # manual mode unchanged: explicit bucket, no allocations
    p3 = _post(
        h,
        "/payments",
        {
            "booking_id": bk["id"],
            "allocation": "manual",
            "against": "FLAT_VALUE",
            "payment_category": "Account",
            "amount": 1000,
            "payment_date": "2026-04-06",
            "payment_mode_id": neft["id"],
            "bank_account_id": bank["id"],
            "instrument": {"number": f"UTR3{tag}"},
        },
    )
    assert p3.get("allocations") in (None, []) and p3["payment_category"] == "Account"
    requests.post(
        f"{BASE}/api/bookings/{bk['id']}/cancel",
        json={"reason": "S3 test cleanup", "version": _get(h, f"/bookings/{bk['id']}")["version"]},
        headers=h,
    )


def test_auto_allocation_rejects_bad_flag(admin_headers):
    r = requests.post(
        f"{BASE}/api/payments",
        json={
            "booking_id": "x",
            "allocation": "foo",
            "amount": 1,
            "payment_date": "2026-01-01",
            "payment_mode_id": "y",
        },
        headers={**admin_headers, "Idempotency-Key": uuid.uuid4().hex},
    )
    assert r.status_code == 422


def test_get_payment_includes_allocations_and_partial_detail(admin_headers):
    """Follow-up: GET /payments/{id} carries allocations[]; a one-bucket-settled bill explains itself in plain English."""
    h = admin_headers
    tag = uuid.uuid4().hex[:5]
    bk = _booking_without_plan(h, tag, cash=2000000, account=3000000)
    # one bill with both shares open: cash 1,00,000 + account 1,83,750
    d = _post(
        h,
        "/demands/manual",
        {
            "booking_id": bk["id"],
            "name": "Mixed bill",
            "cash_amount": 100000,
            "account_amount": 183750,
            "due_date": "2026-03-01",
            "demand_date": "2026-02-01",
        },
    )
    modes = _get(h, "/master/payment-modes?page_size=50")["items"]
    cash = next(m for m in modes if m["code"] == "CASH")
    p = _post(
        h,
        "/payments",
        {
            "booking_id": bk["id"],
            "allocation": "auto",
            "amount": 100000,
            "payment_date": "2026-03-02",
            "payment_mode_id": cash["id"],
        },
    )
    got = _get(h, f"/payments/{p['id']}")
    assert got["allocations"] == p["allocations"] and got["allocations"][0]["demand_number"] == d["demand_number"]
    dem = _reg(h, bk)[d["demand_number"]]
    assert dem["status"] == "Partially Paid"
    assert {k: v for k, v in dem["paid_parts"].items() if k.endswith("_paise")} == {
        "cash_paid_paise": 10000000,
        "cash_open_paise": 0,
        "account_paid_paise": 0,
        "account_open_paise": 18375000,
    }
    assert dem["paid_detail"] == "Cash part paid · Account ₹1,83,750 open"
    reg = _get(h, f"/demands/register?customer={bk['booking_number']}&basis=raised&per_group=100")

    def _vals(x):
        return x.values() if isinstance(x, dict) else x

    row = next(
        r
        for day in reg["groups"]
        for pg in _vals(day["projects"])
        for tg in _vals(pg["towers"])
        for r in tg["rows"]
        if r["demand_number"] == d["demand_number"]
    )
    assert row["paid_detail"] == "Cash part paid · Account ₹1,83,750 open"
    requests.post(
        f"{BASE}/api/bookings/{bk['id']}/cancel",
        json={"reason": "S3 follow-up cleanup", "version": _get(h, f"/bookings/{bk['id']}")["version"]},
        headers=h,
    )
