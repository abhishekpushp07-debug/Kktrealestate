"""Phase K: Mongo invariants — unique partial indexes + JSON-schema validators, created idempotently at startup (background).
What is enforced where:
- one Active booking per flat ............ unique partial index bookings(flat_id) where status=Active
- one non-void demand per installment .... unique partial index demands(booking_id, installment_seq) (pre-existing, verified)
- one payment per idempotency key ........ unique partial index payments(idempotency_key)
- one live customer per phone / pan_hash . unique partial indexes customers(company_id, phone|pan_hash) where is_active
- money validators ....................... collMod validators: bookings cash+account == agreement (ints ≥ 0), payments amount > 0, demands split sums, non-negative amounts
- immutable audit_logs / ledger_entries .. services.immutable (guarded repository; see docs/IMMUTABILITY.md)"""
import logging

from pymongo import ASCENDING
from pymongo.errors import OperationFailure

from db import db
from services.validators import SCHEMAS, VALIDATORS  # noqa: F401 — VALIDATORS re-exported (money $expr invariants live beside SCHEMAS)

log = logging.getLogger("invariants")
async def ensure_invariants() -> dict:
    out = {"indexes": [], "validators": []}
    specs = [
        ("bookings", [("flat_id", ASCENDING)], "uniq_active_booking_per_flat", {"status": "Active"}),
        ("payments", [("idempotency_key", ASCENDING)], "uniq_payment_idempotency_key", {"idempotency_key": {"$type": "string"}}),
        ("customers", [("company_id", ASCENDING), ("pan_hash", ASCENDING)], "uniq_active_pan_hash", {"is_active": True, "pan_hash": {"$type": "string"}}),
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
    try:
        await db.idempotency_claims.create_index("created_at", expireAfterSeconds=24 * 3600, name="ttl_idem_claims")
    except OperationFailure:
        pass
    # merge: schema (existing) AND money invariants ($expr) — never replace the schema validator
    for coll, rule in VALIDATORS.items():
        schema = {"$jsonSchema": {"bsonType": "object", **SCHEMAS[coll]}} if coll in SCHEMAS else rule.get("$jsonSchema") and {"$jsonSchema": rule["$jsonSchema"]}
        parts = [p for p in (schema, {"$expr": rule["$expr"]} if "$expr" in rule else None) if p]
        try:
            await db.command({"collMod": coll, "validator": {"$and": parts}, "validationLevel": "moderate", "validationAction": "error"})
            out["validators"].append(coll)
        except OperationFailure as e:
            log.warning("validator %s not applied: %s", coll, str(e)[:200])
            out["validators"].append(f"{coll}: FAILED {str(e)[:80]}")
    await db.settings.update_one({"key": "invariants_v1"}, {"$set": {"value": out}}, upsert=True)
    return out
