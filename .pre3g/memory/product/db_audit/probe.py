# Read-only integrity probe for the PREVIEW database (test_database). Prints counts only — no personal data.
# Never run against production. Uses only find/aggregate/count/list_indexes.
import asyncio, os, json, re
from collections import Counter
from motor.motor_asyncio import AsyncIOMotorClient

URL = "mongodb://localhost:27017"
DBN = "test_database"

def money_keys(doc, prefix=""):
    out = []
    for k, v in (doc or {}).items():
        if isinstance(v, dict):
            out += money_keys(v, prefix + k + ".")
        elif k.endswith("_paise") or k in ("amount", "paise"):
            out.append((prefix + k, v))
    return out

async def main():
    db = AsyncIOMotorClient(URL)[DBN]
    res = {}
    cols = sorted(await db.list_collection_names())
    res["collections"] = len(cols)
    sizes = {}
    for c in cols:
        sizes[c] = await db[c].estimated_document_count()
    res["sizes_top"] = dict(sorted(sizes.items(), key=lambda x: -x[1])[:45])

    # indexes: which collections have unique indexes, and on what
    uniq = {}
    noidx = []
    for c in cols:
        idx = await db[c].index_information()
        u = [ (v.get("key"), v.get("partialFilterExpression")) for k, v in idx.items() if v.get("unique")]
        if u: uniq[c] = [str(x[0]) + (" partial" if x[1] else "") for x in u]
        if len(idx) <= 1 and sizes[c] > 200: noidx.append((c, sizes[c]))
    res["unique_indexes"] = uniq
    res["large_collections_with_only__id_index"] = noidx

    # validators ($jsonSchema)
    infos = await db.command("listCollections")
    res["collections_with_validator"] = [i["name"] for i in infos["cursor"]["firstBatch"] if i.get("options", {}).get("validator")]

    async def dup(col, field, flt=None):
        if col not in cols: return None
        pipe = [{"$match": {**(flt or {}), field: {"$exists": True, "$ne": None}}},
                {"$group": {"_id": "$" + field, "n": {"$sum": 1}}}, {"$match": {"n": {"$gt": 1}}}, {"$count": "dups"}]
        r = await db[col].aggregate(pipe).to_list(1)
        return r[0]["dups"] if r else 0

    d = {}
    d["bookings.booking_number"] = await dup("bookings", "booking_number")
    d["bookings.id"] = await dup("bookings", "id")
    d["payments.receipt_number"] = await dup("payments", "receipt_number")
    d["payments.receipt_no"] = await dup("payments", "receipt_no")
    d["payments.id"] = await dup("payments", "id")
    d["customers.code"] = await dup("customers", "code")
    d["customers.customer_code"] = await dup("customers", "customer_code")
    d["customers.id"] = await dup("customers", "id")
    d["customers.phone(active)"] = await dup("customers", "phone", {"is_active": {"$ne": False}, "merged_into": {"$in": [None]}})
    d["flats.id"] = await dup("flats", "id")
    d["demands.id"] = await dup("demands", "id")
    d["demands.demand_number"] = await dup("demands", "demand_number")
    d["waivers.wv_number"] = await dup("waivers", "wv_number")
    d["waivers.cn_number"] = await dup("waivers", "cn_number")
    d["ledger_entries.id"] = await dup("ledger_entries", "id")
    d["users.email"] = await dup("users", "email")
    d["refunds.id"] = await dup("refunds", "id")
    res["duplicates"] = d

    # live bookings per flat (should be <= 1)
    if "bookings" in cols:
        live = {"status": {"$nin": ["Cancelled", "Transferred", "cancelled", "transferred"]}}
        r = await db.bookings.aggregate([{"$match": live}, {"$group": {"_id": "$flat_id", "n": {"$sum": 1}}}, {"$match": {"n": {"$gt": 1}}}, {"$count": "c"}]).to_list(1)
        res["flats_with_more_than_one_live_booking"] = r[0]["c"] if r else 0
        res["booking_status_values"] = dict(Counter([b.get("status") async for b in db.bookings.find({}, {"status": 1})]))

    # orphans
    async def ids(col, f="id"):
        return set([x.get(f) async for x in db[col].find({}, {f: 1})]) if col in cols else set()
    bk, cu, fl, pr, tw = await ids("bookings"), await ids("customers"), await ids("flats"), await ids("projects"), await ids("blocks")
    o = {}
    async def orphan(col, field, target, flt=None):
        if col not in cols: return None
        n = 0; tot = 0
        async for x in db[col].find(flt or {}, {field: 1}):
            v = x.get(field)
            if v is None: continue
            tot += 1
            if v not in target: n += 1
        return f"{n}/{tot}"
    o["bookings.customer_id→customers"] = await orphan("bookings", "customer_id", cu)
    o["bookings.flat_id→flats"] = await orphan("bookings", "flat_id", fl)
    o["bookings.project_id→projects"] = await orphan("bookings", "project_id", pr)
    o["payments.booking_id→bookings"] = await orphan("payments", "booking_id", bk)
    o["demands.booking_id→bookings"] = await orphan("demands", "booking_id", bk)
    o["ledger_entries.booking_id→bookings"] = await orphan("ledger_entries", "booking_id", bk)
    o["waivers.booking_id→bookings"] = await orphan("waivers", "booking_id", bk)
    o["refunds.booking_id→bookings"] = await orphan("refunds", "booking_id", bk)
    o["flats.project_id→projects"] = await orphan("flats", "project_id", pr)
    o["flats.block_id→blocks"] = await orphan("flats", "block_id", tw)
    o["flats.booking_id→bookings"] = await orphan("flats", "booking_id", bk)
    o["parking_slots.booking_id→bookings"] = await orphan("parking_slots", "booking_id", bk)
    o["leads.customer_id→customers"] = await orphan("leads", "customer_id", cu)
    o["documents.booking_id→bookings"] = await orphan("documents", "booking_id", bk)
    o["generated_documents.booking_id→bookings"] = await orphan("generated_documents", "booking_id", bk)
    res["orphans(broken/total)"] = o

    # flat status vs booking consistency
    if "flats" in cols and "bookings" in cols:
        live_by_flat = {}
        async for b in db.bookings.find({"status": {"$nin": ["Cancelled", "Transferred"]}}, {"flat_id": 1, "status": 1}):
            live_by_flat[b.get("flat_id")] = b.get("status")
        mism = Counter()
        async for f in db.flats.find({}, {"id": 1, "status": 1}):
            has = f.get("id") in live_by_flat
            st = f.get("status")
            if has and st in ("Available", "Hold"): mism["live booking but flat Available/Hold"] += 1
            if (not has) and st in ("Booked", "Sold"): mism["flat Booked/Sold without live booking"] += 1
        res["flat_vs_booking_mismatch"] = dict(mism)
        res["flat_status_values"] = dict(Counter([f.get("status") async for f in db.flats.find({}, {"status": 1})]))

    # money type check: floats in *_paise
    ft = Counter(); tot = Counter()
    for col in ["payments", "demands", "ledger_entries", "bookings", "waivers", "refunds", "other_charges", "booking_charges"]:
        if col not in cols: continue
        async for x in db[col].find({}).limit(5000):
            for k, v in money_keys({kk: vv for kk, vv in x.items() if kk != "_id"}):
                tot[col] += 1
                if isinstance(v, float): ft[f"{col}.{k}"] += 1
                if isinstance(v, str): ft[f"{col}.{k}(str)"] += 1
    res["money_fields_checked"] = dict(tot)
    res["money_fields_float_or_str"] = dict(ft.most_common(30))

    # timestamp type check
    tt = Counter()
    for col in ["payments", "bookings", "demands", "ledger_entries", "audit_logs"]:
        if col not in cols: continue
        async for x in db[col].find({}).limit(2000):
            for k in ("created_at", "updated_at", "posted_at", "at", "date", "payment_date"):
                if k in x:
                    v = x[k]; kind = type(v).__name__
                    if isinstance(v, str):
                        kind = "str-date" if re.fullmatch(r"\d{4}-\d{2}-\d{2}", v) else ("str-iso-tz" if re.search(r"(Z|[+-]\d\d:\d\d)$", v) else "str-iso-naive")
                    tt[f"{col}.{k}:{kind}"] += 1
    res["timestamp_kinds"] = dict(tt)

    # required-field nulls
    nulls = {}
    req = {"bookings": ["id", "booking_number", "customer_id", "flat_id", "project_id", "status", "agreement_value_paise"],
           "payments": ["id", "booking_id", "amount_paise", "mode", "payment_date"],
           "demands": ["id", "booking_id", "amount_paise"],
           "customers": ["id", "name"], "flats": ["id", "project_id", "block_id", "status"]}
    for col, fs in req.items():
        if col not in cols: continue
        for f in fs:
            n = await db[col].count_documents({"$or": [{f: None}, {f: {"$exists": False}}]})
            if n: nulls[f"{col}.{f}"] = n
    res["required_field_missing_or_null"] = nulls

    # version / optimistic concurrency fields present?
    vers = {}
    for col in ["bookings", "flats", "projects", "customers", "payments", "demands", "blocks"]:
        if col in cols:
            vers[col] = await db[col].count_documents({"version": {"$exists": True}}) , sizes[col]
    res["docs_with_version_field"] = {k: f"{a}/{b}" for k, (a, b) in vers.items()}

    # counters
    if "counters" in cols:
        res["counters_sample_keys"] = [c.get("_id") if not isinstance(c.get("_id"), dict) else "obj" async for c in db.counters.find({}, {"_id": 1}).limit(15)]
    print(json.dumps(res, indent=1, default=str))

asyncio.run(main())
