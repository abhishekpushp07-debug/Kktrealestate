"""Phase I reports: every registered report answers JSON + CSV + PDF, carries totals, honours ETag/304 and its permission code."""
import os

import pytest
import requests

from tests.conftest import BASE as ROOT
from tests.conftest import session_token

TEST_PASSWORD = os.environ["TEST_PASSWORD"]  # seeded-user password from backend/.env (loaded by conftest)

API = f"{ROOT}/api"
NEW = ["collections-v2", "outstanding-v2", "cash-vs-account", "receivables-forecast", "other-charges", "roznamcha-summary", "site-visits", "sales-team", "construction-vs-plan", "data-quality"]


def _h():
    return {"Authorization": f"Bearer {session_token('admin@kkt.in', TEST_PASSWORD)}"}


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



def test_demands_honour_block_id_and_planned_date_roundtrip():
    h = _h()
    blocks = requests.get(f"{API}/blocks?page_size=50", headers=h, timeout=30).json()
    blocks = blocks if isinstance(blocks, list) else blocks["items"]
    with_dem = next(b for b in blocks if requests.get(f"{API}/payments/demands", headers=h, params={"block_id": b["id"], "page_size": 5}, timeout=30).json()["items"])
    items = requests.get(f"{API}/payments/demands", headers=h, params={"block_id": with_dem["id"], "page_size": 200}, timeout=30).json()["items"]
    assert items and all(d["block_id"] == with_dem["id"] for d in items)
    cons = requests.get(f"{API}/blocks/{with_dem['id']}/construction", headers=h, timeout=30).json()
    cvp = requests.get(f"{API}/reports/construction-vs-plan", headers=h, params={"block_id": with_dem["id"]}, timeout=60).json()
    planned_stage_names = {r["stage"].split(". ", 1)[1].replace(" ← next", "") for r in cvp["rows"] if not r.get("_subtotal") and r["status"] != "Completed" and r["expected_paise"] > 0}
    pend = next((s for s in cons["stages"] if s["status"] != "Completed" and s["name"] in planned_stage_names), None)
    if not pend:
        pytest.skip("no pending stage with a plan row")
    r = requests.patch(f"{API}/blocks/{with_dem['id']}/construction/stages/{pend['stage_id']}/planned-date", headers=h, json={"planned_date": "2027-03-15"}, timeout=30)
    assert r.status_code == 200, r.text
    fc = requests.get(f"{API}/reports/receivables-forecast", headers=h, params={"block_id": with_dem["id"]}, timeout=60).json()
    assert fc["group_by"] == "month" and any(row["group"] == "2027-03" for row in fc["rows"])
    before = requests.get(f"{API}/reports/receivables-forecast", headers=h, timeout=60).json()["totals"]
    assert before["expected_paise"] + before["raised_paise"] == before["agreement_paise"]  # identity retained
    done = next((s for s in cons["stages"] if s["status"] == "Completed"), None)
    if done:
        assert requests.patch(f"{API}/blocks/{with_dem['id']}/construction/stages/{done['stage_id']}/planned-date", headers=h, json={"planned_date": "2027-03-15"}, timeout=30).status_code == 409
    assert requests.patch(f"{API}/blocks/{with_dem['id']}/construction/stages/{pend['stage_id']}/planned-date", headers=h, json={"planned_date": None}, timeout=30).status_code == 200
    logs = requests.get(f"{API}/audit-logs", headers=h, params={"page_size": 20}, timeout=30).json()
    assert any(l.get("action") == "construction.planned_date" for l in logs.get("items", []))


def test_collections_date_basis_and_csv_shape():
    h = _h()
    a = requests.get(f"{API}/reports/collections-v2", headers=h, params={"from_date": "2025-04-01", "to_date": "2026-03-31"}, timeout=60).json()
    b = requests.get(f"{API}/reports/collections-v2", headers=h, params={"from_date": "2025-04-01", "to_date": "2026-03-31", "date_basis": "clearance"}, timeout=60).json()
    assert a["date_basis"] == "receipt" and b["date_basis"] == "clearance" and a["basis_text"] != b["basis_text"]
    assert a["kpis"][0]["label"] == "Net received" and a["purpose"]
    assert requests.get(f"{API}/reports/collections-v2", headers=h, params={"date_basis": "x"}, timeout=30).status_code == 400
    csv = requests.get(f"{API}/reports/collections-v2", headers=h, params={"from_date": "2025-04-01", "to_date": "2026-03-31", "format": "csv"}, timeout=60).text.splitlines()
    assert csv[0].startswith("# Collections (Received)") and "Date basis: receipt date" in csv[0]
    assert "Cash received ₹" in csv[1] and "Net received ₹" in csv[1]
    assert csv[-1].startswith("TOTAL")


def test_outstanding_three_balances_law():
    h = _h()
    o = requests.get(f"{API}/reports/outstanding-v2", headers=h, timeout=60).json()
    labels = [c["label"] for c in o["columns"]]
    assert ["Outstanding", "Advance held", "Net balance"] == [l for l in labels if l in ("Outstanding", "Advance held", "Net balance")]
    for r in o["rows"]:
        assert r["net_balance_paise"] == r["outstanding_paise"] - r["advance_paise"] == r["udhar_paise"] - r["jama_paise"]
    r = o["rows"][0]
    s = requests.get(f"{API}/bookings/{r['_link'].rsplit('/', 1)[1]}", headers=h, timeout=30).json()["summary"]
    assert s["net_balance_paise"] == r["net_balance_paise"] and s["outstanding_paise"] == r["outstanding_paise"]
