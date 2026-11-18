"""REQ-211 proof: the same requests against two backends (old code / new code, each on its own copy of one DB) must give
identical report rows and identical stage-complete postings. Usage:
  python tools/perf_equivalence.py dump --base http://127.0.0.1:8041 --db kkt_eq_a --block <id> --stage <id> --out a.json
  python tools/perf_equivalence.py diff a.json b.json"""

import argparse
import json
import os
import sys

import httpx
from _env import DEMO_PASSWORD
from pymongo import MongoClient

DROP = {"id", "at", "posted_at", "created_at", "updated_at", "ledger_rebuilt_at", "completed_at", "audit_id", "_id"}
REPORTS = [
    ("/api/reports/collections-v2", {"from_date": "2026-04-01", "to_date": "2026-11-17"}),
    ("/api/reports/collections-v2", {"from_date": "2025-04-01", "to_date": "2026-03-31", "group_by": "project"}),
    ("/api/reports/collections-v2", {"from_date": "2026-04-01", "to_date": "2026-11-17", "date_basis": "clearance"}),
    ("/api/reports/outstanding-v2", {}),
    ("/api/reports/outstanding-v2", {"group_by": "customer"}),
    ("/api/reports/outstanding-v2", {"group_by": "block"}),
]


def clean(x):
    if isinstance(x, dict):
        return {k: clean(v) for k, v in x.items() if k not in DROP and k != "received_bridge"}
    if isinstance(x, list):
        return [clean(v) for v in x]
    return x


def dump(a):
    c = httpx.Client(base_url=a.base, timeout=300, headers={"X-Rate-Limit-Bypass": "kkt-test-bypass-local"})
    tok = c.post("/api/auth/login", json={"email": "admin@kkt.in", "password": DEMO_PASSWORD}).json()["access_token"]
    c.headers["Authorization"] = f"Bearer {tok}"
    out = {"reports": {}}
    for p, q in REPORTS:
        r = c.get(p, params=q)
        r.raise_for_status()
        d = r.json()
        out["reports"][f"{p}?{json.dumps(q, sort_keys=True)}"] = clean(
            {k: d.get(k) for k in ("rows", "totals", "carried")}
        )
    r = c.post(f"/api/blocks/{a.block}/construction/stage", json={"stage_id": a.stage, "completed_on": "2026-11-17"})
    r.raise_for_status()
    out["stage"] = clean({k: v for k, v in r.json().items() if k not in ("block",)})
    db = MongoClient(os.environ["MONGO_URL"])[a.db]
    bids = sorted(b["id"] for b in db.bookings.find({"block_id": a.block}, {"id": 1}))
    out["bookings"] = {
        bid: clean(
            {
                "booking": db.bookings.find_one({"id": bid}, {"_id": 0, "summary": 1, "other_charges": 1}),
                "demands": list(db.demands.find({"booking_id": bid}, {"_id": 0}).sort("installment_seq", 1)),
                "ledger": list(db.ledger_entries.find({"booking_id": bid}, {"_id": 0}).sort("seq", 1)),
                "notifications": db.notifications.count_documents({"booking_id": bid}),
            }
        )
        for bid in bids
    }
    out["audits"] = sorted(
        (x["action"], x.get("entity_id"))
        for x in db.audit_logs.find({"action": {"$in": ["demand.create", "construction.stage_complete"]}}, {"_id": 0})
    )
    after = {}
    for p, q in REPORTS[:1] + REPORTS[3:4]:  # reports again after the write: the cache must not serve the old answer
        after[p] = clean({k: c.get(p, params=q).json().get(k) for k in ("rows", "totals")})
    out["reports_after_write"] = after
    json.dump(out, open(a.out, "w"), sort_keys=True, default=str)
    print("dumped", a.out, len(out["bookings"]), "bookings")


def _norm(o):
    """bill_day is the one field the new code adds (iteration 12); demands ordered by (seq, number) so a voided earlier
    probe and its re-raise compare deterministically."""
    if isinstance(o, dict):
        o = {k: _norm(v) for k, v in o.items() if k != "bill_day"}
        if isinstance(
            o.get("rows"), list
        ):  # reports sort by amount; equal amounts keep storage order, which a restore varies
            o["rows"] = sorted(o["rows"], key=lambda r: json.dumps(r, sort_keys=True))
        if "demands" in o:
            o["demands"] = sorted(
                o["demands"], key=lambda d: (d.get("installment_seq") or 0, d.get("demand_number") or "")
            )
        return o
    if isinstance(o, list):
        return [_norm(v) for v in o]
    return o


def diff(a, b):
    x, y = _norm(json.load(open(a))), _norm(json.load(open(b)))
    bad = 0
    for sec in ("reports", "stage", "bookings", "audits", "reports_after_write"):
        if x.get(sec) == y.get(sec):
            print(f"IDENTICAL {sec}")
            continue
        bad += 1
        if isinstance(x.get(sec), dict):
            for k in sorted(set(x[sec]) | set(y[sec])):
                if x[sec].get(k) != y[sec].get(k):
                    print(f"DIFF {sec} · {k}")
        else:
            print(f"DIFF {sec}")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["dump", "diff"])
    ap.add_argument("files", nargs="*")
    ap.add_argument("--base")
    ap.add_argument("--db")
    ap.add_argument("--block")
    ap.add_argument("--stage")
    ap.add_argument("--out")
    a = ap.parse_args()
    dump(a) if a.cmd == "dump" else diff(*a.files)
