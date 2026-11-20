from _h3h import BANK, CHEQUE, NEFT, TODAY, row, sfx, v3  # noqa: F401
def test_as_of(api):
    a=v3(api,"outstanding"); t=v3(api,"outstanding",as_of=TODAY); cs=v3(api,"customer-status",as_of=TODAY)
    assert a["totals"]["outstanding_paise"]==t["totals"]["outstanding_paise"]==cs["totals"]["total_due"]
    o=v3(api,"outstanding",as_of="2026-10-31"); c=v3(api,"customer-status",as_of="2026-10-31")
    assert o["totals"]["outstanding_paise"]==3504349800==c["totals"]["total_due"] and o["count"]==78
    assert "31 Oct 2026" in o["sentence"]
def test_future_refused(api):
    r=api.get("/reports/v3/outstanding",params={"as_of":"2026-12-31"}); assert r.status_code in (400,422) and "As of can't be after today" in r.text
