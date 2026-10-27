"""Phase L2 — journey-based load test (coherent data, no random noise). Creates ONE load_test project, a staff token pool, then staged VUs.

  python tools/loadtest_journeys.py --base https://<host> --stages 500,1000,2000 --stage-min 4 --email admin@… --password …
Safety: --max-vus / --max-min hard caps; stops when 5xx > 2 % sustained for 30 s; only touches the LT project; never deletes.
"""
import argparse
import asyncio
import json
import os
import random
import sys
import time
import uuid
from collections import Counter, defaultdict
from datetime import date, datetime, timezone

import httpx

OUT_DIR = "/app/memory/qa/prod"
BYPASS = os.environ.get("LOGIN_RATE_LIMIT_BYPASS_TOKEN", "")
GROUPS = {"leads": "/api/leads", "visits": "/api/site-visits", "customers": "/api/customers", "bookings": "/api/bookings", "payments": "/api/payments", "construction": "/construction/", "demands": "/api/demands",
          "receipt_pdf": "/receipt", "customer360": "/panels", "ledger": "/ledger", "reports": "/api/reports/", "service": "/api/service-requests", "notifications": "/api/notifications", "search": "/api/search", "home": "/api/dashboard"}


def verhoeff(num11: str) -> str:
    d = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]]
    pm = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]]
    inv = [0,4,3,2,1,5,6,7,8,9]
    c = 0
    for i, ch in enumerate(reversed(num11)):
        c = d[c][pm[(i + 1) % 8][int(ch)]]
    return num11 + str(inv[c])


def pct(xs, p):
    if not xs:
        return 0
    xs = sorted(xs)
    return round(xs[min(len(xs) - 1, int(len(xs) * p / 100))], 1)


def group_of(path):
    for g, frag in GROUPS.items():
        if frag in path:
            return g
    return "other"


class Metrics:
    def __init__(self):
        self.lat = defaultdict(list)
        self.dbq = defaultdict(list)
        self.err = Counter()
        self.timeouts = 0
        self.n = 0
        self.n5xx = 0
        self.window = []  # (t, is5xx)
        self.ops = []

    def rec(self, path, ms, r=None, exc=None):
        g = group_of(path)
        self.n += 1
        self.lat[g].append(ms)
        if exc is not None:
            self.err[f"client:{type(exc).__name__}"] += 1
            self.timeouts += isinstance(exc, httpx.TimeoutException)
            self.window.append((time.time(), False))
            return
        st = r.headers.get("server-timing", "")
        if "db;dur=" in st:
            self.dbq[g].append(float(st.split("db;dur=")[1].split(",")[0].split(";")[0]))
        if r.status_code >= 500:
            self.n5xx += 1
            self.err[f"{r.status_code}"] += 1
        elif r.status_code == 429:
            self.err["429"] += 1
        elif r.status_code >= 400:
            try:
                self.err[f"{r.status_code} {r.json().get('code', '')}"] += 1
            except Exception:  # noqa: BLE001
                self.err[str(r.status_code)] += 1
        self.window.append((time.time(), r.status_code >= 500))

    def sustained_5xx(self, secs=30):
        now = time.time()
        self.window = [w for w in self.window if now - w[0] <= secs]
        return (sum(1 for w in self.window if w[1]) / len(self.window)) if len(self.window) >= 50 else 0.0


class Pool:
    """Token pool: logs in once per user, reuses, refreshes near expiry (one login per user → rate limits never hit during the run)."""

    def __init__(self, client, users):
        self.c, self.users, self.tokens, self.exp = client, users, {}, {}

    async def token(self, i):
        u = self.users[i % len(self.users)]
        if u["email"] not in self.tokens or time.time() > self.exp[u["email"]] - 120:
            for attempt in range(12):  # login limit is 10/min/IP: pace instead of failing (one login per user per run)
                r = await self.c.post("/api/auth/login", json={"email": u["email"], "password": u["password"]}, headers={"X-Rate-Limit-Bypass": BYPASS})
                if r.status_code != 429:
                    break
                await asyncio.sleep(7)
            r.raise_for_status()
            j = r.json()
            self.tokens[u["email"]] = j["access_token"]
            self.exp[u["email"]] = time.time() + int(j.get("expires_in") or 840)
        return self.tokens[u["email"]]


