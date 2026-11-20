"""3I load test (REQ-369/370): 50 users × 20 min, realistic mix with think time, on a scratch copy of kkt_volume served by
2 processes pinned to 2 cores. --redis: with a local Redis (REDIS_URL), stopped for 60 s at minute 10.
Records p50/p95 per action, user-visible errors (5xx / connection), RSS per worker at start / 10 / 20 min and Redis
commands sent. Never touches preview or production.
  python tools/loadtest_3i.py --out /app/memory/qa/phase3i/load_noredis.md [--redis] [--users 50] [--minutes 20]"""

import argparse
import asyncio
import os
import random
import statistics
import subprocess
import sys
import time
from collections import defaultdict

import httpx

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import perf_budget as PB  # noqa: E402

R = random.Random(42)
_B = "/app/.eqtmp/bin"  # a copy that survives the container resetting /usr (LD_LIBRARY_PATH for its libs)
REDIS_SERVER = "/usr/bin/redis-server" if os.path.exists("/usr/bin/redis-server") else f"{_B}/redis-server"
REDIS_CLI = "/usr/bin/redis-cli" if os.path.exists("/usr/bin/redis-cli") else f"{_B}/redis-cli"
os.environ["LD_LIBRARY_PATH"] = _B + ":" + os.environ.get("LD_LIBRARY_PATH", "")


def rss_mb(master: int) -> list[float]:
    kids = subprocess.run(["pgrep", "-P", str(master)], capture_output=True, text=True).stdout.split()
    out = []
    for p in kids:
        try:
            for line in open(f"/proc/{p}/status"):
                if line.startswith("VmRSS"):
                    out.append(round(int(line.split()[1]) / 1024, 1))
        except OSError:
            pass
    return out


