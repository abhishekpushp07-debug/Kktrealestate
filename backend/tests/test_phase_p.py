"""Phase P: Customer 360 composite, Documents register/bulk, Demand register grouping tie-outs, manual demand → ledger + Journey, void is final."""
import os
import sys
from datetime import date, timedelta

import requests
from pymongo import MongoClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from tests.conftest import BASE  # noqa: E402

mongo = MongoClient(os.environ["MONGO_URL"])[os.environ.get("KKT_TEST_DB", "kkt_test")]


def _active_booking(h):
    r = requests.get(f"{BASE}/api/bookings", params={"status": "Active", "page_size": 5}, headers=h).json()["items"]
    assert r
    return r[0]


def test_customer360_composite_payload(admin_headers):
    b = _active_booking(admin_headers)
    p = requests.get(f"{BASE}/api/customers/{b['customer_id']}/panels", headers=admin_headers)
    assert p.status_code == 200, p.text
    d = p.json()
    for k in ("summary", "next_due", "ledgers", "demands", "receipts", "generated_documents", "tickets", "plans", "construction", "counts"):
        assert k in d, k
    s = d["summary"]
    T = d["ledgers"]["totals"]["combined"]
    assert s["udhar_paise"] == T["total_udhar_paise"] and s["jama_paise"] == T["total_jama_paise"] and s["balance_paise"] == T["balance_paise"]
    assert s["balance_paise"] == s["udhar_paise"] - s["jama_paise"]
    live = [x for x in d["demands"]["items"] if not x.get("voided")]
    assert d["counts"]["demands"] == len(live) and d["counts"]["receipts"] == len(d["receipts"]["items"])


def test_documents_generate_register_share_sent_and_deterministic(admin_headers):
    b = _active_booking(admin_headers)
    pv = requests.post(f"{BASE}/api/docgen/generate", json={"type": "statement", "booking_id": b["id"], "preview": True}, headers=admin_headers)
    assert pv.status_code == 200 and pv.content.startswith(b"%PDF")
    g = requests.post(f"{BASE}/api/docgen/generate", json={"type": "statement", "booking_id": b["id"]}, headers=admin_headers)
    assert g.status_code == 200, g.text
    doc = g.json()
    assert doc["type"] == "statement" and doc["booking_number"] == b["booking_number"] and doc["sent"] is None
    dl = requests.get(f"{BASE}/api/docgen/{doc['id']}/download", headers=admin_headers)
    assert dl.status_code == 200 and dl.content.startswith(b"%PDF")
    reg = requests.get(f"{BASE}/api/docgen/register", params={"booking_id": b["id"]}, headers=admin_headers).json()
    assert any(i["id"] == doc["id"] for i in reg["items"]) and reg["kpis"]["today"] >= 1
    sh = requests.post(f"{BASE}/api/docgen/{doc['id']}/share", headers=admin_headers).json()
    assert sh["expires_in_sec"] == 900
    anon = requests.get(f"{BASE}{sh['url']}")
    assert anon.status_code == 200 and anon.content.startswith(b"%PDF")
    assert requests.get(f"{BASE}/api/docgen/shared/not-a-token").status_code == 410
    st = requests.post(f"{BASE}/api/docgen/{doc['id']}/sent", json={"channel": "whatsapp", "note": "sent"}, headers=admin_headers)
    assert st.status_code == 200 and st.json()["sent"]["channel"] == "whatsapp"
    assert requests.post(f"{BASE}/api/docgen/{doc['id']}/sent", json={"channel": "pigeon"}, headers=admin_headers).status_code == 422
    assert mongo.audit_logs.count_documents({"action": "document.generated", "entity_id": doc["id"]}) == 1
    j = requests.get(f"{BASE}/api/journey/entity/booking/{b['id']}", headers=admin_headers).json()["items"]
    assert any(i["action"] == "document.generated" for i in j)
    for t in ("reminder", "schedule", "allotment"):
        r = requests.post(f"{BASE}/api/docgen/generate", json={"type": t, "booking_id": b["id"], "preview": True}, headers=admin_headers)
        assert r.status_code == 200 and r.content.startswith(b"%PDF"), t


def test_bulk_merged_pdf_and_zip(admin_headers):
    reg = requests.get(f"{BASE}/api/demands/register", params={"basis": "raised", "per_group": 500}, headers=admin_headers).json()
    rows = [r for g in reg["groups"] for p in g["projects"] for t in p["towers"] for r in t["rows"]][:3]
    assert len(rows) >= 2
    ids = [r["id"] for r in rows]
    m = requests.post(f"{BASE}/api/docgen/bulk", json={"demand_ids": ids, "mode": "merged"}, headers=admin_headers)
    assert m.status_code == 200 and m.content.startswith(b"%PDF")
    from pypdf import PdfReader
    import io
    singles = sum(len(PdfReader(io.BytesIO(requests.get(f"{BASE}/api/bookings/{r['booking_id']}/demands/{r['id']}/letter.pdf", headers=admin_headers).content)).pages) for r in rows)
    assert len(PdfReader(io.BytesIO(m.content)).pages) == singles  # page break per document, nothing lost
    z = requests.post(f"{BASE}/api/docgen/bulk", json={"demand_ids": ids, "mode": "zip"}, headers=admin_headers)
    assert z.status_code == 200 and z.headers["content-type"].startswith("application/zip")
    assert requests.post(f"{BASE}/api/docgen/bulk", json={"demand_ids": [], "mode": "merged"}, headers=admin_headers).status_code == 422