class Setup:
    """One LT project (4 towers × 60 flats), CLP plan + assignment, N staff users — all via real APIs, all tagged for purge."""

    def __init__(self, c, admin_token, ts):
        self.c, self.h, self.ts = c, {"Authorization": f"Bearer {admin_token}"}, ts

    async def post(self, path, body, ok=(200, 201)):
        r = await self.c.post(path, json=body, headers={**self.h, "Idempotency-Key": str(uuid.uuid4())})
        if r.status_code not in ok:
            raise RuntimeError(f"POST {path} → {r.status_code} {r.text[:300]}")
        return r.json()

    async def get(self, path, **params):
        r = await self.c.get(path, params=params, headers=self.h)
        r.raise_for_status()
        return r.json()

    async def run(self, n_users):
        today = date.today().isoformat()
        p = await self.post("/api/projects", {"name": f"LT {self.ts}", "code": f"LT{self.ts[-6:]}", "project_type": "Residential", "status": "Under Construction", "launch_date": today, "default_cash_percent": 40, "load_test": True,
                                              "address": {"line1": "Load test", "city": "Patna", "state": "Bihar", "pincode": "800001"}})
        bt = next(b for b in (await self.get("/api/master/block-types", page_size=50))["items"] if b["name"].lower().startswith("tower"))
        ft = (await self.get("/api/master/flat-types", page_size=50))["items"][0]
        towers = []
        for i, code in enumerate("ABCD"):
            b = await self.post("/api/blocks", {"project_id": p["id"], "block_type_id": bt["id"], "name": f"LT Tower {code}", "code": f"L{code}", "floors": 15, "flats_per_floor": 4, "floor_start": 1, "numbering_pattern": "{block}-{floor}{pos2}",
                                                 "position_flat_types": [{"position": k, "flat_type_id": ft["id"]} for k in range(1, 5)]})
            towers.append(b)
        plan = await self.post("/api/master/payment-plans", {"name": f"LT CLP {self.ts}", "code": f"LT{self.ts[-6:]}", "plan_type": "CLP", "installments": [
            {"seq": 1, "name": "On booking", "percent": 10, "trigger_type": "ON_BOOKING", "due_days": 7}, {"seq": 2, "name": "30 days", "percent": 20, "trigger_type": "DAYS_AFTER_BOOKING", "trigger_days": 30, "due_days": 15},
            {"seq": 3, "name": "90 days", "percent": 20, "trigger_type": "DAYS_AFTER_BOOKING", "trigger_days": 90, "due_days": 15}, {"seq": 4, "name": "180 days", "percent": 30, "trigger_type": "DAYS_AFTER_BOOKING", "trigger_days": 180, "due_days": 15},
            {"seq": 5, "name": "Possession", "percent": 20, "trigger_type": "ON_POSSESSION", "due_days": 15}]})
        await self.post("/api/payment-plan-assignments", {"payment_plan_id": plan["id"], "project_id": p["id"], "block_id": None, "is_default": True}, ok=(200, 201, 409, 422))
        flats = []
        for b in towers:
            fl = (await self.get("/api/flats", block_id=b["id"], page_size=200))["items"]
            for f in fl:
                if not f.get("price"):
                    await self.c.patch(f"/api/flats/{f['id']}", json={"price": 4500000}, headers=self.h)
                    f["price"] = 4500000
            flats += fl
        rr = await self.get("/api/roles", page_size=50)
        roles = {r["name"]: r["id"] for r in (rr["items"] if isinstance(rr, dict) else rr)}
        users = []
        for i in range(n_users):
            role = "Sales" if i % 3 else "Accounts"
            email = f"lt-{self.ts}-{i}@loadtest.kkt-erp.in"
            await self.post("/api/users", {"name": f"LT {role} {i}", "email": email, "password": "LoadTest@12345", "role_id": roles.get(role), "project_scope": ["*"]}, ok=(200, 201, 409))
            users.append({"email": email, "password": "LoadTest@12345", "role": role})
        modes = {m["code"]: m["id"] for m in (await self.get("/api/master/payment-modes"))["items"]}
        bank = (await self.get("/api/master/bank-accounts"))["items"][0]
        return {"project": p, "towers": towers, "flats": flats, "plan": plan, "users": users, "modes": modes, "bank": bank}


