"""Owner's reference ledger: BK-…-0001 (P1, 60L cash / 40L account) must match the 10-row table to the rupee.
Run: cd /app/backend && python -m pytest tests/test_ledger_example.py -q
"""
import os

import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
API = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"

EXPECTED = [  # (category, amount, cash_due, account_due, total_due) after each payment
    ("Account", 400000, 600000, 0, 600000),
    ("Cash", 800000, 100000, 200000, 300000),
    ("Account", 1200000, 700000, -600000, 100000),
    ("Cash", 500000, 500000, -400000, 100000),
    ("Cash", 1000000, 100000, 0, 100000),
    ("Account", 1500000, 700000, -1100000, -400000),
    ("Cash", 700000, 600000, -700000, -100000),
    ("Cash", 2000000, -500000, -100000, -600000),
    ("Account", 900000, 100000, -600000, -500000),
    ("Cash", 1000000, 0, 0, 0),
]


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": "admin@kkt.in", "password": "Kkt@12345"}, timeout=30)
    r.raise_for_status()
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def example_booking(token):
    r = requests.get(f"{API}/bookings", params={"search": "BK-", "page_size": 100, "sort": "booking_number"}, headers={"Authorization": f"Bearer {token}"}, timeout=30)
    r.raise_for_status()
    items = [b for b in r.json()["items"] if b["flat_snapshot"]["flat_number"] == "P1"]
    assert items, "example booking P1 missing"
    return items[0]


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


def test_example_booking_completed_and_flat_sold(token, example_booking):
    assert example_booking["status"] == "Completed"
    assert example_booking["summary"]["due"] == 0
    r = requests.get(f"{API}/flats/{example_booking['flat_id']}", headers={"Authorization": f"Bearer {token}"}, timeout=30)
    assert r.json()["status"] == "Sold"


def test_csv_export_matches(token, example_booking):
    r = requests.get(f"{API}/bookings/{example_booking['id']}/ledger", params={"format": "csv"}, headers={"Authorization": f"Bearer {token}"}, timeout=30)
    assert r.headers["content-type"].startswith("text/csv")
    lines = [l for l in r.text.splitlines() if ",PAYMENT," in l]
    assert len(lines) == 10
    assert lines[-1].rstrip().endswith(",0.0,0.0,0.0")
