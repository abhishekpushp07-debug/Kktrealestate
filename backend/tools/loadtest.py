"""Phase K.15: load runner (asyncio + httpx). Scenarios with warm-up, drain between scenarios, token pool, fresh Idempotency-Key per write.
Reports p50/p95/p99, RPS and an error table per scenario; writes JSON + Markdown. Measured numbers are labelled "measured"; anything derived is "estimated".
Usage: python tools/loadtest.py --base http://127.0.0.1:8001 --users 5 --seconds 15 --out /app/memory/qa/load"""
import argparse
import asyncio
import json
import os
import statistics
import sys
import time
import uuid
from collections import Counter
from datetime import datetime, timezone

import httpx

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

SCENARIOS = [
    {"name": "health", "method": "GET", "path": "/api/health", "auth": False},
    {"name": "bookings_list", "method": "GET", "path": "/api/bookings?page_size=20", "auth": True},
    {"name": "search", "method": "GET", "path": "/api/search?q=Sh&limit=5", "auth": True},
    {"name": "report_collections", "method": "GET", "path": "/api/reports/collections", "auth": True},
    {"name": "customer_create", "method": "POST", "path": "/api/customers", "auth": True, "write": True,
     "body": lambda: {"full_name": "Load Test", "phone": f"91{uuid.uuid4().int % 10**8:08d}", "salutation": "Mr"}},
]


def pct(xs, p):
    if not xs:
        return None
    xs = sorted(xs)
    return round(xs[min(len(xs) - 1, int(len(xs) * p))], 1)


async def worker(client, sc, token, until, lat, errs, created):
    while time.perf_counter() < until:
        headers = {"Authorization": f"Bearer {token}"} if sc["auth"] else {}
        kw = {}
        if sc.get("write"):
            headers["Idempotency-Key"] = str(uuid.uuid4())
            kw["json"] = sc["body"]()
        t0 = time.perf_counter()
        try:
            r = await client.request(sc["method"], sc["path"], headers=headers, **kw)
            lat.append((time.perf_counter() - t0) * 1000)
            if r.status_code >= 400:
                errs[f"{r.status_code} {r.json().get('code', '')}" if r.headers.get("content-type", "").startswith("application/json") else str(r.status_code)] += 1
            elif sc.get("write") and r.status_code in (200, 201):
                created.append(r.json().get("id"))
        except Exception as e:  # noqa: BLE001
            errs[type(e).__name__] += 1
            lat.append((time.perf_counter() - t0) * 1000)


async def run(base, email, password, users, seconds, out_dir):
    async with httpx.AsyncClient(base_url=base, timeout=30) as client:
        tokens = []
        for _ in range(users):
            r = await client.post("/api/auth/login", json={"email": email, "password": password})
            r.raise_for_status()
            tokens.append(r.json()["access_token"])
        results = []
        for sc in SCENARIOS:
            lat, errs, created = [], Counter(), []
            await asyncio.gather(*[worker(client, sc, tokens[i % len(tokens)], time.perf_counter() + 2, [], Counter(), []) for i in range(users)])  # warm-up
            t0 = time.perf_counter()
            await asyncio.gather(*[worker(client, sc, tokens[i % len(tokens)], t0 + seconds, lat, errs, created) for i in range(users)])
            dur = time.perf_counter() - t0
            results.append({"scenario": sc["name"], "method": sc["method"], "path": sc["path"], "users": users, "requests": len(lat), "rps": round(len(lat) / dur, 1),
                            "p50_ms": pct(lat, 0.5), "p95_ms": pct(lat, 0.95), "p99_ms": pct(lat, 0.99), "mean_ms": round(statistics.fmean(lat), 1) if lat else None, "errors": dict(errs), "kind": "measured"})
            for cid in created:  # clean up load-test writes
                await client.delete(f"/api/customers/{cid}", headers={"Authorization": f"Bearer {tokens[0]}"})
            await asyncio.sleep(2)  # drain
        os.makedirs(out_dir, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        meta = {"base": base, "users": users, "seconds": seconds, "at": stamp, "note": "Single-process preview container; production capacity is an ESTIMATE = measured RPS × worker count (not measured here)."}
        json.dump({"meta": meta, "results": results}, open(os.path.join(out_dir, f"loadtest_{stamp}.json"), "w"), indent=2)
        md = [f"# Load test {stamp}", "", f"base {base} · {users} virtual users · {seconds}s per scenario · warm-up 2 s · drain 2 s", "", "| scenario | req | rps | p50 ms | p95 ms | p99 ms | errors | kind |", "|---|---|---|---|---|---|---|---|"]
        md += [f"| {r['scenario']} | {r['requests']} | {r['rps']} | {r['p50_ms']} | {r['p95_ms']} | {r['p99_ms']} | {r['errors'] or '—'} | {r['kind']} |" for r in results]
        md += ["", meta["note"]]
        open(os.path.join(out_dir, f"loadtest_{stamp}.md"), "w").write("\n".join(md))
        print("\n".join(md))
        return results


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=os.environ.get("LOADTEST_BASE", "http://127.0.0.1:8001"))
    ap.add_argument("--email", default="admin@kkt.in")
    ap.add_argument("--password", default="Kkt@12345")
    ap.add_argument("--users", type=int, default=5)
    ap.add_argument("--seconds", type=int, default=10)
    ap.add_argument("--out", default="/app/memory/qa/load")
    a = ap.parse_args()
    asyncio.run(run(a.base, a.email, a.password, a.users, a.seconds, a.out))
