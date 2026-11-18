"""Phase I reports: every registered report answers JSON + CSV + PDF, carries totals, honours ETag/304 and its permission code."""

import os

import pytest
import requests

from tests.conftest import BASE as ROOT
from tests.conftest import session_token

TEST_PASSWORD = os.environ["TEST_PASSWORD"]  # seeded-user password from backend/.env (loaded by conftest)

API = f"{ROOT}/api"
NEW = [
    "collections-v2",
    "outstanding-v2",
    "cash-vs-account",
    "receivables-forecast",
    "other-charges",
    "roznamcha-summary",
    "site-visits",
    "sales-team",
    "construction-vs-plan",
    "data-quality",
]


def _h():
    return {"Authorization": f"Bearer {session_token('admin@kkt.in', TEST_PASSWORD)}"}


def test_registry_lists_every_phase_i_report_with_purpose():
    items = requests.get(f"{API}/reports", headers=_h(), timeout=30).json()["items"]
    keys = {i["key"] for i in items}
    for k in NEW + [
        "demand-vs-collection",
        "cheques",
        "cancellations",
        "bank-receipts",
        "inventory",
        "sales-leads",
        "service-sla",
        "activity",
    ]:
        assert k in keys, k
    assert all(
        i.get("purpose") and i.get("group") in ("Finance", "Sales", "Construction", "Operations", "Admin")
        for i in items
    )


@pytest.mark.load_sensitive  # two reads must see one state: no writes from the other worker in between
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
    tot = requests.get(
        f"{API}/reports/collections-v2",
        headers=h,
        params={"from_date": "2020-01-01", "to_date": "2030-12-31"},
        timeout=90,
    ).json()["totals"]["total_paise"]
    by = requests.get(
        f"{API}/reports/collections-v2",
        headers=h,
        params={"from_date": "2020-01-01", "to_date": "2030-12-31", "group_by": "project"},
        timeout=90,
    ).json()
    assert sum(r["total_paise"] for r in by["rows"]) == tot


def test_registry_has_no_unregistered_codes():
    reg = requests.get(f"{API}/admin/access/registry", headers=_h(), timeout=30).json()
    assert reg["unregistered"] == []
    codes = {r["code"] for r in reg["items"]} if "items" in reg else set()
    for c in (
        "reports.cash_vs_account.view",
        "reports.other_charges.export",
        "reports.site_visit_conversion.view",
        "reports.sales_team.view",
        "reports.data_quality.view",
    ):
        assert not codes or c in codes