def test_demand_register_grouping_ties_out_to_ledger_udhar(admin_headers):
    r = requests.get(f"{BASE}/api/demands/register", params={"basis": "raised", "per_group": 500}, headers=admin_headers)
    assert r.status_code == 200 and r.headers.get("ETag")
    d = r.json()
    rows = [x for g in d["groups"] for p in g["projects"] for t in p["towers"] for x in t["rows"]]
    assert len(rows) == d["row_count"]
    assert d["tie_out"]["rows_total_paise"] == d["tie_out"]["groups_total_paise"] == d["totals"]["total_paise"] == sum(x["total_paise"] for x in rows if not x["voided"])
    for g in d["groups"]:
        assert g["totals"]["total_paise"] == sum(p["totals"]["total_paise"] for p in g["projects"])
        for p in g["projects"]:
            assert p["totals"]["total_paise"] == sum(t["totals"]["total_paise"] for t in p["towers"])
        assert all((x["due_date"] if d["basis"] == "due" else x["demand_date"]) == g["date"] for p in g["projects"] for t in p["towers"] for x in t["rows"])
    # vs ledger: Σ DEMAND Udhar rows across bookings == Σ register total (non-void, same company)
    led = sum(e["amount_paise"] for e in mongo.ledger_entries.find({"type": "DEMAND"}, {"amount_paise": 1}))
    assert led == d["totals"]["total_paise"], (led, d["totals"]["total_paise"])
    assert requests.get(f"{BASE}/api/demands/register", params={"basis": "raised"}, headers={**admin_headers, "If-None-Match": r.headers["ETag"]}).status_code == 304
    due = requests.get(f"{BASE}/api/demands/register", params={"basis": "due", "per_group": 500}, headers=admin_headers).json()
    assert due["totals"]["total_paise"] == d["totals"]["total_paise"]
    cal = requests.get(f"{BASE}/api/demands/calendar", params={"month": rows[0]["demand_date"][:7]}, headers=admin_headers).json()
    assert any(x["date"] == rows[0]["demand_date"] for x in cal["days"])
    k = requests.get(f"{BASE}/api/demands/kpis", headers=admin_headers).json()
    assert {"raised_today_paise", "overdue_paise", "collection_pct", "due_week_paise"} <= set(k)


def test_manual_demand_ledger_effect_journey_and_void_is_final(admin_headers):
    b = _active_booking(admin_headers)
    before = requests.get(f"{BASE}/api/bookings/{b['id']}/ledger", headers=admin_headers).json()["booking"]["summary"]
    due = (date.today() + timedelta(days=10)).isoformat()
    pv = requests.post(f"{BASE}/api/demands/manual", json={"booking_id": b["id"], "kind": "other_charge", "name": "Society formation", "cash_amount": 1500, "account_amount": 500, "due_date": due, "preview": True}, headers=admin_headers).json()
    assert pv["preview"] and pv["effect"]["udhar_delta_paise"] == 200_000
    r = requests.post(f"{BASE}/api/demands/manual", json={"booking_id": b["id"], "kind": "other_charge", "name": "Society formation", "cash_amount": 1500, "account_amount": 500, "due_date": due}, headers=admin_headers)
    assert r.status_code == 201, r.text
    dm = r.json()
    assert dm["source"] == "other_charge" and dm["total_paise"] == 200_000 and dm["status"] == "Open"
    after = requests.get(f"{BASE}/api/bookings/{b['id']}/ledger", headers=admin_headers).json()
    assert after["booking"]["summary"]["total_udhar_paise"] == before["total_udhar_paise"] + 200_000
    assert any(x["type"] == "DEMAND" and x.get("ref") == dm["demand_number"] for x in after["rows"])
    j = requests.get(f"{BASE}/api/journey/entity/booking/{b['id']}", headers=admin_headers).json()["items"]
    assert any(i["action"] == "demand.create" and (i.get("after") or {}).get("demand_number") == dm["demand_number"] for i in j)
    assert requests.post(f"{BASE}/api/demands/manual", json={"booking_id": b["id"], "name": "x", "cash_amount": 0, "account_amount": 0, "due_date": due}, headers=admin_headers).status_code == 422
    assert requests.post(f"{BASE}/api/demands/manual", json={"booking_id": b["id"], "name": "Late", "cash_amount": 10, "due_date": "2020-01-01"}, headers=admin_headers).status_code == 422
    v = requests.post(f"{BASE}/api/demands/{dm['id']}/void", json={"reason": "raised in error"}, headers=admin_headers)
    assert v.status_code == 200 and v.json()["udhar_delta_paise"] == -200_000
    final = requests.get(f"{BASE}/api/bookings/{b['id']}/ledger", headers=admin_headers).json()["booking"]["summary"]
    assert final["total_udhar_paise"] == before["total_udhar_paise"]
    assert requests.post(f"{BASE}/api/demands/{dm['id']}/void", json={"reason": "again"}, headers=admin_headers).status_code == 409
    assert requests.post(f"{BASE}/api/demands/{dm['id']}/unvoid", headers=admin_headers).status_code == 409
    reg = requests.get(f"{BASE}/api/demands/register", params={"basis": "raised", "status": "Voided", "customer": dm["demand_number"]}, headers=admin_headers).json()
    rows = [x for g in reg["groups"] for p in g["projects"] for t in p["towers"] for x in t["rows"]]
    assert rows and rows[0]["voided"] and rows[0]["void_reason"] == "raised in error" and rows[0]["balance_paise"] == 0
    j2 = requests.get(f"{BASE}/api/journey/entity/booking/{b['id']}", headers=admin_headers).json()["items"]
    assert any(i["action"] == "demand.void" for i in j2)
