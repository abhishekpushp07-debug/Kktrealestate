"""Phase 3F F7 perf meter for all 50 reports on the sheet. Scratch copy of a DB (demo or kkt_volume), private backend.
first = first page right after a data write (every cache stale — a write is simulated by an audit row in the scratch
DB only); cached = repeats. Budget: p95 first ≤ 300 ms, p95 cached ≤ 100 ms (server time).
Run: python tools/perf_reports_v3.py --source kkt_volume --out /app/memory/qa/phase3f/perf_volume.md"""

import argparse
import os
import sys
import time
import uuid

import httpx
from pymongo import MongoClient

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _env import DEMO_PASSWORD  # noqa: E402
from perf_budget import BYPASS, PORT, SCRATCH_DB, pct, server_ms, snapshot, start_backend  # noqa: E402

from reports_v3.registry import REGISTRY  # noqa: E402

FIRST, CACHED = 300, 100


def params(key, c):
    spec = REGISTRY[key]
    if spec.get("needs"):
        opts = c.get(f"/api/reports/v3/{key}").json()["options"][spec["needs"]["filter"]]
        return {spec["needs"]["filter"]: opts[0]["value"]}
    return {}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default=os.environ["DB_NAME"])
    ap.add_argument("--out", required=True)
    ap.add_argument("--cold", type=int, default=6)
    ap.add_argument("--warm", type=int, default=20)
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    snapshot(a.source)
    proc = start_backend()
    scratch = MongoClient(os.environ["MONGO_URL"])[SCRATCH_DB]
    rows = []
    try:
        c = httpx.Client(base_url=f"http://127.0.0.1:{PORT}", timeout=120, headers={"X-Rate-Limit-Bypass": BYPASS})
        tok = c.post("/api/auth/login", json={"email": "admin@kkt.in", "password": DEMO_PASSWORD}).json()[
            "access_token"
        ]
        c.headers["Authorization"] = f"Bearer {tok}"
        keys = [k for k in REGISTRY if not a.only or k in a.only.split(",")]
        for key in keys:
            p = params(key, c) | {"page_size": 50}
            first = []
            for _ in range(a.cold):
                scratch.audit_logs.insert_one(
                    {
                        "id": str(uuid.uuid4()),
                        "action": "perf.bump",
                        "entity_type": "perf",
                        "created_at": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime()),
                    }
                )
                r = c.get(f"/api/reports/v3/{key}", params=p)
                assert r.status_code == 200, (key, r.status_code, r.text[:200])
                first.append(server_ms(r))
            warm = [server_ms(c.get(f"/api/reports/v3/{key}", params=p)) for _ in range(a.warm)]
            rows.append((key, REGISTRY[key]["segment"], r.json()["count"], first, warm))
            print(f"{key:24} first p95 {pct(first, 95):7.1f}  cached p95 {pct(warm, 95):6.1f}", flush=True)
    finally:
        proc.kill()
        MongoClient(os.environ["MONGO_URL"]).drop_database(SCRATCH_DB)
    bad = [k for k, _, _, f, w in rows if pct(f, 95) > FIRST or pct(w, 95) > CACHED]
    lines = [
        f"# Phase 3F report speed — {a.source} — {time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime())}",
        "",
        f"Scratch copy of `{a.source}`, private backend. first = first page after a write ({a.cold} samples, every cache stale); "
        f"cached = {a.warm} repeats. Server time (`Server-Timing: total`). Budget p95 first ≤ {FIRST} ms, cached ≤ {CACHED} ms.",
        "",
        "| Segment | Report | Rows | first p50 | first p95 | cached p50 | cached p95 | Within |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for key, seg, n, f, w in rows:
        ok = pct(f, 95) <= FIRST and pct(w, 95) <= CACHED
        lines.append(
            f"| {seg} | {key} | {n:,} | {pct(f, 50):.0f} | {pct(f, 95):.0f} | {pct(w, 50):.0f} | {pct(w, 95):.0f} | {'yes' if ok else 'NO'} |"
        )
    lines += [
        "",
        f"**{len(rows) - len(bad)}/{len(rows)} within budget**" + (f" — over: {', '.join(bad)}" if bad else ""),
        "",
    ]
    open(a.out, "w").write("\n".join(lines))
    print(f"{len(rows) - len(bad)}/{len(rows)} within budget", bad)
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
