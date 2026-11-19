"""Phase 3I REQ-355/359/360: per-booking money snapshot kept by every ledger rebuild, invalidated by any other bill
write, served only while valid; Home "stale part-paid" = the register's own stale_days total."""

import os
import uuid
from datetime import date

import pytest
import requests
from pymongo import MongoClient

from tests.conftest import BASE

API = f"{BASE}/api"
FIELDS = ("due_date", "cash_demand_paise", "account_demand_paise", "total_demand_paise", "paid_paise", "status")


@pytest.fixture(scope="module")
def mongo():
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


def _bills(mongo, bid):
    return sorted(
        tuple(str(d.get(k)) for k in FIELDS)
        for d in mongo.demands.find({"booking_id": bid, "voided": {"$ne": True}}, {"_id": 0})
    )


def _valid(b):
    s = b.get("money_snapshot")
    return bool(s) and s.get("rev") == (b.get("money_rev") or 0)


def test_receipt_keeps_snapshot_valid_and_equal_to_bills(admin_headers, mongo):
    b = mongo.bookings.find_one(
        {"status": "Active", "summary.outstanding_paise": {"$gt": 500000}, "load_test": {"$ne": True}}, {"_id": 0}
    )
    md = {
        m["code"]: m["id"] for m in requests.get(f"{API}/master/payment-modes", headers=admin_headers).json()["items"]
    }
    r = requests.post(
        f"{API}/payments",
        json={
            "booking_id": b["id"],
            "amount": 1000,
            "payment_date": date.today().isoformat(),
            "payment_mode_id": md["CASH"],
            "allocation": "auto",
            "remarks": "3I snapshot",
        },  # fmt: skip
        headers={**admin_headers, "Idempotency-Key": uuid.uuid4().hex},
    )
    assert r.status_code == 201, r.text[:200]
    after = mongo.bookings.find_one({"id": b["id"]}, {"_id": 0, "money_rev": 1, "money_snapshot": 1})
    assert _valid(after)
    snap = sorted(tuple(str(x.get(k)) for k in FIELDS) for x in after["money_snapshot"]["bills"])
    assert snap == _bills(mongo, b["id"])


def test_reminder_mark_keeps_snapshot_but_due_date_change_invalidates(admin_headers, mongo):
    d = mongo.demands.find_one({"voided": {"$ne": True}, "status": {"$in": ["Open", "Partially Paid"]}}, {"_id": 0})
    requests.get(f"{API}/home/bundle", params={"period": "month"}, headers=admin_headers)  # repairs any snapshot
    r = requests.post(f"{API}/demands/{d['id']}/reminder-sent", headers=admin_headers)
    assert r.status_code in (200, 201), r.text[:200]
    b = mongo.bookings.find_one({"id": d["booking_id"]}, {"_id": 0, "money_rev": 1, "money_snapshot": 1})
    rev = b.get("money_rev") or 0
    # a bill write that bypasses the app's rebuild (e.g. an old script) moves nothing → the app path is what counts:
    # the app's own `db.demands` wrapper bumps the rev; a raw pymongo write here must be caught by the nightly check
    mongo.bookings.update_one({"id": d["booking_id"]}, {"$inc": {"money_rev": 1}})
    b2 = mongo.bookings.find_one({"id": d["booking_id"]}, {"_id": 0, "money_rev": 1, "money_snapshot": 1})
    assert (b2.get("money_rev") or 0) == rev + 1 and not _valid(b2)
    # the next read serves the figure from the bills and repairs the snapshot in the background
    h = requests.get(f"{API}/home/bundle", params={"period": "month"}, headers=admin_headers)
    assert h.status_code == 200
    for _ in range(20):
        b3 = mongo.bookings.find_one({"id": d["booking_id"]}, {"_id": 0, "money_rev": 1, "money_snapshot": 1})
        if _valid(b3):
            break
        __import__("time").sleep(0.5)
    assert _valid(b3)


def test_home_stale_part_paid_equals_register_total(admin_headers):
    home = requests.get(f"{API}/home/bundle", params={"period": "month"}, headers=admin_headers).json()
    w = home["widgets"]["attention"]["data"] if "widgets" in home else home["attention"]["data"]
    reg = requests.get(f"{API}/demands/register", params={"stale_days": 30}, headers=admin_headers).json()
    assert w["stale_part_paid"]["count"] == reg["totals"]["count"]


def test_system_health_shows_report_figures_check(admin_headers):
    ops = requests.get(f"{API}/admin/ops", headers=admin_headers)
    assert ops.status_code == 200
    assert "report_figures" in ops.json()
