"""JRN-26/27 (read-only): refresh state after the manual run, setup and logins kept, numbers monotonic.
Pre-refresh values noted 2026-11-16 00:03 UTC: highest BK-2627-2047 / KKT/2627/14994 (JRN-4 then issued 2048 / 14995)."""
import httpx
from conftest import BASE, _pw

PRICES = {"A-102": 645250000, "A-701": 681500000, "C-304": 456750000}
HOLD_REASONS_BEFORE = ["Customer interest", "Legal/documentation", "Management", "Pricing review", "Token received"]


def test_last_refresh_today_done_with_backup(api):
    d = api.get("/admin/demo-refresh").json()
    ld = d["last_done"]
    assert ld["outcome"].startswith("done") and ld["as_of"] == "2026-11-16" and ld["backup"], ld


def test_backup_listed_as_last_backup(api):
    d = api.get("/admin/backups").json()
    ld = api.get("/admin/demo-refresh").json()["last_done"]
    assert ld["backup"] in [a.get("archive") or a.get("name") for a in d.get("archives", [])]
    assert d["last_backup"], "System Health 'Last backup' is empty although a pre-refresh archive exists"


def test_home_alive(api):
    t = api.get("/dashboard/home").json()["totals"]
    assert t["collections_mtd_paise"] > 0 and t["pending_cheques_paise"] > 0, t


def test_logins_kept():
    for u in ("admin@kkt.in", "sales@kkt.in"):
        r = httpx.post(f"{BASE}/auth/login", json={"email": u, "password": _pw()}, timeout=30)
        assert r.status_code == 200, (u, r.text[:200])


def test_unsold_prices_kept(api):
    items = api.get("/flats", params={"page_size": 200}).json()
    items = items.get("items", items)
    got = {f["flat_number"]: f["price_paise"] for f in items if f["flat_number"] in PRICES}
    assert got == PRICES, got


def test_hold_reason_master_kept(api):
    items = api.get("/master/hold-reasons", params={"page_size": 100}).json()
    names = sorted(i["name"] for i in items.get("items", items))
    assert names == HOLD_REASONS_BEFORE, names


def test_numbers_only_go_up(api):
    items = api.get("/bookings", params={"page_size": 200}).json()["items"]
    mx = max(int(b["booking_number"].split("-")[-1]) for b in items if b["booking_number"].startswith("BK-2627"))
    assert mx > 2048, mx
