"""Phase 1 F-6 chronology check (REQ-36): every demo record must respect date order. Read-only.
Also fails when Not due or any overdue band is empty, or no tower has a next stage to bill (REQ-46…49).
Usage: python tools/story_logic_check.py [--db NAME] [--today YYYY-MM-DD] → prints problems, exit 1 when any."""

import argparse
import os
import re
import sys
from datetime import date

from dotenv import load_dotenv
from pymongo import MongoClient

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(ROOT, ".env"))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from services import clock
from services.definitions import BANDS, ageing_bands, live_bookings_match


def _d(v):
    return clock.day_of(v)


def _future(db, today, out):
    for coll, field, label in (
        ("bookings", "booking_date", "booking_number"),
        ("payments", "payment_date", "receipt_number"),
        ("demands", "demand_date", "demand_number"),
        ("leads", "created_at", "name"),
    ):
        for r in db[coll].find({field: {"$gt": today + "T99"}}, {"_id": 0, label: 1, field: 1}):
            out.append(f"{coll} {r.get(label)}: {field} {r[field]} is after today {today}")
    # E2: ANY audit / activity / notification row whose business day is after the as-of day fails the story
    end = clock.day_end_utc(date.fromisoformat(today))
    for coll in ("audit_logs", "notifications", "lead_activities", "activities", "communications"):
        for r in (
            db[coll].find({"created_at": {"$gt": end}}, {"_id": 0, "action": 1, "type": 1, "created_at": 1}).limit(5)
        ):
            out.append(
                f"{coll} {r.get('action') or r.get('type')}: created_at {r['created_at']} is after today {today}"
            )
    # E5: hold expiry is mandatory — every flat on Hold carries a real expiry
    for f in db.flats.find({"status": "Hold"}, {"_id": 0, "flat_number": 1, "hold": 1}):
        if not (f.get("hold") or {}).get("expires_at"):
            out.append(f"flat {f['flat_number']}: on Hold without an expiry")


def _booking_order(db, out, stage_done):
    for b in db.bookings.find({}, {"_id": 0}):
        n, bd = b["booking_number"], b["booking_date"]
        if b.get("lead_id"):
            ld = db.leads.find_one({"id": b["lead_id"]}, {"_id": 0, "created_at": 1})
            if ld and _d(ld.get("created_at")) and _d(ld["created_at"]) > bd:
                out.append(f"{n}: booked {bd} before its lead was created {_d(ld['created_at'])}")
            for v in db.site_visits.find({"lead_id": b["lead_id"], "status": "Completed"}, {"_id": 0, "date": 1}):
                if v["date"] > bd:
                    out.append(f"{n}: booked {bd} before its completed site visit {v['date']}")
        for p in db.payments.find(
            {"booking_id": b["id"]},
            {"_id": 0, "receipt_number": 1, "payment_date": 1, "cleared_at": 1, "instrument": 1},
        ):
            if p["payment_date"] < bd:
                out.append(f"{p['receipt_number']}: received {p['payment_date']} before booking {n} ({bd})")
            dep = (p.get("instrument") or {}).get("date") or p["payment_date"]
            if p.get("cleared_at") and _d(p["cleared_at"]) < dep:
                out.append(f"{p['receipt_number']}: cheque cleared {_d(p['cleared_at'])} before deposit {dep}")
        for d in db.demands.find({"booking_id": b["id"], "voided": {"$ne": True}}, {"_id": 0}):
            if d.get("demand_date") and d["demand_date"] < bd:
                out.append(f"{d['demand_number']}: bill {d['demand_date']} before booking {n} ({bd})")
            sid = d.get("trigger_stage_id")
            done = stage_done.get((b["block_id"], sid)) if sid else None
            if sid and done and d.get("demand_date") and d["demand_date"] < done:
                out.append(f"{d['demand_number']}: bill {d['demand_date']} before its stage completed {done}")
        if b.get("status") == "Cancelled":
            cd = _d((b.get("cancellation") or {}).get("date") or (b.get("cancellation") or {}).get("at"))
            for d in db.demands.find({"booking_id": b["id"], "voided": {"$ne": True}}, {"_id": 0}):
                if cd and d.get("demand_date") and d["demand_date"] > cd:
                    out.append(f"{d['demand_number']}: bill {d['demand_date']} after cancellation of {n} ({cd})")
            for r in db.refunds.find({"booking_id": b["id"]}, {"_id": 0, "paid_date": 1}):
                if cd and r.get("paid_date") and r["paid_date"] < cd:
                    out.append(f"{n}: refund paid {r['paid_date']} before cancellation {cd}")


