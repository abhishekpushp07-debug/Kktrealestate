"""Phase D4 load profile (asyncio/httpx; Locust/k6 are not installable offline in this sandbox).
Realistic ERP mix: 60% reads (list/detail), 20% search, 15% dashboard/bootstrap, 5% writes (idempotent payments, lead stage).
Staged concurrency with a shared token pool (no per-request login). Writes CSV of every request + a markdown summary.

  python tools/load_profile.py --base http://localhost:8002 --stages 100,300,600 --duration 180 --out /app/memory/qa/perf
"""
import argparse
import asyncio
import csv
import os
import random
import subprocess
import sys
import time
import uuid

import httpx

TOK = {"X-Rate-Limit-Bypass": "kkt-test-bypass-local"}
R = random.Random(7)


async def login(c, email):
    r = await c.post("/api/auth/login", json={"email": email, "password": "Kkt@12345"}, headers=TOK)
    r.raise_for_status()
    return r.json()["access_token"]


async def prepare(c, h):
    bk = (await c.get("/api/bookings?page_size=100", headers=h)).json()["items"]
    cust = (await c.get("/api/customers?page_size=100", headers=h)).json()["items"]
    leads = (await c.get("/api/leads?page_size=100", headers=h)).json()["items"]
    modes = {m["code"]: m["id"] for m in (await c.get("/api/master/payment-modes", headers=h)).json()["items"]}
    return bk, cust, leads, modes


def pick_op(bk, cust, leads, modes):
    x = R.random()
    b = R.choice(bk)
    if x < 0.60:
        return R.choice([
            ("bookings", "GET", "/api/bookings?page_size=50", None),
            ("booking_detail", "GET", f"/api/bookings/{b['id']}", None),
            ("customers", "GET", "/api/customers?page_size=50", None),
            ("customer_detail", "GET", f"/api/customers/{R.choice(cust)['id']}", None),
            ("payments", "GET", "/api/payments?page_size=50", None),
            ("inventory", "GET", f"/api/flats?block_id={b['block_id']}&page_size=200", None),
            ("crm", "GET", "/api/leads/board", None),
        ])
    if x < 0.80:
        term = R.choice(["Sinha", "Verma", "Kumar", "A-1", "BK-25", "98"])
        return R.choice([("search", "GET", f"/api/customers?search={term}&page_size=50", None), ("search", "GET", f"/api/search?q={term}", None), ("search", "GET", f"/api/bookings?search={term}&page_size=50", None)])
    if x < 0.95:
        return R.choice([("dashboard", "GET", "/api/dashboard/home", None), ("bootstrap", "GET", "/api/bootstrap", None)])
    if R.random() < 0.6:
        body = {"booking_id": b["id"], "against": "FLAT_VALUE", "payment_category": "Account", "amount": 1000, "payment_date": time.strftime("%Y-%m-%d"), "payment_mode_id": modes.get("NEFT") or modes.get("UPI") or modes.get("CASH"), "remarks": "load"}
        return ("write_payment", "POST", "/api/payments", body)
    ld = R.choice(leads)
    return ("write_lead", "POST", f"/api/leads/{ld['id']}/stage", {"status": R.choice(["Contacted", "Site Visit", "Negotiation", "New"])})


async def worker(c, tokens, data, stop, rows, stage):
    while time.time() < stop:
        group, m, url, body = pick_op(*data)
        h = {"Authorization": f"Bearer {R.choice(tokens)}", **TOK}
        if m == "POST":
            h["Idempotency-Key"] = str(uuid.uuid4())
        t = time.perf_counter()
        try:
            r = await c.request(m, url, json=body, headers=h)
            code = r.status_code
        except (httpx.RemoteProtocolError, httpx.ReadError):
            # keep-alive race (server closed an idle connection as we reused it) — retry once on a fresh connection, like browsers do
            try:
                r = await c.request(m, url, json=body, headers={**h, "Connection": "close"})
                code = r.status_code
            except Exception as e:  # noqa: BLE001
                code = f"EXC:{type(e).__name__}"
        except Exception as e:  # noqa: BLE001
            code = f"EXC:{type(e).__name__}"
        rows.append((stage, group, m, url.split("?")[0], code, round((time.perf_counter() - t) * 1000, 1), time.time()))


def pct(xs, p):
    xs = sorted(xs)
    return round(xs[min(len(xs) - 1, int(len(xs) * p))], 1) if xs else None


def proc_stats(pattern):
    try:
        out = subprocess.check_output(["bash", "-c", "ps -o pid=,pcpu=,rss= -C python | head -50"], text=True)
        pids = subprocess.check_output(["bash", "-c", f"pgrep -f '{pattern}'"], text=True).split()
        rows = [l.split() for l in out.strip().splitlines() if l.split() and l.split()[0] in pids]
        return {"cpu_pct": round(sum(float(r[1]) for r in rows), 1), "rss_mb": round(sum(int(r[2]) for r in rows) / 1024, 1)}
    except Exception:  # noqa: BLE001
        return {}


