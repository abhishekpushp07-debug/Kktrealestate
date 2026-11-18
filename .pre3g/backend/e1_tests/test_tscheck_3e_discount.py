from conftest import qa_booking, SGH
import datetime as dt
def test_discount_recorded_and_in_register(api):
    cust, b = qa_booking(api, "Disc", discount=150000, reason="QA tscheck festive")
    d = api.get(f"/bookings/{b['id']}").json()["discount"]
    assert d["status"] == "recorded" and d["amount"] == 150000 and d["reason"] == "QA tscheck festive", d
    assert d["list"] - d["agreed"] == 150000
    t = dt.date.today().isoformat()
    r = api.get("/reports/discount-register", params={"from_date":t,"to_date":t})
    assert r.status_code == 200, r.text
    assert b["booking_number"] in r.text, r.text[:500]
    # money unaffected: agreement = cash+account
    assert b["agreement_value"] == b["cash_agreed"] + b["account_agreed"]
def test_discount_needs_reason(api):
    fl = [f for f in api.get("/flats", params={"project_id":SGH,"status":"Available","limit":100}).json()["items"] if f.get("bookable")][0]
    from conftest import qa_customer
    c = qa_customer(api, "DiscNoReason"); av = fl["price"]-50000
    r = api.post("/bookings", json={"flat_id":fl["id"],"customer_id":c["id"],"booking_date":dt.date.today().isoformat(),"agreement_value":av,"cash_agreed":0,"account_agreed":av})
    assert r.status_code == 422 and "reason" in r.text.lower(), r.text
def test_demo_has_revision_discount(api):
    r = api.get("/reports/discount-register", params={"from_date":"2024-04-01","to_date":dt.date.today().isoformat()})
    assert r.status_code == 200
    assert "revision" in r.text.lower(), r.text[:800]
