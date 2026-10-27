"""Mongo JSON-schema validators (validationLevel=moderate) for canonical collections. Applied idempotently via collMod from the background startup task.

Money is integer paise everywhere; enums mirror the application constants. `moderate` validates inserts and updates to valid docs only, so legacy rows are never bricked."""
import logging

from db import db

logger = logging.getLogger("kkt.validators")
MONEY = {"bsonType": ["int", "long"]}
STR = {"bsonType": "string"}
BOOL = {"bsonType": "bool"}
ISO = {"bsonType": "string", "minLength": 10}

SCHEMAS = {
    "projects": {"required": ["id", "company_id", "name", "status"], "properties": {"id": STR, "company_id": STR, "name": {"bsonType": "string", "minLength": 1, "maxLength": 200}, "status": {"enum": ["Planning", "Under Construction", "Ready", "Completed"]}, "default_cash_percent": {"bsonType": ["int", "double", "long"], "minimum": 0, "maximum": 100}}},
    "blocks": {"required": ["id", "company_id", "project_id", "name"], "properties": {"id": STR, "project_id": STR, "name": {"bsonType": "string", "minLength": 1}, "floors": {"bsonType": ["int", "long"], "minimum": 0}}},
    "flats": {"required": ["id", "company_id", "project_id", "block_id", "flat_number", "status"], "properties": {"id": STR, "block_id": STR, "flat_number": {"bsonType": "string", "minLength": 1}, "status": {"enum": ["Available", "Hold", "Booked", "Sold", "Blocked", "Allotted", "Not for sale"]}, "display_state": {"enum": ["Show as Available", "Show as Sold", "Show as Hold", "Hidden", None]}, "bookable": {"bsonType": "bool"}, "floor": {"bsonType": ["int", "long"]}, "price_paise": {"bsonType": ["int", "long", "null"]}}},
    "customers": {"required": ["id", "company_id", "full_name", "phone"], "properties": {"id": STR, "full_name": {"bsonType": "string", "minLength": 1, "maxLength": 200}, "phone": {"bsonType": "string", "minLength": 10}, "email": {"bsonType": ["string", "null"]}, "is_active": BOOL}},
    "bookings": {"required": ["id", "company_id", "project_id", "block_id", "flat_id", "customer_id", "booking_number", "status", "agreement_value_paise", "cash_agreed_paise", "account_agreed_paise", "version"],
                 "properties": {"booking_number": {"bsonType": "string", "pattern": "^BK-"}, "status": {"enum": ["Active", "Cancelled", "Completed"]}, "agreement_value_paise": {**MONEY, "minimum": 0}, "cash_agreed_paise": {**MONEY, "minimum": 0}, "account_agreed_paise": {**MONEY, "minimum": 0}, "version": {"bsonType": ["int", "long"], "minimum": 1}}},
    "payments": {"required": ["id", "company_id", "booking_id", "receipt_number", "amount_paise", "status", "against", "payment_date"],
                 "properties": {"receipt_number": {"bsonType": "string", "minLength": 3}, "amount_paise": {**MONEY, "minimum": 1}, "status": {"enum": ["Cleared", "Pending", "Bounced", "Reversed"]}, "against": {"enum": ["FLAT_VALUE", "OTHER_CHARGE"]}, "payment_category": {"enum": ["Cash", "Account", None]}, "payment_date": ISO}},
    "demands": {"required": ["id", "company_id", "booking_id", "demand_number", "cash_demand_paise", "account_demand_paise", "total_demand_paise", "status", "voided"],
                "properties": {"demand_number": {"bsonType": "string", "pattern": "^DM-"}, "cash_demand_paise": {**MONEY, "minimum": 0}, "account_demand_paise": {**MONEY, "minimum": 0}, "total_demand_paise": {**MONEY, "minimum": 0}, "status": {"enum": ["Open", "Partially Paid", "Paid", "Cancelled", "Voided", "Overdue"]}, "voided": BOOL}},
    "ledger_entries": {"required": ["id", "booking_id", "seq", "type", "amount_paise"], "properties": {"seq": {"bsonType": ["int", "long"], "minimum": 1}, "type": {"enum": ["AGREEMENT_CHANGE", "CANCELLATION", "DEMAND", "OTHER_CHARGE_DEMAND", "OTHER_CHARGE_PAYMENT", "PAYMENT", "REVERSAL", "REFUND", "TRANSFER"]}, "amount_paise": MONEY, "cash_due_paise": MONEY, "account_due_paise": MONEY, "total_due_paise": MONEY, "cash_paid_cum_paise": MONEY, "account_paid_cum_paise": MONEY}},
    "catalogue_items": {"required": ["id", "company_id", "type", "code", "label", "is_active"], "properties": {"type": {"bsonType": "string", "minLength": 1}, "code": {"bsonType": "string", "minLength": 1}, "label": {"bsonType": "string", "minLength": 1}, "is_active": BOOL, "sort_order": {"bsonType": ["int", "long", "double"]}}},
    "users": {"required": ["id", "company_id", "email", "password_hash", "role_id", "is_active"], "properties": {"email": {"bsonType": "string", "pattern": "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$"}, "password_hash": {"bsonType": "string", "minLength": 20}, "is_active": BOOL}},
    "audit_logs": {"required": ["id", "action", "entity_type", "created_at"], "properties": {"action": {"bsonType": "string", "minLength": 1}, "entity_type": STR, "created_at": ISO}},
}


