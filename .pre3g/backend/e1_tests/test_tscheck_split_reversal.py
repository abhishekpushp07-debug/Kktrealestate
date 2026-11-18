"""JRN-11/12/14/15/13 — split receipt, roznamcha, reports agree, booking summary vs ledger, reversal.
Creates ONE cash payment on BK-2526-1995 (remark tscheck-jrn11-*) and reverses it at the end."""
import uuid, json, pytest

BK = "BK-2526-1995"
AMT = 683725
CASH_MODE = "Cash"
_state = {}


def _home_split(api):
    h = api.get("/dashboard/home").json()
    m = [x for x in h["collections_12m"] if x["month"] == h["business_day"][:7]][0]
    return h["business_day"], {"Cash": m["Cash"], "Account": m["Account"], "Other": m["Other"]}


def _booking(api):
    for b in api.get("/bookings", params={"search": BK}).json()["items"]:
        if b["booking_number"] == BK:
            return b


def _mode_id(api):
    d = api.get("/master/payment-modes").json()
    d = d["items"] if isinstance(d, dict) else d
    return [m["id"] for m in d if m["name"] == CASH_MODE][0]


def _rz(api, day):
    return api.get("/roznamcha", params={"date": day}).json()


@pytest.fixture(scope="module")
def posted(api):
    day, before = _home_split(api)
    b = _booking(api)
    rz_before = _rz(api, day)
    _state["sum_before"] = api.get(f"/bookings/{b['id']}").json()["summary"]
    prev = api.post("/payments/allocation-preview", json={"booking_id": b["id"], "amount": AMT, "payment_mode_id": _mode_id(api)}).json()
    r = api.post("/payments", headers={"Idempotency-Key": str(uuid.uuid4())}, json={
        "booking_id": b["id"], "amount": AMT, "payment_date": day, "payment_mode_id": _mode_id(api),
        "allocation": "auto", "remarks": f"tscheck-jrn11-{uuid.uuid4().hex[:6]}"})
    assert r.status_code in (200, 201), r.text
    p = r.json()
    _state.update(day=day, before=before, booking=b, rz_before=rz_before, preview=prev, pay=p)
    yield _state
    # safety net: reverse if a test died before JRN-13
    if not _state.get("reversed"):
        api.post(f"/payments/{p['id']}/reverse", json={"reason": "tscheck cleanup"})


def test_jrn11_split_buckets(api, posted):
    p = posted["pay"]
    print("PAYMENT", json.dumps(p)[:1500])
    print("PREVIEW", json.dumps(posted["preview"])[:1200])
    _, after = _home_split(api)
    d = {k: round(after[k] - posted["before"][k], 2) for k in after}
    print("DELTA", d)
    assert round(sum(d.values()), 2) == AMT
    allocs = posted["preview"]["allocations"]
    inst = sum(a["amount"] for a in allocs if a["kind"] == "FLAT_VALUE")
    chg = sum(a["amount"] for a in allocs if a["kind"] == "OTHER_CHARGE")
    assert d["Cash"] == inst and d["Other"] == chg and d["Account"] == 0
    # receipt's own applied-to lines carry the same parts
    pa = api.get(f"/payments/{p['id']}").json()
    lines = pa.get("allocations") or []
    print("APPLIED", json.dumps(lines)[:800])
    got = round(sum(l.get("amount", 0) for l in lines), 2)
    assert got == AMT, lines
    # NOTE: briefing expected instalment 294,528 + Club 103,000; build applies oldest-due first
    # (Club 103,000 + GST 147,264 due 2025-04-16, then Brickwork 147,264 due 2026-11-25).
    print("SPLIT instalment", inst, "charges", chg)


def test_jrn12_roznamcha_cash(api, posted):
    rz = _rz(api, posted["day"])
    ids = [x["id"] for x in rz["receipts"]]
    assert posted["pay"]["id"] in ids
    assert round(rz["cash_received"] - posted["rz_before"]["cash_received"], 2) == AMT, (rz["cash_received"], posted["rz_before"]["cash_received"])


def test_jrn14_reports_agree_home(api, posted):
    day, home = _home_split(api)
    t = api.get("/reports/collections-v2", params={"from_date": day[:8] + "01", "to_date": day}).json()["totals"]
    assert (t["cash"], t["account"], t["other"]) == (home["Cash"], home["Account"], home["Other"])
    assert round(t["cash"] + t["account"] + t["other"], 2) == t["total"]


def test_jrn15_summary_vs_ledger(api, posted):
    b = posted["booking"]
    s = api.get(f"/bookings/{b['id']}").json()["summary"]
    rows = api.get(f"/bookings/{b['id']}/ledger").json()["rows"]
    last = rows[-1]
    assert (s["cash_paid"], s["account_paid"]) == (last["cash_paid_cum"], last["account_paid_cum"])
    types = sorted({r["type"] for r in rows})
    print("TYPES", types)
    cash = sum(r["amount"] for r in rows if r["type"] in ("PAYMENT",) and r.get("category") == "Cash")
    acct = sum(r["amount"] for r in rows if r["type"] in ("PAYMENT",) and r.get("category") == "Account")
    print("LEDGER SUMS", cash, acct, "SUMMARY", s["cash_paid"], s["account_paid"])
    assert round(cash, 2) == s["cash_paid"] and round(acct, 2) == s["account_paid"]


def test_jrn13_reversal_restores(api, posted):
    p = posted["pay"]
    r = api.post(f"/payments/{p['id']}/reverse", json={"reason": "tscheck-jrn13 reversal"})
    assert r.status_code == 200, r.text
    posted["reversed"] = True
    _, after = _home_split(api)
    assert after == posted["before"], (after, posted["before"])
    rz = _rz(api, posted["day"])
    print("REVERSALS", json.dumps(rz["reversals"])[:600])
    assert any(p["id"] in json.dumps(x) or p.get("receipt_number", "~") in json.dumps(x) for x in rz["reversals"])
    s = api.get(f"/bookings/{posted['booking']['id']}").json()["summary"]
    assert s["cash_due"] == posted["sum_before"]["cash_due"]
    t = api.get("/reports/collections-v2", params={"from_date": posted["day"][:8] + "01", "to_date": posted["day"]}).json()["totals"]
    print("REPORT AFTER REVERSAL", t, after)
    assert (t["cash"], t["account"], t["other"]) == (after["Cash"], after["Account"], after["Other"])
    assert round(t["cash"] + t["account"] + t["other"], 2) == t["total"]
    prev = api.post("/payments/allocation-preview", json={"booking_id": posted["booking"]["id"], "amount": AMT, "payment_mode_id": _mode_id(api)}).json()
    assert prev == posted["preview"]