class Journey:
    """One VU slice: lead → visit → customer(+KYC) → booking → payments (cash + cheque pending→clear) → reads; tower VU adds a stage completion."""

    def __init__(self, c, pool, S, M, vu, tower_vu=None):
        self.c, self.pool, self.S, self.M, self.vu, self.tower_vu = c, pool, S, M, vu, tower_vu
        self.role = S["users"][vu % len(S["users"])]["role"]
        self.booking = None

    async def call(self, method, path, body=None, params=None, timeout=30, idem=True, accept=(200, 201)):
        h = {"Authorization": f"Bearer {await self.pool.token(self.vu)}"}
        if method != "GET" and idem:
            h["Idempotency-Key"] = str(uuid.uuid4())
        t0 = time.perf_counter()
        try:
            r = await self.c.request(method, path, json=body, params=params, headers=h, timeout=timeout)
        except Exception as e:  # noqa: BLE001
            self.M.rec(path, (time.perf_counter() - t0) * 1000, exc=e)
            return None
        self.M.rec(path, (time.perf_counter() - t0) * 1000, r)
        return r.json() if r.status_code in accept and r.headers.get("content-type", "").startswith("application/json") else (r if r.status_code in accept else None)

    async def write_slice(self):
        S, today = self.S, date.today()
        n = random.randint(10 ** 8, 10 ** 9 - 1)
        ld = await self.call("POST", "/api/leads", {"name": f"LT Lead {n}", "phone": f"7{n:09d}", "project_id": S["project"]["id"], "source": random.choice(["Website", "Walk-in", "Referral", "Broker"]), "notes": "load_test"})
        if not ld:
            return
        await self.call("POST", "/api/site-visits", {"project_id": S["project"]["id"], "date": today.isoformat(), "slot_start": random.choice(["10:00", "11:00", "12:00", "15:00"]), "lead_id": ld["id"]})
        cu = await self.call("POST", "/api/customers", {"full_name": f"LT Customer {n}", "phone": f"8{n:09d}", "email": f"lt{n}@loadtest.kkt-erp.in", "tags": ["load_test"], "pan": f"LTPAN{n % 10000:04d}X", "aadhaar": verhoeff(f"{n:09d}{n % 100:02d}"),
                                                        "address_current": {"line1": "LT street", "city": "Patna", "state": "Bihar", "pincode": "800001"}})
        if not cu:
            return
        await self.call("POST", f"/api/customers/{cu['id']}/kyc-status", {"kyc_status": "Verified", "note": "load_test"})
        avail = [f for f in S["flats"] if f.get("_free", True)]
        if not avail:
            return
        f = random.choice(avail)
        f["_free"] = False
        price = f.get("price") or 4500000
        bk = await self.call("POST", "/api/bookings", {"flat_id": f["id"], "customer_id": cu["id"], "booking_date": today.isoformat(), "agreement_value": price, "cash_agreed": round(price * 0.4, 2), "account_agreed": round(price * 0.6, 2),
                                                        "lead_id": ld["id"], "payment_plan_id": S["plan"]["id"], "other_charges": [], "remarks": "load_test"})
        if not bk:
            f["_free"] = True
            return
        self.booking = bk
        await self.call("POST", "/api/payments", {"booking_id": bk["id"], "against": "FLAT_VALUE", "payment_category": "Cash", "amount": round(price * 0.04, 2), "payment_date": today.isoformat(), "payment_mode_id": S["modes"]["CASH"], "remarks": "load_test"})
        chq = await self.call("POST", "/api/payments", {"booking_id": bk["id"], "against": "FLAT_VALUE", "payment_category": "Account", "amount": round(price * 0.06, 2), "payment_date": today.isoformat(), "payment_mode_id": S["modes"]["CHEQUE"],
                                                        "instrument": {"number": f"LT{n % 10**6:06d}", "date": today.isoformat(), "bank_name": "SBI"}, "bank_account_id": S["bank"]["id"], "remarks": "load_test"})
        if chq and isinstance(chq, dict) and self.role == "Accounts":
            await self.call("POST", f"/api/payments/{chq['id']}/clear", {"cleared_on": today.isoformat()}, accept=(200, 201, 409, 422))
            await self.call("GET", f"/api/payments/{chq['id']}/receipt", timeout=60, accept=(200,))
        await self.call("POST", "/api/service-requests", {"customer_id": cu["id"], "booking_id": bk["id"], "category": "Plumbing", "priority": "Medium", "subject": "LT ticket", "description": "load_test"}, accept=(200, 201, 422))

    async def read_slice(self):
        S = self.S
        bk = self.booking
        reads = [("GET", "/api/dashboard/home", None), ("GET", "/api/bookings", {"project_id": S["project"]["id"], "page_size": 20}), ("GET", "/api/search", {"q": "LT", "limit": 8}), ("GET", "/api/notifications", {"page_size": 10}),
                 ("GET", "/api/leads", {"project_id": S["project"]["id"], "page_size": 20})]
        if self.role == "Accounts":  # role-aware: Sales has no reports/demand-register permission
            reads += [("GET", "/api/reports/collections", {"project_id": S["project"]["id"]}), ("GET", "/api/reports/outstanding", {"project_id": S["project"]["id"]}), ("GET", "/api/demands/register", {"project_id": S["project"]["id"]}), ("GET", "/api/payments", {"page_size": 20})]
        if bk:
            reads += [("GET", f"/api/customers/{bk['customer_id']}/panels", None), ("GET", f"/api/bookings/{bk['id']}/ledger", None)]
        for m, p, q in random.sample(reads, k=min(5, len(reads))):
            await self.call(m, p, params=q, timeout=60, accept=(200,))

    async def stage_slice(self):
        tower = self.S["towers"][self.tower_vu]
        cons = await self.call("GET", f"/api/blocks/{tower['id']}/construction", accept=(200,))
        if not cons:
            return
        pending = [s for s in cons.get("stages", []) if s.get("status") != "Completed"]
        if pending:
            await self.call("POST", f"/api/blocks/{tower['id']}/construction/stage", {"stage_id": pending[0]["stage_id"], "completed_on": date.today().isoformat(), "notes": "load_test"}, accept=(200, 201, 409, 422))

    async def run(self, until):
        first = True
        while time.time() < until:
            if self.tower_vu is not None and first:
                await self.stage_slice()
            if first or random.random() < 0.3:
                await self.write_slice()
            else:
                await self.read_slice()
            first = False
            await asyncio.sleep(random.uniform(0.2, 1.0))


