"""Phase 3H REQ-325/331: read-only trace of the two report gaps the owner saw, receipt by receipt / booking by booking.
Usage: python tools/trace_3h_gaps.py --db test_database [--from 2026-04-01 --to 2026-11-18]"""

import argparse
import asyncio
import os
from collections import defaultdict

from motor.motor_asyncio import AsyncIOMotorClient


def day(x):
    return str(x)[:10] if x else None


async def main(dbn, f, t):
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[dbn]
    bks = {b["id"]: b async for b in db.bookings.find({}, {"_id": 0, "id": 1, "booking_number": 1, "status": 1})}
    print(f"== Gap 1: Collections vs Bank-wise + Cash, {f} … {t} (receipt-date basis, as the screens read today)")
    rows = defaultdict(int)
    detail = []
    async for p in db.payments.find({}, {"_id": 0}):
        st, mode, d, amt = p["status"], p.get("payment_mode_code"), p["payment_date"], p["amount_paise"]
        in_p = f <= d <= t
        coll = amt if in_p and st in ("Cleared", "Reversed") else 0
        rd = day((p.get("reversal") or {}).get("at") or p.get("updated_at")) if st == "Reversed" else None
        if rd and f <= rd <= t:
            coll -= amt
        bank = amt if in_p and mode != "CASH" and st in ("Cleared", "Pending") else 0
        cash = amt if in_p and mode == "CASH" and st == "Cleared" else 0
        diff = coll - bank - cash
        if diff:
            why = (
                "cheque in hand (Pending) counted in Bank-wise Total, not in Collections"
                if st == "Pending"
                else "reversed: Collections nets it on the reversal day, Bank-wise drops it"
                if st == "Reversed"
                else f"status {st}"
            )
            rows[why] += diff
            b = bks.get(p["booking_id"], {})
            detail.append(
                (p["receipt_number"], b.get("booking_number"), b.get("status"), mode, st, d, rd, amt, diff, why)
            )
    for r in sorted(detail, key=lambda r: r[5]):
        print("  ", " | ".join(str(x) for x in r))
    print("  by cause:", dict(rows), "net", sum(rows.values()))

    print("== Gap 2: Bills vs Collection (all instalment bills) vs Customer status (live bookings)")
    per = defaultdict(int)
    async for d in db.demands.find({"voided": {"$ne": True}, "status": {"$nin": ["Voided", "Cancelled"]}}, {"_id": 0}):
        b = bks.get(d["booking_id"], {})
        if b.get("status") not in ("Active", "Completed"):
            per[(b.get("booking_number"), b.get("status"))] += d["total_demand_paise"]
    for k, v in sorted(per.items()):
        print("   not live:", k, v)
    live = [i for i, b in bks.items() if b["status"] in ("Active", "Completed")]
    adj = defaultdict(int)
    async for e in db.ledger_entries.find(
        {"booking_id": {"$in": live}, "type": {"$nin": ["DEMAND", "OTHER_CHARGE_DEMAND"]}, "udhar_paise": {"$ne": 0}},
        {"_id": 0, "booking_id": 1, "type": 1, "udhar_paise": 1, "date": 1, "narration": 1},
    ):
        adj[(bks[e["booking_id"]]["booking_number"], e["type"], e.get("date"))] += e["udhar_paise"]
    for k, v in sorted(adj.items()):
        print("   adjustment on live booking:", k, v)
    print("  not live total", sum(per.values()), "adjust total", sum(adj.values()))


if __name__ == "__main__":
    a = argparse.ArgumentParser()
    a.add_argument("--db", required=True)
    a.add_argument("--from", dest="f", default="2026-04-01")
    a.add_argument("--to", dest="t", default="2099-12-31")
    x = a.parse_args()
    asyncio.run(main(x.db, x.f, x.t))
