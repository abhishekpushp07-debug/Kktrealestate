import datetime, uuid
from conftest import login, qa_booking, CASH_MODE

def _cs(c, bid):
    for p in range(1, 10):
        r = c.get("/reports/v3/customer-status", params={"page": p, "page_size": 200}).json()
        for x in r["rows"]:
            if x["booking_id"] == bid: return x
        if len(r["rows"]) < 200: return None
def _out(c, bid):
    for x in c.get("/reports/outstanding-v2").json()["rows"]:
        if x.get("_link") == f"/bookings/{bid}": return x

def test_fresh_after_receipt_and_waiver():
    c = login("admin@kkt.in")
    _, bk = qa_booking(c, "tscheck-3g-fresh", discount=0); bid = bk["id"]
    s0 = c.get(f"/bookings/{bid}").json()["summary"]; cs0 = _cs(c, bid); o0 = _out(c, bid)
    col0 = c.get("/reports/collections-v2").json()
    r = c.post("/payments", headers={"Idempotency-Key": f"tscheck-{uuid.uuid4().hex}"}, json={"booking_id":bid,"payment_category":"Cash","against":"FLAT_VALUE","amount":5000,
        "payment_date":datetime.date.today().isoformat(),"payment_mode_id":CASH_MODE,"remarks":"tscheck-3g-fresh"})
    assert r.status_code == 201, r.text
    s1 = c.get(f"/bookings/{bid}").json()["summary"]
    assert s1["total_jama_paise"] - s0["total_jama_paise"] == 500000
    cs1 = _cs(c, bid); assert cs1 and cs1["cash_received"] - (cs0 or {}).get("cash_received", 0) == 500000, (cs0, cs1)
    o1 = _out(c, bid); assert o1 and o1["jama_paise"] - (o0 or {}).get("jama_paise", 0) == 500000, (o0, o1)
    cust = c.get(f"/customers/{bk['customer_id']}/payments").json()
    items = cust if isinstance(cust, list) else cust.get("items", [])
    assert any(p.get("id") == r.json()["id"] for p in items)
    col1 = c.get("/reports/collections-v2").json()
    assert str(col0.get("totals")) != str(col1.get("totals")), "collections totals unchanged"
    w = login("accounts@kkt.in").post("/waivers", json={"booking_id":bid,"target":{"kind":"share","share":"Account"},"amount":2000,"reason":"tscheck-3g-fresh"}).json()
    o_before = _out(c, bid)
    assert c.post(f"/waivers/{w['id']}/approve", json={}).status_code == 200
    o_after = _out(c, bid)
    assert o_after["waived_paise"] - o_before["waived_paise"] >= 200000 and o_after["outstanding_paise"] < o_before["outstanding_paise"], (o_before["waived_paise"], o_after["waived_paise"])
