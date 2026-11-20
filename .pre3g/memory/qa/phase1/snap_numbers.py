"""Determinism snapshot (REQ-38): money totals, counts and statuses of the story DB. Usage: python snap_numbers.py OUT.json"""

import json
import os
import sys
from collections import Counter

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/app/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


def agg(coll, key, amt):
    out = {}
    for d in db[coll].find({}, {"_id": 0, key: 1, amt: 1}):
        k = d.get(key)
        c, s = out.get(k, (0, 0))
        out[k] = (c + 1, s + (d.get(amt) or 0))
    return {str(k): list(v) for k, v in sorted(out.items(), key=lambda x: str(x[0]))}


snap = {
    "story": (db.settings.find_one({"key": "story"}) or {}).get("value", {}).get("as_of"),
    "bookings": dict(Counter(b["status"] for b in db.bookings.find({}, {"status": 1}))),
    "payments": agg("payments", "status", "amount_paise"),
    "demands": agg("demands", "status", "total_demand_paise"),
    "refunds": agg("refunds", "status", "amount_paise"),
    "outstanding": sum((b.get("summary") or {}).get("outstanding_paise", 0) for b in db.bookings.find({}, {"summary": 1})),
    "flats": dict(Counter(f["status"] for f in db.flats.find({}, {"status": 1}))),
    "flat_prices": sum(f.get("price_paise") or 0 for f in db.flats.find({}, {"price_paise": 1})),
    "leads": dict(Counter(x.get("status") for x in db.leads.find({}, {"status": 1}))),
    "visits": dict(Counter(x.get("status") for x in db.site_visits.find({}, {"status": 1}))),
    "users": sorted(u["email"] for u in db.users.find({}, {"email": 1})),
    "roles": sorted(r["name"] for r in db.roles.find({}, {"name": 1})),
    "projects": sorted(p["code"] for p in db.projects.find({}, {"code": 1})),
    "towers": sorted(b["name"] for b in db.blocks.find({}, {"name": 1})),
    "plans": sorted(p["name"] for p in db.payment_plans.find({}, {"name": 1})),
    # E4: setup kept → ids, rates and per-flat state must be identical rebuild to rebuild
    "flat_state": {
        f["id"]: [f["flat_number"], f.get("status"), f.get("rate_per_sqft"), f.get("price_paise")]
        for f in db.flats.find({}, {"_id": 0, "id": 1, "flat_number": 1, "status": 1, "rate_per_sqft": 1, "price_paise": 1})
    },
    "project_ids": sorted(p["id"] for p in db.projects.find({}, {"id": 1})),
    "block_ids": sorted(b["id"] for b in db.blocks.find({}, {"id": 1})),
    "hold_reasons": sorted(r["name"] for r in db.hold_reasons.find({}, {"name": 1})),
    "booked_flats": sorted(
        (b.get("flat_id"), b.get("status"), (b.get("summary") or {}).get("agreement_value_paise"))
        for b in db.bookings.find({}, {"flat_id": 1, "status": 1, "summary": 1})
    ),
}
counters = {f"{c.get('_id') or c.get('key')}": c.get("seq") for c in db.counters.find({})}
json.dump({"snap": snap, "counters": counters}, open(sys.argv[1], "w"), indent=1, sort_keys=True, default=str)
print("written", sys.argv[1])
