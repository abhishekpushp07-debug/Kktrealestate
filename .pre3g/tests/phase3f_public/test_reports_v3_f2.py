"""Phase 3F F2 — Customers segment reports on the v3 engine, against the PUBLIC preview URL. Read-only."""

import os
import time

import pytest
import requests

BASE = (os.environ.get("REACT_APP_BACKEND_URL") or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0]).rstrip("/")
API = f"{BASE}/api/reports/v3"
PW = "Kkt@12345"
F2 = ["customer-statement", "customer-ageing", "advance-holders", "call-list", "kyc-pending", "payment-behaviour", "customer-directory", "cancelled-customers"]
BANDS = ["band_not_due", "band_0_30", "band_31_60", "band_61_90", "band_90p"]
_tok = {}


def H(email):
    if email not in _tok:
        for _ in range(3):
            r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": PW}, timeout=30)
            if r.status_code == 200:
                _tok[email] = r.json()["access_token"]
                break
            time.sleep(3)
        else:
            pytest.skip(f"login failed {email}")
    return {"Authorization": f"Bearer {_tok[email]}"}


def get(key, params=None, email="admin@kkt.in", suffix=""):
    return requests.get(f"{API}/{key}{suffix}", headers=H(email), params={"page_size": 500, **(params or {})}, timeout=90)


def J(key, params=None, email="admin@kkt.in"):
    r = get(key, params, email)
    assert r.status_code == 200, f"{key} {params}: {r.status_code} {r.text[:300]}"
    return r.json()


# Hub
def test_hub_customers_segment():
    d = requests.get(API, headers=H("admin@kkt.in"), timeout=90).json()
    seg = next(s for s in d["segments"] if s["segment"] == "Customers")
    keys = [t["key"] for t in seg["tiles"]]
    assert len(keys) == 10
    by = {t["key"]: t for t in seg["tiles"]}
    for k in ["customer-status", *F2]:
        assert by[k]["live"], k
        assert by[k].get("headline"), k
    assert by["customer-statement"]["headline"] == "—"
    assert not by["service-sla"]["live"] and by["service-sla"]["legacy"] == "service-sla"


# Statement
def test_statement_needs_customer():
    d = J("customer-statement")
    assert d["count"] == 0 and d["meta"]["needs"]["message"] == "Pick a customer to see their statement"


@pytest.fixture(scope="module")
def stmt():
    d = J("customer-statement")
    opts = d["options"]["customer"]
    assert opts
    cid = next(o["value"] for o in opts if "Amit Kumar Sinha" in o["label"]) if any("Amit Kumar Sinha" in o["label"] for o in opts) else opts[0]["value"]
    return cid, J("customer-statement", {"customer": cid})


def test_statement_lines_and_formula(stmt):
    cid, d = stmt
    assert d["count"] > 0
    t = d["totals"]
    for k in ("bill", "received", "waived"):
        assert sum(r[k] for r in d["rows"]) == t[k]
    # last balance per booking = bills - received - waived of that booking
    per = {}
    for r in d["rows"]:
        per.setdefault(r["flat_code"], []).append(r)
    total_bal = 0
    for fc, rs in per.items():
        total_bal += rs[-1]["balance"]
    assert total_bal == t["bill"] - t["received"] - t["waived"], (total_bal, t)
    assert "Bills" in d["formula"] and "= balance" in d["formula"]
    kinds = {r["particulars"].split(" · ")[0] for r in d["rows"]}
    print("kinds:", kinds)


