"""Phase 3G database integrity audit (REQ-285…302). Strictly read-only.

    python -m tools.db_audit --db kkt_volume [--out /app/memory/qa/db_audit]

Every command sent to MongoDB passes an allow-list listener (find / aggregate without $out|$merge / count / explain /
listIndexes / collStats / dbHash …); anything else aborts the run. Per-collection count + dbHash fingerprint are taken
before and after; "read-only: verified" is printed only when every one is identical.
"""

import argparse
import json
import os
import re
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime

from pymongo import MongoClient, monitoring

READ_CMDS = {
    "find", "aggregate", "count", "countDocuments", "distinct", "getMore", "killCursors", "explain", "listIndexes",
    "listCollections", "collStats", "dbStats", "dbHash", "hello", "isMaster", "ismaster", "ping", "buildInfo",
    "serverStatus", "endSessions", "saslStart", "saslContinue", "getParameter", "replSetGetStatus", "connectionStatus",
}  # fmt: skip
SENT: Counter = Counter()


class ReadOnlyGuard(monitoring.CommandListener):
    def started(self, event):
        name = event.command_name
        SENT[name] += 1
        if os.environ.get("DB_AUDIT_TRACE"):
            print("cmd", name, str(event.command.get(name))[:60], file=sys.stderr, flush=True)
        if name not in READ_CMDS:
            os._exit(f"db_audit: refused non-read command {name}")  # type: ignore[arg-type]
        if name == "aggregate":
            for st in event.command.get("pipeline", []):
                if "$out" in st or "$merge" in st:
                    os._exit("db_audit: refused $out/$merge")  # type: ignore[arg-type]

    def succeeded(self, event):
        pass

    def failed(self, event):
        pass


LIVE = ["Active", "Completed"]
SAMPLE = 3000
ISO_TZ = re.compile(r"^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d\d:\d\d)$")
ISO_NAIVE = re.compile(r"^\d{4}-\d{2}-\d{2}T[\d:.]+$")
DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
FINDINGS: list[dict] = []


def finding(fid, sev, title, evidence, scenario="", fix="", status=""):
    FINDINGS.append(
        {"id": fid, "severity": sev, "title": title, "evidence": evidence, "scenario": scenario, "fix": fix, "status": status}
    )


def kind_of(v):
    if isinstance(v, bool):
        return "bool"
    if isinstance(v, int):
        return "int"
    if isinstance(v, float):
        return "float"
    if isinstance(v, str):
        if ISO_TZ.match(v):
            return "str:iso-tz"
        if ISO_NAIVE.match(v):
            return "str:iso-naive"
        if DAY.match(v):
            return "str:day"
        return "str"
    if isinstance(v, datetime):
        return "date"
    if v is None:
        return "null"
    return type(v).__name__


def flatten(d, p=""):
    for k, v in d.items():
        if k == "_id":
            continue
        if isinstance(v, dict) and v and len(v) <= 40:
            yield from flatten(v, p + k + ".")
        else:
            yield p + k, v


# ---------------------------------------------------------------- fingerprint + inventory
def fingerprint(db) -> dict:
    h = db.command("dbHash")["collections"]
    return {c: [db[c].estimated_document_count(), h.get(c)] for c in sorted(db.list_collection_names())}


def inventory(db) -> dict:
    infos = {i["name"]: i for i in db.list_collections()}
    out = {}
    for c in sorted(infos):
        if infos[c].get("type") == "view":
            continue
        st = db.command("collStats", c)
        n = st.get("count", 0)
        opts = infos[c].get("options", {})
        sample = list(db[c].find({}, limit=200))
        keys = Counter(k for d in sample for k, _ in flatten(d))
        out[c] = {
            "count": n,
            "size_mb": round(st.get("size", 0) / 1e6, 2),
            "storage_mb": round(st.get("storageSize", 0) / 1e6, 2),
            "indexes": st.get("nindexes", 0),
            "index_mb": round(st.get("totalIndexSize", 0) / 1e6, 2),
            "validator": bool(opts.get("validator")),
            "validation": f"{opts.get('validationLevel', '-')}/{opts.get('validationAction', '-')}" if opts.get("validator") else "-",
            "money_fields": sorted(k for k in keys if k.endswith("_paise"))[:30],
            "date_fields": sorted(k for k in keys if k.endswith(("_at", "_date", "_on")) or k in ("date", "at"))[:20],
            "company_id_pct": round(100 * db[c].count_documents({"company_id": {"$exists": True}}) / n, 1) if n else None,
        }
    return out


def shapes(db, inv) -> dict:
    out = {}
    for c, meta in inv.items():
        if not meta["count"]:
            continue
        docs = list(db[c].aggregate([{"$sample": {"size": SAMPLE}}])) if meta["count"] > SAMPLE else list(db[c].find({}))
        pres, kinds = Counter(), defaultdict(Counter)
        for d in docs:
            for k, v in flatten(d):
                pres[k] += 1
                kinds[k][kind_of(v)] += 1
        out[c] = {
            k: {"pct": round(100 * pres[k] / len(docs), 1), "types": dict(kinds[k])}
            for k in sorted(pres)
        }
    return out


