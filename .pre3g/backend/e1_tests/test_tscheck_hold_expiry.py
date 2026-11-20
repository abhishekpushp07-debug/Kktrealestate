"""Owner rule: Hold without expiry -> 422 on all three paths; nothing changes. Uses GGV P6 read-only (rejections only)."""
FLAT = "0f2a8829-c24d-462a-8d39-b444b216c465"
BLOCK = "0d220380-bdd3-4202-9769-7a5db753b75a"


def _state(api):
    f = api.get(f"/flats/{FLAT}").json()
    return f["status"], f.get("version")


def _chk(r):
    assert r.status_code == 422, (r.status_code, r.text[:200])
    assert "Hold expiry is required" in r.text, r.text[:300]


def test_hold_without_expiry_rejected(api):
    before = _state(api)
    v = before[1]
    _chk(api.patch(f"/flats/{FLAT}/status", json={"status": "Hold", "reason": "tscheck-hold", "version": v}))
    _chk(api.post(f"/blocks/{BLOCK}/bulk-status", json={"flat_ids": [FLAT], "status": "Hold", "reason": "tscheck-hold"}))
    _chk(api.post("/inventory/bulk", json={"flat_ids": [FLAT], "action": "hold", "reason": "tscheck-hold"}))
    assert _state(api) == before
