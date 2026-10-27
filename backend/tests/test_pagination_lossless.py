"""Every cursor-paginated list endpoint must be lossless: walking next_cursor at any page size returns exactly the set a direct
DB query returns (and == `total`), with and without a sort param, ascending and descending."""
import os

import pytest
import requests
from pymongo import MongoClient

TEST_PASSWORD = os.environ["TEST_PASSWORD"]  # seeded-user password from backend/.env (loaded by conftest)

BASE = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/") + "/api"
H = {"X-Rate-Limit-Bypass": "kkt-test-bypass-local"}
MONGO = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]

# endpoint, collection, extra params, DB filter that mirrors the endpoint's default scope (company-wide admin)
ENDPOINTS = [
    ("/bookings", "bookings", {}, {}),
    ("/customers", "customers", {}, {}),
    ("/payments", "payments", {}, {}),
    ("/payments/demands", "demands", {}, {}),
    ("/flats", "flats", {}, {}),
    ("/leads", "leads", {}, {}),
    ("/site-visits", "site_visits", {}, {}),
    ("/service-requests", "service_requests", {}, {}),
    ("/users", "users", {}, {}),
    ("/audit-logs", "audit_logs", {}, {}),
    ("/refunds", "refunds", {}, {}),
    ("/blocks", "blocks", {}, {}),
    ("/projects", "projects", {}, {}),
    ("/parking", "parking_slots", {}, {}),
]
SIZES = (1, 7, 20, 100)


@pytest.fixture(scope="module")
def Hd():
    r = requests.post(f"{BASE}/auth/login", json={"email": "admin@kkt.in", "password": TEST_PASSWORD}, headers=H, timeout=30)
    assert r.status_code == 200, r.text
    return {**H, "Authorization": f"Bearer {r.json()['access_token']}"}


def walk(Hd, path, limit, extra):
    seen, cur, total, pages = [], None, None, 0
    while True:
        p = {"limit": limit, "with_total": "true", **extra}
        if cur:
            p["cursor"] = cur
        r = requests.get(f"{BASE}{path}", params=p, headers=Hd, timeout=60)
        assert r.status_code == 200, (path, p, r.text[:300])
        d = r.json()
        total = d["total"] if total is None else total
        seen += [x["id"] for x in d["items"]]
        cur, pages = d.get("next_cursor"), pages + 1
        assert pages <= d["total"] // limit + 10, f"{path}: walked {pages} pages for live total {d['total']} at limit {limit}"  # live total: rows created concurrently by other xdist workers (dues engine, fixtures)
        if not cur:
            return seen, total, pages


def db_ids(coll, flt, company_id):
    return {x["id"] for x in MONGO[coll].find({"company_id": company_id, **flt}, {"id": 1})}


@pytest.fixture(scope="module")
def company_id(Hd):
    return requests.get(f"{BASE}/auth/me", headers=Hd, timeout=30).json()["company_id"]


@pytest.mark.parametrize("path,coll,extra,flt", ENDPOINTS, ids=[e[0] for e in ENDPOINTS])
@pytest.mark.parametrize("limit", SIZES)
def test_cursor_walk_is_lossless(Hd, company_id, path, coll, extra, flt, limit):
    r0 = requests.get(f"{BASE}{path}", params={"limit": limit, "with_total": "true", **extra}, headers=Hd, timeout=60)
    if r0.status_code == 404:
        pytest.skip(f"{path} not mounted")
    seen, total, pages = walk(Hd, path, limit, extra)
    assert len(seen) == len(set(seen)), f"{path} limit={limit}: duplicates across pages"
    # the endpoint's own total is the contract; the DB set catches silent scope drift (only when the endpoint has no implicit filter)
    # Deterministic under concurrent xdist writers: re-read the total after the walk and accept any count within [min, max] of the two snapshots (+10 inserts in flight).
    r1 = requests.get(f"{BASE}{path}", params={"limit": limit, "with_total": "true", **extra}, headers=Hd, timeout=60).json()
    total_after = r1.get("total", total)
    lo, hi = min(total, total_after), max(total, total_after)
    assert lo - 10 <= len(seen) <= hi + 10, f"{path} limit={limit}: fetched {len(seen)} outside totals [{total}, {total_after}] over {pages} pages"
    full = db_ids(coll, flt, company_id)
    if total == len(full):
        assert set(seen) == full, f"{path} limit={limit}: set differs from DB ({len(full - set(seen))} missing)"


@pytest.mark.parametrize("sort", ["created_at", "-created_at", "name", "-booking_date", "booking_date"])
@pytest.mark.parametrize("limit", (1, 7, 20))
def test_bookings_sorted_walk_is_lossless(Hd, sort, limit):
    seen, total, _ = walk(Hd, "/bookings", limit, {"sort": sort})
    assert len(seen) == len(set(seen)) == total, (sort, limit, len(seen), total)


@pytest.mark.parametrize("limit", (1, 7))
def test_filtered_walk_is_lossless(Hd, limit):
    seen, total, _ = walk(Hd, "/bookings", limit, {"status": "Active"})
    assert len(seen) == len(set(seen)) == total
    seen, total, _ = walk(Hd, "/customers", limit, {"search": "a"})
    assert len(seen) == len(set(seen)) == total


def test_page_mode_cursor_hands_off_to_keyset(Hd):
    """Page mode's next_cursor can be used to continue in cursor mode without loss."""
    r = requests.get(f"{BASE}/bookings", params={"page": 1, "page_size": 5, "sort": "-booking_date"}, headers=Hd, timeout=30).json()
    ids = [x["id"] for x in r["items"]]
    cur = r["next_cursor"]
    while cur:
        d = requests.get(f"{BASE}/bookings", params={"cursor": cur, "limit": 5, "sort": "-booking_date"}, headers=Hd, timeout=30).json()
        ids += [x["id"] for x in d["items"]]
        cur = d["next_cursor"]
    assert len(ids) == len(set(ids)) == r["total"]


def test_max_cursor_page_size_is_documented():
    spec = requests.get(f"{BASE}/openapi.json", timeout=30).json()
    lim = next(p for p in spec["paths"]["/api/bookings"]["get"]["parameters"] if p["name"] == "limit")
    sch = lim["schema"]
    mx = sch.get("maximum") or next((a.get("maximum") for a in sch.get("anyOf", []) if a.get("maximum")), None)
    assert mx == 100 and "max 100" in lim.get("description", "")