def shape_findings(sh):
    money_bad, time_mixed = [], []
    for c, fields in sh.items():
        for f, m in fields.items():
            t = {k for k in m["types"] if k != "null"}
            if f.endswith("_paise") and t - {"int"} and not t <= {"list", "dict"}:
                money_bad.append(f"{c}.{f} {m['types']}")
            stry = {k for k in t if k.startswith("str:")}
            if len(stry) > 1 or (stry and ("date" in t)):
                time_mixed.append(f"{c}.{f} {m['types']}")
    if money_bad:
        finding("SHAPE-MONEY", "High", "Money fields stored with a non-integer type", money_bad[:40],
                "A float/str paise value breaks exact sums", "Coerce to int paise at write; repair", "")
    if time_mixed:
        finding("SHAPE-TIME", "Low", f"{len(time_mixed)} fields mix timestamp formats", time_mixed[:40],
                "Sorting/filtering by string compares mixed formats", "Normalise at write; one-off repair", "listed for Phase 3I")
    return {"money_non_int": money_bad, "time_mixed": time_mixed}


# ---------------------------------------------------------------- uniqueness
UNIQUE_KEYS = [
    ("booking number", "bookings", ["booking_number"], {}),
    ("receipt number", "payments", ["receipt_number"], {}),
    ("demand (bill) number", "demands", ["demand_number"], {}),
    ("waiver number", "waivers", ["waiver_number"], {}),
    ("credit-note number", "waivers", ["cn_number"], {"cn_number": {"$type": "string"}}),
    ("refund number", "refunds", ["refund_number"], {}),
    ("customer code", "customers", ["customer_code"], {}),
    ("user email", "users", ["email"], {}),
    ("ledger line booking + seq", "ledger_entries", ["booking_id", "seq"], {}),
    ("counter scope + key", "counters", ["scope", "key"], {}),
    ("flat per tower", "flats", ["block_id", "flat_number"], {}),
    ("parking slot per project", "parking_slots", ["project_id", "number"], {}),
    ("one live booking per flat", "bookings", ["flat_id"], {"status": {"$in": LIVE}}),
    ("one active instalment per booking + seq", "demands", ["booking_id", "installment_seq"], {"voided": False, "installment_seq": {"$type": "int"}}),
    ("one default active plan assignment per tower", "payment_plan_assignments", ["project_id", "block_id"], {"is_active": True, "is_default": True}),
    ("idempotency key per user", "idempotency_keys", ["user_id", "key"], {}),
    ("receipt idempotency key", "payments", ["idempotency_key"], {"idempotency_key": {"$type": "string"}}),
    ("active customer phone", "customers", ["company_id", "phone"], {"is_active": True}),
    ("generated document number", "generated_documents", ["number"], {"number": {"$type": "string"}}),
    ("project code per company", "projects", ["company_id", "code"], {}),
    ("tower code per project", "blocks", ["project_id", "code"], {}),
    ("lead number", "leads", ["lead_number"], {"lead_number": {"$type": "string"}}),
    ("read model per project", "project_summaries", ["project_id"], {}),
    ("read model per tower", "block_summaries", ["block_id"], {}),
    ("read model per customer", "customer_summaries", ["customer_id"], {}),
    ("trend bucket per scope + month", "monthly_buckets", ["company_id", "scope", "scope_id", "month"], {}),
]


def enforced(db, coll, fields, flt) -> str:
    for ix in db[coll].index_information().values():
        if not ix.get("unique"):
            continue
        if [k for k, _ in ix["key"]] != fields:
            continue
        pfe = ix.get("partialFilterExpression")
        return "yes" + (f" (partial {pfe})" if pfe else "")
    return "no"


def dups(db, coll, fields, flt, limit=5):
    match = {**flt, **{f: {"$exists": True, "$ne": None} for f in fields if f not in flt}}
    pipe = [
        {"$match": match},
        {"$group": {"_id": {f.replace(".", "_"): "$" + f for f in fields}, "n": {"$sum": 1}}},
        {"$match": {"n": {"$gt": 1}}},
    ]
    rows = list(db[coll].aggregate(pipe + [{"$sort": {"n": -1}}, {"$limit": 1000}], allowDiskUse=True))
    return len(rows), [r["_id"] for r in rows[:limit]]


def uniqueness(db, cols) -> list:
    out = []
    for label, coll, fields, flt in UNIQUE_KEYS:
        if coll not in cols:
            out.append({"key": label, "collection": coll, "fields": fields, "enforced": "n/a (no collection)", "duplicates": 0})
            continue
        n, ex = dups(db, coll, fields, flt)
        out.append({"key": label, "collection": coll, "fields": fields, "enforced": enforced(db, coll, fields, flt), "duplicates": n, "examples": ex})
    for c in cols:  # every `id` field must be unique
        if db[c].find_one({"id": {"$exists": True}}, {"_id": 1}) is None:
            continue
        n, ex = dups(db, c, ["id"], {})
        e = enforced(db, c, ["id"], {})
        if n or e == "no":
            out.append({"key": f"{c}.id", "collection": c, "fields": ["id"], "enforced": e, "duplicates": n, "examples": ex})
    return out


def uniqueness_findings(rows, db_name):
    for r in rows:
        if r["duplicates"]:
            finding(f"UNIQ-DUP-{r['collection']}-{'_'.join(r['fields'])}", "Critical",
                    f"{r['duplicates']} duplicate {r['key']} values", r.get("examples"), "Two records share one business key",
                    "Repair duplicates; add a unique index", "")
    money_keys = {"receipt number", "demand (bill) number", "waiver number", "credit-note number", "refund number",
                  "ledger line booking + seq", "one live booking per flat", "booking number"}
    miss = [r["key"] for r in rows if r["enforced"] == "no" and r["key"] in money_keys]
    if miss:
        finding("UNIQ-NOT-ENFORCED", "High", "Money business keys not enforced by the database: " + ", ".join(miss),
                {"db": db_name, "keys": miss},
                "A race or retry can write a second record with the same number (only application code prevents it)",
                "Unique (partial where needed) indexes, created safely at startup (skip + System Health on duplicates)", "")
    other = [f"{r['collection']}.{'+'.join(r['fields'])}" for r in rows if r["enforced"] == "no" and r["key"] not in money_keys]
    if other:
        finding("UNIQ-OTHER", "Medium", f"{len(other)} other keys not DB-enforced (0 duplicates today)", other,
                "Same-key rows possible under a race", "Unique indexes", "listed for Phase 3I")


