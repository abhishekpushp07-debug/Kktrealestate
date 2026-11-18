"""Phase K: Mongo invariants — unique partial indexes + JSON-schema validators, created idempotently at startup (background).
What is enforced where:
- one Active booking per flat ............ unique partial index bookings(flat_id) where status=Active
- one non-void demand per installment .... unique partial index demands(booking_id, installment_seq) (pre-existing, verified)
- one payment per idempotency key ........ unique partial index payments(idempotency_key)
- one live customer per phone / pan_hash . unique partial indexes customers(company_id, phone|pan_hash) where is_active
- money validators ....................... collMod validators: bookings cash+account == agreement (ints ≥ 0),
payments amount > 0, demands split sums, non-negative amounts
- immutable audit_logs / ledger_entries .. services.immutable (guarded repository; see docs/IMMUTABILITY.md)"""

import logging

from pymongo import ASCENDING
from pymongo.errors import OperationFailure

from db import db
from services.validators import SCHEMAS, VALIDATORS  # noqa: F401 — VALIDATORS re-exported (money $expr invariants live beside SCHEMAS)

log = logging.getLogger("invariants")

# 3G (REQ-290/307): money business keys the database itself must refuse to repeat. A rule that meets existing
# duplicates (e.g. on an old production copy) is skipped and shown on System Health; the app keeps starting.
BUSINESS_KEYS = [
    (
        "waiver number",
        "waivers",
        [("waiver_number", ASCENDING)],
        "uniq_waiver_number",
        {"waiver_number": {"$type": "string"}},
    ),
    ("credit-note number", "waivers", [("cn_number", ASCENDING)], "uniq_cn_number", {"cn_number": {"$type": "string"}}),
    # a Mixed payout keeps one number across its per-bucket rows (parent = Cash, children = Account / Other)
    (
        "refund number",
        "refunds",
        [("refund_number", ASCENDING), ("bucket", ASCENDING)],
        "uniq_refund_number_bucket",
        None,
    ),
    (
        "ledger line (booking + sequence)",
        "ledger_entries",
        [("booking_id", ASCENDING), ("seq", ASCENDING)],
        "uniq_ledger_seq",
        None,
    ),
    # Phase K's index covers Active only; a Completed (sold) booking keeps its flat too
    (
        "one live booking per flat",
        "bookings",
        [("flat_id", ASCENDING)],
        "uniq_live_booking_per_flat",
        {"status": {"$in": ["Active", "Completed"]}},
    ),
]
NOT_APPLIED = "Uniqueness rule not applied — duplicates found"


async def _duplicates(coll: str, keys: list, pfe: dict | None) -> list:
    group = {k.replace(".", "_"): f"${k}" for k, _ in keys}
    pipe = [
        {"$match": pfe or {}},
        {"$group": {"_id": group, "n": {"$sum": 1}}},
        {"$match": {"n": {"$gt": 1}}},
        {"$limit": 5},
    ]
    return [r["_id"] async for r in db[coll].aggregate(pipe, allowDiskUse=True)]


async def _business_key(label: str, coll: str, keys: list, name: str, pfe: dict | None) -> dict:
    row = {"key": label, "collection": coll, "index": name}
    info = await db[coll].index_information()
    if name in info:
        return {**row, "status": "applied"}
    dups = await _duplicates(coll, keys, pfe)
    if dups:
        log.warning("%s: %s.%s — %d+ duplicate keys, e.g. %s", NOT_APPLIED, coll, name, len(dups), dups[:2])
        return {**row, "status": "not_applied", "message": NOT_APPLIED, "examples": [str(d) for d in dups]}
    for old, ix in info.items():  # a plain (non-unique) index on the same keys is replaced by the unique one
        if old != "_id_" and list(ix["key"]) == keys and not ix.get("unique"):
            try:
                await db[coll].drop_index(old)
            except OperationFailure:
                pass  # the other replica dropped it first
    try:
        await db[coll].create_index(keys, unique=True, name=name, **({"partialFilterExpression": pfe} if pfe else {}))
        return {**row, "status": "applied"}
    except OperationFailure as e:
        log.warning("%s: %s.%s — %s", NOT_APPLIED, coll, name, str(e)[:160])
        return {**row, "status": "not_applied", "message": NOT_APPLIED, "examples": [str(e)[:120]]}


async def ensure_invariants() -> dict:
    out = {"indexes": [], "validators": []}
    specs = [
        ("bookings", [("flat_id", ASCENDING)], "uniq_active_booking_per_flat", {"status": "Active"}),
        (
            "payments",
            [("idempotency_key", ASCENDING)],
            "uniq_payment_idempotency_key",
            {"idempotency_key": {"$type": "string"}},
        ),
        (
            "customers",
            [("company_id", ASCENDING), ("pan_hash", ASCENDING)],
            "uniq_active_pan_hash",
            {"is_active": True, "pan_hash": {"$type": "string"}},
        ),
        ("idempotency_claims", [("owner", ASCENDING), ("key", ASCENDING)], "uniq_idem_claim", None),
    ]
    for coll, keys, name, pfe in specs:
        try:
            kw = {"unique": True, "name": name}
            if pfe:
                kw["partialFilterExpression"] = pfe
            await db[coll].create_index(keys, **kw)
            out["indexes"].append(name)
        except OperationFailure as e:  # existing duplicates → report, never crash startup
            log.warning("invariant index %s not created: %s", name, str(e)[:200])
            out["indexes"].append(f"{name}: FAILED {str(e)[:80]}")
    out["uniqueness"] = [await _business_key(*spec) for spec in BUSINESS_KEYS]
    try:
        await db.idempotency_claims.create_index("created_at", expireAfterSeconds=24 * 3600, name="ttl_idem_claims")
    except OperationFailure:
        pass
    # merge: schema (existing) AND money invariants ($expr) — never replace the schema validator
    for coll, rule in VALIDATORS.items():
        schema = (
            {"$jsonSchema": {"bsonType": "object", **SCHEMAS[coll]}}
            if coll in SCHEMAS
            else rule.get("$jsonSchema") and {"$jsonSchema": rule["$jsonSchema"]}
        )
        parts = [p for p in (schema, {"$expr": rule["$expr"]} if "$expr" in rule else None) if p]
        try:
            await db.command(
                {
                    "collMod": coll,
                    "validator": {"$and": parts},
                    "validationLevel": "moderate",
                    "validationAction": "error",
                }
            )
            out["validators"].append(coll)
        except OperationFailure as e:
            log.warning("validator %s not applied: %s", coll, str(e)[:200])
            out["validators"].append(f"{coll}: FAILED {str(e)[:80]}")
    await db.settings.update_one({"key": "invariants_v1"}, {"$set": {"value": out}}, upsert=True)
    return out
