from _h3h import *
BK="a4c0f93b-81da-4d1a-bd51-6ce22a05e213"
def test_cheque_in_hand_then_clear(api):
    mf=dict(period_from="2026-11-01",period_to=TODAY)
    c0=v3(api,"collections",**mf)["totals"]; b0=v3(api,"bank-receipts",**mf)["totals"]; o0=row(v3(api,"outstanding"),BK)["outstanding_paise"]
    assert any("Cheques in hand" in l["text"] for l in v3(api,"collections",**mf)["lines"])
    r=api.post("/payments",headers={"Idempotency-Key":sfx()+sfx()},json=dict(booking_id=BK,payment_category="Account",amount=12345,payment_date=TODAY,payment_mode_id=CHEQUE,bank_account_id=BANK,
        instrument=dict(number="TS"+sfx(),date=TODAY,bank_name="SBI"),remarks="tscheck-3h-cheque-"+sfx(),allocation="auto"))
    assert r.status_code in (200,201),r.text[:400]; pid=r.json().get("id") or r.json()["payment"]["id"]
    c1=v3(api,"collections",**mf)["totals"]; b1=v3(api,"bank-receipts",**mf)["totals"]
    assert c1["total_paise"]==c0["total_paise"] and b1["total_paise"]==b0["total_paise"]
    assert c1["in_hand_paise"]==c0["in_hand_paise"]+1234500 and b1["in_hand_n"]==b0["in_hand_n"]+1
    lk=v3(api,"cheques",in_hand_on=TODAY); assert any(x.get("id")==pid or x.get("payment_id")==pid or "TS" in str(x) for x in lk["rows"])
    r=api.post(f"/payments/{pid}/clear",json={}); assert r.status_code==200,r.text[:300]
    c2=v3(api,"collections",**mf)["totals"]; b2=v3(api,"bank-receipts",**mf)["totals"]
    assert c2["total_paise"]==c0["total_paise"]+1234500 and b2["total_paise"]==b0["total_paise"]+1234500
    assert c2["in_hand_paise"]==c0["in_hand_paise"]
    assert row(v3(api,"outstanding"),BK)["outstanding_paise"]==o0-1234500