# ---------------------------------------------------------------- references
def idset(db, coll, f="id", flt=None):
    return {d.get(f) for d in db[coll].find(flt or {}, {f: 1, "_id": 0})} if coll in db.list_collection_names() else set()


def references(db) -> dict:
    ids = {c: idset(db, c) for c in ("bookings", "customers", "flats", "projects", "blocks", "demands", "payments",
                                      "users", "payment_plans", "leads", "waivers", "refunds")}  # fmt: skip
    lines = {}
    for b in db.bookings.find({}, {"_id": 0, "id": 1, "other_charges.line_id": 1, "pricing.charges.line_id": 1}):
        s = {x.get("line_id") for x in b.get("other_charges") or []} | {x.get("line_id") for x in (b.get("pricing") or {}).get("charges") or []}
        lines[b["id"]] = s
    receipts = idset(db, "payments", "receipt_number")
    demand_nos = idset(db, "demands", "demand_number")
    cns = idset(db, "waivers", "cn_number")
    refund_nos = idset(db, "refunds", "refund_number")
    out, broken_ex = {}, {}

    def path(name, coll, field, target, flt=None, array=None):
        if coll not in db.list_collection_names():
            return
        bad = tot = 0
        ex = []
        proj = {"_id": 0, "id": 1, "booking_id": 1, (array or field.split(".")[0]): 1}
        for d in db[coll].find(flt or {}, proj):
            vals = []
            if array:
                for it in d.get(array) or []:
                    if isinstance(it, dict) and it.get(field) is not None:
                        vals.append(it[field])
            else:
                v = d
                for part in field.split("."):
                    v = v.get(part) if isinstance(v, dict) else None
                vals = v if isinstance(v, list) else ([v] if v is not None else [])
            for v in vals:
                tot += 1
                ok = target(d, v) if callable(target) else v in target
                if not ok:
                    bad += 1
                    if len(ex) < 5:
                        ex.append({"doc": d.get("id"), "value": v})
        out[name] = f"{bad}/{tot}"
        if bad:
            broken_ex[name] = ex

    path("bookings.customer_id→customers", "bookings", "customer_id", ids["customers"])
    path("bookings.flat_id→flats", "bookings", "flat_id", ids["flats"])
    path("bookings.project_id→projects", "bookings", "project_id", ids["projects"])
    path("bookings.block_id→blocks", "bookings", "block_id", ids["blocks"])
    path("bookings.payment_plan_id→payment_plans", "bookings", "payment_plan_id", ids["payment_plans"])
    path("bookings.co_applicant_customer_ids→customers", "bookings", "co_applicant_customer_ids", ids["customers"])
    path("payments.booking_id→bookings", "payments", "booking_id", ids["bookings"])
    path("payments.customer_id→customers", "payments", "customer_id", ids["customers"])
    path("payments.allocations[].demand_id→demands", "payments", "demand_id", ids["demands"], array="allocations")
    path("payments.allocations[].line_id→booking charge line", "payments", "line_id",
         lambda d, v: v in lines.get(d.get("booking_id"), set()), array="allocations")
    path("payments.other_charge_line_id→booking charge line", "payments", "other_charge_line_id",
         lambda d, v: v in lines.get(d.get("booking_id"), set()), {"other_charge_line_id": {"$type": "string"}})
    path("demands.booking_id→bookings", "demands", "booking_id", ids["bookings"])
    path("demands.customer_id→customers", "demands", "customer_id", ids["customers"])
    path("ledger_entries.booking_id→bookings", "ledger_entries", "booking_id", ids["bookings"])
    path("ledger_entries.ref(receipt)→payments", "ledger_entries", "ref", receipts | demand_nos | cns | refund_nos,
         {"ref": {"$type": "string"}})
    path("waivers.booking_id→bookings", "waivers", "booking_id", ids["bookings"])
    path("waivers.target.line_id→booking charge line", "waivers", "target.line_id",
         lambda d, v: v in lines.get(d.get("booking_id"), set()))
    path("waivers.entries[].line_id→booking charge line", "waivers", "line_id",
         lambda d, v: v in lines.get(d.get("booking_id"), set()), array="entries")
    path("refunds.booking_id→bookings", "refunds", "booking_id", ids["bookings"])
    path("refunds.customer_id→customers", "refunds", "customer_id", ids["customers"])
    path("flats.project_id→projects", "flats", "project_id", ids["projects"])
    path("flats.block_id→blocks", "flats", "block_id", ids["blocks"])
    path("flats.booking_id→bookings", "flats", "booking_id", ids["bookings"])
    path("blocks.project_id→projects", "blocks", "project_id", ids["projects"])
    path("parking_slots.booking_id→bookings", "parking_slots", "booking_id", ids["bookings"])
    path("parking_slots.flat_id→flats", "parking_slots", "flat_id", ids["flats"])
    path("customer_merges.survivor_id→customers", "customer_merges", "survivor_id", ids["customers"])
    path("customer_merges.merged_id→customers", "customer_merges", "merged_id", ids["customers"])
    path("customer_summaries.customer_id→customers", "customer_summaries", "customer_id", ids["customers"])
    path("project_summaries.project_id→projects", "project_summaries", "project_id", ids["projects"])
    path("block_summaries.block_id→blocks", "block_summaries", "block_id", ids["blocks"])
    path("monthly_buckets.scope_id(project)→projects", "monthly_buckets", "scope_id", ids["projects"], {"scope": "project"})
    path("monthly_buckets.scope_id(customer)→customers", "monthly_buckets", "scope_id", ids["customers"], {"scope": "customer"})
    path("leads.customer_id→customers", "leads", "customer_id", ids["customers"])
    path("site_visits.lead_id→leads", "site_visits", "lead_id", ids["leads"])
    path("generated_documents.booking_id→bookings", "generated_documents", "booking_id", ids["bookings"])
    path("documents.booking_id→bookings", "documents", "booking_id", ids["bookings"])
    path("notifications.user_id→users", "notifications", "user_id", ids["users"])
    path("payment_plan_assignments.payment_plan_id→payment_plans", "payment_plan_assignments", "payment_plan_id", ids["payment_plans"])
    money_paths = {k for k in out if k.split(".")[0] in ("payments", "demands", "ledger_entries", "waivers", "refunds")}
    for k, v in out.items():
        if v.split("/")[0] != "0":
            sev = "Critical" if k in money_paths else "Medium"
            finding(f"REF-{k.split('→')[0]}", sev, f"Broken reference {k}: {v}", broken_ex.get(k),
                    "A record points at something that does not exist", "Investigate ids; repair or document", "")
    return {"paths": out, "examples": broken_ex}