async def poll_ops(c, token, M, until):
    while time.time() < until:
        t0 = time.time()
        try:
            h = (await c.get("/api/health", timeout=10)).json()
            o = await c.get("/api/admin/ops", params={"window": 60}, headers={"Authorization": f"Bearer {token}"}, timeout=20)
            oj = o.json() if o.status_code == 200 else {"status": o.status_code}
            M.ops.append({"t": round(t0), "health": h.get("status"), "db_ping_ms": h.get("db_ping_ms"), "rss_mb": (oj.get("process") or {}).get("rss_mb"), "shed": (oj.get("http") or oj.get("shed") or {}).get("shed_count") if isinstance(oj.get("http") or oj.get("shed"), dict) else oj.get("shed_count"),
                          "pool": (oj.get("db") or {}).get("pool") if isinstance(oj.get("db"), dict) else None, "inflight": (oj.get("http") or {}).get("inflight") if isinstance(oj.get("http"), dict) else None})
        except Exception as e:  # noqa: BLE001
            M.ops.append({"t": round(t0), "error": str(e)[:80]})
        await asyncio.sleep(15)


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--email", default=os.environ.get("LT_ADMIN_EMAIL", "admin@kkt.in"))
    ap.add_argument("--password", default=os.environ.get("LT_ADMIN_PASSWORD", "Kkt@12345"))
    ap.add_argument("--stages", default="500,1000,2000")
    ap.add_argument("--stage-min", type=float, default=4)
    ap.add_argument("--warmup-s", type=int, default=20)
    ap.add_argument("--drain-s", type=int, default=15)
    ap.add_argument("--users", type=int, default=40)
    ap.add_argument("--max-vus", type=int, default=2000)
    ap.add_argument("--max-min", type=float, default=30)
    a = ap.parse_args()
    stages = [int(x) for x in a.stages.split(",")]
    if max(stages) > a.max_vus or len(stages) * a.stage_min > a.max_min:
        sys.exit(f"refusing: caps are --max-vus {a.max_vus} / --max-min {a.max_min}")
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    limits = httpx.Limits(max_connections=max(stages) + 20, max_keepalive_connections=max(stages) + 20)
    async with httpx.AsyncClient(base_url=a.base.rstrip("/"), timeout=60, limits=limits) as c:
        r = await c.post("/api/auth/login", json={"email": a.email, "password": a.password}, headers={"X-Rate-Limit-Bypass": BYPASS})
        r.raise_for_status()
        admin = r.json()["access_token"]
        print(f"[setup] creating LT project + {a.users} users …", flush=True)
        S = await Setup(c, admin, ts).run(a.users)
        print(f"[setup] project {S['project']['name']} · {len(S['flats'])} flats · {len(S['users'])} users · plan {S['plan']['code']}", flush=True)
        pool = Pool(c, S["users"])
        for i in range(len(S["users"])):
            await pool.token(i)
        print(f"[pool] {len(pool.tokens)} tokens (one login per user)", flush=True)
        results = []
        for vus in stages:
            M = Metrics()
            until = time.time() + a.stage_min * 60
            print(f"\n[stage {vus} VUs] warm-up {a.warmup_s}s → run {a.stage_min} min → drain {a.drain_s}s", flush=True)
            t_start = time.time()
            tasks = [asyncio.create_task(poll_ops(c, admin, M, until + a.drain_s))]
            for i in range(vus):
                tasks.append(asyncio.create_task(Journey(c, pool, S, M, i, tower_vu=i if i < len(S["towers"]) else None).run(until)))
                if i % 50 == 49:
                    await asyncio.sleep(a.warmup_s * 50 / max(vus, 50))
            stop = None
            while time.time() < until:
                await asyncio.sleep(5)
                if M.sustained_5xx() > 0.02:
                    stop = f"STOP: sustained 5xx {M.sustained_5xx():.1%} > 2 % at {int(time.time() - t_start)}s"
                    print(stop, flush=True)
                    for t in tasks:
                        t.cancel()
                    break
            await asyncio.gather(*tasks, return_exceptions=True)
            await asyncio.sleep(a.drain_s)
            dur = time.time() - t_start
            row = {"vus": vus, "duration_s": round(dur), "requests": M.n, "rps": round(M.n / max(dur, 1), 1), "stopped": stop, "errors": dict(M.err), "timeouts": M.timeouts, "n5xx": M.n5xx,
                   "groups": {g: {"n": len(v), "p50": pct(v, 50), "p95": pct(v, 95), "p99": pct(v, 99), "db_p95_ms": pct(M.dbq.get(g, []), 95)} for g, v in sorted(M.lat.items())}, "ops": M.ops}
            results.append(row)
            print(f"[stage {vus}] {M.n} req · {row['rps']} rps · 5xx {M.n5xx} · errors {dict(M.err)}", flush=True)
            for g, s in row["groups"].items():
                print(f"   {g:14s} n={s['n']:6d} p50={s['p50']:8.1f} p95={s['p95']:8.1f} p99={s['p99']:8.1f} db_p95={s['db_p95_ms']}", flush=True)
            if stop:
                break
    os.makedirs(OUT_DIR, exist_ok=True)
    json.dump({"ts": ts, "base": a.base, "project": S["project"]["name"], "stages": results}, open(f"{OUT_DIR}/loadtest_{ts}.json", "w"), indent=1)
    md = [f"# Journey load test — {a.base} — {ts}", f"Project `{S['project']['name']}` (load_test:true) · {len(S['flats'])} flats · {len(S['users'])} staff users · mix ≈ 70 % reads / 30 % writes", ""]
    for r_ in results:
        md += [f"## {r_['vus']} VUs — {r_['duration_s']}s · {r_['requests']} req · {r_['rps']} rps · 5xx {r_['n5xx']} · timeouts {r_['timeouts']}" + (f" · **{r_['stopped']}**" if r_["stopped"] else ""),
               "| group | n | p50 ms | p95 ms | p99 ms | server db p95 |", "|---|---:|---:|---:|---:|---:|"]
        md += [f"| {g} | {s['n']} | {s['p50']} | {s['p95']} | {s['p99']} | {s['db_p95_ms']} |" for g, s in r_["groups"].items()]
        md += ["", "Errors: " + (", ".join(f"`{k}`×{v}" for k, v in sorted(r_["errors"].items())) or "none"), ""]
        ops = [o for o in r_["ops"] if "rss_mb" in o]
        if ops:
            md += [f"Ops samples: {len(ops)} · RSS {min(o['rss_mb'] or 0 for o in ops)}–{max(o['rss_mb'] or 0 for o in ops)} MB · db ping p95 {pct([o['db_ping_ms'] or 0 for o in ops], 95)} ms · shed {max((o.get('shed') or 0) for o in ops)}", ""]
    md += ["## Measured vs estimated", "| | estimated (capacity model) | measured |", "|---|---|---|", "| p95 reads @ top stage | < 400 ms | fill from table |", "| p95 writes @ top stage | < 800 ms | fill |", "| 5xx / shed | 0 | fill |", "| worker RSS | < 700 MB | fill |", "",
           "## Tier recommendation (template)", "- Sustained RPS without 5xx/shed: __ → tier __ (workers __, Mongo __).", "- First degradation at __ VUs on group __ (p95 __ ms) → cap / scale trigger.", "- Headroom vs expected peak (__ concurrent staff): __×.", ""]
    open(f"{OUT_DIR}/loadtest_{ts}.md", "w").write("\n".join(md))
    print(f"\nreport: {OUT_DIR}/loadtest_{ts}.md", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
