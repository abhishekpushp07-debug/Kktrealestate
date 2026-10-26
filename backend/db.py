import os
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ASCENDING, DESCENDING

load_dotenv(Path(__file__).parent / ".env")

# Connection pool (Atlas-compatible; all tunable via env, documented in memory/qa/perf/load_report.md):
#   MONGO_MAX_POOL (50)  max sockets per process      MONGO_MIN_POOL (5)   warm sockets kept open
#   MONGO_WAIT_QUEUE_MS (5000) wait for a free socket  MONGO_SST_MS (5000)  server selection timeout
#   MONGO_CONNECT_MS (5000) TCP connect               MONGO_SOCKET_MS (30000) per-operation socket timeout
POOL = {"maxPoolSize": int(os.environ.get("MONGO_MAX_POOL", "50")), "minPoolSize": int(os.environ.get("MONGO_MIN_POOL", "5")),
        "waitQueueTimeoutMS": int(os.environ.get("MONGO_WAIT_QUEUE_MS", "5000")), "serverSelectionTimeoutMS": int(os.environ.get("MONGO_SST_MS", "5000")),
        "connectTimeoutMS": int(os.environ.get("MONGO_CONNECT_MS", "5000")), "socketTimeoutMS": int(os.environ.get("MONGO_SOCKET_MS", "30000")),
        "maxIdleTimeMS": 120000, "heartbeatFrequencyMS": 10000}
client = AsyncIOMotorClient(os.environ["MONGO_URL"], **POOL, retryWrites=True, retryReads=True, compressors="zlib",
                            event_listeners=[__import__("dbtiming").DbTimingListener(), __import__("dbtiming").PoolListener()])
