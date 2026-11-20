"""Iteration 4: JRN-36/8 one outstanding number, JRN-14 trend incl Other, JRN-6 nothing after today."""
AGE = {"not_due": (1445527000, 25), "d0_30": (498850100, 10), "d31_60": (386609300, 9),
       "d61_90": (679609400, 12), "d90": (4417403600, 70)}
OUT = 7427999400


def test_home_ageing_equals_reports_and_register(api):
    h = api.get("/dashboard/home").json()
    assert {k: (h["ageing_paise"][k], h["ageing_counts"][k]) for k in AGE} == AGE
    assert h["totals"]["outstanding_paise"] == OUT == sum(v[0] for v in AGE.values())
    r = api.get("/reports/outstanding-v2").json()
    assert [b["amount_paise"] for b in r["ageing"]] == [v[0] for v in AGE.values()]
    assert [k for k in r["kpis"] if k["label"] == "Outstanding"][0]["value_paise"] == OUT
    d = api.get("/demands/register").json()
    rc = d["reconcile"]
    assert d["basis"] == "raised" and "Raised bills only" in rc["basis"]
    assert rc["bills_open_paise"] + rc["other_charges_due_paise"] + rc["adjustment_paise"] == rc["outstanding_paise"] == OUT


def test_trend_other_equals_mtd_and_reports(api):
    h = api.get("/dashboard/home").json()
    cur = [m for m in h["collections_12m"] if m["month"] == h["business_day"][:7]][0]
    assert (cur["Cash"], cur["Account"], cur["Other"]) == (9118506.0, 6392424.0, 40000.0)
    assert cur["Cash"] + cur["Account"] + cur["Other"] == h["totals"]["collections_mtd"] == 15550930.0
    k = {x["label"]: x["value_paise"] for x in api.get("/reports/collections-v2", params={
        "from_date": h["business_day"][:8] + "01", "to_date": h["business_day"]}).json()["kpis"]}
    assert k["Net received"] == 1555093000


def test_nothing_after_today_and_holds_expire(api):
    day = api.get("/dashboard/home").json()["business_day"]
    assert api.get("/audit-logs", params={"date_from": "2026-11-17"}).json()["total"] == 0
    newest = api.get("/audit-logs", params={"page_size": 1}).json()["items"][0]["created_at"]
    assert newest[:10] <= day, newest
    n = api.get("/notifications", params={"page_size": 200}).json()
    n = n.get("items", n)
    assert all(x["created_at"][:10] <= day for x in n)
    rec = api.get("/dashboard/home").json()["recent"]
    assert all(x["created_at"][:10] <= day for x in rec)
    rows = api.get("/reports/hold-register").json()["rows"]
    assert rows and all(r["expires_at"] for r in rows)
    assert any(r["hours_left"] <= 48 for r in rows), [r["hours_left"] for r in rows]
