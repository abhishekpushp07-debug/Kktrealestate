"""JRN-37/27 post-refresh: masters + custom rows kept, ids stable, logins, numbers higher. Needs tscheck_prerefresh_snapshot.json."""
import json, os, httpx
from conftest import BASE, _pw
S = json.load(open(os.path.join(os.path.dirname(__file__), "tscheck_prerefresh_snapshot.json")))
MASTERS = [k for k, v in S.items() if isinstance(v, list) and k not in ("flats", "projects")]


def _items(d): return d.get("items", d) if isinstance(d, dict) else d


def test_refresh_done_today_with_backup(api):
    ld = api.get("/admin/demo-refresh").json()["last_done"]
    assert ld["outcome"] == "done" and ld["as_of"] == "2026-11-16" and ld["started_at"] > "2026-11-16T04:17", ld
    assert ld["backup"] and ld["backup"] != S["pre_backup"]
    lb = api.get("/admin/backups").json()["last_backup"]
    assert lb and lb["archive"] == ld["backup"], (lb, ld["backup"])


def test_masters_kept(api):
    for k in MASTERS:
        now = {(i["id"], i.get("name")) for i in _items(api.get(f"/master/{k}", params={"page_size": 200}).json())}
        missing = {tuple(t) for t in S[k]} - now
        assert not missing, (k, missing)
    names = [i["name"] for i in _items(api.get("/master/hold-reasons", params={"page_size": 200}).json())]
    assert "tscheck custom reason" in names and "Token received (custom)" in names


def test_ids_stable(api):
    assert sorted(i["id"] for i in api.get("/flats", params={"page_size": 200}).json()["items"]) == S["flats"]
    assert sorted(i["id"] for i in _items(api.get("/projects").json())) == S["projects"]
    n = S["noted"]
    for f in n["flats"]:
        assert api.get(f"/flats/{f}").status_code == 200
    h = api.get("/dashboard/home").json()
    assert any(b["block_id"] == n["tower_c"] for p in h["projects"] if p.get("id", p.get("project_id")) == n["project_sgh"] or p["code"] == "SGH" for b in p["blocks"])


def test_logins():
    for u in ("admin@kkt.in", "sales@kkt.in"):
        assert httpx.post(f"{BASE}/auth/login", json={"email": u, "password": _pw()}, timeout=30).status_code == 200, u


def test_numbers_higher(api):
    b = api.get("/bookings", params={"page_size": 200}).json()["items"]
    assert max(x["booking_number"] for x in b) > S["max_bk"]
    p = _items(api.get("/payments", params={"page_size": 200}).json())
    assert max(x.get("receipt_number") or "" for x in p) > S["max_rc"]
