"""Q-44 / REQ-341 proof: Outstanding "As of D" over every live booking × 12 past dates equals an independent replay of
the source records (bills, receipts on their cleared day, reversals, waivers, price / transfer steps), and equals
Customer status As of D. Usage: DB_NAME=<db> python tools/asof_replay.py --base http://localhost:8001 --out file.md"""

import argparse
import os
import sys
from collections import defaultdict
from datetime import date, timedelta

import httpx
from pymongo import MongoClient

sys.path.insert(0, "/app/backend")
from services import clock  # noqa: E402
from services.definitions import received_on  # noqa: E402

LIVE = ("Active", "Completed")


def dates12(today: date) -> list[str]:
    out, d = [], today.replace(day=1) - timedelta(days=1)
    while len(out) < 10:  # ten past month-ends
        out.append(d.isoformat())
        d = d.replace(day=1) - timedelta(days=1)
    return [*sorted(out), (today - timedelta(days=17)).isoformat(), (today - timedelta(days=1)).isoformat()]


def replay(db, cid, day: str) -> dict[str, int]:
    """Net balance per booking live on `day` (owed − received − waived), read from source collections only."""
    bks = {
        b["id"]
        for b in db.bookings.find(
            {"company_id": cid, "status": {"$in": list(LIVE)}, "booking_date": {"$lte": day}}, {"id": 1}
        )
    }
    net: dict[str, int] = defaultdict(int)
    for d in db.demands.find({"booking_id": {"$in": list(bks)}}):
        if (clock.day_of(d.get("posted_at")) or d["demand_date"]) > day:  # a bill exists from the day it was raised
            continue
        if d.get("voided") and (clock.day_of(d.get("voided_at")) or "") <= day:
            continue
        if d.get("status") in ("Voided", "Cancelled"):
            continue
        net[d["booking_id"]] += d["total_demand_paise"]
    for p in db.payments.find({"booking_id": {"$in": list(bks)}, "status": {"$in": ["Cleared", "Reversed"]}}):
        got = received_on(p)
        if not got or got > day:
            continue
        rev = clock.day_of((p.get("reversal") or {}).get("at")) if p["status"] == "Reversed" else None
        if rev and rev <= day:
            continue
        net[p["booking_id"]] -= p["amount_paise"]
    wv = ("WAIVER", "WAIVER_REVERSAL")  # a waiver's own rows: its share part and the GST on it go together
    for e in db.ledger_entries.find(
        {"booking_id": {"$in": list(bks)}, "type": {"$in": list(wv)}, "date": {"$lte": day}}
    ):
        net[e["booking_id"]] -= (e.get("jama_paise") or 0) - (e.get("udhar_paise") or 0)
    for b in db.bookings.find({"id": {"$in": list(bks)}}, {"id": 1, "other_charges": 1}):
        for oc in b.get("other_charges") or []:
            for h in oc.get("demand_history") or []:
                if (clock.day_of(h.get("at")) or h.get("bill_day") or "9") <= day:  # raised that day
                    net[b["id"]] += h.get("paise") or 0
    steps = ("AGREEMENT_CHANGE", "TRANSFER")  # price / transfer steps (their only record is the ledger step)
    for e in db.ledger_entries.find(
        {"booking_id": {"$in": list(bks)}, "type": {"$in": list(steps)}, "date": {"$lte": day}}
    ):
        net[e["booking_id"]] += e.get("udhar_paise", 0)
    return {b: net.get(b, 0) for b in bks}


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--base", default="http://localhost:8001")
    a.add_argument("--out", required=True)
    x = a.parse_args()
    db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    cl = httpx.Client(
        base_url=x.base + "/api",
        timeout=300,
        headers={"X-Rate-Limit-Bypass": os.environ.get("LOGIN_RATE_LIMIT_BYPASS_TOKEN", "")},
    )
    tok = cl.post("/auth/login", json={"email": "admin@kkt.in", "password": os.environ["DEMO_PASSWORD"]}).json()
    cl.headers["Authorization"] = f"Bearer {tok['access_token']}"
    cid = db.users.find_one({"email": "admin@kkt.in"})["company_id"]
    today = clock.today()
    lines, bad_total = [f"# As-of replay proof — `{os.environ['DB_NAME']}` (today {today})", ""], 0
    lines += [
        "| As of | Bookings | Outstanding (report) | Customer status | Booking mismatches |",
        "|---|---:|---:|---:|---:|",
    ]
    for d in dates12(today):
        rows, page = [], 1
        while True:
            r = cl.get(
                "/reports/v3/outstanding",
                params={
                    "as_of": d,
                    "page": page,
                    "page_size": 500,
                    "cols": "booking_number,outstanding_paise,advance_paise,net_balance_paise",
                },
            ).json()
            rows += r["rows"]
            if page * 500 >= r["count"]:
                break
            page += 1
        cs = cl.get("/reports/v3/customer-status", params={"as_of": d, "page_size": 10}).json()["totals"]
        rep = {r["booking_id"]: r["net_balance_paise"] for r in rows}
        rp = replay(db, cid, d)
        bad = [b for b in set(rep) | set(rp) if rep.get(b) != rp.get(b)]
        bad_total += len(bad) + (r["totals"]["outstanding_paise"] != cs["total_due"])
        lines.append(f"| {d} | {len(rep)} | {r['totals']['outstanding_paise']} | {cs['total_due']} | {len(bad)} |")
        for b in bad[:5]:
            lines.append(f"|  ↳ {b} | | report {rep.get(b)} | replay {rp.get(b)} | |")
    lines += [
        "",
        f"**{'PASS' if not bad_total else 'FAIL'}** — {bad_total} mismatches (booking net balance vs replay; report total vs Customer status).",
    ]
    open(x.out, "w").write("\n".join(lines) + "\n")
    print("\n".join(lines))
    sys.exit(1 if bad_total else 0)


if __name__ == "__main__":
    main()
