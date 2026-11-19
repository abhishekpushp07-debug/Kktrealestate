from _h3h import *
BK="85b4bd88-030f-44af-94e8-e2457f90ab8c"
def test_manual_bill_on_paid_share(api):
    o0=v3(api,"outstanding")["totals"]["outstanding_paise"]
    r=api.post("/demands/manual",json=dict(booking_id=BK,name="tscheck-3h-mb-"+sfx(),account_amount=20000,due_date=TODAY))
    assert r.status_code in (200,201),r.text[:400]
    assert v3(api,"outstanding")["totals"]["outstanding_paise"]==o0+2000000
    r=api.post("/payments",headers={"Idempotency-Key":sfx()+sfx()},json=dict(booking_id=BK,payment_category="Account",amount=20000,payment_date=TODAY,payment_mode_id=NEFT,bank_account_id=BANK,
        instrument=dict(number="TSN"+sfx(),date=TODAY),remarks="tscheck-3h-mbpay",allocation="auto"))
    assert r.status_code in (200,201),r.text[:400]
    assert v3(api,"outstanding")["totals"]["outstanding_paise"]==o0
