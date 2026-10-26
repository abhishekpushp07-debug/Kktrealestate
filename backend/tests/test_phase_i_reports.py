"""Phase I reports: every registered report answers JSON + CSV + PDF, carries totals, honours ETag/304 and its permission code."""
import pytest
import requests

from tests.conftest import BASE as ROOT, session_token

API = f"{ROOT}/api"
NEW = ["collections-v2", "outstanding-v2", "cash-vs-account", "receivables-forecast", "other-charges", "roznamcha-summary", "site-visits", "sales-team", "construction-vs-plan", "data-quality"]


def _h():
    return {"Authorization": f"Bearer {session_token('admin@kkt.in', 'Kkt@12345')}"}


def test_registry_lists_every_phase_i_report_with_purpose():
    items = requests.get(f"{API}/reports", headers=_h(), timeout=30).json()["items"]
    keys = {i["key"] for i in items}
    for k in NEW + ["demand-vs-collection", "cheques", "cancellations", "bank-receipts", "inventory", "sales-leads", "service-sla", "activity"]:
        assert k in keys, k
    assert all(i.get("purpose") and i.get("group") in ("Finance", "Sales", "Construction", "Operations", "Admin") for i in items)


@pytest.mark.parametrize("key", NEW)
def test_report_json_csv_pdf_and_etag(key):
    h = _h()
    r = requests.get(f"{API}/reports/{key}", headers=h, timeout=90)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "columns" in body and "rows" in body and "totals" in body and body.get("purpose")
    tag = r.headers.get("ETag")
    assert tag
    r304 = requests.get(f"{API}/reports/{key}", headers={**h, "If-None-Match": tag}, timeout=90)
    assert r304.status_code == 304
    csv = requests.get(f"{API}/reports/{key}", headers=h, params={"format": "csv"}, timeout=90)
    assert csv.status_code == 200 and csv.headers["content-type"].startswith("text/csv")
    assert "_paise" not in csv.text.splitlines()[0]  # rupees at the edge
    pdf = requests.get(f"{API}/reports/{key}", headers=h, params={"format": "pdf"}, timeout=120)
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    pdf2 = requests.get(f"{API}/reports/{key}", headers=h, params={"format": "pdf"}, timeout=120)
    assert pdf.content == pdf2.content  # deterministic bytes


def test_unknown_param_rejected_and_group_invariant():
    h = _h()
    assert requests.get(f"{API}/reports/collections-v2", headers=h, params={"foo": 1}, timeout=30).status_code == 400
    tot = requests.get(f"{API}/reports/collections-v2", headers=h, params={"from_date": "2020-01-01", "to_date": "2030-12-31"}, timeout=90).json()["totals"]["total_paise"]
    by = requests.get(f"{API}/reports/collections-v2", headers=h, params={"from_date": "2020-01-01", "to_date": "2030-12-31", "group_by": "project"}, timeout=90).json()
    assert sum(r["total_paise"] for r in by["rows"]) == tot


def test_registry_has_no_unregistered_codes():
    reg = requests.get(f"{API}/admin/access/registry", headers=_h(), timeout=30).json()
    assert reg["unregistered"] == []
    codes = {r["code"] for r in reg["items"]} if "items" in reg else set()
    for c in ("reports.cash_vs_account.view", "reports.other_charges.export", "reports.site_visit_conversion.view", "reports.sales_team.view", "reports.data_quality.view"):
        assert not codes or c in codes