async def main(a):
    if a.redis:
        subprocess.run([REDIS_SERVER, "--daemonize", "yes", "--port", "6390", "--save", "", "--appendonly", "no"])
        os.environ["REDIS_URL"] = "redis://127.0.0.1:6390/0"
        subprocess.run([REDIS_CLI, "-p", "6390", "flushall"], capture_output=True)
    else:
        os.environ.pop("REDIS_URL", None)
    PB.CFG.update(cpus="0,1", workers=2)
    PB.snapshot("kkt_volume")
    proc = PB.start_backend()
    base = f"http://127.0.0.1:{PB.PORT}"
    lat, errs, rss = defaultdict(list), defaultdict(int), {}
    try:
        async with httpx.AsyncClient(base_url=base, timeout=30) as c:
            h = {"X-Rate-Limit-Bypass": PB.BYPASS}
            tok = (
                await c.post("/api/auth/login", json={"email": "admin@kkt.in", "password": PB.DEMO_PASSWORD}, headers=h)
            ).json()
            h["Authorization"] = f"Bearer {tok['access_token']}"
            bks = (await c.get("/api/bookings", params={"status": "Active", "page_size": 200}, headers=h)).json()[
                "items"
            ]
            from pymongo import MongoClient

            mode = MongoClient(os.environ["MONGO_URL"])[PB.SCRATCH_DB].payment_modes.find_one({"code": "CASH"})["id"]
            sys.path.insert(0, PB.BACKEND)
            from reports_v3.registry import REGISTRY

            keys = list(REGISTRY)
            rss["start"] = rss_mb(proc.pid)
            t0 = time.monotonic()
            end = t0 + a.minutes * 60

            def acts():
                b = R.choice(bks)
                return R.choices(
                    [
                        ("home", "GET", "/api/home/bundle?period=month", None),
                        ("bookings_list", "GET", "/api/bookings?page_size=20", None),
                        ("booking_detail", "GET", f"/api/bookings/{b['id']}", None),
                        ("ledger", "GET", f"/api/bookings/{b['id']}/ledger", None),
                        ("report", "GET", f"/api/reports/v3/{R.choice(keys)}?page_size=50", None),
                        ("search", "GET", "/api/search?q=Sh&limit=5", None),
                        (
                            "payment",
                            "POST",
                            "/api/payments",
                            {
                                "booking_id": b["id"],
                                "amount": 1000,
                                "payment_date": time.strftime("%Y-%m-%d"),
                                "payment_mode_id": mode,
                                "allocation": "auto",
                                "remarks": "load 3i",
                            },
                        ),
                    ],
                    weights=[20, 15, 15, 10, 25, 10, 5],
                )[0]

            relogins = [0]

            async def user(i):
                await asyncio.sleep(R.uniform(0, 10))
                while time.monotonic() < end:
                    name, m, path, body = acts()
                    hh = h | ({"Idempotency-Key": os.urandom(8).hex()} if body else {})
                    s = time.perf_counter()
                    try:
                        r = await c.request(m, path, json=body, headers=hh)
                        if r.status_code == 401:  # access token expired mid-run: sign in again, count it
                            tok = (
                                await c.post(
                                    "/api/auth/login",
                                    json={"email": "admin@kkt.in", "password": PB.DEMO_PASSWORD},
                                    headers={"X-Rate-Limit-Bypass": PB.BYPASS},
                                )
                            ).json()
                            h["Authorization"] = f"Bearer {tok['access_token']}"
                            relogins[0] += 1
                        elif r.status_code >= 500 or r.status_code in (400, 403, 429):
                            errs[f"{name} {r.status_code}"] += 1
                    except httpx.HTTPError as e:
                        errs[f"{name} {type(e).__name__}"] += 1
                    lat[name].append(1000 * (time.perf_counter() - s))
                    await asyncio.sleep(R.uniform(a.think_min, a.think_max))

            async def ticker():
                while time.monotonic() < end:
                    await asyncio.sleep(5)
                    el = time.monotonic() - t0
                    if el >= 300 * (len(rss.setdefault("curve", [])) + 1):  # RSS every 5 min (memory curve)
                        rss["curve"].append((round(el / 60), rss_mb(proc.pid)))
                    if "10min" not in rss and el >= 600:
                        rss["10min"] = rss_mb(proc.pid)
                        if a.redis:
                            subprocess.run([REDIS_CLI, "-p", "6390", "shutdown", "nosave"], capture_output=True)
                            rss["redis_stopped_at_s"] = round(el)
                            await asyncio.sleep(60)
                            subprocess.run(
                                [
                                    REDIS_SERVER,
                                    "--daemonize",
                                    "yes",
                                    "--port",
                                    "6390",
                                    "--save",
                                    "",
                                    "--appendonly",
                                    "no",
                                ]
                            )
                            rss["redis_back_at_s"] = round(time.monotonic() - t0)

            await asyncio.gather(ticker(), *(user(i) for i in range(a.users)))
            rss["20min"] = rss_mb(proc.pid)
            rss["relogins"] = relogins[0]
            r_ops = await c.get("/api/admin/ops", headers=h)
            ops = r_ops.json() if r_ops.status_code == 200 else {"status": r_ops.status_code, "body": r_ops.text[:200]}
    finally:
        proc.terminate()
        proc.wait(timeout=30)
    red = ((ops.get("caches") or {}).get("redis")) if isinstance(ops, dict) else None
    stats = ""
    if a.redis:  # Redis's own count since it came back at minute 11 (INFO commandstats), for the monthly projection
        stats = subprocess.run([REDIS_CLI, "-p", "6390", "info", "commandstats"], capture_output=True, text=True).stdout
        stats = " ".join(x.split(",")[0] for x in stats.splitlines() if x.startswith("cmdstat_"))
    n = sum(len(v) for v in lat.values())
    lines = [
        f"# 3I load test — {'with local Redis (stopped 60 s at minute 10)' if a.redis else 'no Redis'}",
        f"{a.users} users × {a.minutes} min, think {a.think_min}-{a.think_max} s, kkt_volume scratch copy, 2 processes, cores 0,1. "
        f"{n} requests, {n / (a.minutes * 60):.1f} req/s. **User-visible errors: {sum(errs.values())}** {dict(errs) or ''}",
        "",
        "| Action | n | p50 ms | p95 ms | max ms |",
        "|---|---|---|---|---|",
    ]
    for k, v in sorted(lat.items()):
        v = sorted(v)
        lines.append(
            f"| {k} | {len(v)} | {statistics.median(v):.0f} | {v[int(0.95 * (len(v) - 1))]:.0f} | {v[-1]:.0f} |"
        )
    lines += [
        "",
        f"RSS MB per worker: start {rss.get('start')} · 10 min {rss.get('10min')} · end ({a.minutes:g} min) {rss.get('20min')}",
        f"Re-sign-ins after token expiry: {rss.get('relogins')}",
        "RSS curve (minute, MB per process): " + " · ".join(f"{m}: {v}" for m, v in rss.get("curve", [])),
    ]
    if a.redis:
        lines += [
            f"Redis stopped at {rss.get('redis_stopped_at_s')} s, back at {rss.get('redis_back_at_s')} s. "
            f"Redis card (one process): {red if red is not None else ops}",
            f"Redis commandstats since it came back: {stats or '—'}",
        ]
    open(a.out, "w").write("\n".join(lines) + "\n")
    print("\n".join(lines))
    if a.redis:
        subprocess.run([REDIS_CLI, "-p", "6390", "shutdown", "nosave"], capture_output=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--redis", action="store_true")
    ap.add_argument("--users", type=int, default=50)
    ap.add_argument("--minutes", type=float, default=20)
    ap.add_argument("--think-min", type=float, default=3)
    ap.add_argument("--think-max", type=float, default=8)
    asyncio.run(main(ap.parse_args()))