# ---------------------------------------------------------------- money recomputation
def money(db) -> dict:
    res = Counter()
    ex = defaultdict(list)

    def bad(name, eid, detail=None):
        res[name] += 1
        if len(ex[name]) < 5:
            ex[name].append({"id": eid, **(detail or {})})

    bookings = {b["id"]: b for b in db.bookings.find({}, {"_id": 0, "id": 1, "status": 1, "agreement_value_paise": 1,
                "cash_agreed_paise": 1, "account_agreed_paise": 1, "summary": 1, "customer_id": 1, "project_id": 1,
                "block_id": 1, "cancellation": 1, "booking_number": 1, "other_charges": 1})}  # fmt: skip
    res["bookings_checked"] = len(bookings)
    for b in bookings.values():
        if (b.get("cash_agreed_paise") or 0) + (b.get("account_agreed_paise") or 0) != (b.get("agreement_value_paise") or 0):
            bad("cash+account != agreement", b["id"], {"bk": b.get("booking_number")})
        for oc in b.get("other_charges") or []:
            if (oc.get("paid_paise") or 0) > (oc.get("demanded_paise") or 0) + 0:
                bad("charge line paid > demanded", b["id"], {"line": oc.get("line_id")})
            if any((oc.get(k) or 0) < 0 for k in ("demanded_paise", "paid_paise", "amount_paise", "waived_paise")):
                bad("negative charge-line figure", b["id"], {"line": oc.get("line_id")})
    # receipts
    received = defaultdict(int)
    for p in db.payments.find({}, {"_id": 0, "id": 1, "amount_paise": 1, "allocations": 1, "status": 1, "booking_id": 1,
                                   "cleared_at": 1, "bounced_at": 1, "reversal": 1, "payment_date": 1}):  # fmt: skip
        res["receipts_checked"] += 1
        a = p.get("amount_paise")
        if not isinstance(a, int) or a <= 0:
            bad("receipt amount not a positive int", p["id"])
        if p.get("allocations"):
            if sum(x.get("amount_paise") or 0 for x in p["allocations"]) != a:
                bad("receipt != Σ allocations", p["id"])
            if any((x.get("amount_paise") or 0) <= 0 for x in p["allocations"]):
                bad("allocation <= 0", p["id"])
        if p.get("status") == "Cleared":
            received[p.get("booking_id")] += a or 0
            if not p.get("cleared_at"):
                bad("Cleared without cleared_at", p["id"])
        if p.get("status") == "Bounced" and not p.get("bounced_at"):
            bad("Bounced without bounced_at", p["id"])
        if p.get("status") == "Reversed" and not p.get("reversal"):
            bad("Reversed without reversal record", p["id"])
    # demands
    alloc_to = defaultdict(int)
    for p in db.payments.find({"status": "Cleared", "allocations.demand_id": {"$exists": True}}, {"_id": 0, "allocations": 1}):
        for x in p["allocations"]:
            if x.get("demand_id"):
                alloc_to[x["demand_id"]] += x.get("amount_paise") or 0
    for d in db.demands.find({}, {"_id": 0}):
        res["bills_checked"] += 1
        tot, paid = d.get("total_demand_paise") or 0, d.get("paid_paise") or 0
        if paid > tot:
            bad("bill paid > bill", d["id"], {"no": d.get("demand_number")})
        if (d.get("cash_demand_paise") or 0) + (d.get("account_demand_paise") or 0) != tot:
            bad("bill cash+account != total", d["id"])
        pp = d.get("paid_parts")
        if pp:
            if pp["cash_paid_paise"] + pp["cash_open_paise"] != d.get("cash_demand_paise") or \
               pp["account_paid_paise"] + pp["account_open_paise"] != d.get("account_demand_paise"):
                bad("paid_parts do not add up to the bill", d["id"])
            if pp["cash_paid_paise"] + pp["account_paid_paise"] != paid:
                bad("paid_parts != paid", d["id"])
        if d.get("voided") and alloc_to.get(d["id"]):
            bad("voided bill carries cleared allocations", d["id"])
        if tot < 0 or paid < 0:
            bad("negative bill figure", d["id"])
    # ledger
    last = {}
    seqs = defaultdict(list)
    sums = defaultdict(lambda: [0, 0])
    prev_bal = {}
    for e in db.ledger_entries.find({}, {"_id": 0, "booking_id": 1, "seq": 1, "udhar_paise": 1, "jama_paise": 1,
                                         "balance_paise": 1}).sort([("booking_id", 1), ("seq", 1)]):  # fmt: skip
        bid = e["booking_id"]
        seqs[bid].append(e.get("seq"))
        u, j = e.get("udhar_paise") or 0, e.get("jama_paise") or 0
        sums[bid][0] += u
        sums[bid][1] += j
        exp = prev_bal.get(bid, 0) + u - j
        if e.get("balance_paise") is not None and e["balance_paise"] != exp:
            bad("ledger running balance != recomputed", bid, {"seq": e.get("seq")})
        prev_bal[bid] = e.get("balance_paise", exp)
        last[bid] = e
    res["ledger_bookings_checked"] = len(seqs)
    for bid, s in seqs.items():
        if s != list(range(1, len(s) + 1)) and s != list(range(len(s))):
            bad("ledger seq not unique/gap-free", bid, {"n": len(s), "distinct": len(set(s))})
        b = bookings.get(bid)
        sm = (b or {}).get("summary") or {}
        if b and sm:
            if sums[bid][0] - sums[bid][1] != sm.get("balance_paise"):
                bad("Σ Udhar − Σ Jama != booking balance", bid, {"bk": b.get("booking_number")})
            if sm.get("balance_paise") != sm.get("outstanding_paise", 0) - sm.get("advance_paise", 0):
                bad("balance != outstanding − advance", bid, {"bk": b.get("booking_number")})
    for bid, b in bookings.items():
        if b.get("summary") and bid not in seqs and (b["summary"].get("total_udhar_paise") or 0):
            bad("booking with ledger figures but no ledger lines", bid)
    # waivers / refunds
    for w in db.waivers.find({}, {"_id": 0}):
        res["waivers_checked"] += 1
        if (w.get("amount_paise") or 0) <= 0:
            bad("waiver amount <= 0", w["id"])
        if w.get("status") == "Approved":
            if not w.get("cn_number"):
                bad("approved waiver without credit note", w["id"])
            if sum(x.get("amount_paise") or 0 for x in w.get("entries") or []) != w.get("amount_paise"):
                bad("waiver entries != amount", w["id"])
    for r in db.refunds.find({}, {"_id": 0}):
        res["refunds_checked"] += 1
        if (r.get("amount_paise") or 0) < 0:
            bad("negative refund", r["id"])
        if (r.get("amount_paise") or 0) > (r.get("received_paise") or 0):
            bad("refund > money received", r["id"], {"no": r.get("refund_number")})
    # read models
    live = [b for b in bookings.values() if b.get("status") in LIVE and b.get("summary")]
    by = {"customer_id": defaultdict(lambda: Counter()), "project_id": defaultdict(lambda: Counter()), "block_id": defaultdict(lambda: Counter())}
    for b in live:
        for k in by:
            by[k][b.get(k)]["outstanding"] += b["summary"].get("outstanding_paise") or 0
            by[k][b.get(k)]["bookings"] += 1
    for coll, key in (("customer_summaries", "customer_id"), ("project_summaries", "project_id"), ("block_summaries", "block_id")):
        n = 0
        for s in db[coll].find({}, {"_id": 0, key: 1, "outstanding": 1, "bookings": 1, "computed_at": 1}):
            n += 1
            want = by[key].get(s[key], Counter())
            got = (s.get("outstanding") or {}).get("total_paise") or 0
            if got != want["outstanding"]:
                bad(f"{coll}.outstanding != Σ live booking outstanding", s[key], {"stored": got, "recomputed": want["outstanding"]})
        res[f"{coll}_checked"] = n
    snap = db.dashboard_snapshots.find_one({"scope_hash": {"$exists": True}}, {"_id": 0, "payload.totals": 1, "company_id": 1, "scope": 1, "scope_hash": 1},
                                           sort=[("computed_at", -1)])
    if snap:
        tot = sum(b["summary"].get("outstanding_paise") or 0 for b in live)
        got = ((snap.get("payload") or {}).get("totals") or {}).get("outstanding_paise")
        res["dashboard_outstanding_stored"], res["dashboard_outstanding_recomputed"] = got, tot
        if got is not None and got != tot and not snap.get("scope"):
            bad("dashboard_snapshots total outstanding != Σ live bookings", snap.get("scope_hash"), {"stored": got, "recomputed": tot})
    mb = list(db.monthly_buckets.aggregate([{"$match": {"scope": "company"}}, {"$group": {"_id": None, "c": {"$sum": "$collections"}, "b": {"$sum": "$bookings"}}}]))
    if mb:
        res["monthly_buckets_company_bookings"] = mb[0]["b"]
        res["bookings_total_nonloadtest"] = db.bookings.count_documents({"load_test": {"$ne": True}})
    issues = {k: v for k, v in res.items() if not k.endswith(("_checked", "_stored", "_recomputed")) and k not in
              ("monthly_buckets_company_bookings", "bookings_total_nonloadtest")}  # fmt: skip
    for k, v in issues.items():
        finding(f"MONEY-{re.sub(r'[^A-Za-z]+', '-', k)[:40]}", "Critical", f"{v} × {k}", ex.get(k),
                "A stored money figure disagrees with its source records", "Investigate; rebuild via audited path", "")
    return {"counts": dict(res), "examples": dict(ex)}


