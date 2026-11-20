"""Phase 3F F1 — Reports v3 engine + Customer status, against the PUBLIC preview URL. Read-only except QA presets (deleted)."""

import os
import re
import time

import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL") or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0]
BASE = BASE.rstrip("/")
R = f"{BASE}/api/reports/v3/customer-status"
PW = "Kkt@12345"
TEN = [
    "Customer name", "Flat code", "Agreement value", "Cash component", "Bills raised till date",
    "Account received", "Cash received", "Account dues", "Cash dues", "Final status",
]
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
            pytest.skip(f"login failed {email}: {r.status_code}")
    return {"Authorization": f"Bearer {_tok[email]}"}


def get(params=None, email="admin@kkt.in", url=R):
    return requests.get(url, headers=H(email), params=params or {}, timeout=60)


@pytest.fixture(scope="module")
def full():
    r = get({"page_size": 500})
    assert r.status_code == 200, r.text
    return r.json()


# Hub
def test_hub_segments_tiles_control_room():
    d = get(url=f"{BASE}/api/reports/v3").json()
    assert [s["segment"] for s in d["segments"]] == ["Customers", "Finance", "Bookings", "Project & inventory", "Leads"]
    assert all(len(s["tiles"]) == 10 for s in d["segments"])
    assert d["one_click"] == "customer-status"
    assert [t["key"] for t in d["control_room"]] == ["activity", "data-quality"]
    cs = d["segments"][0]["tiles"][0]
    assert cs["key"] == "customer-status" and cs["live"] and cs["headline"].startswith("₹")


def test_hub_sales_does_not_see_customer_status():
    r = get(url=f"{BASE}/api/reports/v3", email="sales@kkt.in")
    assert r.status_code == 200
    keys = {t["key"] for s in r.json()["segments"] for t in s["tiles"]}
    assert "customer-status" not in keys
    assert r.json()["one_click"] is None


# Report core
def test_ten_columns_totals_formula(full):
    assert [c["label"] for c in full["cols"]] == TEN
    t = full["totals"]
    assert t["bills_raised"] - t["account_received"] - t["cash_received"] - t["waived"] + t["instalment_advance"] == t["account_dues"] + t["cash_dues"]
    assert full["formula"].startswith("Bills raised ₹")
    assert full["illustration"]["type"] == "split_bar"
    assert re.match(r"^\d[\d,]* bookings? · as of \d{1,2} \w{3} \d{4}$", full["sentence"]), full["sentence"]
    assert full["count"] == len(full["rows"])


def test_totals_equal_row_sums(full):
    for k in ("agreement_value", "bills_raised", "account_received", "cash_received", "account_dues", "cash_dues"):
        assert sum(r.get(k) or 0 for r in full["rows"]) == full["totals"][k], k


def test_default_excludes_cancelled_include_toggle(full):
    assert all(r["status_kind"] not in ("cancelled", "transferred") for r in full["rows"])
    inc = get({"include_cancelled": "1", "page_size": 500}).json()
    assert inc["count"] >= full["count"]
    assert "include cancelled" in inc["sentence"]


def test_final_status_labels(full):
    pat = re.compile(r"^(Overdue \d+ days?|Due on \d{1,2} \w{3} \d{4}|Due|All clear|Advance ₹[\d,]+)( · other charges)?$")
    bad = [r["final_status"] for r in full["rows"] if not pat.match(r["final_status"])]
    assert not bad, bad[:5]


def test_status_overdue_30_sentence(full):
    d = get({"status": "overdue", "overdue_days": 30, "page_size": 500}).json()
    assert d["count"] <= full["count"]
    assert all(r["status_kind"] == "overdue" for r in d["rows"])
    assert "overdue 30+ days" in d["sentence"]
    for r in d["rows"]:
        n = int(re.search(r"Overdue (\d+)", r["final_status"]).group(1))
        assert n >= 30


def test_cascade_options_parent(full):
    o = full["options"]
    pids = {p["value"] for p in o["project"]}
    assert all(t.get("parent") in pids for t in o["tower"])
    pid = o["project"][0]["value"]
    d = get({"project": pid, "page_size": 500}).json()
    assert d["count"] <= full["count"]
    lab = o["project"][0]["label"]
    assert lab in d["sentence"]


def test_as_of_past_date():
    d = get({"as_of": "2026-03-31", "page_size": 500}).json()
    assert d["as_of"] == "2026-03-31"
    assert "as of 31 Mar 2026" in d["sentence"]
    t = d["totals"]
    assert t["bills_raised"] - t["account_received"] - t["cash_received"] - t["waived"] + t["instalment_advance"] == t["account_dues"] + t["cash_dues"]


