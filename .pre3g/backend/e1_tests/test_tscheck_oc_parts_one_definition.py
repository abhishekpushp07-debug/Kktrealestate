# Phase 3 §3R (REQ-205..213), JRN-94/95 — read-only checks against the running preview API.
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))
BANDS = ["Not due", "0-30", "31-60", "61-90", "90+"]


def _ist_day(at):
    return datetime.fromisoformat(at.replace("Z", "+00:00")).astimezone(IST).date()


def _snap(api):
    os_ = api.get("/reports/outstanding-v2"); assert os_.status_code == 200
    cu = api.get("/customers", params={"page_size": 100}); assert cu.status_code == 200
    hb = api.get("/home/bundle"); assert hb.status_code == 200
    sg = api.get("/customers/segments"); assert sg.status_code == 200
    return os_.json(), cu.json()["items"], hb.json(), sg.json()["counts"]


def test_one_definition_everywhere(api):
    os_, cust, hb, seg = _snap(api)
    t = os_["totals"]
    ag = hb["widgets"]["ageing"]["data"]
    home = {"Not due": ag["not_due"], "0-30": ag["d0_30"], "31-60": ag["d31_60"],
            "61-90": ag["d61_90"], "90+": ag["d90"]}
    for b in BANDS:
        assert home[b]["amount_paise"] == t[f"band_{b}"], b
        assert any(x["bucket"] == b and x["amount_paise"] == t[f"band_{b}"] for x in os_["ageing"])
    assert ag["overdue"]["amount_paise"] == t["overdue_paise"]
    assert sum(t[f"band_{b}"] for b in BANDS[1:]) == t["overdue_paise"]
    cards = [c["card"] for c in cust if c.get("card")]
    assert sum(c["overdue_paise"] for c in cards) == t["overdue_paise"]
    per = defaultdict(lambda: [0, 0])
    for r in os_["rows"]:
        per[r["customer_id"]][0] += r["overdue_paise"]
    for c in cust:
        if c.get("card"):
            assert c["card"]["overdue_paise"] == per[c["id"]][0], c["full_name"]
    n_over = sum(1 for c in cards if c["overdue_paise"] > 0)
    assert seg["overdue"] == n_over
    assert seg["overdue"] + seg["on_track"] + seg["clear"] + seg["advance_only"] + seg["no_booking"] == seg["all"]
    # call-today rows carry the same overdue ₹ as the outstanding row for that booking
    byb = {r["_link"].rsplit("/", 1)[-1]: r for r in os_["rows"]}
    for row in hb["widgets"]["call_today"]["data"]["overdue_customers"]:
        assert row["overdue_paise"] == byb[row["booking_id"]]["overdue_paise"]


def test_overdue_looks_real(api):
    os_, cust, hb, seg = _snap(api)
    assert 15 <= seg["overdue"] <= 30, seg
    assert seg["on_track"] > 0
    for b in BANDS:
        assert os_["totals"][f"band_{b}"] > 0, b
    col = api.get("/reports/collections-v2", params={"from_date": "2025-04-01", "to_date": os_["as_of"]})
    assert col.status_code == 200 and col.json()["totals"]["other_paise"] > 0


def test_parts_dated_and_ledger_law(api):
    os_, cust, hb, seg = _snap(api)
    company_days = 15
    rows = [r for r in os_["rows"] if r["overdue_paise"] > 0][:3] + [r for r in os_["rows"] if r["band_Not due"] > 0][:2]
    assert len(rows) >= 3
    checked_parts = 0
    for r in rows:
        assert r["udhar_paise"] - r["jama_paise"] == r["outstanding_paise"] - r["advance_paise"]
        bid = r["_link"].rsplit("/", 1)[-1]
        b = api.get(f"/bookings/{bid}"); assert b.status_code == 200
        bj = b.json()
        assert bj["summary"]["outstanding_paise"] == r["outstanding_paise"]
        for line in bj.get("other_charges") or []:
            for part in line.get("demand_history") or []:
                assert part.get("due_on"), (bj["booking_number"], line["name"], part)
                inst = [d for d in bj["demands"] if part.get("stage_id") and d.get("trigger_stage_id") == part["stage_id"] and not d.get("voided")]
                # GST-with-stage part: billed with its stage bill -> same bill/due date; otherwise own bill date + days-to-pay
                want = date.fromisoformat(inst[0]["due_date"]) if inst else _ist_day(part["at"]) + timedelta(days=company_days)
                assert date.fromisoformat(part["due_on"]) == want, (bj["booking_number"], line["name"], part)
                checked_parts += 1
    assert checked_parts > 0