def test_statement_as_of_narrows(stmt):
    cid, d = stmt
    dates = sorted({r["date"][:10] for r in d["rows"]})
    mid = dates[len(dates) // 2]
    d2 = J("customer-statement", {"customer": cid, "as_of": mid})
    assert 0 < d2["count"] < d["count"]
    assert all(r["date"][:10] <= mid for r in d2["rows"])


# Ageing
def test_ageing_bands_sum():
    d = J("customer-ageing")
    assert d["count"] > 0
    for r in d["rows"]:
        assert sum(r.get(b) or 0 for b in BANDS) == r["total_due"], r
        assert r["total_due"] > 0
    assert sum(d["totals"][b] for b in BANDS) == d["totals"]["total_due"]


def test_ageing_filters():
    d = J("customer-ageing")
    n = d["count"]
    proj = d["options"]["project"][0]["value"]
    assert J("customer-ageing", {"project": proj})["count"] < n
    d2 = J("customer-ageing", {"overdue_days": 90})
    assert all(r["days_overdue"] >= 90 for r in d2["rows"]) and d2["count"] < n
    d3 = J("customer-ageing", {"due_min": 100000})
    assert all(r["total_due"] >= 100000 * 100 for r in d3["rows"]), "due_min should be rupees"
    assert d3["count"] < n


# Advance
def test_advance_holders():
    d = J("advance-holders")
    assert all(r["advance_total"] > 0 for r in d["rows"])
    assert sum(r["advance_total"] for r in d["rows"]) == d["totals"]["advance_total"]


# Call list
def test_call_list_sort_and_reason():
    d = J("call-list")
    days = [r["days_overdue"] or 0 for r in d["rows"]]
    assert days == sorted(days, reverse=True)
    assert "phone" in d["rows"][0]
    o = J("call-list", {"reason": "Overdue"})
    s = J("call-list", {"reason": "Due soon"})
    assert o["count"] + s["count"] == d["count"]
    assert all((r["days_overdue"] or 0) > 0 for r in o["rows"])
    w = J("call-list", {"window_from": "2026-11-01", "window_to": "2026-12-31"})
    assert all("2026-11-01" <= (r["next_due_date"] or "")[:10] <= "2026-12-31" for r in w["rows"])


# KYC
def test_kyc_pending_filters():
    d = J("kyc-pending")
    allr = J("kyc-pending", {"show_complete": "true"})
    assert allr["count"] >= d["count"]
    a = J("kyc-pending", {"pending": "agreement"})
    assert all(r["agreement"].startswith("Pending · ") for r in a["rows"])
    k = J("kyc-pending", {"pending": "kyc"})
    assert all(r["kyc_status"] != "Verified" for r in k["rows"])
    for r in d["rows"][:5]:
        assert r["agreement"].startswith("Signed") or r["agreement"].startswith("Pending · ")


# Behaviour
def test_payment_behaviour_one_row_per_customer():
    d = J("payment-behaviour")
    ids = [r["customer_id"] for r in d["rows"]]
    assert len(ids) == len(set(ids))
    assert d["meta"]["row_link"] == "/customers/{customer_id}"
    beh = {r["behaviour"] for r in d["rows"]}
    b = next(iter(beh))
    f = J("payment-behaviour", {"behaviour": b})
    assert all(r["behaviour"] == b for r in f["rows"])
    for r in d["rows"]:
        assert r["on_time_pct"] is None or 0 <= r["on_time_pct"] <= 100


# Directory
def test_directory():
    d = J("customer-directory")
    ids = [r["customer_id"] for r in d["rows"]]
    assert len(ids) == len(set(ids)) and len(ids) > 0
    assert d["meta"]["date_mode"] is None
    keys = {c["key"] for c in d["cols"]}
    assert {"customer_code", "phone", "email", "co_applicants", "city", "source", "sales_person"} <= keys


# Cancelled
def test_cancelled_transferred():
    d = J("cancelled-customers")
    kinds = {r["kind"] for r in d["rows"]}
    print("kinds", kinds, d["count"], d["totals"])
    for r in d["rows"]:
        if r["kind"] == "Cancelled":
            assert r["refund_paid"] + r["refund_pending"] == r["refund_payable"]
        else:
            assert "→" in r["new_flat"]


# Group/sort/export on every report
@pytest.mark.parametrize("key", F2)
def test_group_sort_export(key):
    p = {"customer": J("customer-statement")["options"]["customer"][0]["value"]} if key == "customer-statement" else {}
    d = J(key, p)
    g = d["meta"]["groups"][0]["key"]
    dg = J(key, p | {"group": g})
    assert "groups" in dg
    col = d["meta"]["columns"][0]["key"]
    assert J(key, p | {"sort": col, "dir": "desc"})["count"] == d["count"]
    x = get(key, p, suffix="/export.xlsx")
    assert x.status_code == 200 and x.content[:2] == b"PK"
    pdf = get(key, p, suffix="/export.pdf")
    assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"


# Permissions
@pytest.mark.parametrize("key", F2)
def test_sales_403(key):
    assert get(key, email="sales@kkt.in").status_code == 403


def test_accounts_access():
    me = requests.get(f"{BASE}/api/auth/me", headers=H("accounts@kkt.in"), timeout=30).json()
    perms = set(me.get("permissions") or (me.get("user") or {}).get("permissions") or [])
    has = "reports.outstanding.view" in perms
    code = get("customer-ageing", email="accounts@kkt.in").status_code
    assert code == (200 if has else 403), (has, code)
    print("accounts has outstanding.view:", has, "cancellations:", "reports.cancellations_refunds.view" in perms)
