"""Iteration 13: bill dates on GST parts, collections bridge, outstanding grouping, cheques in hand, speed."""
import time, collections

FY_FROM = "2026-04-01"


def _bookings(api):
    r = api.get("/bookings", params={"page_size": 200}); assert r.status_code == 200
    return r.json()["items"]


def test_gst_part_bill_dates(api):
    checked = 0
    for b in _bookings(api):
        gst = [l for l in (b.get("other_charges") or []) if l.get("calc") == "percent_of_agreement"]
        if not gst or checked >= 5:
            continue
        d = api.get(f"/bookings/{b['id']}").json()
        stage_day = {}
        for dm in d.get("demands") or []:
            sid = dm.get("trigger_stage_id") or dm.get("stage_id") or dm.get("milestone_id") or (dm.get("stage") or {}).get("id")
            if sid and not dm.get("voided"):
                stage_day[sid] = dm.get("demand_date")
        for l in gst:
            for h in l.get("demand_history") or []:
                assert h["bill_day"] <= h["due_on"], (b["booking_number"], h)
                if h.get("stage_id") and h["stage_id"] in stage_day:
                    assert h["bill_day"] == stage_day[h["stage_id"]], (b["booking_number"], h, stage_day[h["stage_id"]])
        checked += 1
        assert stage_day, "no stage bills mapped"
    assert checked >= 3


def _coll(api, f, t):
    r = api.get("/reports/collections-v2", params={"from_date": f, "to_date": t}); assert r.status_code == 200, r.text
    return r.json()


def test_collections_carried_and_bridge(api):
    out = api.get("/reports/outstanding-v2").json()
    net = next(k["value_paise"] for k in out["kpis"] if k["label"] == "Net balance")
    today = out["as_of"]
    import datetime as dt
    t = dt.date.fromisoformat(today)
    for f, to in [(FY_FROM, today), ((t - dt.timedelta(days=15)).isoformat(), today)]:
        o = _coll(api, f, to)
        c = o["carried"]
        assert c["opening_paise"] + c["billed_paise"] - c["received_paise"] == c["closing_paise"]
        if to == today:
            assert c["closing_paise"] == net, (c, net)
        rb = o.get("received_bridge")
        if rb:
            calc = (rb["by_receipt_date_paise"] - rb["not_live_paise"] - rb["dated_in_cleared_after_paise"]
                    + rb["dated_before_cleared_in_paise"] - rb["refunds_paise"])
            assert calc == rb["by_clearance_paise"], rb
            assert rb["by_clearance_paise"] == c["received_paise"] or rb["by_receipt_date_paise"] == o["totals"]["total_paise"], (rb, c)


def test_outstanding_grouping(api):
    base = api.get("/reports/outstanding-v2").json()["totals"]["outstanding_paise"]
    cust = api.get("/reports/outstanding-v2", params={"group_by": "customer"}).json()
    links = [r["_link"] for r in cust["rows"]]
    assert len(links) == len(set(links)), "customer rows not unique by id"
    assert sum(r["outstanding_paise"] for r in cust["rows"]) == base
    blk = api.get("/reports/outstanding-v2", params={"group_by": "block"}).json()
    labels = [r["group"] for r in blk["rows"]]
    assert len(labels) == len(set(labels))
    assert sum(r["outstanding_paise"] for r in blk["rows"]) == base


def test_cheques_in_hand_agree(api):
    ch = api.get("/payments/cheques-in-hand").json()
    reg = api.get("/reports/cheques", params={"status": "Pending"}).json()
    home = api.get("/dashboard/home").json()["totals"]
    assert ch["amount_paise"] == home["pending_cheques_paise"] == reg["kpis"][0]["value_paise"]
    assert ch["total"] == len(reg["rows"])


def test_speed(api):
    for p, prm in [("/reports/outstanding-v2", {}), ("/reports/collections-v2", {"from_date": FY_FROM, "to_date": "2026-11-18"}),
                   ("/reports/other-charges", {})]:
        t0 = time.time(); r = api.get(p, params=prm); el = time.time() - t0
        assert r.status_code == 200 and el < 2.0, (p, el)
