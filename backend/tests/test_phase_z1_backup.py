"""Z.1 — backup retention policy (per-db keep-N + global cap), low-disk skip, admin endpoints RBAC."""
import json
import os

import pytest
import requests

from tools import backup as bk

BASE = os.environ.get("REACT_APP_BACKEND_URL") or "http://127.0.0.1:8001"
pytestmark = pytest.mark.skipif(not os.environ.get("KKT_TEST_EXTERNAL", "1"), reason="external")


def _hdr(email):
    r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": os.environ["TEST_PASSWORD"]}, timeout=30)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json().get('access_token') or r.json().get('token')}"}


def _fake(d, db, stamp, size):
    p = d / f"{db}-{stamp}.archive.gz"
    p.write_bytes(b"x" * size)
    (d / f"{db}-{stamp}.archive.gz.manifest.json").write_text(json.dumps({"db": db, "created_at": f"2026-10-{stamp[6:8]}T{stamp[9:11]}:00:00+00:00"}))


def test_prune_keeps_n_per_db_and_under_cap(tmp_path):
    for i in range(1, 10):
        _fake(tmp_path, "kkt", f"202610{i:02d}T010000Z", 1000)
    for i in range(1, 6):
        _fake(tmp_path, "kkt_test", f"202610{i:02d}T020000Z", 1000)
    pol = {"keep_per_db": 7, "keep_test_db": 2, "max_total_mb": 2048, "min_free_pct": 15}
    res = bk.prune(str(tmp_path), pol=pol)
    rows = bk.list_archives(str(tmp_path))
    assert len([r for r in rows if r["db"] == "kkt"]) == 7 and len([r for r in rows if r["db"] == "kkt_test"]) == 2
    assert sorted(res["removed"])[0].startswith("kkt-20261001") and not (tmp_path / "kkt-20261001T010000Z.archive.gz.manifest.json").exists()
    # global cap: 9 × 1000 B remain; cap of 0.005 MB (= 5242 B) drops the oldest until under it
    res = bk.prune(str(tmp_path), pol={**pol, "max_total_mb": 0.005})
    rows = bk.list_archives(str(tmp_path))
    assert sum(r["bytes"] for r in rows) <= 5242 and rows[0]["created_at"] >= "2026-10-05"
    assert res["remaining"] == len(rows)


def test_preflight_skips_on_low_disk(tmp_path, monkeypatch):
    monkeypatch.setenv("DB_NAME", "kkt")
    _fake(tmp_path, "kkt", "20261001T010000Z", 1000)
    monkeypatch.setattr(bk, "disk_usage", lambda path=None: {"total_bytes": 100, "used_bytes": 95, "free_bytes": 5, "free_pct": 5.0, "used_pct": 95.0})
    pf = bk.preflight(str(tmp_path))
    assert pf["ok"] is False and "free disk" in pf["reason"]
    out = bk.run_backup(str(tmp_path))
    assert out["skipped"] is True and "free disk" in out["reason"]
    assert len(bk.list_archives(str(tmp_path))) == 1  # nothing written, nothing crashed
    monkeypatch.setattr(bk, "disk_usage", lambda path=None: {"total_bytes": 100, "used_bytes": 10, "free_bytes": 90, "free_pct": 90.0, "used_pct": 10.0})
    pf = bk.preflight(str(tmp_path), expected_bytes=10 * 1024 * 1024 * 1024)
    assert pf["ok"] is False and "cap" in pf["reason"]


def test_backups_endpoints_rbac():
    A = _hdr("admin@kkt.in")
    r = requests.get(f"{BASE}/api/admin/backups", headers=A, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert {"archives", "disk", "policy", "items"} <= set(d) and d["policy"]["keep_per_db"] >= 1 and d["disk"]["free_pct"] is not None
    for a in d["archives"]:
        assert {"db", "bytes", "created_at"} <= set(a)
    r = requests.post(f"{BASE}/api/admin/backups/prune", headers={**A, "Idempotency-Key": "z1-prune-test"}, timeout=60)
    assert r.status_code == 200 and "removed" in r.json()
    for who in ("projectadmin@kkt.in", "sales@kkt.in"):
        assert requests.get(f"{BASE}/api/admin/backups", headers=_hdr(who), timeout=30).status_code == 403
        assert requests.post(f"{BASE}/api/admin/backups/prune", headers=_hdr(who), timeout=30).status_code == 403
    h = requests.get(f"{BASE}/api/health", timeout=30).json()
    assert "disk_free_pct" in h and not any(k in json.dumps(h).lower() for k in ("password", "secret", "mongo_url"))