# ---------------------------------------------------------------- record states + time
def states(db) -> dict:
    res = Counter()
    ex = defaultdict(list)

    def bad(name, eid):
        res[name] += 1
        if len(ex[name]) < 5:
            ex[name].append(eid)

    live_by_flat = defaultdict(list)
    for b in db.bookings.find({}, {"_id": 0, "id": 1, "flat_id": 1, "status": 1, "booking_date": 1, "cancellation": 1, "customer_id": 1}):
        if b.get("status") in LIVE:
            live_by_flat[b.get("flat_id")].append(b["id"])
        if b.get("status") == "Cancelled" and not b.get("cancellation"):
            bad("Cancelled booking without cancellation record", b["id"])
    for f in db.flats.find({}, {"_id": 0, "id": 1, "status": 1, "booking_id": 1, "hold": 1}):
        has = f["id"] in live_by_flat
        if has and f.get("status") not in ("Booked", "Sold"):
            bad("live booking but flat not Booked/Sold", f["id"])
        if not has and f.get("status") in ("Booked", "Sold"):
            bad("flat Booked/Sold without live booking", f["id"])
        if f.get("status") == "Hold" and not (f.get("hold") or {}).get("expires_at"):
            bad("Hold without expiry", f["id"])
        if has and f.get("booking_id") and f["booking_id"] not in live_by_flat[f["id"]]:
            bad("flat.booking_id is not its live booking", f["id"])
    cancelled = idset(db, "bookings", "id", {"status": "Cancelled"})
    for d in db.demands.find({"booking_id": {"$in": list(cancelled)}, "status": {"$in": ["Open", "Partially Paid"]}, "voided": {"$ne": True}}, {"_id": 0, "id": 1}):
        bad("open bill on a cancelled booking", d["id"])
    for p in db.payments.find({"booking_id": {"$in": list(cancelled)}, "status": "Pending"}, {"_id": 0, "id": 1}):
        bad("cheque pending on a cancelled booking", p["id"])
    refunded = idset(db, "refunds", "booking_id")
    for bid in cancelled - refunded:
        b = db.bookings.find_one({"id": bid}, {"_id": 0, "cancellation": 1})
        if ((b or {}).get("cancellation") or {}).get("received_paise"):
            bad("cancelled booking with money received but no refund/forfeit record", bid)
    merged = idset(db, "customers", "id", {"merged_into": {"$exists": True, "$ne": None}})
    for b in db.bookings.find({"customer_id": {"$in": list(merged)}, "status": {"$in": LIVE}}, {"_id": 0, "id": 1}):
        bad("merged customer still owns a live booking", b["id"])
    for p in db.payments.find({"status": "Cleared", "cleared_at": {"$exists": True}}, {"_id": 0, "id": 1, "cleared_at": 1, "payment_date": 1, "bounced_at": 1}):
        if p.get("bounced_at"):
            bad("Cleared receipt carries bounced_at", p["id"])
    for k, v in res.items():
        finding(f"STATE-{re.sub(r'[^A-Za-z]+', '-', k)[:40]}", "High", f"{v} × {k}", ex.get(k),
                "Two records disagree on the state of the same thing", "Investigate and repair through audited path", "")
    return {"counts": dict(res), "examples": dict(ex)}


