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


MIX = [  # realistic ERP staff mix (weights): dashboard/home, lists, search, customer 360, booking ledger, reports, writes
    (20, {"name": "home", "method": "GET", "path": "/api/dashboard/home", "auth": True}),
    (20, {"name": "bookings_list", "method": "GET", "path": "/api/bookings?limit=20", "auth": True}),
    (15, {"name": "payments_list", "method": "GET", "path": "/api/payments?limit=20", "auth": True}),
    (15, {"name": "search", "method": "GET", "path": "/api/search?q=Am&limit=8", "auth": True}),
    (10, {"name": "customer_360", "method": "GET", "path": "/api/customers/{customer_id}", "auth": True}),
    (10, {"name": "booking_ledger", "method": "GET", "path": "/api/bookings/{booking_id}/ledger", "auth": True}),
    (5, {"name": "report_outstanding", "method": "GET", "path": "/api/reports/outstanding", "auth": True}),
    (5, {"name": "customer_create", "method": "POST", "path": "/api/customers", "auth": True, "write": True, "body": lambda: {"full_name": "Load Test", "phone": f"91{uuid.uuid4().int % 10**8:08d}", "salutation": "Mr"}}),
]


async def mixed_worker(client, token, until, lat, errs, created, ids, per_scn):
    import random
    weights = [w for w, _ in MIX]
    while time.perf_counter() < until:
        sc = random.choices([s for _, s in MIX], weights)[0]
        path = sc["path"].format(**ids)
        headers = {"Authorization": f"Bearer {token}"}
        kw = {}
        if sc.get("write"):
            headers["Idempotency-Key"] = str(uuid.uuid4())
            kw["json"] = sc["body"]()
        t0 = time.perf_counter()
        try:
            r = await client.request(sc["method"], path, headers=headers, **kw)
            ms = (time.perf_counter() - t0) * 1000
            lat.append(ms)
            per_scn.setdefault(sc["name"], []).append(ms)
            st = r.headers.get("server-timing", "")
            if "db;dur=" in st:
                per_scn.setdefault(sc["name"] + "@db", []).append(float(st.split("db;dur=")[1].split(",")[0]))
            if r.status_code >= 400:
                errs[f"{r.status_code} {r.json().get('code', '')}" if r.headers.get("content-type", "").startswith("application/json") else str(r.status_code)] += 1
            elif sc.get("write") and r.status_code in (200, 201):
                created.append(r.json().get("id"))
        except Exception as e:  # noqa: BLE001
            errs[type(e).__name__] += 1
            lat.append((time.perf_counter() - t0) * 1000)


