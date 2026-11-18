"""Perf budget meter (overview.md "Performance & Architecture Standards").
Copies the preview DB into a scratch DB, starts a private backend on it, measures p50/p95 server time (Server-Timing total)
over N warm requests for every budget path, plus initial JS gzip from frontend/build. Writes go to the scratch DB only.
Run: python tools/perf_budget.py --out /app/memory/qa/perf/baseline_phase1.md [--runs 30]"""

import argparse
import gzip
import os
import re
import subprocess
import sys
import time
import uuid
from datetime import date
from pathlib import Path

import httpx
from _env import DEMO_PASSWORD

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(BACKEND, "..", "frontend", "build")
SCRATCH_DB = "kkt_perf_scratch"
PORT = 8031
BYPASS = os.environ.get("LOGIN_RATE_LIMIT_BYPASS_TOKEN", "kkt-test-bypass-local")
BUDGET = {"hot": 200, "write": 600, "report": 800, "report_cached": 100}


def server_ms(r):
    m = re.search(r"total;dur=([\d.]+)", r.headers.get("server-timing", ""))
    return float(m.group(1)) if m else float(r.headers.get("x-response-time", "0ms").rstrip("ms"))


def pct(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(p / 100 * (len(xs) - 1))))]


def snapshot(src):
    url = os.environ["MONGO_URL"]
    dump = subprocess.Popen(["mongodump", "--uri", url, "--db", src, "--archive", "--quiet"], stdout=subprocess.PIPE)
    subprocess.run(
        ["mongorestore", "--uri", url, "--archive", "--drop", "--quiet", f"--nsFrom={src}.*", f"--nsTo={SCRATCH_DB}.*"],
        stdin=dump.stdout,
        check=True,
    )
    dump.wait()
    from pymongo import MongoClient

    MongoClient(url)[SCRATCH_DB].leases.delete_many({})


def start_backend():
    env = {
        **os.environ,
        "DB_NAME": SCRATCH_DB,
        "LOGIN_RATE_LIMIT_BYPASS_TOKEN": BYPASS,
        "KKT_ROLE": "test",
        "BACKUP_ENABLED": "0",
        "DEMO_AUTO_REFRESH": "false",  # never rebuild the scratch copy
    }
    with open("/tmp/kkt_perf_backend.log", "w") as log:
        proc = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "server:app",
                "--host",
                "127.0.0.1",
                "--port",
                str(PORT),
                "--log-level",
                "warning",
            ],
            cwd=BACKEND,
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
        )
    for _ in range(120):
        try:
            if httpx.get(f"http://127.0.0.1:{PORT}/api/health", timeout=2).json().get("startup", {}).get("done"):
                return proc
        except (httpx.HTTPError, ValueError):
            pass
        time.sleep(1)
    proc.kill()
    raise RuntimeError("perf backend did not start: see /tmp/kkt_perf_backend.log")


SPAN_LOG = []  # (span, ms) per measured request — written to the report when --only is used


def measure(c, method, path, runs, body_fn=None, after=None):
    xs = []
    for i in range(runs + 2):
        body = body_fn(i) if body_fn else None
        r = c.request(
            method, path(i) if callable(path) else path, json=body, headers={"Idempotency-Key": uuid.uuid4().hex}
        )
        if r.status_code >= 400:
            raise RuntimeError(f"{method} {path} → {r.status_code} {r.text[:300]}")
        if i >= 2:  # first two = warm-up
            xs.append(server_ms(r))
            SPAN_LOG.append(
                {
                    m.group(1): float(m.group(2))
                    for m in re.finditer(r"(\w+);dur=([\d.]+)", r.headers.get("server-timing", ""))
                }
            )
        if after:
            after(r.json())
    return xs


