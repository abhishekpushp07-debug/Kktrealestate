"""Overdue facts: customers / ₹ by band under the old rule (whole other-charge line aged from its first bill date)
vs the §3R rule (each part from its own due date). Read-only."""

import asyncio
import collections
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))
from db import db  # noqa: E402
from services import clock  # noqa: E402
from services.definitions import BANDS, ageing_bands, overdue_of  # noqa: E402


def _old(lines):
    return [{**l, "demand_history": [], "due_on": None} for l in lines or []]


async def main():
    today = clock.today()
    bk = await db.bookings.find(
        {"status": {"$in": ["Active", "Completed"]}},
        {"_id": 0, "id": 1, "customer_id": 1, "summary": 1, "other_charges": 1},
    ).to_list(None)
    dem = collections.defaultdict(list)
    async for d in db.demands.find({"booking_id": {"$in": [b["id"] for b in bk]}, "voided": {"$ne": True}}, {"_id": 0}):
        dem[d["booking_id"]].append(d)
    custs = {c["id"] for c in await db.customers.find({}, {"_id": 0, "id": 1}).to_list(None)}
    for label, f in (
        ("old rule (line from first bill date)", _old),
        ("§3R (each part from its due date)", lambda x: x),
    ):
        bands, per = {k: 0 for k in BANDS}, collections.Counter()
        for b in bk:
            r = ageing_bands(b.get("summary") or {}, dem[b["id"]], f(b.get("other_charges")), today)
            for k in BANDS:
                bands[k] += r[k]
            per[b["customer_id"]] += overdue_of(r)
        od = sum(1 for v in per.values() if v > 0)
        print(
            f"{label}: overdue customers {od} of {len(custs)} ({100 * od / max(len(custs), 1):.0f}%) · ₹ overdue {overdue_of(bands) / 100:,.0f}"
        )
        print("   " + " · ".join(f"{k} ₹{v / 100:,.0f}" for k, v in bands.items()))


if __name__ == "__main__":
    asyncio.run(main())
