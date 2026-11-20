import datetime
from conftest import login, qa_booking
from test_tscheck_3g_fresh_reads import _out, _cs

def test_manual_bill_counts_in_outstanding():
    c = login("admin@kkt.in")
    _, bk = qa_booking(c, "tscheck-3g-manual", discount=0, days_ago=40); bid = bk["id"]
    o0 = _out(c, bid); s0 = c.get(f"/bookings/{bid}").json()["summary"]; cs0 = _cs(c, bid)
    due = (datetime.date.today() - datetime.timedelta(days=35)).isoformat()
    r = c.post("/demands/manual", json={"booking_id":bid,"name":"tscheck-3g manual bill","account_amount":20000,"due_date":due,"demand_date":(datetime.date.today()-datetime.timedelta(days=40)).isoformat()})
    assert r.status_code in (200,201), r.text
    o1 = _out(c, bid); s1 = c.get(f"/bookings/{bid}").json()["summary"]; cs1 = _cs(c, bid)
    assert o1["outstanding_paise"] - o0["outstanding_paise"] == 2000000, (o0["outstanding_paise"], o1["outstanding_paise"])
    assert o1["band_31-60"] - o0["band_31-60"] == 2000000, {k:(o0[k],o1[k]) for k in o1 if k.startswith("band_")}
    assert s1["outstanding_paise"] - s0["outstanding_paise"] == 2000000
    assert o1["net_balance_paise"] == o1["outstanding_paise"] - o1["advance_paise"]
    assert s1["net_balance_paise"] == s1["total_udhar_paise"] - s1["total_jama_paise"] - s1.get("total_waived_paise", 0) or s1["net_balance_paise"] == s1["outstanding_paise"] - s1.get("advance_paise", 0)
    assert cs1["account_dues"] - cs0["account_dues"] == 2000000, (cs0["account_dues"], cs1["account_dues"])