def reads(c, runs):
    proj = c.get("/api/projects", params={"page_size": 50}).json()["items"]
    sgh = next(p for p in proj if p["code"] == "SGH")
    blk = c.get("/api/blocks", params={"project_id": sgh["id"], "page_size": 50}).json()["items"][0]
    bk = c.get("/api/bookings", params={"page_size": 1, "status": "Active"}).json()["items"][0]
    t = date.today()
    fy0 = date(t.year if t.month >= 4 else t.year - 1, 4, 1).isoformat()
    rows = [
        ("hot", "Home Command Center (month)", "/api/home/bundle?period=month"),
        ("hot", "Home Command Center (FY)", "/api/home/bundle?period=fy"),
        ("hot", "Home Command Center (Today, project)", f"/api/home/bundle?period=today&project_id={sgh['id']}"),
        ("hot", "Home legacy snapshot", "/api/dashboard/home"),
        ("hot", "Project list", "/api/projects?page_size=50"),
        ("hot", "Project detail", f"/api/projects/{sgh['id']}"),
        ("hot", "Booking detail", f"/api/bookings/{bk['id']}"),
        ("hot", "Customer 360", f"/api/customers/{bk['customer_id']}"),
        ("hot", "Bills raised page", "/api/demands/register?page_size=50"),
        ("hot", "Unit grid", f"/api/flats?block_id={blk['id']}&page_size=200"),
        ("hot", "Catalogues bundle", "/api/catalogues"),
        ("report", "FY collections", f"/api/reports/collections-v2?from_date={fy0}&to_date={t.isoformat()}"),
        ("report", "Outstanding & ageing", "/api/reports/outstanding-v2"),
    ]
    out = []
    for kind, name, path in rows:
        first = server_ms(c.get(path))
        xs = measure(c, "GET", path, runs)
        out.append((kind, name, path, xs, first))
    return out


def _pick_write_targets(c):
    bks = c.get("/api/bookings", params={"page_size": 100, "status": "Active"}).json()["items"]
    pay_bk = next(b for b in bks if (b.get("summary") or {}).get("outstanding_paise", 1) > 0)
    modes = {m["code"]: m["id"] for m in c.get("/api/master/payment-modes").json()["items"]}
    blocks = [
        b
        for p in c.get("/api/projects", params={"page_size": 50}).json()["items"]
        for b in c.get("/api/blocks", params={"project_id": p["id"], "page_size": 50}).json()["items"]
    ]
    stage_blk = None
    for b in blocks:
        n = c.get("/api/bookings", params={"block_id": b["id"], "status": "Active", "page_size": 100}).json()["items"]
        st = c.get(f"/api/blocks/{b['id']}/construction").json()["stages"]
        pend = [s for s in st if s["status"] != "Completed"]
        if 0 < len(n) <= 60 and pend:
            stage_blk = (b, pend[0]["stage_id"], len(n))
            break
    flats = [
        f
        for b in blocks
        for f in c.get("/api/flats", params={"block_id": b["id"], "page_size": 200}).json()["items"]
        if f["status"] == "Available" and f.get("price") and f.get("bookable") is not False
    ]
    return pay_bk, modes, stage_blk, flats


def writes(c, runs, only=None):
    pay_bk, modes, stage_blk, flats = _pick_write_targets(c)
    today = date.today().isoformat()
    out = []
    pay = lambda i: {
        "booking_id": pay_bk["id"],
        "amount": 1000,
        "payment_date": today,
        "payment_mode_id": modes["CASH"],
        "allocation": "auto",
        "remarks": "perf",
    }
    rev = lambda p: c.post(f"/api/payments/{p['id']}/reverse", json={"reason": "perf meter"})
    out.append(
        (
            "write",
            "Post payment (auto allocation + ledger)",
            "POST /api/payments",
            [] if only else measure(c, "POST", "/api/payments", runs, pay, rev),
            None,
        )
    )
    cust = c.post(
        "/api/customers",
        json={"full_name": "Perf Meter", "phone": "+919000000001", "source": "Walk-in"},
        headers={"Idempotency-Key": uuid.uuid4().hex},
    ).json()

    def bk_body(i):
        f = flats[i % len(flats)]
        plans = c.get(f"/api/projects/{f['project_id']}/blocks/{f['block_id']}/payment-plans").json()["items"]
        pre = c.post(
            "/api/bookings/breakdown-preview",
            json={"flat_id": f["id"], "agreement_value": f["price"], "has_plan": bool(plans)},
        ).json()
        oc = [
            {k: x.get(k) for k in ("charge_type_id", "name", "source", "amount", "gst_percent", "demand_at")}
            for x in pre["charges"]
            if x.get("code") != "AGR_GST"
        ]
        return {
            "flat_id": f["id"],
            "customer_id": cust["id"],
            "booking_date": today,
            "agreement_value": f["price"],
            "cash_agreed": 0,
            "account_agreed": f["price"],
            "payment_plan_id": plans[0]["id"] if plans else None,
            "other_charges": oc,
            "agreement_gst_percent": 5,
            "remarks": "perf",
        }

    def cancel(b):
        d = c.get(f"/api/bookings/{b['id']}").json()
        c.post(f"/api/bookings/{b['id']}/cancel", json={"reason": "perf meter", "version": d["version"]})

    out.append(
        (
            "write",
            "Create booking",
            "POST /api/bookings",
            measure(c, "POST", "/api/bookings", min(runs, len(flats)), bk_body, cancel),
            None,
        )
    )
    if only:
        return out
    if stage_blk:
        b, sid, n = stage_blk
        undo = lambda r: c.post(f"/api/blocks/{b['id']}/construction/undo", json={"reason": "perf meter"})
        body = lambda i: {"stage_id": sid, "completed_on": today, "notes": "perf"}
        out.append(
            (
                "write",
                f"Stage complete ({n} bookings)",
                "POST /api/blocks/{id}/construction/stage",
                measure(c, "POST", f"/api/blocks/{b['id']}/construction/stage", runs, body, undo),
                None,
            )
        )
    return out


