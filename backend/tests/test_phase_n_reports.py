"""Phase N reports hub: 4 inventory-control screens share the common report shape (kpis/columns/rows/totals, CSV/PDF, ETag) and tie out to flats."""
import os
import sys

import pytest
import requests
from pymongo import MongoClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from tests.conftest import BASE  # noqa: E402

TEST_PASSWORD = os.environ["TEST_PASSWORD"]  # seeded-user password from backend/.env (loaded by conftest)

mongo = MongoClient(os.environ["MONGO_URL"])[os.environ.get("KKT_TEST_DB", "kkt_test")]
KEYS = ["inventory-control", "landowner-share", "hold-register", "masked-inventory"]


def _login(email):
    r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": TEST_PASSWORD})
    return {"Authorization": f"Bearer {r.json()['access_token']}"} if r.status_code == 200 else None


def test_registry_lists_inventory_reports(admin_headers):
    items = {i["key"]: i for i in requests.get(f"{BASE}/api/reports", headers=admin_headers).json()["items"]}
    for k in KEYS:
        assert k in items and items[k]["purpose"] and items[k]["group"] == "Sales", k


@pytest.mark.parametrize("key", KEYS)
def test_shape_csv_pdf_etag(admin_headers, key):
    r = requests.get(f"{BASE}/api/reports/{key}", headers=admin_headers, timeout=60)
    assert r.status_code == 200, r.text
    body = r.json()
    assert {"columns", "rows", "totals", "kpis", "tie_out", "purpose"} <= set(body)
    assert requests.get(f"{BASE}/api/reports/{key}", headers={**admin_headers, "If-None-Match": r.headers["ETag"]}).status_code == 304
    csv = requests.get(f"{BASE}/api/reports/{key}", headers=admin_headers, params={"format": "csv"}, timeout=60)
    assert csv.status_code == 200 and "_paise" not in csv.text.splitlines()[0]
    pdf = requests.get(f"{BASE}/api/reports/{key}", headers=admin_headers, params={"format": "pdf"}, timeout=90)
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    assert requests.get(f"{BASE}/api/reports/{key}", headers=admin_headers, params={"bogus": 1}).status_code == 400


def test_tie_outs(admin_headers):
    n_flats = mongo.flats.count_documents({"is_active": True})
    ic = requests.get(f"{BASE}/api/reports/inventory-control", headers=admin_headers).json()
    assert ic["tie_out"]["flats"] == ic["tie_out"]["rows_total"] == ic["totals"]["total"] == n_flats
    lo = requests.get(f"{BASE}/api/reports/landowner-share", headers=admin_headers).json()
    assert lo["tie_out"]["landowner_flats"] == lo["tie_out"]["rows_landowner"] == mongo.flats.count_documents({"is_active": True, "allocation_category_code": "LANDOWNER"})
    hr = requests.get(f"{BASE}/api/reports/hold-register", headers=admin_headers).json()
    assert hr["tie_out"]["flats_on_hold"] == hr["tie_out"]["rows_active"] == len(hr["rows"]) == mongo.flats.count_documents({"is_active": True, "status": "Hold"})
    assert hr["group_options"] == ["active", "expiring", "expired"]
    ex = requests.get(f"{BASE}/api/reports/hold-register", headers=admin_headers, params={"group_by": "expiring"}).json()
    assert all(r["state"] == "expiring" for r in ex["rows"]) and len(ex["rows"]) == hr["totals_extra"]["expiring_48h"]
    mk = requests.get(f"{BASE}/api/reports/masked-inventory", headers=admin_headers).json()
    assert mk["tie_out"]["masked"] == len(mk["rows"]) <= mk["tie_out"]["overrides"]


def test_masked_report_privileged_only():
    sales = _login("sales@kkt.in")
    if not sales:
        pytest.skip("no sales user")
    assert requests.get(f"{BASE}/api/reports/masked-inventory", headers=sales).status_code == 403
    ic = requests.get(f"{BASE}/api/reports/inventory-control", headers=sales)
    if ic.status_code == 200:  # if sales may view the hub report, it must not carry the masked column
        assert ic.json()["privileged"] is False and all(c["key"] != "masked" for c in ic.json()["columns"])
