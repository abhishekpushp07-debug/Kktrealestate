import os
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ASCENDING, DESCENDING

load_dotenv(Path(__file__).parent / ".env")

client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]

MASTER_COLLECTIONS = [
    "room_types", "area_types", "flat_types", "block_types", "amenities",
    "milestone_templates", "charge_types", "payment_modes", "bank_accounts", "document_types",
    "floor_plan_templates", "plc_types", "spec_categories", "spec_items",
]


async def ensure_indexes():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.refresh_tokens.create_index("token_hash", unique=True)
    await db.refresh_tokens.create_index("user_id")
    await db.roles.create_index("id", unique=True)
    await db.roles.create_index([("company_id", ASCENDING), ("name", ASCENDING)])
    for c in MASTER_COLLECTIONS:
        await db[c].create_index("id", unique=True)
        await db[c].create_index([("company_id", ASCENDING), ("is_active", ASCENDING), ("name", ASCENDING)])
    await db.projects.create_index("id", unique=True)
    await db.projects.create_index([("company_id", ASCENDING), ("code", ASCENDING)], unique=True)
    await db.blocks.create_index("id", unique=True)
    await db.blocks.create_index([("project_id", ASCENDING), ("code", ASCENDING)], unique=True)
    await db.flats.create_index("id", unique=True)
    await db.flats.create_index([("block_id", ASCENDING), ("flat_number", ASCENDING)], unique=True)
    await db.flats.create_index([("project_id", ASCENDING), ("status", ASCENDING)])
    await db.flats.create_index([("block_id", ASCENDING), ("floor", ASCENDING), ("position", ASCENDING)])
    await db.audit_logs.create_index([("entity_type", ASCENDING), ("entity_id", ASCENDING)])
    await db.audit_logs.create_index([("created_at", DESCENDING)])
    await db.audit_logs.create_index("actor_id")
    await db.companies.create_index("id", unique=True)
    await db.idempotency_keys.create_index([("user_id", ASCENDING), ("key", ASCENDING)], unique=True)
    await db.idempotency_keys.create_index("created_at", expireAfterSeconds=86400)
    await db.rate_limits.create_index([("bucket", ASCENDING), ("slot", ASCENDING)], unique=True)
    await db.rate_limits.create_index("expires_at", expireAfterSeconds=0)
    await db.login_events.create_index([("created_at", DESCENDING)])
    await db.login_events.create_index("email")
    await db.counters.create_index([("scope", ASCENDING), ("key", ASCENDING)], unique=True)
    await db.settings.create_index("key", unique=True)
    for c in ("floor_plan_templates", "plc_types", "spec_categories", "spec_items", "rate_cards", "parking_slots"):
        await db[c].create_index("id", unique=True)
    await db.rate_cards.create_index([("project_id", ASCENDING), ("status", ASCENDING)])
    await db.parking_slots.create_index([("project_id", ASCENDING), ("number", ASCENDING)], unique=True)
    await db.parking_slots.create_index([("project_id", ASCENDING), ("status", ASCENDING)])
    await db.projects.create_index([("name", "text"), ("code", "text"), ("address.city", "text")])
    await db.blocks.create_index([("name", "text"), ("code", "text")])
    await db.flats.create_index([("flat_number", "text")])
    await db.flats.create_index("flat_number")
    await db.users.create_index([("name", "text"), ("email", "text")])
    for c in ("customers", "leads", "bookings", "payments", "demands", "documents", "ledger_entries", "contra_entries"):
        await db[c].create_index("id", unique=True)
    await db.customers.create_index([("company_id", ASCENDING), ("phone", ASCENDING)])
    await db.customers.create_index("pan_hash")
    await db.customers.create_index("customer_code", unique=True)
    await db.customers.create_index([("full_name", "text"), ("phone", "text"), ("customer_code", "text")])
    await db.leads.create_index([("company_id", ASCENDING), ("status", ASCENDING)])
    await db.leads.create_index("next_follow_up_at")
    await db.bookings.create_index("booking_number", unique=True)
    await db.bookings.create_index([("project_id", ASCENDING), ("status", ASCENDING)])
    await db.bookings.create_index([("block_id", ASCENDING), ("status", ASCENDING)])
    await db.bookings.create_index("customer_id")
    await db.bookings.create_index("flat_id")
    await db.payments.create_index("receipt_number", unique=True)
    await db.payments.create_index([("booking_id", ASCENDING), ("status", ASCENDING)])
    await db.payments.create_index([("company_id", ASCENDING), ("payment_date", DESCENDING)])
    await db.payments.create_index([("project_id", ASCENDING), ("payment_date", DESCENDING)])
    await db.demands.create_index([("booking_id", ASCENDING), ("posted_at", ASCENDING)])
    await db.demands.create_index([("block_id", ASCENDING), ("milestone_seq", ASCENDING)])
    await db.ledger_entries.create_index([("booking_id", ASCENDING), ("seq", ASCENDING)])
    await db.notifications.create_index([("user_id", ASCENDING), ("read", ASCENDING), ("created_at", DESCENDING)])
    await db.demands.create_index([("company_id", ASCENDING), ("status", ASCENDING), ("due_date", ASCENDING)])
    await db.leads.create_index([("company_id", ASCENDING), ("source", ASCENDING), ("is_read", ASCENDING)])
    await db.backups.create_index("expires_at", expireAfterSeconds=86400)
    await db.report_presets.create_index([("user_id", ASCENDING), ("report_key", ASCENDING)])
    await db.documents.create_index([("entity_type", ASCENDING), ("entity_id", ASCENDING)])
    await db.contra_entries.create_index("date")
