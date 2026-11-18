"""Cross-worker flat claims: tests that book "an Available flat" must never pick the same flat on both xdist workers."""

import fcntl
import json
import os

_CLAIMS = os.path.join(os.path.dirname(__file__), ".flat_claims.json")
_SESSION = os.environ.get("KKT_TEST_SESSION", "")


def claim_flat(flats, ok=lambda f: True) -> dict:
    """First flat in `flats` passing `ok` that no other test in this session has claimed; the claim is recorded atomically."""
    with open(_CLAIMS, "a+") as fh:
        fcntl.flock(fh, fcntl.LOCK_EX)
        try:
            fh.seek(0)
            raw = fh.read()
            data = json.loads(raw) if raw else {}
            taken = set(data.get(_SESSION, []))
            # an `Own-*` tower belongs to the own_flats() caller even before its claim lands (creation → claim window)
            flat = next(
                f
                for f in flats
                if f["id"] not in taken and not str(f.get("block_name") or "").startswith("Own-") and ok(f)
            )
            fh.seek(0)
            fh.truncate()
            json.dump({_SESSION: sorted(taken | {flat["id"]})}, fh)
            return flat
        finally:
            fcntl.flock(fh, fcntl.LOCK_UN)


def _claim_all(ids: list[str]):
    with open(_CLAIMS, "a+") as fh:
        fcntl.flock(fh, fcntl.LOCK_EX)
        try:
            fh.seek(0)
            raw = fh.read()
            data = json.loads(raw) if raw else {}
            fh.seek(0)
            fh.truncate()
            json.dump({_SESSION: sorted(set(data.get(_SESSION, [])) | set(ids))}, fh)
        finally:
            fcntl.flock(fh, fcntl.LOCK_UN)


def own_flats(api: str, headers: dict, n: int, rate: int = 4000) -> list[dict]:
    """A fresh tower in SGH with `n` rate-priced flats and a Standard CLP default — no other test can book them."""
    import uuid

    import requests

    def call(method, p, body=None, **params):
        h = {**headers, "Idempotency-Key": str(uuid.uuid4())}
        r = requests.request(method, f"{api}{p}", headers=h, json=body, params=params, timeout=60)
        assert r.status_code in (200, 201), (method, p, r.status_code, r.text[:300])
        return r.json()

    sgh = next(p for p in call("GET", "/projects")["items"] if p.get("code") == "SGH")
    bt = call("GET", "/master/block-types")["items"][0]
    ft = call("GET", "/master/flat-types", page_size=100)["items"][0]
    code = f"T{uuid.uuid4().hex[:3].upper()}"
    body = {
        "project_id": sgh["id"],
        "block_type_id": bt["id"],
        "name": f"Own-{code}",
        "code": code,
        "floors": 1,
        "flats_per_floor": n,
        "floor_start": 1,
        "numbering_pattern": "{block}-{floor}{pos2}",
        "position_flat_types": [{"position": i, "flat_type_id": ft["id"]} for i in range(1, n + 1)],
        "rate_per_sqft": rate,
    }
    blk = call("POST", "/blocks", body)
    plans = call("GET", "/master/payment-plans", page_size=200)["items"]
    plan = next(p for p in plans if p.get("code") == "STANDARD_CLP")
    assign = {"payment_plan_id": plan["id"], "project_id": sgh["id"], "block_id": blk["id"], "is_default": True}
    call("POST", "/payment-plan-assignments", assign)
    made = sorted(call("GET", "/flats", block_id=blk["id"], page_size=200)["items"], key=lambda f: f["flat_number"])
    _claim_all([f["id"] for f in made])  # the tower is in SGH: claim_flat() in other tests must never pick these
    out = []
    for f in made:
        sheet = {"saleable_sqft": 1000, "pricing_mode": "rate", "rate_per_sqft": rate, "version": f["version"]}
        call("PATCH", f"/flats/{f['id']}/pricing", sheet)
        out.append(call("GET", f"/flats/{f['id']}"))
    assert len(out) == n and all(f.get("price") for f in out), out
    return out