def test_demands_honour_block_id_and_planned_date_roundtrip():
    h = _h()
    blocks = requests.get(f"{API}/blocks?page_size=50", headers=h, timeout=30).json()
    blocks = blocks if isinstance(blocks, list) else blocks["items"]
    with_dem = next(
        b
        for b in blocks
        if requests.get(
            f"{API}/payments/demands", headers=h, params={"block_id": b["id"], "page_size": 5}, timeout=30
        ).json()["items"]
    )
    items = requests.get(
        f"{API}/payments/demands", headers=h, params={"block_id": with_dem["id"], "page_size": 200}, timeout=30
    ).json()["items"]
    assert items and all(d["block_id"] == with_dem["id"] for d in items)
    cons = requests.get(f"{API}/blocks/{with_dem['id']}/construction", headers=h, timeout=30).json()
    cvp = requests.get(
        f"{API}/reports/construction-vs-plan", headers=h, params={"block_id": with_dem["id"]}, timeout=60
    ).json()
    planned_stage_names = {
        r["stage"].split(". ", 1)[1].replace(" ← next", "")
        for r in cvp["rows"]
        if not r.get("_subtotal") and r["status"] != "Completed" and r["expected_paise"] > 0
    }
    pend = next((s for s in cons["stages"] if s["status"] != "Completed" and s["name"] in planned_stage_names), None)
    if not pend:
        pytest.skip("no pending stage with a plan row")
    r = requests.patch(
        f"{API}/blocks/{with_dem['id']}/construction/stages/{pend['stage_id']}/planned-date",
        headers=h,
        json={"planned_date": "2027-03-15"},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    fc = requests.get(
        f"{API}/reports/receivables-forecast", headers=h, params={"block_id": with_dem["id"]}, timeout=60
    ).json()
    assert fc["group_by"] == "month" and any(row["group"] == "2027-03" for row in fc["rows"])
    before = requests.get(f"{API}/reports/receivables-forecast", headers=h, timeout=60).json()["totals"]
    assert before["expected_paise"] + before["raised_paise"] == before["agreement_paise"]  # identity retained
    done = next((s for s in cons["stages"] if s["status"] == "Completed"), None)
    if done:
        assert (
            requests.patch(
                f"{API}/blocks/{with_dem['id']}/construction/stages/{done['stage_id']}/planned-date",
                headers=h,
                json={"planned_date": "2027-03-15"},
                timeout=30,
            ).status_code
            == 409
        )
    assert (
        requests.patch(
            f"{API}/blocks/{with_dem['id']}/construction/stages/{pend['stage_id']}/planned-date",
            headers=h,
            json={"planned_date": None},
            timeout=30,
        ).status_code
        == 200
    )
    logs = requests.get(  # filtered by action: under -n 2 the newest 20 rows are other workers' writes
        f"{API}/audit-logs", headers=h, params={"page_size": 20, "action": "construction.planned_date"}, timeout=30
    ).json()
    assert any(l.get("action") == "construction.planned_date" for l in logs.get("items", []))


def test_collections_date_basis_and_csv_shape():
    h = _h()
    a = requests.get(
        f"{API}/reports/collections-v2",
        headers=h,
        params={"from_date": "2025-04-01", "to_date": "2026-03-31"},
        timeout=60,
    ).json()
    b = requests.get(
        f"{API}/reports/collections-v2",
        headers=h,
        params={"from_date": "2025-04-01", "to_date": "2026-03-31", "date_basis": "clearance"},
        timeout=60,
    ).json()
    assert a["date_basis"] == "cleared" and b["date_basis"] == "clearance" and a["basis_text"] != b["basis_text"]
    assert a["kpis"][0]["label"] == "Net received" and a["purpose"]
    assert (
        requests.get(f"{API}/reports/collections-v2", headers=h, params={"date_basis": "x"}, timeout=30).status_code
        == 400
    )
    csv = requests.get(
        f"{API}/reports/collections-v2",
        headers=h,
        params={"from_date": "2025-04-01", "to_date": "2026-03-31", "format": "csv"},
        timeout=60,
    ).text.splitlines()
    assert csv[0].startswith("# Collections (Received)") and "Date basis: cleared" in csv[0]
    assert "Cash received ₹" in csv[1] and "Net received ₹" in csv[1]
    assert csv[-1].startswith("TOTAL")


def test_outstanding_three_balances_law():
    h = _h()
    o = requests.get(f"{API}/reports/outstanding-v2", headers=h, timeout=60).json()
    labels = [c["label"] for c in o["columns"]]
    assert ["Outstanding", "Advance held", "Net balance"] == [
        l for l in labels if l in ("Outstanding", "Advance held", "Net balance")
    ]
    for r in o["rows"]:
        assert (
            r["net_balance_paise"]
            == r["outstanding_paise"] - r["advance_paise"]
            == r["udhar_paise"] - r["jama_paise"] - r.get("waived_paise", 0)  # REQ-250: received + waived
        )
    r = o["rows"][0]
    s = requests.get(f"{API}/bookings/{r['_link'].rsplit('/', 1)[1]}", headers=h, timeout=30).json()["summary"]
    assert s["net_balance_paise"] == r["net_balance_paise"] and s["outstanding_paise"] == r["outstanding_paise"]


def test_manual_bill_counts_in_outstanding_and_ageing(admin_headers):
    """PRE-01 (owner decision A, 2026-11-18): a manual bill is owed money — it is in Outstanding, aged by its own due
    date, and the three-balances law (Net balance = Udhar − Jama) holds on a booking that carries one."""
    import uuid
    from datetime import date, timedelta

    from tests.flat_claims import own_flats

    def call(method, path, body=None):
        r = requests.request(method, f"{API}{path}", headers={**admin_headers, "Idempotency-Key": uuid.uuid4().hex},
                             json=body, timeout=120)  # fmt: skip
        assert r.status_code in (200, 201), (path, r.status_code, r.text[:300])
        return r.json()

    def row(bid):
        rows = call("GET", "/reports/outstanding-v2")["rows"]
        return next(r for r in rows if r["_link"].endswith(bid))

    today = date.today()
    f = own_flats(API, admin_headers, 1)[0]
    cust = call("POST", "/customers", {"full_name": "QA Manual Bill", "phone": f"9{uuid.uuid4().int % 10**9:09d}"})
    plans = call("GET", f"/projects/{f['project_id']}/blocks/{f['block_id']}/payment-plans")["items"]
    bk = call("POST", "/bookings", {"flat_id": f["id"], "customer_id": cust["id"], "agreement_value": f["price"],
              "cash_agreed": 0, "account_agreed": f["price"], "payment_plan_id": plans[0]["id"],
              "booking_date": (today - timedelta(days=50)).isoformat(), "other_charges": []})  # fmt: skip
    before = call("GET", f"/bookings/{bk['id']}")["summary"]
    band_before = row(bk["id"])["band_0-30"]
    call("POST", "/demands/manual", {"booking_id": bk["id"], "name": "QA manual bill", "cash_amount": 5000,
         "account_amount": 20000, "demand_date": (today - timedelta(days=20)).isoformat(),
         "due_date": (today - timedelta(days=10)).isoformat()})  # fmt: skip
    s = call("GET", f"/bookings/{bk['id']}")["summary"]
    assert s["outstanding_paise"] == before["outstanding_paise"] + 2_500_000
    assert s["cash_due_paise"] == before["cash_due_paise"] + 500_000
    assert s["account_due_paise"] == before["account_due_paise"] + 2_000_000
    assert s["net_balance_paise"] == s["total_udhar_paise"] - s["total_jama_paise"] == s["balance_paise"]
    r = row(bk["id"])
    assert r["net_balance_paise"] == r["outstanding_paise"] - r["advance_paise"] == r["udhar_paise"] - r["jama_paise"]
    assert r["outstanding_paise"] == s["outstanding_paise"]
    assert r["band_0-30"] == band_before + 2_500_000  # aged by the manual bill's own due date (10 days late)
