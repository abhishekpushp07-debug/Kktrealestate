from _h3h import BANK, CHEQUE, NEFT, TODAY, row, sfx, v3  # noqa: F401
def test_bvc_default_and_switch(api):
    d=v3(api,"bills-vs-collection"); cs=v3(api,"customer-status")
    assert d["totals"]["demand_paise"]==cs["totals"]["bills_raised"]
    i=v3(api,"bills-vs-collection",include_cancelled=1)
    diff=i["totals"]["demand_paise"]-d["totals"]["demand_paise"]; assert diff>0 and diff==i["totals"]["cancelled_demand_paise"]
    assert any("Cancelled bookings" in l["text"] for l in i["lines"]) and "include cancelled" in i["sentence"]