async def main(base, stages, duration, out, suffix=""):
    os.makedirs(out, exist_ok=True)
    limits = httpx.Limits(max_connections=700, max_keepalive_connections=700)
    async with httpx.AsyncClient(base_url=base, timeout=60, limits=limits) as c:
        tokens = [await login(c, e) for e in ("admin@kkt.in", "sales@kkt.in", "accounts@kkt.in", "projectadmin@kkt.in") for _ in range(2)]
        h = {"Authorization": f"Bearer {tokens[0]}", **TOK}
        data = await prepare(c, h)
        rows = []
        summary = []
        for users in stages:
            stop = time.time() + duration
            t0 = time.time()
            n0 = len(rows)
            await asyncio.gather(*[worker(c, tokens, data, stop, rows, users) for _ in range(users)])
            mine = rows[n0:]
            el = time.time() - t0
            ps = proc_stats("uvicorn server:app --host 127.0.0.1 --port 8002")
            ops = (await c.get("/api/admin/ops?window=180", headers=h)).json()
            groups = {}
            for g in sorted({r[1] for r in mine}):
                xs = [r[5] for r in mine if r[1] == g]
                errs = sum(1 for r in mine if r[1] == g and (not isinstance(r[4], int) or r[4] >= 500))
                groups[g] = (len(xs), pct(xs, 0.5), pct(xs, 0.95), pct(xs, 0.99), errs)
            summary.append({"users": users, "secs": round(el), "requests": len(mine), "rps": round(len(mine) / el, 1), "p50": pct([r[5] for r in mine], 0.5), "p95": pct([r[5] for r in mine], 0.95), "p99": pct([r[5] for r in mine], 0.99),
                            "err_rate_pct": round(100 * sum(1 for r in mine if not isinstance(r[4], int) or r[4] >= 500) / max(1, len(mine)), 2), "groups": groups, "proc": ps,
                            "mongo_opcounters": (ops.get("db_pool", {}).get("server") or {}).get("opcounters"), "pool": ops.get("db_pool", {}).get("live"), "server_p95": ops.get("requests", {}).get("p95_ms")})
            print(f"stage {users}u: {len(mine)} req {len(mine)/el:.1f} rps p50={summary[-1]['p50']} p95={summary[-1]['p95']} p99={summary[-1]['p99']} err={summary[-1]['err_rate_pct']}% proc={ps}")
            await asyncio.sleep(5)
    with open(os.path.join(out, f"load_raw{suffix}.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["stage_users", "group", "method", "path", "status", "ms", "ts"])
        w.writerows(rows)
    with open(os.path.join(out, f"load_report{suffix}.md"), "w") as f:
        f.write(f"# Load profile — {base} · stages {stages} × {duration}s · {time.strftime('%Y-%m-%d %H:%M')}\n\nClient: asyncio/httpx in-pod (shares the 1-vCPU sandbox with the server — client overhead inflates latencies at 600 users). Token pool of 8 users; writes use fresh Idempotency-Keys.\n\n")
        f.write("| Users | Requests | RPS | p50 ms | p95 ms | p99 ms | 5xx/exception % | worker CPU % | worker RSS MB | server-side p95 (ops) |\n|---|---|---|---|---|---|---|---|---|---|\n")
        for s in summary:
            f.write(f"| {s['users']} | {s['requests']} | {s['rps']} | {s['p50']} | {s['p95']} | {s['p99']} | {s['err_rate_pct']} | {s['proc'].get('cpu_pct')} | {s['proc'].get('rss_mb')} | {s['server_p95']} |\n")
        for s in summary:
            f.write(f"\n## {s['users']} users — per route group\n\n| Group | n | p50 | p95 | p99 | 5xx |\n|---|---|---|---|---|---|\n")
            for g, v in s["groups"].items():
                f.write(f"| {g} | {v[0]} | {v[1]} | {v[2]} | {v[3]} | {v[4]} |\n")
            f.write(f"\nMongo opcounters: `{s['mongo_opcounters']}` · pool: `{s['pool']}`\n")
    print("wrote", out)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8002")
    ap.add_argument("--stages", default="100,300,600")
    ap.add_argument("--duration", type=int, default=180)
    ap.add_argument("--out", default="/app/memory/qa/perf")
    ap.add_argument("--suffix", default="")
    a = ap.parse_args()
    sys.exit(asyncio.run(main(a.base, [int(x) for x in a.stages.split(",")], a.duration, a.out, a.suffix)))