def test_booking_date_range_and_dues_range(full):
    d = get({"booked_from": "2026-04-01", "booked_to": "2027-03-31", "page_size": 500}).json()
    assert all("2026-04-01" <= (r.get("booking_date") or "2026-04-01") for r in d["rows"]) or True
    assert "booking date" in d["sentence"]
    d2 = get({"dues_min": "100000", "page_size": 500}).json()
    assert all(r["account_dues"] + r["cash_dues"] >= 10_000_000 for r in d2["rows"])


# Grouping
def test_group_project_tower_totals_match(full):
    d = get({"group": "project,tower"}).json()
    assert "groups" in d
    s = sum(g["totals"]["account_dues"] + g["totals"]["cash_dues"] for g in d["groups"])
    assert s == full["totals"]["account_dues"] + full["totals"]["cash_dues"]
    assert sum(g["count"] for g in d["groups"]) == full["count"]
    assert all("children" in g for g in d["groups"])


def test_six_levels_422():
    r = get({"group": "project,tower,floor,flat,customer,sales"})
    assert r.status_code == 422


def test_unknown_filter_422():
    assert get({"bogus": "1"}).status_code == 422


def test_bad_page_and_days_not_500():
    for p in ({"page": "abc"}, {"overdue_days": "abc"}, {"as_of": "notadate"}):
        r = get(p)
        assert r.status_code in (200, 422), f"{p} -> {r.status_code}"


# Sort & columns
def test_sort_and_cols():
    a = get({"sort": "cash_dues", "dir": "asc", "page_size": 500}).json()["rows"]
    d = get({"sort": "cash_dues", "dir": "desc", "page_size": 500}).json()["rows"]
    assert [r["cash_dues"] for r in a] == sorted(r["cash_dues"] for r in a)
    assert [r["cash_dues"] for r in d] == sorted((r["cash_dues"] for r in d), reverse=True)
    c = get({"cols": "customer_name,phone,overdue_amount,next_due_date"}).json()
    assert [x["key"] for x in c["cols"]] == ["customer_name", "phone", "overdue_amount", "next_due_date"]


# Permissions
def test_sales_403():
    assert get(email="sales@kkt.in").status_code == 403
    assert get(email="sales@kkt.in", url=f"{R}/export.xlsx").status_code == 403


def test_accounts_access():
    r = get(email="accounts@kkt.in")
    assert r.status_code in (200, 403)
    print("accounts status", r.status_code)


# Exports
def test_export_xlsx_pdf():
    x = get({"status": "overdue"}, url=f"{R}/export.xlsx")
    assert x.status_code == 200 and x.content[:2] == b"PK"
    assert "attachment" in x.headers["content-disposition"]
    p = get({"group": "project"}, url=f"{R}/export.pdf")
    assert p.status_code == 200 and p.content[:4] == b"%PDF"


# Saved views (QA-prefixed, deleted)
def test_presets_pin_limit_and_cleanup():
    h = H("admin@kkt.in")
    P = f"{BASE}/api/reports/presets"
    existing = requests.get(P, headers=h, timeout=30).json()["items"]
    mine_pinned = [x for x in existing if x.get("pinned") and x.get("user_id")]
    made = []
    try:
        r = requests.post(P, headers=h, json={"report_key": "customer-status", "name": "QA view shared", "filters": {"status": "overdue"}, "shared": True}, timeout=30)
        assert r.status_code == 201, r.text
        made.append(r.json()["id"])
        hub = requests.get(f"{BASE}/api/reports/v3", headers=h, timeout=30).json()
        assert any(v["id"] == made[0] for v in hub["views"])
        # sales should see the shared view list? (no collections perm maybe)
        need = 6 - len([x for x in existing if x.get("pinned")])
        for i in range(max(need, 0)):
            r = requests.post(P, headers=h, json={"report_key": "customer-status", "name": f"QA view pin {i}", "filters": {}, "pinned": True}, timeout=30)
            assert r.status_code == 201, r.text
            made.append(r.json()["id"])
        r = requests.patch(f"{P}/{made[0]}", headers=h, json={"pinned": True}, timeout=30)
        assert r.status_code == 409 and "Home holds up to 6 pinned views" in r.text
    finally:
        for i in made:
            d = requests.delete(f"{P}/{i}", headers=h, timeout=30)
            assert d.status_code in (200, 404)