def check(db, today: str) -> list[str]:
    out: list[str] = []
    stage_done = {}
    for blk in db.blocks.find({}, {"_id": 0, "id": 1, "construction_stages": 1}):
        for s in blk.get("construction_stages") or []:
            if s.get("status") == "Completed":
                stage_done[(blk["id"], s["stage_id"])] = s.get("completed_on")
                if (s.get("completed_on") or "") > today:
                    out.append(f"stage {s.get('name')}: completed {s['completed_on']} after today")
    _future(db, today, out)
    _booking_order(db, out, stage_done)
    return out


def bands(db, today: str) -> tuple[list[str], dict]:
    """REQ-46/47/49: Not due and every overdue band hold ₹ > 0 and ≥ 1 booking (same ageing rule as the reports)."""
    as_of = date.fromisoformat(today)
    rupees = {k: 0 for k in BANDS}
    count = {k: 0 for k in BANDS}
    for b in db.bookings.find(live_bookings_match(), {"_id": 0, "id": 1, "summary": 1, "other_charges": 1}):
        dem = list(
            db.demands.find(
                {"booking_id": b["id"], "voided": {"$ne": True}},
                {"_id": 0, "due_date": 1, "cash_demand_paise": 1, "account_demand_paise": 1, "status": 1},
            )
        )
        per = ageing_bands(b.get("summary") or {}, dem, b.get("other_charges") or [], as_of)
        for k, v in per.items():
            rupees[k] += v
            count[k] += 1 if v > 0 else 0
    out = [f"{k} is empty (₹{rupees[k] // 100:,}, {count[k]} bookings)" for k in BANDS if not rupees[k] or not count[k]]
    return out, {k: {"paise": rupees[k], "bookings": count[k]} for k in BANDS}


def next_stage(db) -> tuple[list[str], list[dict]]:
    """REQ-48: at least one tower's next pending stage would raise bills for live bookings (same rule as the preview)."""
    found = []
    for blk in db.blocks.find({}, {"_id": 0, "id": 1, "name": 1, "construction_stages": 1}):
        pending = sorted(
            (s for s in blk.get("construction_stages") or [] if s.get("status") != "Completed"), key=lambda s: s["seq"]
        )
        if not pending:
            continue
        sid, n = pending[0]["stage_id"], 0
        for b in db.bookings.find(
            {"block_id": blk["id"], "status": "Active"}, {"_id": 0, "id": 1, "payment_plan_snapshot": 1}
        ):
            raised = {
                d["installment_seq"]
                for d in db.demands.find({"booking_id": b["id"], "voided": {"$ne": True}}, {"installment_seq": 1})
            }
            ins = (b.get("payment_plan_snapshot") or {}).get("installments", [])
            n += any(
                i["trigger_type"] == "ON_STAGE" and i.get("trigger_stage_id") == sid and i["seq"] not in raised
                for i in ins
            )
        if n:
            found.append(
                {
                    "block_id": blk["id"],
                    "tower": blk["name"],
                    "stage_id": sid,
                    "stage": pending[0]["name"],
                    "bookings": n,
                }
            )
    return (
        [] if found else ["next billing stage is empty (no tower has a pending stage with bookings to bill)"]
    ), found


def followups(db, today: str) -> tuple[list[str], int]:
    """REQ-65/66: open leads with a follow-up due on or before the as-of business day (same rule as the Home tile)."""
    n = db.leads.count_documents(
        {"next_follow_up_at": {"$lte": clock.day_end_utc(today)}, "status": {"$nin": ["Converted", "Lost"]}}
    )
    return ([] if n else ["follow-ups due today is empty"]), n


GAP_SCOPES = [
    ("bookings", "booking_number"),
    ("payments", "receipt_number"),
    ("demands", "demand_number"),
    ("customers", "customer_code"),
    ("refunds", "refund_number"),
]


def gaps(db) -> list[str]:
    """REQ-38: inside one rebuild every FY sequence is contiguous (counters carry on across rebuilds)."""
    out = []
    for coll, field in GAP_SCOPES:
        seqs: dict[tuple, list[int]] = {}
        for d in db[coll].find({field: {"$type": "string"}}, {"_id": 0, field: 1}):
            m = re.match(r"^(.*?)(\d{4})\D(\d+)$", d[field])
            if m:
                seqs.setdefault((m.group(1), m.group(2)), []).append(int(m.group(3)))
        for (pre, fy), ns in seqs.items():
            ns.sort()
            missing = sorted(set(range(ns[0], ns[-1] + 1)) - set(ns))
            if missing:
                out.append(f"{coll} {pre}{fy}: {len(missing)} gap(s) inside this rebuild, first {missing[:5]}")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=os.environ["DB_NAME"])
    ap.add_argument("--today", default=clock.today_iso())
    a = ap.parse_args()
    db = MongoClient(os.environ["MONGO_URL"])[a.db]
    problems = check(db, a.today) + gaps(db) + bands(db, a.today)[0] + next_stage(db)[0] + followups(db, a.today)[0]
    for p in problems[:200]:
        print("PROBLEM", p)
    print(f"{len(problems)} problems")
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