def chronology(db) -> dict:
    res = Counter()
    ex = defaultdict(list)
    bdate = {b["id"]: (b.get("booking_date") or "")[:10] for b in db.bookings.find({}, {"_id": 0, "id": 1, "booking_date": 1})}
    canc = {b["id"]: (b.get("cancellation") or {}).get("at") for b in db.bookings.find({"status": "Cancelled"}, {"_id": 0, "id": 1, "cancellation.at": 1})}

    def bad(name, eid):
        res[name] += 1
        if len(ex[name]) < 5:
            ex[name].append(eid)

    for d in db.demands.find({}, {"_id": 0, "id": 1, "booking_id": 1, "demand_date": 1, "due_date": 1}):
        bd = bdate.get(d["booking_id"])
        if bd and (d.get("demand_date") or "9")[:10] < bd:
            bad("bill dated before its booking", d["id"])
        if d.get("due_date") and d.get("demand_date") and d["due_date"][:10] < d["demand_date"][:10]:
            bad("bill due before it was raised", d["id"])
    for p in db.payments.find({}, {"_id": 0, "id": 1, "payment_date": 1, "cleared_at": 1, "bounced_at": 1, "status": 1}):
        pd = (p.get("payment_date") or "")[:10]
        if p.get("cleared_at") and p["cleared_at"][:10] < pd and p.get("status") == "Cleared":
            # cleared_at is UTC; IST date may be a day later — allow 1 day
            if p["cleared_at"][:10] < pd[:8] + "00":
                bad("cheque cleared before its date", p["id"])
    for r in db.refunds.find({}, {"_id": 0, "id": 1, "booking_id": 1, "created_at": 1}):
        c = canc.get(r["booking_id"])
        if c and r.get("created_at") and r["created_at"] < c[:19]:
            bad("refund before cancellation", r["id"])
    for k, v in res.items():
        finding(f"TIME-{re.sub(r'[^A-Za-z]+', '-', k)[:40]}", "Medium", f"{v} × {k}", ex.get(k), "Dates out of order", "Investigate", "")
    return {"counts": dict(res), "examples": dict(ex)}