# Phase K money invariants ($expr) — merged with SCHEMAS by both apply_validators() and invariants.ensure_invariants()
MONEY_NN = {"bsonType": ["int", "long"], "minimum": 0}

VALIDATORS = {
    "bookings": {"$jsonSchema": {"bsonType": "object", "properties": {"agreement_value_paise": MONEY_NN, "cash_agreed_paise": MONEY_NN, "account_agreed_paise": MONEY_NN}},
                 # cash + account == agreement, expressed with $expr (ints only)
                 "$expr": {"$or": [{"$not": [{"$isNumber": "$agreement_value_paise"}]}, {"$eq": [{"$add": ["$cash_agreed_paise", "$account_agreed_paise"]}, "$agreement_value_paise"]}]}},
    "payments": {"$jsonSchema": {"bsonType": "object", "required": ["amount_paise"], "properties": {"amount_paise": {"bsonType": ["int", "long"], "minimum": 1}}}},
    "demands": {"$jsonSchema": {"bsonType": "object", "properties": {"total_demand_paise": MONEY_NN, "cash_demand_paise": MONEY_NN, "account_demand_paise": MONEY_NN, "paid_paise": MONEY_NN}},
                "$expr": {"$or": [{"$not": [{"$isNumber": "$cash_demand_paise"}]}, {"$not": [{"$isNumber": "$account_demand_paise"}]}, {"$eq": [{"$add": ["$cash_demand_paise", "$account_demand_paise"]}, "$total_demand_paise"]}]}},
}



async def apply_validators() -> dict:
    """collMod each collection with its $jsonSchema (creating empty collections if needed). Safe on Atlas; idempotent."""
    out = {}
    existing = set(await db.list_collection_names())
    for name, schema in SCHEMAS.items():
        validator = {"$jsonSchema": {"bsonType": "object", **schema}}
        if name in VALIDATORS and "$expr" in VALIDATORS[name]:  # Phase K: keep money $expr invariants when re-applying schemas
            validator = {"$and": [validator, {"$expr": VALIDATORS[name]["$expr"]}]}
        try:
            if name not in existing:
                await db.create_collection(name, validator=validator, validationLevel="moderate", validationAction="error")
            else:
                await db.command({"collMod": name, "validator": validator, "validationLevel": "moderate", "validationAction": "error"})
            out[name] = "ok"
        except Exception as e:  # never fail startup because of a validator
            out[name] = f"failed: {e}"
            logger.warning("[validators] %s: %s", name, e)
    return out


async def backfill_price_paise() -> dict:
    """Idempotent: flats.price (rupees, legacy float) → flats.price_paise (int). Keeps `price` until all consumers are switched."""
    n = 0
    async for f in db.flats.find({"price": {"$ne": None}, "$or": [{"price_paise": {"$exists": False}}, {"price_paise": None}]}, {"_id": 0, "id": 1, "price": 1}).batch_size(500):
        await db.flats.update_one({"id": f["id"]}, {"$set": {"price_paise": round(float(f["price"]) * 100)}})
        n += 1
    legacy = await db.flats.count_documents({"price": {"$exists": True}, "price_paise": {"$type": ["int", "long"]}})
    bad = await db.flats.count_documents({"price": {"$ne": None}, "$or": [{"price_paise": {"$exists": False}}, {"price_paise": None}]})
    if legacy and not bad:  # every priced flat has an integer price_paise → legacy rupee field can go
        await db.flats.update_many({"price": {"$exists": True}}, {"$unset": {"price": ""}})
    return {"backfilled": n, "legacy_removed": legacy if not bad else 0}