_db_raw = client.get_database(os.environ["DB_NAME"], write_concern=__import__("pymongo").WriteConcern(w="majority", j=True) if os.environ.get("MONGO_WRITE_MAJORITY", "1") == "1" else None)
db = __import__("services.immutable", fromlist=["GuardedDatabase"]).GuardedDatabase(_db_raw)  # Phase K: audit_logs / ledger_entries append-only guard
# reads: primary (default) for transactional truth; `db_ro` below for derived read models
# derived read models may be served from secondaries when a replica set exists (standalone ignores the preference)
db_ro = client.get_database(os.environ["DB_NAME"], read_preference=__import__("pymongo").ReadPreference.SECONDARY_PREFERRED)

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
    await db.refresh_tokens.create_index("expires_dt", expireAfterSeconds=0, name="ttl_expires_dt")  # Date mirror of ISO expires_at
    await db.portal_refresh_tokens.create_index("expires_dt", expireAfterSeconds=0, name="ttl_expires_dt")
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
    await db.audit_logs.create_index([("entity_type", ASCENDING), ("entity_id", ASCENDING), ("created_at", DESCENDING)], name="audit_entity_created")
    await db.audit_logs.create_index([("created_at", DESCENDING)])
    await db.audit_logs.create_index("actor_id")
    await db.companies.create_index("id", unique=True)
    await db.idempotency_keys.create_index([("user_id", ASCENDING), ("key", ASCENDING)], unique=True)
    await db.idempotency_keys.create_index("created_at", expireAfterSeconds=86400)
    await db.idempotency_claims.create_index([("owner", ASCENDING), ("key", ASCENDING)], unique=True)
    await db.idempotency_claims.create_index("created_at", expireAfterSeconds=86400)
    await db.rate_limits.create_index([("bucket", ASCENDING), ("slot", ASCENDING)], unique=True)
    await db.rate_limits.create_index("expires_at", expireAfterSeconds=0)
    await db.login_events.create_index([("created_at", DESCENDING)])
    await db.login_events.create_index("email")
    await db.login_events.create_index([("email", ASCENDING), ("ip", ASCENDING), ("success", ASCENDING), ("created_at", DESCENDING)])
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
    await db.customers.create_index([("company_id", ASCENDING), ("phone", ASCENDING)], unique=True, name="uniq_active_phone", partialFilterExpression={"is_active": True})
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
    await db.payments.create_index([("company_id", ASCENDING), ("status", ASCENDING), ("amount_paise", ASCENDING)], name="payments_totals_covered")
    await db.payments.create_index([("company_id", ASCENDING), ("payment_category", ASCENDING), ("status", ASCENDING), ("amount_paise", ASCENDING)], name="payments_totals_by_category")
    await db.demands.create_index([("booking_id", ASCENDING), ("posted_at", ASCENDING)])
    await db.demands.create_index("demand_number", unique=True, name="uniq_demand_number")
    await db.demands.create_index([("block_id", ASCENDING), ("milestone_seq", ASCENDING)])
    await db.demands.create_index([("booking_id", ASCENDING), ("installment_seq", ASCENDING)], unique=True, partialFilterExpression={"voided": False, "installment_seq": {"$type": "int"}})
    await db.payment_plan_assignments.create_index([("project_id", ASCENDING), ("block_id", ASCENDING), ("is_active", ASCENDING)])
    await db.construction_stages.create_index("name", unique=True)
    try:
        await db.payment_plans.drop_index("name_1")  # Phase M: names are unique per project+tower, not globally
    except Exception:
        pass
    await db.payment_plans.create_index([("company_id", ASCENDING), ("project_id", ASCENDING), ("block_id", ASCENDING), ("name", ASCENDING)], unique=True, name="plan_name_scope", partialFilterExpression={"is_active": True})
    await db.ledger_entries.create_index([("booking_id", ASCENDING), ("seq", ASCENDING)])
    await db.notifications.create_index([("user_id", ASCENDING), ("read", ASCENDING), ("created_at", DESCENDING)])
    await db.notifications.create_index([("audit_id", ASCENDING), ("user_id", ASCENDING)])
    await db.audit_logs.create_index([("propagated_complete", ASCENDING), ("created_at", ASCENDING)])
    await db.refunds.create_index([("booking_id", ASCENDING), ("status", ASCENDING)])
    await db.refunds.create_index([("company_id", ASCENDING), ("paid_date", ASCENDING)])
    await db.demands.create_index([("company_id", ASCENDING), ("status", ASCENDING), ("due_date", ASCENDING)])
    await db.leads.create_index([("company_id", ASCENDING), ("source", ASCENDING), ("is_read", ASCENDING)])
    await db.backups.create_index("expires_at", expireAfterSeconds=86400)
    await db.report_presets.create_index([("user_id", ASCENDING), ("report_key", ASCENDING)])
    await db.documents.create_index([("entity_type", ASCENDING), ("entity_id", ASCENDING)])
    await db.contra_entries.create_index("date")
    # ---- Phase 11A: canonical additions + ESR-aligned compound indexes for every list/search path ----
    await db.catalogue_items.create_index("id", unique=True)
    await db.catalogue_items.create_index([("company_id", ASCENDING), ("type", ASCENDING), ("code", ASCENDING)], unique=True)
    await db.catalogue_items.create_index([("company_id", ASCENDING), ("type", ASCENDING), ("is_active", ASCENDING), ("sort_order", ASCENDING)])
    await db.communications.create_index("id", unique=True)
    await db.communications.create_index([("company_id", ASCENDING), ("customer_id", ASCENDING), ("happened_at", DESCENDING)])
    await db.communications.create_index([("company_id", ASCENDING), ("lead_id", ASCENDING), ("happened_at", DESCENDING)])
    await db.project_summaries.create_index("project_id", unique=True)
    await db.project_summaries.create_index([("company_id", ASCENDING), ("project_id", ASCENDING)])
    await db.block_summaries.create_index("block_id", unique=True)
    await db.block_summaries.create_index("project_id")
    await db.customer_summaries.create_index("customer_id", unique=True)
    await db.customer_summaries.create_index([("company_id", ASCENDING), ("engagement_score", DESCENDING)])
    await db.dashboard_snapshots.create_index([("company_id", ASCENDING), ("scope_hash", ASCENDING)], unique=True)
    await db.cache.create_index("key", unique=True)
    await db.cache.create_index("expires_at", expireAfterSeconds=0)
    await db.locks.create_index("name", unique=True)
    await db.report_cache.create_index("expires_at", expireAfterSeconds=0)
    # list paths: (company, filter, sort)
    await db.customers.create_index([("company_id", ASCENDING), ("is_active", ASCENDING), ("created_at", DESCENDING), ("id", ASCENDING)])
    await db.customers.create_index([("company_id", ASCENDING), ("full_name", ASCENDING)])
    await db.customers.create_index([("company_id", ASCENDING), ("lifecycle_stage", ASCENDING), ("engagement_score", DESCENDING)])
    await db.customers.create_index([("company_id", ASCENDING), ("assigned_sales_user_id", ASCENDING), ("next_follow_up_at", ASCENDING)])
    await db.bookings.create_index([("company_id", ASCENDING), ("status", ASCENDING), ("booking_date", DESCENDING), ("id", ASCENDING)])
    await db.bookings.create_index([("company_id", ASCENDING), ("customer_id", ASCENDING), ("booking_date", DESCENDING)])
    await db.bookings.create_index([("company_id", ASCENDING), ("project_id", ASCENDING), ("status", ASCENDING), ("booking_date", DESCENDING)])
    await db.bookings.create_index("customer_name")
    await db.payments.create_index([("company_id", ASCENDING), ("status", ASCENDING), ("payment_date", DESCENDING), ("id", ASCENDING)])
    await db.payments.create_index([("booking_id", ASCENDING), ("against", ASCENDING), ("payment_category", ASCENDING), ("status", ASCENDING)])
    await db.payments.create_index("customer_id")
    await db.payments.create_index([("company_id", ASCENDING), ("status", ASCENDING), ("payment_mode_code", ASCENDING)], partialFilterExpression={"status": "Pending"})
    await db.demands.create_index([("customer_id", ASCENDING), ("status", ASCENDING), ("due_date", ASCENDING)])
    await db.demands.create_index([("project_id", ASCENDING), ("status", ASCENDING), ("due_date", ASCENDING)], partialFilterExpression={"status": {"$in": ["Open", "Partially Paid"]}})
    await db.leads.create_index([("company_id", ASCENDING), ("status", ASCENDING), ("created_at", DESCENDING), ("id", ASCENDING)])
    await db.leads.create_index([("company_id", ASCENDING), ("project_id", ASCENDING), ("status", ASCENDING)])
    await db.leads.create_index([("company_id", ASCENDING), ("phone", ASCENDING)])
    await db.leads.create_index([("company_id", ASCENDING), ("assigned_to", ASCENDING), ("next_follow_up_at", ASCENDING)])
    await db.flats.create_index([("company_id", ASCENDING), ("status", ASCENDING), ("project_id", ASCENDING)])
    await db.site_visits.create_index([("company_id", ASCENDING), ("date", ASCENDING), ("slot_start", ASCENDING)])
    await db.site_visits.create_index([("project_id", ASCENDING), ("date", ASCENDING), ("status", ASCENDING)])
    await db.site_visits.create_index([("lead_id", ASCENDING), ("status", ASCENDING), ("date", ASCENDING)])
    await db.service_requests.create_index([("company_id", ASCENDING), ("status", ASCENDING), ("created_at", DESCENDING)])
    await db.service_requests.create_index([("customer_id", ASCENDING), ("created_at", DESCENDING)])
    await db.notifications.create_index([("user_id", ASCENDING), ("withdrawn", ASCENDING), ("read", ASCENDING)])
    await db.ledger_entries.create_index([("booking_id", ASCENDING), ("ref", ASCENDING)])
    await db.brochure_downloads.create_index([("lead_id", ASCENDING), ("at", DESCENDING)])
    await db.brochure_downloads.create_index([("project_id", ASCENDING), ("at", DESCENDING)])
    await db.login_events.create_index([("account_id", ASCENDING), ("success", ASCENDING), ("created_at", DESCENDING)])
    await db.portal_accounts.create_index("customer_id")
    await db.audit_logs.create_index([("company_id", ASCENDING), ("created_at", DESCENDING)])