async def run_mix(base, email, password, user_levels, seconds, out_dir, note=""):
    """Phase J5: realistic mix at several concurrency levels; server-side db time from Server-Timing; hot paths ranked by p95."""
    import psutil
    limits = httpx.Limits(max_connections=max(user_levels) + 10, max_keepalive_connections=max(user_levels) + 10)
    async with httpx.AsyncClient(base_url=base, timeout=60, limits=limits) as client:
        r = await client.post("/api/auth/login", json={"email": email, "password": password})
        r.raise_for_status()
        tokens = [r.json()["access_token"]]
        for _ in range(min(20, max(user_levels)) - 1):
            rr = await client.post("/api/auth/login", json={"email": email, "password": password})
            if rr.status_code == 200:
                tokens.append(rr.json()["access_token"])
        h = {"Authorization": f"Bearer {tokens[0]}"}
        bk = (await client.get("/api/bookings?limit=1", headers=h)).json()["items"][0]
        ids = {"booking_id": bk["id"], "customer_id": bk["customer_id"]}
        api_pid = None
        for p in psutil.process_iter(["pid", "cmdline"]):
            cl = " ".join(p.info["cmdline"] or [])
            if "uvicorn" in cl and base.rsplit(":", 1)[-1].split("/")[0] in cl:
                api_pid = p.info["pid"]
        results = []
        for users in user_levels:
            lat, errs, created, per = [], Counter(), [], {}
            await asyncio.gather(*[mixed_worker(client, tokens[i % len(tokens)], time.perf_counter() + 3, [], Counter(), [], ids, {}) for i in range(min(users, 20))])  # warm-up
            rss0 = psutil.Process(api_pid).memory_info().rss / 1048576 if api_pid else None
            t0 = time.perf_counter()
            await asyncio.gather(*[mixed_worker(client, tokens[i % len(tokens)], t0 + seconds, lat, errs, created, ids, per) for i in range(users)])
            dur = time.perf_counter() - t0
            rss1 = psutil.Process(api_pid).memory_info().rss / 1048576 if api_pid else None
            hot = sorted([(k, pct(v, 0.95), len(v)) for k, v in per.items() if not k.endswith("@db")], key=lambda x: -(x[1] or 0))
            dbp = {k[:-3]: pct(v, 0.95) for k, v in per.items() if k.endswith("@db")}
            n5 = sum(c for k, c in errs.items() if k.startswith("5") and "OVERLOADED" not in k)
            shed = sum(c for k, c in errs.items() if "OVERLOADED" in k)
            results.append({"users": users, "requests": len(lat), "rps": round(len(lat) / dur, 1), "p50_ms": pct(lat, 0.5), "p95_ms": pct(lat, 0.95), "p99_ms": pct(lat, 0.99), "errors": dict(errs), "5xx_non_shed": n5, "shed_503": shed,
                            "rss_mb_before": round(rss0, 1) if rss0 else None, "rss_mb_after": round(rss1, 1) if rss1 else None, "hot_paths": [{"scenario": k, "p95_ms": p, "n": n, "db_p95_ms": dbp.get(k)} for k, p, n in hot[:8]], "kind": "measured"})
            for cid in created:
                await client.delete(f"/api/customers/{cid}", headers=h)
            await asyncio.sleep(3)
        os.makedirs(out_dir, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        meta = {"base": base, "levels": user_levels, "seconds": seconds, "at": stamp, "note": note or "Sandbox: ONE uvicorn worker, shared CPU with the preview stack and MongoDB on the same container. Production capacity = measured per-worker RPS × workers (ESTIMATE)."}
        json.dump({"meta": meta, "results": results}, open(os.path.join(out_dir, f"loadmix_{stamp}.json"), "w"), indent=2)
        md = [f"# Load profile {stamp}", "", meta["note"], "", "| users | req | rps | p50 ms | p95 ms | p99 ms | 5xx (non-shed) | shed 503 | RSS MB before→after | errors |", "|---|---|---|---|---|---|---|---|---|---|"]
        md += [f"| {r['users']} | {r['requests']} | {r['rps']} | {r['p50_ms']} | {r['p95_ms']} | {r['p99_ms']} | {r['5xx_non_shed']} | {r['shed_503']} | {r['rss_mb_before']}→{r['rss_mb_after']} | {r['errors'] or '—'} |" for r in results]
        for r in results:
            md += ["", f"## Hot paths @ {r['users']} users (p95, server db p95 from Server-Timing)", "| scenario | p95 ms | db p95 ms | n |", "|---|---|---|---|"]
            md += [f"| {h['scenario']} | {h['p95_ms']} | {h['db_p95_ms']} | {h['n']} |" for h in r["hot_paths"]]
        open(os.path.join(out_dir, f"loadmix_{stamp}.md"), "w").write("\n".join(md))
        print("\n".join(md))
        return results


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
    ap.add_argument("--mix", default=None, help="comma-separated user levels for the realistic mix, e.g. 100,300,600")
    a = ap.parse_args()
    if a.mix:
        asyncio.run(run_mix(a.base, a.email, a.password, [int(x) for x in a.mix.split(",")], a.seconds, a.out))
    else:
        asyncio.run(run(a.base, a.email, a.password, a.users, a.seconds, a.out))
