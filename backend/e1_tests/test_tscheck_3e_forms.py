import datetime as dt, uuid
H = lambda: {"Idempotency-Key": str(uuid.uuid4())}
B = None
NEFT = "f8f3f9ce-37f7-4b48-9803-1025f0c25ee8"; CHEQUE = "3a78eb1c-9a36-465a-9533-87c447bed465"
def _qa_booking_id(api):
    r = api.get("/bookings", params={"search":"QA tscheck","limit":5}); items = r.json()["items"]
    assert items, "no QA booking"; assert items[0]["customer_name"].startswith("QA "); return items[0]["id"]
def test_payment_needs_bank_and_reference(api):
    bid = _qa_booking_id(api); t = dt.date.today().isoformat()
    r = api.post("/payments", json={"booking_id":bid,"amount":100,"payment_date":t,"payment_mode_id":NEFT,"payment_category":"Account","instrument":{"number":"QA1"}}, headers=H())
    assert r.status_code in (400,409,422) and "bank" in r.text.lower(), (r.status_code, r.text[:300])
    r = api.post("/payments", json={"booking_id":bid,"amount":100,"payment_date":t,"payment_mode_id":CHEQUE,"payment_category":"Account","bank_account_id":api.get("/master/bank-accounts").json()["items"][0]["id"]}, headers=H())
    assert r.status_code in (400,409,422) and ("reference" in r.text.lower() or "number" in r.text.lower()), (r.status_code, r.text[:300])
