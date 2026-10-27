"""Phase J2: index/explain audit on a scale DB. For every list/search/report/dashboard query shape: explain() → flag COLLSCAN, in-memory SORT, non-index-backed
aggregation stages; measure cold vs warm p95; add missing compound keyset indexes (sort_key, id) for every allowed list sort.
Usage: DB_NAME=kkt_scale python tools/explain_audit.py [--fix] [--out /app/memory/qa/scale/explain_report.md]"""
import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
from pymongo import ASCENDING, DESCENDING, MongoClient  # noqa: E402

# allowed sorts per list endpoint (mirrors routers/*.sort_spec)
LIST_SORTS = {
    "bookings": ["booking_number", "booking_date", "created_at", "status", "customer_name"],
    "payments": ["payment_date", "receipt_number", "amount_paise", "status", "created_at"],
    "demands": ["due_date", "demand_date", "total_demand_paise", "customer_name"],
    "customers": ["full_name", "customer_code", "created_at", "kyc_status", "phone", "engagement_score", "lifecycle_stage"],
    "leads": ["name", "lead_number", "created_at", "status", "next_follow_up_at"],
    "flats": ["flat_number", "floor", "status", "price_paise"],
    "audit_logs": ["created_at"],
    "service_tickets": ["created_at", "status", "priority"],
    "documents": ["created_at", "kind"],
}


def shapes(cid, pid, bid, cust, booking_id):
    s = []
    for coll, keys in LIST_SORTS.items():
        base = {"company_id": cid} if coll not in ("audit_logs",) else {}
        for k in keys:
            for d in (1, -1):
                s.append((f"list {coll} sort {'-' if d < 0 else ''}{k}", coll, "find", {**base}, [(k, d), ("id", d)]))
        if coll != "audit_logs":  # audit rows carry no project_id
            s.append((f"list {coll} by project", coll, "find", {**base, "project_id": pid}, [(keys[0], -1), ("id", -1)]))
    s += [
        ("search customers by name prefix", "customers", "find", {"company_id": cid, "is_active": True, "full_name": {"$regex": "^Am", "$options": "i"}}, None),
        ("search customers by phone", "customers", "find", {"company_id": cid, "phone": {"$regex": "^(\\+91)?9000"}}, None),
        ("search bookings by number", "bookings", "find", {"company_id": cid, "booking_number": {"$regex": "^BK-S-0001"}}, None),
        ("customer 360 bookings", "bookings", "find", {"customer_id": cust}, [("booking_date", -1)]),
        ("booking ledger", "ledger_entries", "find", {"booking_id": booking_id}, [("seq", 1)]),
        ("booking payments", "payments", "find", {"booking_id": booking_id}, [("payment_date", -1)]),
        ("booking demands", "demands", "find", {"booking_id": booking_id, "voided": False}, [("installment_seq", 1)]),
        ("audit by entity", "audit_logs", "find", {"entity_type": "booking", "entity_id": booking_id}, [("created_at", -1)]),
        ("cheques pending", "payments", "find", {"company_id": cid, "status": "Pending"}, [("payment_date", 1)]),
        ("overdue demands", "demands", "find", {"company_id": cid, "status": {"$in": ["Open", "Partially Paid"]}, "voided": False, "due_date": {"$lt": "2026-10-01"}}, [("due_date", 1)]),
        ("flats by block", "flats", "find", {"block_id": bid, "is_active": True}, [("floor", 1), ("position", 1)]),
        ("report collections by month", "payments", "agg", [{"$match": {"company_id": cid, "status": "Cleared", "payment_date": {"$gte": "2026-04-01", "$lte": "2026-10-26"}}}, {"$group": {"_id": {"$substr": ["$payment_date", 0, 7]}, "amt": {"$sum": "$amount_paise"}}}], None),
        ("report collections by project", "payments", "agg", [{"$match": {"company_id": cid, "status": "Cleared", "payment_date": {"$gte": "2026-04-01", "$lte": "2026-10-26"}}}, {"$group": {"_id": "$project_id", "amt": {"$sum": "$amount_paise"}}}], None),
        ("report outstanding by project", "bookings", "agg", [{"$match": {"company_id": cid, "status": "Active"}}, {"$group": {"_id": "$project_id", "out": {"$sum": "$summary.outstanding_paise"}}}], None),
        ("dashboard: cheques to clear", "payments", "agg", [{"$match": {"company_id": cid, "status": "Pending"}}, {"$group": {"_id": None, "n": {"$sum": 1}, "amt": {"$sum": "$amount_paise"}}}], None),
        ("dashboard: collected this month", "payments", "agg", [{"$match": {"company_id": cid, "status": "Cleared", "payment_date": {"$gte": "2026-10-01"}}}, {"$group": {"_id": None, "amt": {"$sum": "$amount_paise"}}}], None),
        ("project summary read model", "bookings", "agg", [{"$match": {"project_id": pid, "status": "Active"}}, {"$group": {"_id": "$block_id", "n": {"$sum": 1}, "out": {"$sum": "$summary.outstanding_paise"}}}], None),
        ("leads pipeline", "leads", "agg", [{"$match": {"company_id": cid, "is_active": True}}, {"$group": {"_id": "$status", "n": {"$sum": 1}}}], None),
        ("inventory by status", "flats", "agg", [{"$match": {"project_id": pid, "is_active": True}}, {"$group": {"_id": "$status", "n": {"$sum": 1}}}], None),
        ("ageing: open demands", "demands", "agg", [{"$match": {"company_id": cid, "voided": False, "status": {"$ne": "Paid"}}}, {"$group": {"_id": "$booking_id", "due": {"$sum": {"$subtract": ["$total_demand_paise", "$paid_paise"]}}}}], None),
    ]
    return s


