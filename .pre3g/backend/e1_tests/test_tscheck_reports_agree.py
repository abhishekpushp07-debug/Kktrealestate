def test_collections_fy(api):
    r = api.get("/reports/collections-v2", params={"from_date":"2026-04-01","to_date":"2026-11-16"})
    assert r.status_code == 200 and r.json()["totals"]["total"] == 187511936.0
def test_outstanding_and_ageing(api):
    d = api.get("/reports/outstanding-v2").json()
    t = d["totals"]; assert t["outstanding"] == 76934315.0 and t["overdue"] == 62191215.0
    ag = {a["bucket"]: a["amount"] for a in d["ageing"]}
    assert ag == {"Not due":14743100.0,"0-30":4614414.0,"31-60":5462161.0,"61-90":8823725.0,"90+":43290915.0}
    assert round(sum(ag.values()),2) == t["outstanding"]
def test_home_ageing_matches_report(api, home):
    d = api.get("/reports/outstanding-v2").json()
    rep = [a["amount_paise"] for a in d["ageing"]]
    h = home["ageing_paise"]; homev = [h["not_due"],h["d0_30"],h["d31_60"],h["d61_90"],h["d90"]]
    assert homev == rep, f"home {homev} vs report {rep}"
    assert home["totals"]["outstanding_paise"] == d["totals"]["outstanding_paise"]
