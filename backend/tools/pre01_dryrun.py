"""PRE-01 dry run (read-only): which live bookings change Outstanding when manual bills count in it (owner decision A).
Usage: python -m tools.pre01_dryrun --db test_database kkt_medium kkt_volume → prints one line per DB + changed bookings."""

import argparse
import os

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/app/backend/.env")


def changes(db) -> list[dict]:
    out = []
    ids = db.demands.distinct("booking_id", {"trigger_type": "MANUAL", "voided": {"$ne": True}})
    for b in db.bookings.find({"id": {"$in": ids}, "status": {"$in": ["Active", "Completed"]}}):
        s = b.get("summary") or {}
        man = list(db.demands.find({"booking_id": b["id"], "trigger_type": "MANUAL", "voided": {"$ne": True}}))
        new = max(s.get("other_charges_due_paise", 0), 0)
        for k in ("cash", "account"):
            plan_order = s.get(f"{k}_order_raised_paise", 0)
            new += max(plan_order + sum(d.get(f"{k}_demand_paise", 0) for d in man) - s.get(f"{k}_paid_paise", 0), 0)
        if new != s.get("outstanding_paise", 0):
            out.append({"booking": b["booking_number"], "before": s.get("outstanding_paise", 0), "after": new})
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", nargs="+", required=True)
    client = MongoClient(os.environ["MONGO_URL"])
    for name in ap.parse_args().db:
        db = client[name]
        n = db.demands.count_documents({"trigger_type": "MANUAL", "voided": {"$ne": True}})
        ch = changes(db)
        print(f"{name}: manual bills {n} · bookings whose Outstanding changes {len(ch)}")
        for c in ch:
            print(f"  {c['booking']}: ₹{c['before'] / 100:,.0f} → ₹{c['after'] / 100:,.0f}")
