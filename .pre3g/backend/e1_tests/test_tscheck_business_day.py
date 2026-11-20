"""JRN-31/32 — IST business day + picked date kept. Posts two payments on BK-2526-1349 and reverses both."""
import uuid, datetime, pytest

BK = "BK-2526-2219"


def _ctx(api):
    b = [x for x in api.get("/bookings", params={"search": BK}).json()["items"] if x["booking_number"] == BK][0]
    m = api.get("/master/payment-modes").json()
    m = m["items"] if isinstance(m, dict) else m
    return b["id"], [x["id"] for x in m if x["name"] == "Cash"][0]


def _post(api, day, amt):
    bid, mid = _ctx(api)
    r = api.post("/payments", headers={"Idempotency-Key": str(uuid.uuid4())}, json={
        "booking_id": bid, "amount": amt, "payment_date": day, "payment_mode_id": mid,
        "allocation": "auto", "remarks": f"tscheck-jrn31-{uuid.uuid4().hex[:6]}"})
    assert r.status_code in (200, 201), r.text
    return r.json()


def _ids(api, day):
    return [x["id"] for x in api.get("/roznamcha", params={"date": day}).json()["receipts"]]


def test_jrn31_today_is_ist_day(api):
    ist = (datetime.datetime.utcnow() + datetime.timedelta(hours=5, minutes=30)).date().isoformat()
    h = api.get("/dashboard/home").json()
    assert h["business_day"] == ist
    p = _post(api, h["business_day"], 1111)
    try:
        assert p["payment_date"] == ist
        assert p["id"] in _ids(api, ist)
        c = api.get("/reports/collections-v2", params={"from_date": ist, "to_date": ist}).json()["totals"]
        assert c["count"] >= 1 and c["total"] >= 1111
    finally:
        assert api.post(f"/payments/{p['id']}/reverse", json={"reason": "tscheck jrn31 cleanup"}).status_code == 200


def test_jrn32_picked_yesterday_kept(api):
    h = api.get("/dashboard/home").json()
    y = (datetime.date.fromisoformat(h["business_day"]) - datetime.timedelta(days=1)).isoformat()
    p = _post(api, y, 1212)
    try:
        assert p["payment_date"] == y
        assert p["id"] in _ids(api, y)
        assert p["id"] not in _ids(api, h["business_day"])
    finally:
        assert api.post(f"/payments/{p['id']}/reverse", json={"reason": "tscheck jrn32 cleanup"}).status_code == 200
