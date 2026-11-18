"""§3R REQ-205…209: each billed part of an other charge ages from its own due date (bill day + days-to-pay)."""

from datetime import date, datetime, timedelta, timezone

from services import clock
from services.definitions import (
    ageing_bands,
    bill_part,
    days_to_pay,
    due_on,
    oc_parts,
    overdue_days,
    overdue_of,
)


def _line(parts, paid=0, **kw):
    l = {"name": "GST on agreement value (5%)", "demanded_at": parts[0][0], "paid_paise": paid, **kw}
    for at, paise, due in parts:
        bill_part(l, at, paise, due)
    l["demanded_paise"] = sum(p for _, p, _ in parts)
    return l


def _summary(oc_unpaid):
    return {"other_charges_due_paise": oc_unpaid, "cash_due_paise": 0, "account_due_paise": 0}


def test_days_to_pay_is_the_instalment_rule():
    assert days_to_pay({"demand_due_days": 15}) == 15
    assert days_to_pay({"demand_due_days": 15}, {"due_days": 7}) == 7  # an instalment's own days win, as for bills
    assert days_to_pay(None) == 15
    assert due_on("2026-04-05", 15) == "2026-04-20"


def test_each_part_ages_from_its_own_due_date_late_booking_back_billed():
    # booked 05 Apr on a 90 % tower: six parts back-billed that day, the last part billed at a later stage (16 May)
    parts = [("2026-04-05T05:00:00+00:00", 75000_00, "2026-04-20")] * 6 + [
        ("2026-05-16T05:00:00+00:00", 50000_00, "2026-05-31")
    ]
    l = _line(parts)
    today = date(2026, 6, 10)
    b = ageing_bands(_summary(l["demanded_paise"]), [], [l], today)
    assert b["31-60"] == 6 * 75000_00  # 51 days past 20 Apr
    assert b["0-30"] == 50000_00  # the later part: 10 days past its own due date, not 66 days from booking
    assert overdue_days(_summary(l["demanded_paise"]), [], [l], today) == 51


def test_not_due_through_due_on_then_overdue_next_india_day():
    l = _line([("2026-05-01T05:00:00+00:00", 10000_00, "2026-05-16")])
    s = _summary(10000_00)
    assert overdue_of(ageing_bands(s, [], [l], date(2026, 5, 16))) == 0  # due day itself: Not due
    assert ageing_bands(s, [], [l], date(2026, 5, 17))["0-30"] == 10000_00


def test_india_day_boundary_0030_and_2359_ist():
    # 00:30 IST on 17 May is still 16 May in UTC; 23:59 IST on 16 May is 18:29 UTC — the business day decides
    assert clock.day_of(datetime(2026, 5, 16, 19, 0, tzinfo=timezone.utc).isoformat()) == "2026-05-17"  # 00:30 IST
    assert clock.day_of(datetime(2026, 5, 16, 18, 29, tzinfo=timezone.utc).isoformat()) == "2026-05-16"  # 23:59 IST
    late_night = clock.day_of(datetime(2026, 5, 16, 18, 29, tzinfo=timezone.utc).isoformat())
    assert due_on(late_night, 15) == "2026-05-31"  # billed 23:59 IST → due 15 India days later


def test_partial_payment_settles_oldest_part_first():
    parts = [
        ("2026-01-05T05:00:00+00:00", 30000_00, "2026-01-20"),
        ("2026-03-05T05:00:00+00:00", 30000_00, "2026-03-20"),
        ("2026-05-05T05:00:00+00:00", 30000_00, "2026-05-20"),
    ]
    l = _line(parts, paid=40000_00)
    b = ageing_bands(_summary(50000_00), [], [l], date(2026, 6, 1))
    assert b["0-30"] == 30000_00 and b["61-90"] == 20000_00 and b["90+"] == 0  # oldest part fully paid first


def test_bounce_charge_is_its_own_part():
    gst = _line([("2026-01-05T05:00:00+00:00", 30000_00, "2026-01-20")], paid=30000_00)
    bounce = _line([("2026-05-30T05:00:00+00:00", 500_00, "2026-06-14")], name="Cheque bounce charge")
    b = ageing_bands(_summary(500_00), [], [gst, bounce], date(2026, 6, 10))
    assert overdue_of(b) == 0 and b["Not due"] == 500_00


def test_setting_change_never_moves_an_old_due_date():
    l = _line([("2026-04-05T05:00:00+00:00", 10000_00, due_on("2026-04-05", days_to_pay({"demand_due_days": 15})))])
    # the company later moves to 30 days: the stored part keeps its snapshot
    assert days_to_pay({"demand_due_days": 30}) == 30
    assert oc_parts([l]) == [("2026-04-20", 10000_00)]


def test_unmigrated_line_ages_from_first_billed_date():
    l = {"demanded_at": "2026-04-05T05:00:00+00:00", "demanded_paise": 10000_00, "paid_paise": 0}
    assert oc_parts([l]) == [("2026-04-05", 10000_00)]
    assert oc_parts([{**l, "due_on": "2026-04-20"}]) == [("2026-04-20", 10000_00)]  # flagged remainder (REQ-213)


def test_stage_part_due_equals_its_stage_bill_due():
    bill = date(2026, 3, 1)
    stage_due = (bill + timedelta(days=days_to_pay({"demand_due_days": 15}))).isoformat()
    assert due_on(bill.isoformat(), 15) == stage_due


def test_back_billed_stage_part_keeps_its_bill_day_apart_from_posting_time():
    from services.breakdown import raise_stage_charges

    b = {"other_charges": [{"line_id": "g", "demand_at": "stage", "total_paise": 100_000, "demanded_paise": 0}]}
    # late booking on 17 Nov: the Brickwork stage bill is dated 16 Aug and due 31 Aug
    raise_stage_charges(b, 20.0, "2026-11-17T06:00:00+00:00", "brick", "2026-08-31", "2026-08-16")
    h = b["other_charges"][0]["demand_history"][0]
    assert (h["at"][:10], h["bill_day"], h["due_on"]) == ("2026-11-17", "2026-08-16", "2026-08-31")
    assert h["bill_day"] <= h["due_on"]


def test_bill_part_defaults_bill_day_to_the_india_posting_day():
    l = {}
    bill_part(l, "2026-04-15T19:00:00+00:00", 100, "2026-05-01")  # 00:30 IST on 16 Apr
    assert l["demand_history"][0]["bill_day"] == "2026-04-16"


def test_part_rows_for_display_pay_oldest_first_and_age_from_own_due():
    from services.definitions import oc_part_rows

    line = {
        "demanded_at": "2025-08-15T05:00:00+00:00",
        "demanded_paise": 300,
        "paid_paise": 150,
        "demand_history": [
            {"at": "2025-08-15T05:00:00+00:00", "bill_day": "2025-08-15", "due_on": "2025-08-30", "paise": 100},
            {"at": "2026-11-01T05:00:00+00:00", "bill_day": "2026-11-01", "due_on": "2026-11-16", "paise": 100},
            {"at": "2026-11-10T05:00:00+00:00", "bill_day": "2026-11-10", "due_on": "2026-11-25", "paise": 100},
        ],
    }
    rows = oc_part_rows(line, date(2026, 11, 18))
    assert [(r["status"], r["paid_paise"], r["days_overdue"]) for r in rows] == [
        ("paid", 100, 0),
        ("overdue", 50, 2),
        ("open", 0, 0),
    ]