def walk(plan):
    out = []
    def rec(p):
        if isinstance(p, dict):
            if "stage" in p:
                out.append(p)
            for v in p.values():
                rec(v)
        elif isinstance(p, list):
            for v in p:
                rec(v)
    rec(plan)
    return out


def analyse(db, coll, kind, q, sort):
    if kind == "find":
        cur = db[coll].find(q).sort(sort) if sort else db[coll].find(q)
        ex = cur.limit(50).explain()
        plan = ex["queryPlanner"]["winningPlan"]
        stages = {s["stage"] for s in walk(plan)}
        exec_ = ex.get("executionStats", {})
        return {"collscan": "COLLSCAN" in stages, "mem_sort": "SORT" in stages, "stages": sorted(stages), "keys": exec_.get("totalKeysExamined"), "docs": exec_.get("totalDocsExamined")}
    ex = db.command("explain", {"aggregate": coll, "pipeline": q, "cursor": {}}, verbosity="executionStats")
    plan = ex.get("stages", [{}])[0].get("$cursor", ex).get("queryPlanner", {}).get("winningPlan", {})
    stages = {s["stage"] for s in walk(plan)}
    es = ex.get("stages", [{}])[0].get("$cursor", ex).get("executionStats", {})
    return {"collscan": "COLLSCAN" in stages or not stages, "mem_sort": "SORT" in stages, "stages": sorted(stages), "keys": es.get("totalKeysExamined"), "docs": es.get("totalDocsExamined")}


def timeit(db, coll, kind, q, sort, n=5):
    xs = []
    for _ in range(n):
        t0 = time.perf_counter()
        if kind == "find":
            cur = db[coll].find(q).sort(sort) if sort else db[coll].find(q)
            list(cur.limit(50))
        else:
            list(db[coll].aggregate(q, maxTimeMS=20000))
        xs.append((time.perf_counter() - t0) * 1000)
    return round(xs[0], 1), round(sorted(xs[1:])[int(len(xs[1:]) * 0.95) - 1] if len(xs) > 1 else xs[0], 1)


def _idx(coll, spec, name):
    try:
        coll.create_index(spec, name=name, background=True)
        return f"{coll.name}.{name}"
    except Exception as e:  # noqa: BLE001  (already exists under another name, etc.)
        return f"{coll.name}.{name}: {str(e)[:50]}"