# ---------------------------------------------------------------- indexes, explain, growth
HOT_QUERIES = [
    ("Home/dashboard live bookings", "bookings", {"company_id": "$C", "status": {"$in": LIVE}}, None),
    ("Booking page bills", "demands", {"booking_id": "$B", "voided": False}, [("installment_seq", 1)]),
    ("Booking page receipts", "payments", {"booking_id": "$B"}, [("payment_date", -1)]),
    ("Booking page ledger", "ledger_entries", {"booking_id": "$B"}, [("seq", 1)]),
    ("Customer 360 bookings", "bookings", {"customer_id": "$U"}, [("booking_date", -1)]),
    ("Customer 360 receipts", "payments", {"customer_id": "$U"}, None),
    ("Bills raised list (open)", "demands", {"company_id": "$C", "voided": False, "status": {"$in": ["Open", "Partially Paid"]}}, [("due_date", 1)]),
    ("Payments list", "payments", {"company_id": "$C", "status": "Cleared"}, [("payment_date", -1), ("id", 1)]),
    ("Cheques in hand", "payments", {"company_id": "$C", "status": "Pending"}, None),
    ("Collections FY", "payments", {"company_id": "$C", "status": {"$in": ["Cleared", "Reversed"]}, "payment_date": {"$gte": "2026-04-01", "$lte": "2027-03-31"}}, None),
    ("Refunds paid in period", "refunds", {"company_id": "$C", "paid_date": {"$gte": "2026-04-01"}}, None),
    ("Waivers of a booking", "waivers", {"booking_id": "$B"}, None),
    ("Waivers pending (approvals)", "waivers", {"company_id": "$C", "status": "Pending"}, None),
    ("Credit note lookup", "waivers", {"cn_number": "$CN"}, None),
    ("Refund by number", "refunds", {"refund_number": "$RN"}, None),
    ("Generated documents of a booking", "generated_documents", {"booking_id": "$B"}, None),
    ("Doc verification by code", "doc_verifications", {"code": "$X"}, None),
    ("Job runs latest per job", "job_runs", {"job": "DEMO_REFRESH"}, [("started_at", -1)]),
    ("Customer merges of a customer", "customer_merges", {"survivor_id": "$U"}, None),
    ("Audit trail of a booking", "audit_logs", {"entity_type": "booking", "entity_id": "$B"}, [("created_at", -1)]),
    ("Outbox unpropagated", "audit_logs", {"propagated_complete": False}, [("created_at", 1)]),
    ("Tower stage bills", "demands", {"block_id": "$K", "milestone_seq": 3}, None),
    ("Flats of a tower", "flats", {"block_id": "$K", "is_active": True}, [("floor", 1), ("position", 1)]),
    ("Holds to expire", "flats", {"status": "Hold", "hold.expires_at": {"$lt": "2099"}}, None),
    ("Notifications unread", "notifications", {"user_id": "$US", "read": False}, [("created_at", -1)]),
    ("Login events recent", "login_events", {"email": "x@y"}, [("created_at", -1)]),
    ("Other-charge parts due", "bookings", {"company_id": "$C", "other_charges.demand_history.due_on": {"$lte": "2026-12-31"}}, None),
    ("Monthly buckets company", "monthly_buckets", {"company_id": "$C", "scope": "company"}, None),
]


def explain_hot(db) -> list:
    b = db.bookings.find_one({"status": "Active"}, {"_id": 0, "id": 1, "customer_id": 1, "company_id": 1, "block_id": 1}) or {}
    w = db.waivers.find_one({"cn_number": {"$type": "string"}}, {"_id": 0, "cn_number": 1}) or {}
    r = db.refunds.find_one({}, {"_id": 0, "refund_number": 1}) or {}
    u = db.users.find_one({}, {"_id": 0, "id": 1}) or {}
    subs = {"$C": b.get("company_id"), "$B": b.get("id"), "$U": b.get("customer_id"), "$K": b.get("block_id"),
            "$CN": w.get("cn_number"), "$RN": r.get("refund_number"), "$US": u.get("id"), "$X": "nope"}  # fmt: skip

    def sub(x):
        if isinstance(x, dict):
            return {k: sub(v) for k, v in x.items()}
        if isinstance(x, list):
            return [sub(v) for v in x]
        return subs.get(x, x) if isinstance(x, str) else x

    out = []
    for name, coll, q, sort in HOT_QUERIES:
        if coll not in db.list_collection_names():
            continue
        cmd = {"find": coll, "filter": sub(q)}
        if sort:
            cmd["sort"] = dict(sort)
        ex = db.command("explain", cmd, verbosity="executionStats")
        es = ex["executionStats"]
        plan = json.dumps(ex["queryPlanner"]["winningPlan"])
        stages = re.findall(r'"stage": "([A-Z_]+)"', plan)
        ixn = re.findall(r'"indexName": "([^"]+)"', plan)
        ret = es["nReturned"]
        exd = es["totalDocsExamined"]
        out.append({"query": name, "collection": coll, "stages": "/".join(dict.fromkeys(stages)), "index": ",".join(ixn) or "-",
                    "returned": ret, "docs_examined": exd, "keys_examined": es["totalKeysExamined"],
                    "ms": es["executionTimeMillis"], "collscan": "COLLSCAN" in stages, "in_memory_sort": "SORT" in stages,
                    "ratio": round(exd / max(ret, 1), 1)})
    return out


def index_review(db, inv) -> dict:
    unused, prefix, per = [], [], {}
    for c in inv:
        ixs = db[c].index_information()
        per[c] = len(ixs)
        try:
            stats = {s["name"]: s["accesses"]["ops"] for s in db[c].aggregate([{"$indexStats": {}}])}
        except Exception:  # noqa: BLE001
            stats = {}
        for name, ix in ixs.items():
            if name != "_id_" and stats.get(name) == 0 and not ix.get("unique") and "expireAfterSeconds" not in ix:
                unused.append(f"{c}.{name}")
        keys = {n: [tuple(k) for k in ix["key"]] for n, ix in ixs.items()}
        for a, ka in keys.items():
            ia = ixs[a]
            if a == "_id_" or ia.get("unique") or ia.get("partialFilterExpression") or "expireAfterSeconds" in ia:
                continue
            if any("text" in str(v) for _, v in ka):
                continue
            for bname, kb in keys.items():
                if bname != a and len(kb) > len(ka) and kb[: len(ka)] == ka and not ixs[bname].get("partialFilterExpression"):
                    prefix.append(f"{c}.{a} ⊂ {bname}")
                    break
    return {"per_collection": per, "unused_since_restart": unused, "prefix_duplicates": prefix}