def js_gzip():
    html = Path(os.path.join(BUILD, "index.html")).read_text()
    total = 0
    files = [f for f in re.findall(r'<script[^>]+src="([^"]+\.js)"', html) if not f.startswith("http")]
    for src in files:
        with open(os.path.join(BUILD, src.lstrip("/")), "rb") as fh:
            total += len(gzip.compress(fh.read(), 9))
    return total, files


def report(rows, runs, js):
    lines = [
        f"# Perf budget — {time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime())}",
        "",
        (
            f"Scratch copy of the preview DB, private backend (1 worker, no reload), {runs} warm requests per path after 2 warm-ups; server time = "
            f"`Server-Timing: total`."
        ),
        "",
        "| Kind | Path | Endpoint | p50 ms | p95 ms | first ms | Budget p95 | Within |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for kind, name, path, xs, first in rows:
        p50, p95 = pct(xs, 50), pct(xs, 95)
        budget = BUDGET["report_cached"] if kind == "report" else BUDGET[kind]
        lines.append(
            (
                f"| {kind} | {name} | `{path}` | {p50:.1f} | {p95:.1f} | {'' if first is None else f'{first:.1f}'} | ≤ {budget} | "
                f"{'yes' if p95 <= budget else 'NO'} |"
            )
        )
    lines += [
        "",
        "Reports: `first` = first call (uncached budget ≤ 800 ms); p50/p95 = cached repeats (budget ≤ 100 ms).",
        "",
        f"Initial JS (gzip, scripts in build/index.html): **{js[0] / 1024:.1f} KB** (budget ≤ 250 KB) — {', '.join(js[1])}",
        "",
    ]
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--runs", type=int, default=30)
    ap.add_argument(
        "--only", choices=["create-booking"], help="measure one write path and print its Server-Timing spans"
    )
    ap.add_argument("--source", default=os.environ["DB_NAME"], help="DB to copy into the scratch DB (e.g. kkt_volume)")
    a = ap.parse_args()
    js = js_gzip()
    snapshot(a.source)
    proc = start_backend()
    try:
        c = httpx.Client(base_url=f"http://127.0.0.1:{PORT}", timeout=60, headers={"X-Rate-Limit-Bypass": BYPASS})
        tok = c.post("/api/auth/login", json={"email": "admin@kkt.in", "password": DEMO_PASSWORD}).json()[
            "access_token"
        ]
        c.headers["Authorization"] = f"Bearer {tok}"
        rows = (
            [r for r in writes(c, a.runs, only=a.only) if r[1] == "Create booking"]
            if a.only
            else reads(c, a.runs) + writes(c, a.runs)
        )
    finally:
        proc.kill()
        from pymongo import MongoClient

        MongoClient(os.environ["MONGO_URL"]).drop_database(SCRATCH_DB)
    text = report(rows, a.runs, js)
    if a.only and SPAN_LOG:
        keys = sorted({k for d in SPAN_LOG for k in d} - {"dbq"}, key=lambda k: -sum(d.get(k, 0) for d in SPAN_LOG))
        text += "\n## Server-Timing spans (median ms over measured requests)\n| span | p50 | p95 |\n|---|---|---|\n"
        text += "".join(
            f"| {k} | {pct([d.get(k, 0) for d in SPAN_LOG], 50):.1f} | {pct([d.get(k, 0) for d in SPAN_LOG], 95):.1f} |\n"
            for k in keys
        )
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, "w") as fh:
        fh.write(text)
    print(text)


if __name__ == "__main__":
    main()
