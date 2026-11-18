"""Phase L — journey-based staged load test (API-only, no DB access). Every virtual user runs ONE complete, logically connected journey
and asserts its own propagation (ledger, Customer 360, inventory). No random noise data.

  LT_BASE_URL=https://host LT_EMAIL=… LT_PASSWORD=… python tools/loadtest_journeys.py --stages 50,200,500,1000,2000 --stage-min 3
  python tools/loadtest_journeys.py --cleanup [--manifest /app/memory/qa/loadtest/<ts>]

Credentials come from env only (LT_EMAIL/LT_PASSWORD → OWNER_BOOTSTRAP_EMAIL/OWNER_BOOTSTRAP_PASSWORD) and are never printed.
Manifest: /app/memory/qa/loadtest/<ts>/{config,pre_snapshot,stage_N,assertions,cleanup}.json + report.md
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
from pathlib import Path

import httpx

OUT_ROOT = "/app/memory/qa/loadtest"
BYPASS = os.environ.get("LOGIN_RATE_LIMIT_BYPASS_TOKEN", "")
GROUPS = [
    ("login", "/api/auth/login"),
    ("leads", "/api/leads"),
    ("customers", "/api/customers"),
    ("breakdown", "/breakdown-preview"),
    ("ledger", "/ledger"),
    ("receipt_pdf", "/receipt"),
    ("bookings", "/api/bookings"),
    ("payments", "/api/payments"),
    ("c360", "/panels"),
    ("demand_register", "/api/demands/register"),
    ("project_statement", "/project-statement"),
    ("construction", "/construction"),
    ("documents", "/api/docgen/register"),
    ("flats", "/api/flats"),
    ("integrity", "/integrity-report"),
    ("health", "/api/health"),
]


def pct(xs, p):
    if not xs:
        return 0
    xs = sorted(xs)
    return round(xs[min(len(xs) - 1, int(len(xs) * p / 100))], 1)


def group_of(path):
    return next((g for g, frag in GROUPS if frag in path), "other")


def creds():
    email = os.environ.get("LT_EMAIL") or os.environ.get("OWNER_BOOTSTRAP_EMAIL")
    pw = os.environ.get("LT_PASSWORD") or os.environ.get("OWNER_BOOTSTRAP_PASSWORD")
    base = os.environ.get("LT_BASE_URL")
    if not (email and pw and base):
        sys.exit("LT_BASE_URL + LT_EMAIL/LT_PASSWORD (or OWNER_BOOTSTRAP_*) must be set in the environment")
    return base.rstrip("/"), email, pw


class Metrics:
    def __init__(self):
        self.lat, self.err, self.n, self.minute = (
            defaultdict(list),
            Counter(),
            0,
            defaultdict(lambda: {"n": 0, "err": 0, "lat": []}),
        )
        self.assertions = Counter()
        self.failed_assertions = []
        self.last_error = ""

    def rec(self, path, ms, status=None, exc=None):
        g, m = group_of(path), int(time.time() // 60)
        self.n += 1
        self.lat[g].append(ms)
        self.minute[m]["n"] += 1
        self.minute[m]["lat"].append(ms)
        bad = exc is not None or (status or 0) >= 500 or status == 429
        if bad:
            self.minute[m]["err"] += 1
            self.err[f"client:{type(exc).__name__}" if exc else str(status)] += 1
        elif (status or 0) >= 400:
            self.err[str(status)] += 1

    def breach(self):
        """Two consecutive completed minutes with error rate > 2 % or p95 > 3 s → stop the stage."""
        cur = int(time.time() // 60)
        done = [self.minute[k] for k in sorted(self.minute) if k < cur][-2:]
        if len(done) < 2:
            return None
        bad = [m for m in done if m["n"] >= 20 and (m["err"] / m["n"] > 0.02 or pct(m["lat"], 95) > 3000)]
        return (
            f"error rate/p95 breach in 2 consecutive minutes ({[(round(m['err'] / max(m['n'], 1), 3), pct(m['lat'], 95)) for m in done]})"
            if len(bad) == 2
            else None
        )

    def ok(self, name, cond, detail=""):
        self.assertions[f"{name}:{'ok' if cond else 'FAIL'}"] += 1
        if not cond and len(self.failed_assertions) < 50:
            self.failed_assertions.append({"assertion": name, "detail": str(detail)[:200]})
        return cond


class Api:
    def __init__(self, client, metrics, email, pw):
        self.c, self.M, self.email, self.pw, self.token = client, metrics, email, pw, None

    async def login(self):
        for _ in range(6):
            t0 = time.perf_counter()
            r = await self.c.post(
                "/api/auth/login",
                json={"email": self.email, "password": self.pw},
                headers={"X-Rate-Limit-Bypass": BYPASS},
                timeout=30,
            )
            self.M.rec("/api/auth/login", (time.perf_counter() - t0) * 1000, r.status_code)
            if r.status_code == 200:
                self.token = r.json()["access_token"]
                return self
            await asyncio.sleep(7 if r.status_code == 429 else 1)
        raise RuntimeError("login failed")

    async def call(self, method, path, body=None, params=None, accept=(200, 201), timeout=60, raw=False):
        h = {
            "Authorization": f"Bearer {self.token}",
            "X-Rate-Limit-Bypass": BYPASS,
        }  # per-user write limiter (120/60 s) would otherwise throttle the generator
        if method != "GET":
            h["Idempotency-Key"] = str(uuid.uuid4())
        t0 = time.perf_counter()
        try:
            r = await self.c.request(method, path, json=body, params=params, headers=h, timeout=timeout)
        except Exception as e:  # noqa: BLE001
            self.M.rec(path, (time.perf_counter() - t0) * 1000, exc=e)
            return None
        self.M.rec(path, (time.perf_counter() - t0) * 1000, r.status_code)
        if r.status_code not in accept:
            self.M.last_error = f"{method} {path} -> {r.status_code} {r.text[:160]}"
            if os.environ.get("LT_DEBUG"):
                print("[debug]", self.M.last_error, file=sys.stderr)
            return None
        if raw or not r.headers.get("content-type", "").startswith("application/json"):
            return r
        return r.json()


def think():
    return asyncio.sleep(random.uniform(0.5, 2.0))


class Setup:
    """ONE temporary project LOADTEST-<ts> (load_test:true): 4 towers, mixed per-floor unit types via the floor
    designer, flats priced via the pricing API,
    parking slots attached, stage plan + 100 % payment plan, project pricing (GST 5 %, maintenance + parking heads)."""

    def __init__(self, api, ts):
        self.a, self.ts = api, ts

    async def must(self, method, path, body=None, **params):
        r = await self.a.call(method, path, body, params or None)
        if r is None:
            raise RuntimeError(f"setup: {method} {path} failed")
        return r

    async def run(self):
        a, today = self.a, date.today().isoformat()
        p = await self.must(
            "POST",
            "/api/projects",
            {
                "name": f"LOADTEST-{self.ts}",
                "code": f"LT{self.ts[-6:]}",
                "project_type": "Residential",
                "status": "Under Construction",
                "launch_date": today,
                "default_cash_percent": 40,
                "load_test": True,
                "address": {"line1": "Load test", "city": "Patna", "state": "Bihar", "pincode": "800001"},
            },
        )
        bt = (await self.must("GET", "/api/master/block-types", page_size=50))["items"][0]
        fts = (await self.must("GET", "/api/master/flat-types", page_size=50))["items"][:2]
        towers, flats = [], []
        for code in "ABCD":
            b = await self.must(
                "POST",
                "/api/blocks",
                {
                    "project_id": p["id"],
                    "block_type_id": bt["id"],
                    "name": f"LT Tower {code}",
                    "code": f"L{code}",
                    "floors": 20,
                    "flats_per_floor": 4,
                    "floor_start": 1,
                    "numbering_pattern": "{block}-{floor}{pos2}",
                    "position_flat_types": [{"position": k, "flat_type_id": fts[0]["id"]} for k in range(1, 5)],
                    "rate_per_sqft": 4500,
                },
            )
            towers.append(b)
            for fl in range(
                2, 21, 2
            ):  # even floors: 6 smaller units of the second type (floor designer, mixed per-floor mix)
                await self.must(
                    "PUT",
                    f"/api/blocks/{b['id']}/floors/{fl}",
                    {"positions": [{"position": k, "flat_type_id": fts[-1]["id"]} for k in range(1, 7)]},
                )
            items = (await self.must("GET", "/api/flats", block_id=b["id"], page_size=200))["items"]
            for f in items:
                big = f["floor"] % 2 == 1
                await self.must(
                    "PATCH",
                    f"/api/flats/{f['id']}/pricing",
                    {
                        "saleable_sqft": 1250 if big else 850,
                        "rate_per_sqft": 4500,
                        "pricing_mode": "rate",
                        "maintenance": {"method": "per_sqft_months", "rate_per_sqft": 2.5, "months": 24},
                        "version": f["version"],
                    },
                )
            flats += (await self.must("GET", "/api/flats", block_id=b["id"], page_size=200))[
                "items"
            ]  # re-read: prices come from the pricing PATCHes above
        slots = await self.must(
            "POST",
            "/api/parking/bulk-generate",
            {
                "project_id": p["id"],
                "prefix": "LT",
                "start": 1,
                "count": len(flats) // 2,
                "type": "Covered",
                "price": 250000,
            },
        )
        slot_items = (
            slots.get("items")
            or slots.get("slots")
            or (await self.must("GET", "/api/parking", project_id=p["id"], page_size=200))["items"]
        )
        for f, s in zip(flats[::2], slot_items):
            await a.call("POST", f"/api/parking/{s['id']}/attach", {"flat_id": f["id"]})
        stages = (await self.must("GET", "/api/master/construction-stages", page_size=100))["items"]
        ids = [s["id"] for s in stages if s.get("code") != "BOOKING"][:5]
        plans = []
        for b in towers:
            sp = await self.must(
                "POST",
                "/api/stage-plans",
                {"name": f"LT plan {b['code']}", "project_id": p["id"], "block_id": b["id"], "stage_ids": ids},
            )
            rows = [
                {"stage_id": s, "percent": pc}
                for s, pc in zip(sp["stage_ids"], [10, 20, 20, 20, 15, 15][: len(sp["stage_ids"])])
            ]
            rows[-1]["percent"] += 100 - sum(r["percent"] for r in rows)
            plans.append(
                await self.must(
                    "POST",
                    "/api/payment-plans/structured",
                    {
                        "name": f"LT CLP {b['code']}",
                        "project_id": p["id"],
                        "block_id": b["id"],
                        "stage_plan_id": sp["id"],
                        "rows": rows,
                    },
                )
            )
        heads = {h["code"]: h for h in (await self.must("GET", "/api/master/charge-types", page_size=100))["items"]}
        cur = await self.must("GET", f"/api/projects/{p['id']}/pricing-setup")
        await self.must(
            "PUT",
            f"/api/projects/{p['id']}/pricing-setup",
            {
                "agreement_gst_percent": 5,
                "floor_rise_enabled": False,
                "rounding": "nearest_100",
                "maintenance": {"method": "per_sqft_months", "rate_per_sqft": 2.5, "months": 24},
                "charge_heads": [
                    {
                        "charge_type_id": heads["CLUB"]["id"],
                        "enabled": True,
                        "value": 100000,
                        "gst_percent": 18,
                        "timing": "on_booking",
                    }
                ]
                if "CLUB" in heads
                else [],
                "version": cur.get("version"),
            },
        )
        modes = {m["code"]: m["id"] for m in (await self.must("GET", "/api/master/payment-modes"))["items"]}
        return {
            "project": p,
            "towers": towers,
            "flats": flats,
            "plans": {pl["block_id"]: pl for pl in plans},
            "modes": modes,
        }


class VU:
    """lead → convert → co-applicant → breakdown preview → booking → payment → Customer 360 → ledger → receipt PDF → demand register → project statement."""

    def __init__(self, api, S, pool, M, idx, admin_tower=None):
        self.a, self.S, self.pool, self.M, self.i, self.admin_tower = api, S, pool, M, idx, admin_tower

    async def run(self):
        a, S, M, today = self.a, self.S, self.M, date.today().isoformat()
        n = random.randint(10**8, 10**9 - 1)
        ld = await a.call(
            "POST",
            "/api/leads",
            {
                "name": f"LT Lead {n}",
                "phone": f"7{n:09d}",
                "project_id": S["project"]["id"],
                "source": "Website",
                "notes": "load_test",
            },
        )
        if not M.ok("lead_created", ld, "lead POST failed"):
            return
        await think()
        cu = (await a.call("POST", f"/api/leads/{ld['id']}/convert", {}) or {}).get("customer")
        if cu:  # converted customers carry the lineage tag so the audited purge can find them
            await a.call(
                "PATCH",
                f"/api/customers/{cu['id']}",
                {"tags": ["lead", "load_test"], "version": cu.get("version", 1)},
                accept=(200, 409),
            )
        if not M.ok("lead_converted", cu and cu.get("id"), "convert failed"):
            return
        co = await a.call(
            "POST", "/api/customers", {"full_name": f"LT Co-applicant {n}", "phone": f"8{n:09d}", "tags": ["load_test"]}
        )
        await think()
        flat = self.pool.pop() if self.pool else None
        if flat is None:
            M.assertions["journey_without_flat(no inventory left)"] += 1
            await a.call("GET", f"/api/customers/{cu['id']}/panels", accept=(200,))
            return
        price = flat["price"]
        pre = await a.call(
            "POST",
            "/api/bookings/breakdown-preview",
            {"flat_id": flat["id"], "agreement_value": price, "has_plan": True},
        )
        charges = [
            {
                "charge_type_id": c.get("charge_type_id"),
                "name": c["name"],
                "source": c.get("source"),
                "amount": c["amount"],
                "gst_percent": c["gst_percent"],
                "demand_at": c["demand_at"],
            }
            for c in (pre or {}).get("charges", [])
            if c.get("code") != "AGR_GST"
        ]
        plan = S["plans"].get(flat["block_id"])
        bk = await a.call(
            "POST",
            "/api/bookings",
            {
                "flat_id": flat["id"],
                "customer_id": cu["id"],
                "booking_date": today,
                "agreement_value": price,
                "cash_agreed": round(price * 0.4, 2),
                "account_agreed": round(price * 0.6, 2),
                "lead_id": ld["id"],
                "payment_plan_id": plan["id"] if plan else None,
                "other_charges": charges,
                "agreement_gst_percent": 5,
                "co_applicant_customer_ids": [co["id"]] if co else [],
                "remarks": "load_test",
            },
        )
        if not M.ok("booking_created", bk, f"booking POST failed: {M.last_error}"):
            M.assertions["flat_dropped_from_pool"] += (
                1  # never re-queue: a request cut off at stage end may have booked it server-side → endless 409 loop
            )
            return
        M.ok(
            "booking_total_matches_preview",
            not pre or abs(bk["pricing"]["total_final_value"] - pre["total_final_value"]) < 0.01,
            f"{bk['pricing']['total_final_value']} vs {pre and pre['total_final_value']}",
        )
        await think()
        amt = round(price * 0.05, 2)
        pay = await a.call(
            "POST",
            "/api/payments",
            {
                "booking_id": bk["id"],
                "against": "FLAT_VALUE",
                "payment_category": "Cash",
                "amount": amt,
                "payment_date": today,
                "payment_mode_id": S["modes"]["CASH"],
                "remarks": "load_test",
            },
        )
        M.ok("payment_posted", pay, "payment POST failed")
        await think()
        panels = await a.call("GET", f"/api/customers/{cu['id']}/panels", accept=(200,))
        led_items = (panels or {}).get("ledgers") or {}
        led_items = (
            led_items.get("bookings") or led_items.get("items") or [] if isinstance(led_items, dict) else led_items
        )
        M.ok(
            "c360_shows_booking",
            any(
                isinstance(x, dict) and (x.get("booking_id") == bk["id"] or x.get("id") == bk["id"]) for x in led_items
            ),
            f"booking missing in Customer 360 ledgers ({len(led_items)} ledgers)",
        )
        led = await a.call("GET", f"/api/bookings/{bk['id']}/ledger", accept=(200,))
        if led:
            received = sum(r.get("jama_paise", 0) for r in led["rows"])
            raised = sum(r.get("udhar_paise", 0) for r in led["rows"])
            M.ok(
                "ledger_received_equals_payment",
                received == round(amt * 100),
                f"received {received} vs {round(amt * 100)}",
            )
            M.ok("ledger_bill_raised_positive", raised > 0, raised)
        else:
            M.ok("ledger_loaded", False, "ledger GET failed")
        fl = await a.call("GET", f"/api/flats/{flat['id']}", accept=(200,))
        M.ok("inventory_flat_booked", fl and fl.get("status") == "Booked", fl and fl.get("status"))
        if pay:
            M.ok(
                "receipt_pdf",
                await a.call("GET", f"/api/payments/{pay['id']}/receipt", accept=(200,), raw=True, timeout=90),
                "receipt PDF failed",
            )
        await think()
        M.ok(
            "demand_register",
            await a.call("GET", "/api/demands/register", params={"project_id": S["project"]["id"]}, accept=(200,)),
            "demand register failed",
        )
        M.ok(
            "project_statement",
            await a.call(
                "GET",
                "/api/reports/project-statement",
                params={"project_id": S["project"]["id"]},
                accept=(200,),
                timeout=120,
            ),
            "project statement failed",
        )
        if self.admin_tower is not None:
            await self.admin()

    async def admin(self):
        """1 in 50 VUs: complete the next stage on one tower → demands raised for every active booking on it → documents register."""
        a, M, tower = self.a, self.M, self.S["towers"][self.admin_tower % 4]
        cons = await a.call("GET", f"/api/blocks/{tower['id']}/construction", accept=(200,))
        pending = [
            s for s in (cons or {}).get("stages", []) if s.get("status") != "Completed" and s.get("code") != "BOOKING"
        ]
        if not pending:
            return
        before = await a.call(
            "GET", "/api/bookings", params={"block_id": tower["id"], "status": "Active", "page_size": 1}, accept=(200,)
        )
        r = await a.call(
            "POST",
            f"/api/blocks/{tower['id']}/construction/stage",
            {"stage_id": pending[0]["stage_id"], "completed_on": date.today().isoformat(), "notes": "load_test"},
            accept=(200, 201, 409, 422),
        )
        if r and isinstance(r, dict) and "demands_raised" in r:
            after = await a.call(
                "GET",
                "/api/bookings",
                params={"block_id": tower["id"], "status": "Active", "page_size": 1},
                accept=(200,),
            )
            lo, hi = (before or {}).get("total", -1), (after or {}).get("total", -1)
            # bookings keep landing on this tower while the stage completes; the demand count must sit inside [active-before, active-after]
            M.ok(
                "stage_demands_match_active_bookings",
                lo <= r["demands_raised"] <= hi,
                f"{r['demands_raised']} not in [{lo}, {hi}]",
            )
        M.ok(
            "documents_register",
            await a.call("GET", "/api/docgen/register", params={"project_id": self.S["project"]["id"]}, accept=(200,)),
            "documents register failed",
        )


async def snapshot_numbers(api):
    out = {}
    for name, path in (
        ("outstanding", "/api/reports/outstanding"),
        ("home", "/api/dashboard/home"),
        ("integrity", "/api/admin/integrity-report"),
        ("backups", "/api/admin/backups"),
    ):
        r = await api.call("GET", path, accept=(200,), timeout=120)
        out[name] = r if isinstance(r, dict) else None
    return out


def numbers_of(snap):
    """Headline numbers that must be unchanged after cleanup: outstanding totals + home tiles (any numeric field named outstanding/advance/mtd/collect)."""
    keys = {}

    def walk(o, pre):
        if isinstance(o, dict):
            for k, v in o.items():
                walk(v, f"{pre}.{k}")
        elif isinstance(o, (int, float)) and any(
            w in pre.lower() for w in ("outstanding", "advance", "mtd", "collect", "balance")
        ):
            keys[pre] = o

    walk((snap or {}).get("outstanding", {}).get("totals") or (snap or {}).get("outstanding") or {}, "outstanding")
    walk((snap or {}).get("home") or {}, "home")
    return keys


async def run_stages(a, S, args, out_dir, M0):
    results = []
    for vus in args.stages:
        M = Metrics()
        pool = [f for f in S["flats"] if f.get("_free", True)]
        random.shuffle(pool)
        until = time.time() + args.stage_min * 60
        print(f"\n[stage {vus} VUs] {args.stage_min} min · {len(pool)} flats available", flush=True)
        t0 = time.time()
        apis = []
        for i in range(
            vus
        ):  # login once per VU (bypass header when available; the shared owner token is reused if the login limiter bites)
            api = Api(a.c, M, a.email, a.pw)
            try:
                await api.login()
            except Exception:  # noqa: BLE001
                api.token = a.token
                M.err["login_fallback_shared_token"] += 1
            apis.append(api)

        async def worker(idx, until=until, apis=apis, pool=pool, M=M):
            while time.time() < until:
                try:
                    await VU(apis[idx], S, pool, M, idx, admin_tower=idx // 50 if idx % 50 == 0 else None).run()
                except asyncio.CancelledError:
                    raise
                except Exception as e:  # noqa: BLE001 — a journey bug must be visible, never silently end the worker
                    M.ok("journey_exception", False, f"{type(e).__name__}: {e}")
                await think()

        tasks = [asyncio.create_task(worker(i)) for i in range(vus)]
        stop = None
        while time.time() < until and not stop:
            await asyncio.sleep(10)
            stop = M.breach()
        # drain: workers stop at their next loop check; in-flight journeys finish (hard-cancelling mid-request kills keep-alive
        # sockets → spurious RemoteProtocolError / Starlette "No response returned" noise that is the generator's fault, not the server's)
        done, pending = await asyncio.wait(tasks, timeout=45)
        for t in pending:
            t.cancel()
        M.err["journeys_cut_at_stage_end"] += len(pending)
        await asyncio.gather(*tasks, return_exceptions=True)
        for f in S["flats"]:
            f["_free"] = f in pool
        integ = await a.call("GET", "/api/admin/integrity-report", accept=(200,), timeout=120)
        M.ok(
            "integrity_ok_after_stage",
            integ and integ.get("ok") and not integ.get("findings"),
            integ and integ.get("findings"),
        )
        dur = time.time() - t0
        row = {
            "vus": vus,
            "duration_s": round(dur),
            "requests": M.n,
            "rps": round(M.n / max(dur, 1), 1),
            "stopped": stop,
            "errors": dict(M.err),
            "assertions": dict(M.assertions),
            "failed_assertions": M.failed_assertions,
            "groups": {
                g: {"n": len(v), "p50": pct(v, 50), "p95": pct(v, 95), "p99": pct(v, 99)}
                for g, v in sorted(M.lat.items())
            },
        }
        results.append(row)
        Path(f"{out_dir}/stage_{vus}.json").write_text(json.dumps(row, indent=1))
        print(
            f"[stage {vus}] {M.n} req · {row['rps']} rps · errors {dict(M.err)} · failed assertions {len(M.failed_assertions)}"
            + (f" · STOP {stop}" if stop else ""),
            flush=True,
        )
        if stop:
            break
    return results


async def cleanup(a, S_project_id, out_dir, pre):
    """Audited: cancel loadtest bookings, release slots, deactivate customers/leads, soft-deactivate the project; verify integrity + headline numbers."""
    res = Counter()

    async def pages(
        path, **params
    ):  # walk every page; callers that remove items from the result set re-read page 1 instead
        page, out = 1, []
        while True:
            r = await a.call("GET", path, params={**params, "page_size": 200, "page": page}, accept=(200,))
            items = (r or {}).get("items", [])
            out += items
            if len(items) < 200:
                return out
            page += 1

    while True:  # cancelled bookings leave the Active set, so page 1 is re-read until empty
        bks = await a.call(
            "GET",
            "/api/bookings",
            params={"project_id": S_project_id, "status": "Active", "page_size": 200},
            accept=(200,),
        )
        if not bks or not bks["items"]:
            break
        failed = 0
        for b in bks["items"]:
            full = await a.call("GET", f"/api/bookings/{b['id']}", accept=(200,))
            ok = full and await a.call(
                "POST",
                f"/api/bookings/{b['id']}/cancel",
                {"reason": "load test cleanup (automated, audited)", "version": full["version"]},
            )
            res["bookings_cancelled" if ok else "bookings_cancel_failed"] += 1
            failed += 0 if ok else 1
        if failed == len(bks["items"]):
            break
    for s in await pages("/api/parking", project_id=S_project_id):
        if s.get("flat_id"):
            res[
                "slots_detached"
                if await a.call("POST", f"/api/parking/{s['id']}/detach", {})
                else "slots_detach_failed"
            ] += 1
    for path, key in (("/api/customers", "customers"), ("/api/leads", "leads")):
        for it in await pages(path, search="LT "):
            if "LT " not in (it.get("full_name") or it.get("name") or ""):
                continue
            if key == "customers":
                cur = await a.call("GET", f"/api/customers/{it['id']}", accept=(200,))
                ok = cur and await a.call(
                    "PATCH", f"/api/customers/{it['id']}", {"is_active": False, "version": cur["version"]}
                )
            else:
                ok = await a.call(
                    "POST",
                    f"/api/leads/{it['id']}/stage",
                    {"stage": "Lost", "note": "load test cleanup"},
                    accept=(200, 201, 409, 422),
                )
            res[f"{key}_deactivated" if ok else f"{key}_failed"] += 1
    proj = await a.call("GET", f"/api/projects/{S_project_id}", accept=(200,))
    res["project_deactivated"] = bool(
        proj
        and await a.call("PATCH", f"/api/projects/{S_project_id}", {"is_active": False, "version": proj["version"]})
    )
    post = await snapshot_numbers(a)
    before, after = numbers_of(pre), numbers_of(post)
    diff = {k: (before.get(k), after.get(k)) for k in set(before) | set(after) if before.get(k) != after.get(k)}
    out = {
        "counts": dict(res),
        "integrity_ok": bool((post.get("integrity") or {}).get("ok"))
        and not (post.get("integrity") or {}).get("findings"),
        "headline_numbers_unchanged": not diff,
        "headline_diff": diff,
        "post_snapshot": post,
    }
    Path(f"{out_dir}/cleanup.json").write_text(json.dumps(out, indent=1, default=str))
    print(
        f"[cleanup] {dict(res)} · integrity_ok={out['integrity_ok']} · headline unchanged={not diff}"
        + (f" · diff {diff}" if diff else ""),
        flush=True,
    )
    return out


def report(out_dir, cfg, results, pre):
    md = [
        f"# Journey load test — {cfg['base']} — {cfg['ts']}",
        (
            f"Project `{cfg['project']}` (load_test:true, hidden from reports) · {cfg['flats']} flats · generator: preview pod (shared CPU) — "
            f"client-side "
            f"queueing "
            f"inflates "
            f"p95 at high "
            f"VU counts; "
            f"server `db` "
            f"timings are not "
            f"separated here."
        ),
        "",
    ]
    for r in results:
        md += [
            f"## {r['vus']} VUs — {r['duration_s']}s · {r['requests']} req · {r['rps']} rps"
            + (f" · **STOPPED: {r['stopped']}**" if r["stopped"] else ""),
            "| endpoint group | n | p50 ms | p95 ms | p99 ms |",
            "|---|---:|---:|---:|---:|",
        ]
        md += [f"| {g} | {s['n']} | {s['p50']} | {s['p95']} | {s['p99']} |" for g, s in r["groups"].items()]
        md += [
            "",
            "Errors: " + (", ".join(f"`{k}`×{v}" for k, v in sorted(r["errors"].items())) or "none"),
            "Assertions: " + ", ".join(f"`{k}`×{v}" for k, v in sorted(r["assertions"].items())),
            "",
        ]
    Path(f"{out_dir}/report.md").write_text("\n".join(md))


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stages", default="50,200,500,1000,2000")
    ap.add_argument("--stage-min", type=float, default=3)
    ap.add_argument("--cleanup", action="store_true")
    ap.add_argument("--manifest", default=None, help="manifest dir for --cleanup (default: latest)")
    ap.add_argument(
        "--no-cleanup", action="store_true", help="leave data in place after the run (cleanup later with --cleanup)"
    )
    args = ap.parse_args()
    args.stages = [int(x) for x in args.stages.split(",")]
    base, email, pw = creds()
    limits = httpx.Limits(max_connections=max(args.stages) + 50, max_keepalive_connections=max(args.stages) + 50)
    async with httpx.AsyncClient(base_url=base, timeout=60, limits=limits) as c:
        a = await Api(c, Metrics(), email, pw).login()
        if args.cleanup:
            d = args.manifest or sorted(os.path.join(OUT_ROOT, x) for x in os.listdir(OUT_ROOT))[-1]
            cfg, pre = (
                json.loads(Path(f"{d}/config.json").read_text()),
                json.loads(Path(f"{d}/pre_snapshot.json").read_text()),
            )
            await cleanup(a, cfg["project_id"], d, pre)
            return
        ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        out_dir = f"{OUT_ROOT}/{ts}"
        os.makedirs(out_dir, exist_ok=True)
        pre = await snapshot_numbers(a)
        Path(f"{out_dir}/pre_snapshot.json").write_text(json.dumps(pre, indent=1, default=str))
        health = await a.call("GET", "/api/health", accept=(200,))
        print(f"[setup] {base} build={health and health.get('build')} · creating LOADTEST-{ts} …", flush=True)
        S = await Setup(a, ts).run()
        cfg = {
            "ts": ts,
            "base": base,
            "project": S["project"]["name"],
            "project_id": S["project"]["id"],
            "flats": len(S["flats"]),
            "stages": args.stages,
            "stage_min": args.stage_min,
            "build": health and health.get("build"),
            "generator": "preview pod (shared CPU)",
        }
        Path(f"{out_dir}/config.json").write_text(json.dumps(cfg, indent=1))
        print(f"[setup] {len(S['flats'])} flats · {len(S['towers'])} towers · {len(S['plans'])} plans", flush=True)
        results = await run_stages(a, S, args, out_dir, None)
        Path(f"{out_dir}/assertions.json").write_text(
            json.dumps(
                {
                    "stages": [
                        {k: v for k, v in r.items() if k in ("vus", "assertions", "failed_assertions")} for r in results
                    ]
                },
                indent=1,
            )
        )
        report(out_dir, cfg, results, pre)
        if not args.no_cleanup:
            await cleanup(a, S["project"]["id"], out_dir, pre)
        print(f"\nmanifest: {out_dir}", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