TIME_BASED = {"audit_logs", "audit_logs_archive", "login_events", "job_runs", "notifications", "messages", "served_hosts",
              "doc_verifications", "generated_documents", "monthly_buckets", "files", "uploads", "communications"}  # fmt: skip


def growth(db, inv) -> list:
    nb = max(db.bookings.estimated_document_count(), 1)
    out = []
    for c, m in inv.items():
        n = m["count"]
        if not n:
            continue
        first = db[c].find_one({"created_at": {"$type": "string"}}, {"created_at": 1}, sort=[("created_at", 1)])
        last = db[c].find_one({"created_at": {"$type": "string"}}, {"created_at": 1}, sort=[("created_at", -1)])
        days = None
        if first and last:
            try:
                days = max((datetime.fromisoformat(last["created_at"][:19]) - datetime.fromisoformat(first["created_at"][:19])).days, 1)
            except ValueError:
                days = None
        per_b = n / nb
        avg = (m["size_mb"] * 1e6 / n) if n else 0
        # booking-driven rows scale with bookings; activity rows (audit, logins, jobs) also scale with days × activity
        f1500 = per_b * 1500
        f10k = per_b * 10000
        if c in TIME_BASED and days:
            per_day_per_booking = n / days / nb
            f1500 = per_day_per_booking * 1500 * 1825
            f10k = per_day_per_booking * 10000 * 1825
        out.append({"collection": c, "rows": n, "rows_per_booking": round(per_b, 2), "span_days": days,
                    "avg_doc_bytes": int(avg), "rows_5y_1500": int(f1500), "rows_5y_10000": int(f10k),
                    "mb_5y_10000": round(f10k * avg / 1e6, 1)})
    return sorted(out, key=lambda r: -r["rows_5y_10000"])


# ---------------------------------------------------------------- runner
def run(db_name: str, out_dir: str, url: str) -> dict:
    client = MongoClient(url, event_listeners=[ReadOnlyGuard()])
    db = client[db_name]
    t0 = time.time()
    before = fingerprint(db)
    hello = client.admin.command("hello")
    build = client.admin.command("buildInfo")["version"]
    inv = inventory(db)
    cols = list(inv)
    sh = shapes(db, inv)
    shf = shape_findings(sh)
    un = uniqueness(db, cols)
    uniqueness_findings(un, db_name)
    refs = references(db)
    mon = money(db)
    st = states(db)
    ch = chronology(db)
    ex = explain_hot(db)
    ix = index_review(db, inv)
    gr = growth(db, inv)
    for e in ex:
        if e["collscan"] and inv.get(e["collection"], {}).get("count", 0) > 1000:
            finding(f"IDX-COLLSCAN-{e['collection']}-{e['query'][:20]}", "Medium", f"COLLSCAN: {e['query']} ({e['docs_examined']} docs examined)",
                    e, "Grows linearly with history kept forever", "Add index", "listed for Phase 3I")
        elif e["ratio"] > 10 and e["docs_examined"] > 1000:
            finding(f"IDX-RATIO-{e['collection']}-{e['query'][:20]}", "Medium", f"examined/returned {e['ratio']}: {e['query']}", e,
                    "Index does not cover the filter", "Better compound index", "listed for Phase 3I")
    after = fingerprint(db)
    changed = [c for c in set(before) | set(after) if before.get(c) != after.get(c)]
    writes = {k: v for k, v in SENT.items() if k not in READ_CMDS}
    ro = not changed and not writes
    report = {
        "db": db_name, "mongo_version": build, "topology": "replica set " + hello["setName"] if hello.get("setName") else "standalone",
        "transactions_available": bool(hello.get("setName")), "ran_at": datetime.now().isoformat(timespec="seconds"),
        "seconds": round(time.time() - t0, 1), "read_only": {"verified": ro, "changed": changed, "commands_sent": dict(SENT)},
        "fingerprint_before": before, "fingerprint_after": after, "inventory": inv, "shape_findings": shf, "shapes": sh,
        "uniqueness": un, "references": refs, "money": mon, "states": st, "chronology": ch, "explain": ex, "indexes": ix,
        "growth": gr, "findings": FINDINGS,
        "severity_counts": dict(Counter(f["severity"] for f in FINDINGS)),
    }  # fmt: skip
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, f"{db_name}.json"), "w") as fh:
        json.dump(report, fh, indent=1, default=str)
    print(f"{db_name}: {len(inv)} collections, {report['seconds']} s, findings {report['severity_counts']}")
    for f in FINDINGS:
        print(f"  [{f['severity']}] {f['id']}: {f['title']}")
    print("read-only: verified" if ro else f"read-only: NOT verified (changed: {changed}, writes: {writes})")
    return report


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("--out", default="/app/memory/qa/db_audit")
    ap.add_argument("--url", default=os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
    a = ap.parse_args()
    if "billpe" in a.url:
        sys.exit("refusing production")
    r = run(a.db, a.out, a.url)
    sys.exit(0 if r["read_only"]["verified"] else 2)


if __name__ == "__main__":
    main()
