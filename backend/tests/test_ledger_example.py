"""Owner's reference ledger (second story anchor): the `story:owner` booking — ₹1 Cr agreement, 60 L cash / 40 L account, 100 % raised on
booking, paid by the owner's 10-payment table. Dues after each payment must match the table to the rupee (three-ledger principle)."""
import os

import pytest
import requests
from pymongo import MongoClient

API = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"
db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]

EXPECTED = [  # (category, amount ₹, cash_due, account_due, total_due) after each payment
    ("Account", 400000, 6000000, 3600000, 9600000),
    ("Cash", 800000, 5200000, 3600000, 8800000),
    ("Account", 1200000, 5200000, 2400000, 7600000),
    ("Cash", 500000, 4700000, 2400000, 7100000),
    ("Cash", 1000000, 3700000, 2400000, 6100000),
    ("Account", 1500000, 3700000, 900000, 4600000),
    ("Cash", 700000, 3000000, 900000, 3900000),
    ("Cash", 2000000, 1000000, 900000, 1900000),
    ("Account", 900000, 1000000, 0, 1000000),
    ("Cash", 1000000, 0, 0, 0),
]


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": "admin@kkt.in", "password": "Kkt@12345"}, timeout=30)
    r.raise_for_status()
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def example_booking(token):
    doc = db.bookings.find_one({"remarks": {"$regex": "^story:owner"}}, {"_id": 0, "id": 1})
    assert doc, "owner worked-example booking missing (story persona `owner`)"
    r = requests.get(f"{API}/bookings/{doc['id']}", headers={"Authorization": f"Bearer {token}"}, timeout=30)
    r.raise_for_status()
    return r.json()


def test_owner_example_agreement_split(example_booking):
    b = example_booking
    assert b["agreement_value"] == 10000000 and b["cash_agreed"] == 6000000 and b["account_agreed"] == 4000000
    assert b["summary"]["total_order_raised"] == 10000000  # lump-sum plan: everything raised on booking


def test_example_ledger_matches_owner_table(token, example_booking):
    r = requests.get(f"{API}/bookings/{example_booking['id']}/ledger", headers={"Authorization": f"Bearer {token}"}, timeout=30)
    r.raise_for_status()
    rows = [x for x in r.json()["rows"] if x["type"] == "PAYMENT"]
    assert len(rows) == 10
    for row, (cat, amt, cd, ad, td) in zip(rows, EXPECTED):
        assert row["category"] == cat
        assert row["amount"] == amt
        assert row["cash_due"] == cd, f"row {row['seq']} cash_due {row['cash_due']} != {cd}"
        assert row["account_due"] == ad, f"row {row['seq']} account_due {row['account_due']} != {ad}"
        assert row["total_due"] == td, f"row {row['seq']} total_due {row['total_due']} != {td}"
    assert example_booking["summary"]["due"] == 0


def test_csv_export_matches(token, example_booking):
    r = requests.get(f"{API}/bookings/{example_booking['id']}/ledger", params={"format": "csv"}, headers={"Authorization": f"Bearer {token}"}, timeout=30)
    assert r.headers["content-type"].startswith("text/csv")
    lines = [l for l in r.text.splitlines() if ",PAYMENT," in l]
    assert len(lines) == 10
    assert lines[-1].rstrip().endswith(",0,0,0")  # ₹ cells are plain numbers (no trailing .0)
