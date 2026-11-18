FY = {"period_from":"2026-04-01","period_to":"2026-11-18"}
def T(api,k,**p): return api.get(f"/reports/v3/{k}", params={**p,"page_size":500}).json()
def test_funnel_equals_register(api):
    for extra in ({}, {"source":"Website"}):
        f = T(api,"lead-funnel",**FY,**extra); r = T(api,"lead-register",**FY,**extra)
        assert f["totals"]["leads"] == r["count"]
        assert f["totals"]["converted_n"] == sum(1 for x in r["rows"] if x["status"]=="Converted")
def test_followups_home_rt_lost(api):
    fu = T(api,"follow-ups")["count"]
    assert fu == api.get("/dashboard/home").json()["counts"]["followups_due"]
    rt = T(api,"response-time")["totals"]; assert rt["median_h"] is not None and rt["avg_h"] is not None
    lost = T(api,"lost-leads"); assert all(x["lost_reason"] for x in lost["rows"])
