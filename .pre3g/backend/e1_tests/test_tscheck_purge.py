from conftest import block_id
def test_hard_purge_dry_run_clean(api):
    r = api.post("/admin/hard-purge", json={"dry_run": True})
    assert r.status_code == 200 and r.json()["counts"] == {}, r.text
def test_projects_and_towers_clean(home):
    assert sorted(p["name"] for p in home["projects"]) == ["Ganesh Green Villas", "Shree Ganesh Heights"]
    sgh = [p for p in home["projects"] if p["code"] == "SGH"][0]
    assert sorted(b["name"] for b in sgh["blocks"]) == ["Tower A", "Tower B", "Tower C"]
def test_purge_refuses_real_tower(api, home):
    before = api.get("/dashboard/home").json()["totals"]
    bid = block_id(home, "SGH", "Tower A")
    r = api.post("/admin/hard-purge", json={"dry_run": False, "confirm": "HARD-PURGE", "block_ids": [bid]})
    assert r.status_code == 409 and "Purge stopped: " in r.json()["detail"] and "is not test data" in r.json()["detail"], r.text
    after = api.get("/dashboard/home").json()["totals"]
    assert before["bookings"] == after["bookings"] and before["units"] == after["units"]
def test_hard_purge_confirm_removes_nothing_and_audits(api):
    before = api.get("/dashboard/home").json()["totals"]
    r = api.post("/admin/hard-purge", json={"dry_run": False, "confirm": "HARD-PURGE"})
    assert r.status_code == 200, r.text
    assert r.json().get("counts", {}) == {} or not any(r.json()["counts"].values()), r.text
    after = api.get("/dashboard/home").json()["totals"]
    assert (before["bookings"], before["units"], before["paid_paise"]) == (after["bookings"], after["units"], after["paid_paise"])
    a = api.get("/audit-logs", params={"action": "admin.test_data_purged", "limit": 1}).json()["items"]
    assert a, "no 'Test data purged' audit row"
def test_masters_and_search_clean(api):
    import re
    bad = re.compile(r"\bQA\b|\btest\b|LT CLP|Imported –", re.I)
    for path in ["/stage-plans", "/master/payment-plans", "/stage-plan-templates"]:
        r = api.get(path, params={"limit": 200})
        if r.status_code != 200: continue
        d = r.json(); items = d.get("items", d) if isinstance(d, dict) else d
        names = [i.get("name", "") for i in items]
        assert not [n for n in names if bad.search(n or "")], (path, names)
    for path in ["/customers", "/leads"]:
        d = api.get(path, params={"search": "Load Test", "limit": 5}).json()
        assert d["items"] == [], (path, d["items"][:1])
