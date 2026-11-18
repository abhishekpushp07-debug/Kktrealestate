TODAY = "2026-11-16"
def test_ageing_counts(api):
    d = api.get("/reports/outstanding-v2").json()
    counts = {b: sum(1 for r in d["rows"] if (r.get(f"band_{b}") or 0) > 0) for b in ["Not due","0-30","31-60","61-90","90+"]}
    assert counts == {"Not due":25,"0-30":10,"31-60":10,"61-90":12,"90+":68}, counts
def test_open_bills_due_after_today(api, home):
    stage_dates = {}
    for p in home["projects"]:
        for b in p["blocks"]:
            stage_dates[b["block_id"]] = {s["stage_id"]: s.get("completed_on") for s in api.get(f"/blocks/{b['block_id']}/construction").json()["stages"]}
    items, cur = [], None
    while True:
        prm = {"limit": 100, **({"cursor": cur} if cur else {})}
        d = api.get("/payments/demands", params=prm).json(); items += d["items"]; cur = d.get("next_cursor")
        if not cur: break
    open_future = [x for x in items if x["due_date"] > TODAY and x.get("status") not in ("Paid", "Void", "Cancelled")]
    assert open_future, "no open bills due after today"
    assert any(x["due_date"] <= "2026-12-16" for x in open_future)
    for x in items:
        assert x["demand_date"] <= TODAY, x["demand_number"]
        sid = x.get("trigger_stage_id")
        if sid and x.get("trigger_type") == "ON_STAGE":
            comp = stage_dates.get(x["block_id"], {}).get(sid)
            assert comp and x["demand_date"] >= comp, (x["demand_number"], x["demand_date"], comp)
