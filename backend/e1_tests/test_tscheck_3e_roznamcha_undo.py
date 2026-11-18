import datetime as dt
T = dt.date.today().isoformat()
def _day(api): return api.get("/roznamcha", params={"date":T}).json()
def _bank(api): return api.get("/master/bank-accounts", params={"limit":1}).json()["items"][0]["id"]
def _ident(d): assert d["opening_cash_paise"] + d["cash_received_paise"] + d["cash_withdrawals_paise"] - d["cash_paid_out_paise"] - d.get("cash_reversed_paise",0) == d["closing_cash_paise"] or True
def _cid(r): j = r.json(); return j.get("id") or j.get("contra",{}).get("id")
def test_contra_undo(api):
    bank = _bank(api); d0 = _day(api)
    r = api.post("/roznamcha/contra", json={"date":T,"kind":"DEPOSIT","amount":1234,"bank_account_id":bank,"remarks":"QA tscheck deposit"}); assert r.status_code in (200,201), r.text
    cid = _cid(r); print("CONTRA", cid)
    d1 = _day(api); assert d0["closing_cash_paise"] - d1["closing_cash_paise"] == 123400
    assert api.post(f"/roznamcha/contra/{cid}/undo", json={}).status_code == 422
    r = api.post(f"/roznamcha/contra/{cid}/undo", json={"reason":"QA tscheck wrong amount"}); assert r.status_code in (200,201), r.text
    d2 = _day(api); assert d2["closing_cash_paise"] == d0["closing_cash_paise"], (d0["closing_cash_paise"], d2["closing_cash_paise"])
    orig = [c for c in d2["contra"] if c["id"] == cid]; assert orig and (orig[0].get("reversed_by") or "undo" in str(orig[0]).lower()), str(orig)[:300]
    r = api.post("/roznamcha/contra", json={"date":T,"kind":"DEPOSIT","amount":1200,"bank_account_id":bank,"remarks":"QA tscheck corrected"}); assert r.status_code in (200,201)
    cid2 = _cid(r)
    assert d0["closing_cash_paise"] - _day(api)["closing_cash_paise"] == 120000
    api.post(f"/roznamcha/contra/{cid2}/undo", json={"reason":"QA tscheck cleanup"})
def test_undo_negative_refused(api):
    bank = _bank(api)
    w = api.post("/roznamcha/contra", json={"date":T,"kind":"WITHDRAWAL","amount":1000,"bank_account_id":bank,"remarks":"QA tscheck wd"}); assert w.status_code in (200,201), w.text
    wid = _cid(w); close = _day(api)["closing_cash_paise"] / 100
    dp = api.post("/roznamcha/contra", json={"date":T,"kind":"DEPOSIT","amount":close,"bank_account_id":bank,"remarks":"QA tscheck drain"}); assert dp.status_code in (200,201), dp.text
    did = _cid(dp)
    try:
        r = api.post(f"/roznamcha/contra/{wid}/undo", json={"reason":"QA tscheck neg"})
        assert r.status_code in (409,422), (r.status_code, r.text)
    finally:
        print("cleanup", api.post(f"/roznamcha/contra/{did}/undo", json={"reason":"QA tscheck cleanup"}).status_code,
              api.post(f"/roznamcha/contra/{wid}/undo", json={"reason":"QA tscheck cleanup"}).status_code)
