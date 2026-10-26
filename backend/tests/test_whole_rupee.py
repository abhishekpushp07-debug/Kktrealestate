"""R0b — every SYSTEM-GENERATED amount is a whole rupee (paise % 100 == 0). User-typed amounts (payments, agreement values) may carry paise."""
import os

import pytest
from pymongo import MongoClient

from services.money import pct_of, rupees_whole

db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


def test_pct_of_whole_rupee_and_telescoping():
    agreed = 12_345_67  # ₹12,345.67 user-typed
    assert pct_of(agreed, 100) == agreed
    shares = [pct_of(agreed, p) for p in (10, 20, 33.33)]
    assert all(s % 100 == 0 for s in shares)
    cum, prev, parts = 0, 0, []
    for p in (10, 15, 25, 50):
        cum += p
        cur = pct_of(agreed, cum)
        parts.append(cur - prev)
        prev = cur
    assert sum(parts) == agreed and all(x % 100 == 0 for x in parts[:-1])
    assert rupees_whole(149) == 100 and rupees_whole(150) == 200


@pytest.mark.parametrize("coll,fields,extra", [
    ("demands", ("cash_demand_paise", "account_demand_paise"), {"voided": {"$ne": True}}),
    ("refunds", ("deduction_paise", "forfeiture_paise"), {}),
])
def test_no_paise_remainders_in_system_amounts(coll, fields, extra):
    bad = [d.get("demand_number") or d.get("id") for d in db[coll].find({**extra, "remarks": {"$not": {"$regex": "^test:"}}}, {"_id": 0, "id": 1, "demand_number": 1, **{f: 1 for f in fields}})
           if any((d.get(f) or 0) % 100 for f in fields) and not _last_installment(d)]
    assert bad == [], bad[:10]


def _last_installment(d: dict) -> bool:
    # the 100 % line legitimately absorbs a paise-carrying agreement value
    return (d.get("cumulative_percent") or 0) >= 99.995


def test_bounce_charges_whole_rupee():
    for b in db.bookings.find({"other_charges.code": "BOUNCE"}, {"_id": 0, "other_charges": 1}):
        for l in b["other_charges"]:
            if l.get("code") == "BOUNCE":
                assert l["amount_paise"] % 100 == 0 and l["gst_paise"] % 100 == 0
