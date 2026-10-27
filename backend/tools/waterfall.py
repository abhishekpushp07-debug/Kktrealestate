"""Phase D2 screen-waterfall measurement against the volume backend (API side).
For each ERP screen replays the request set the frontend issues on first paint, records count / bytes / server ms (p50/p95 over N runs).
Usage: python tools/waterfall.py --base http://localhost:8002 --out /app/memory/qa/perf/waterfall_before.md
"""
import argparse
import json
import statistics
import sys
import time

import httpx
from _env import DEMO_PASSWORD

TOK_HDR = {"X-Rate-Limit-Bypass": "kkt-test-bypass-local"}


def login(c):
    r = c.post("/api/auth/login", json={"email": "admin@kkt.in", "password": DEMO_PASSWORD}, headers=TOK_HDR)
    r.raise_for_status()
    return r.json()["access_token"]


def screens(c, h):
    bk = c.get("/api/bookings?page_size=1", headers=h).json()["items"][0]
    cust = bk["customer_id"]
    proj = c.get("/api/projects?page_size=1", headers=h).json()["items"][0]
    blk = c.get(f"/api/blocks?project_id={proj['id']}&page_size=1", headers=h).json()["items"][0]
    return {
        "Home": ["/api/dashboard/home"],
        "Projects list": ["/api/projects?page_size=50"],
        "Project workspace": [f"/api/projects/{proj['id']}", f"/api/blocks?project_id={proj['id']}&page_size=100", f"/api/projects/{proj['id']}/summary"],
        "Inventory grid": [f"/api/blocks/{blk['id']}", f"/api/flats?block_id={blk['id']}&page_size=200"],
        "Customers list": ["/api/customers?page_size=50"],
        "Customers search": ["/api/customers?search=Sinha&page_size=50"],
        "Customer 360": [f"/api/customers/{cust}", f"/api/customers/{cust}/timeline?limit=20", f"/api/bookings?customer_id={cust}&page_size=20"],
        "Bookings list": ["/api/bookings?page_size=50"],
        "Booking detail (3 ledgers)": [f"/api/bookings/{bk['id']}", f"/api/bookings/{bk['id']}/ledger?book=cash", f"/api/bookings/{bk['id']}/ledger?book=account", f"/api/bookings/{bk['id']}/ledger?book=other"],
        "Payments": ["/api/payments?page_size=50", "/api/payments/summary"],
        "Leads board": ["/api/leads/board", "/api/leads?page_size=50"],
        "Site visits": ["/api/site-visits?page_size=50"],
        "Service": ["/api/service-requests?page_size=50"],
        "Reports": ["/api/reports", "/api/reports/collections?page_size=50"],
        "Catalogues": ["/api/catalogues"],
        "Users": ["/api/users?page_size=50", "/api/roles"],
        "Settings": ["/api/settings/company", "/api/admin/integrity-report"],
        "Global search": ["/api/search?q=Sinha"],
    }


def main(base, out, runs):
    c = httpx.Client(base_url=base, timeout=60)
    h = {"Authorization": f"Bearer {login(c)}", **TOK_HDR}
    rows = []
    raw = {}
    for name, urls in screens(c, h).items():
        per_url = []
        for u in urls:
            ms, bytes_, codes = [], 0, set()
            for _ in range(runs):
                t = time.perf_counter()
                r = c.get(u, headers=h)
                ms.append((time.perf_counter() - t) * 1000)
                bytes_ = len(r.content)
                codes.add(r.status_code)
            st = r.headers.get("server-timing", "")
            per_url.append({"url": u, "status": sorted(codes), "bytes": bytes_, "p50": statistics.median(ms), "p95": sorted(ms)[max(0, int(len(ms) * 0.95) - 1)], "server_timing": st})
        tot_bytes = sum(x["bytes"] for x in per_url)
        p50 = sum(x["p50"] for x in per_url)
        p95 = sum(x["p95"] for x in per_url)
        slow = max(per_url, key=lambda x: x["p95"])
        rows.append((name, len(urls), tot_bytes, p50, p95, slow["url"], slow["p95"], ",".join(str(s) for x in per_url for s in x["status"])))
        raw[name] = per_url
        print(f"{name:28s} req={len(urls)} bytes={tot_bytes/1024:7.1f}KB p50={p50:7.1f}ms p95={p95:7.1f}ms slowest={slow['url'][:60]} {slow['p95']:.0f}ms")
    with open(out, "w") as f:
        f.write(f"# Screen waterfall — {base} · {runs} runs each · {time.strftime('%Y-%m-%d %H:%M')}\n\n")
        f.write("| Screen | Requests (first paint, bootstrap excl.) | Bytes | Σ p50 ms | Σ p95 ms | Slowest call | p95 ms | Status |\n|---|---|---|---|---|---|---|---|\n")
        for r in rows:
            f.write(f"| {r[0]} | {r[1]} | {r[2]/1024:.1f} KB | {r[3]:.0f} | {r[4]:.0f} | `{r[5]}` | {r[6]:.0f} | {r[7]} |\n")
        f.write("\n<details><summary>Per-request detail</summary>\n\n```json\n" + json.dumps(raw, indent=1) + "\n```\n</details>\n")
    print("wrote", out)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8002")
    ap.add_argument("--out", default="/app/memory/qa/perf/waterfall_before.md")
    ap.add_argument("--runs", type=int, default=7)
    a = ap.parse_args()
    sys.exit(main(a.base, a.out, a.runs))