def fix_indexes(db):
    created = []
    for coll, keys in LIST_SORTS.items():
        for k in keys:
            name = f"ks_company_{k}_id"
            spec = ([("company_id", ASCENDING)] if coll != "audit_logs" else []) + [(k, ASCENDING), ("id", ASCENDING)]
            created.append(_idx(db[coll], spec, name))
        if coll not in ("audit_logs",):
            created.append(_idx(db[coll], [("company_id", ASCENDING), ("project_id", ASCENDING), (keys[0], DESCENDING), ("id", DESCENDING)], f"ks_project_{keys[0]}_id"))
    created.append(_idx(db.customers, [("company_id", ASCENDING), ("is_active", ASCENDING), ("full_name", ASCENDING)], "search_name"))
    created.append(_idx(db.customers, [("company_id", ASCENDING), ("phone", ASCENDING)], "search_phone"))
    created.append(_idx(db.bookings, [("company_id", ASCENDING), ("booking_number", ASCENDING)], "search_booking_number"))
    created.append(_idx(db.bookings, [("customer_id", ASCENDING), ("booking_date", DESCENDING)], "c360_bookings"))
    created.append(_idx(db.payments, [("booking_id", ASCENDING), ("payment_date", DESCENDING)], "booking_payments"))
    created.append(_idx(db.payments, [("company_id", ASCENDING), ("status", ASCENDING), ("payment_date", ASCENDING)], "status_date"))
    created.append(_idx(db.payments, [("company_id", ASCENDING), ("status", ASCENDING), ("project_id", ASCENDING), ("payment_date", ASCENDING)], "status_project_date"))
    created.append(_idx(db.demands, [("booking_id", ASCENDING), ("voided", ASCENDING), ("installment_seq", ASCENDING)], "booking_installments"))
    created.append(_idx(db.demands, [("company_id", ASCENDING), ("voided", ASCENDING), ("status", ASCENDING), ("due_date", ASCENDING)], "overdue"))
    created.append(_idx(db.ledger_entries, [("booking_id", ASCENDING), ("seq", ASCENDING)], "booking_seq"))
    created.append(_idx(db.audit_logs, [("entity_type", ASCENDING), ("entity_id", ASCENDING), ("created_at", DESCENDING)], "entity_time"))
    created.append(_idx(db.flats, [("block_id", ASCENDING), ("is_active", ASCENDING), ("floor", ASCENDING), ("position", ASCENDING)], "block_grid"))
    created.append(_idx(db.flats, [("project_id", ASCENDING), ("is_active", ASCENDING), ("status", ASCENDING)], "project_status"))
    created.append(_idx(db.bookings, [("company_id", ASCENDING), ("status", ASCENDING), ("project_id", ASCENDING)], "active_by_project"))
    created.append(_idx(db.bookings, [("project_id", ASCENDING), ("status", ASCENDING), ("block_id", ASCENDING)], "project_block_summary"))
    created.append(_idx(db.leads, [("company_id", ASCENDING), ("is_active", ASCENDING), ("status", ASCENDING)], "pipeline"))
    return created


def main(fix: bool, out: str):
    db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    cid = db.companies.find_one({}, {"id": 1})["id"]
    pid = db.projects.find_one({}, {"id": 1})["id"]
    bid = db.blocks.find_one({}, {"id": 1})["id"]
    bk = db.bookings.find_one({}, {"id": 1, "customer_id": 1})
    if fix:
        created = fix_indexes(db)
        print(f"indexes ensured: {len(created)}")
    rows, bad = [], 0
    for name, coll, kind, q, sort in shapes(cid, pid, bid, bk["customer_id"], bk["id"]):
        a = analyse(db, coll, kind, q, sort)
        cold, warm = timeit(db, coll, kind, q, sort)
        flag = "COLLSCAN" if a["collscan"] else ("MEM_SORT" if a["mem_sort"] else "ok")
        bad += flag != "ok"
        rows.append((name, coll, flag, cold, warm, a["keys"], a["docs"], ",".join(a["stages"])))
    md = [f"# Explain audit — DB `{os.environ['DB_NAME']}` ({sum(db[c].estimated_document_count() for c in LIST_SORTS):,} rows across list collections)", "",
          f"Shapes: {len(rows)} · flagged: **{bad}** (COLLSCAN / in-memory SORT) · indexes {'ensured (--fix)' if fix else 'as-is'} · timings: cold = first run, warm p95 of 4 reruns, limit 50 (lists) / full aggregation (reports)", "",
          "| shape | collection | verdict | cold ms | warm p95 ms | keys examined | docs examined | plan stages |", "|---|---|---|---|---|---|---|---|"]
    md += [f"| {r[0]} | {r[1]} | {'**' + r[2] + '**' if r[2] != 'ok' else 'ok'} | {r[3]} | {r[4]} | {r[5]} | {r[6]} | {r[7]} |" for r in rows]
    md += ["", "## Read-model refresh cost", "- Project/customer summaries and dashboard KPIs are maintained by the Phase D/G outbox (per-entity deltas on payment/demand/booking events); nightly `read_model_flush` recomputes only projects touched since the last flush (`settings.read_models_v1`).",
           "- Report caches are TTL (5 s list page cache, ETag per response); no report precomputes over all rows.", "- Full-scan aggregations above are **report** shapes bounded by `maxTimeMS=20 s` (REPORT_MS) and an indexed `$match` prefix; grouping cost is O(matched rows), not O(all rows)."]
    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out, "w").write("\n".join(md))
    json.dump([dict(zip(("shape", "coll", "verdict", "cold_ms", "warm_p95_ms", "keys", "docs", "stages"), r)) for r in rows], open(out.replace(".md", ".json"), "w"), indent=1)
    print("\n".join(md[:4]))
    print(f"flagged {bad}/{len(rows)} → {out}")
    return bad


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--fix", action="store_true")
    ap.add_argument("--out", default="/app/memory/qa/scale/explain_report.md")
    a = ap.parse_args()
    sys.exit(1 if main(a.fix, a.out) else 0)
