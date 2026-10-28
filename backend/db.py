import logging
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
POOL = {"maxPoolSize": int(os.environ.get("MONGO_MAX_POOL", "100")), "minPoolSize": int(os.environ.get("MONGO_MIN_POOL", "5")),
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


async def _ci(coll, *args, **kwargs):
    """Idempotent index creation: a name/option conflict on one index must never abort the rest (fresh DBs lost later indexes)."""
    from pymongo.errors import OperationFailure
    try:
        await coll.create_index(*args, **kwargs)
    except OperationFailure as e:
        logging.getLogger("kkt.db").warning("index %s.%s skipped: %s", coll.name, args[0], str(e)[:120])


async def _indexes_auth():
    """users, refresh tokens (TTL mirror), roles."""
    await _ci(db.users, "email", unique=True)
    await _ci(db.users, "id", unique=True)
    await _ci(db.refresh_tokens, "token_hash", unique=True)
    await _ci(db.refresh_tokens, "user_id")
    await _ci(db.refresh_tokens, "expires_dt", expireAfterSeconds=0, name="ttl_expires_dt")  # Date mirror of ISO expires_at
    await _ci(db.portal_refresh_tokens, "expires_dt", expireAfterSeconds=0, name="ttl_expires_dt")
    await _ci(db.roles, "id", unique=True)
    await _ci(db.roles, [("company_id", ASCENDING), ("name", ASCENDING)])


async def _indexes_masters_inventory():
    """masters, projects/blocks/flats, bookings, customers, demands, payments, ledger, files, locks, cache."""
    for c in MASTER_COLLECTIONS:
        await db[c].create_index("id", unique=True)
        await db[c].create_index([("company_id", ASCENDING), ("is_active", ASCENDING), ("name", ASCENDING)])
    await _ci(db.projects, "id", unique=True)
    await _ci(db.projects, [("company_id", ASCENDING), ("code", ASCENDING)], unique=True)
    await _ci(db.blocks, "id", unique=True)
    await _ci(db.blocks, [("project_id", ASCENDING), ("code", ASCENDING)], unique=True)
    await _ci(db.flats, "id", unique=True)
    await _ci(db.flats, [("block_id", ASCENDING), ("flat_number", ASCENDING)], unique=True)
    await _ci(db.flats, [("project_id", ASCENDING), ("status", ASCENDING)])
    await _ci(db.flats, [("block_id", ASCENDING), ("floor", ASCENDING), ("position", ASCENDING)])
    await _ci(db.audit_logs, [("entity_type", ASCENDING), ("entity_id", ASCENDING), ("created_at", DESCENDING)], name="audit_entity_created")
    await _ci(db.audit_logs, [("created_at", DESCENDING)])
    await _ci(db.audit_logs, "actor_id")
    await _ci(db.companies, "id", unique=True)
    await _ci(db.idempotency_keys, [("user_id", ASCENDING), ("key", ASCENDING)], unique=True)
    await _ci(db.idempotency_keys, "created_at", expireAfterSeconds=86400)
    await _ci(db.idempotency_claims, [("owner", ASCENDING), ("key", ASCENDING)], unique=True, name="uniq_idem_claim")
    await _ci(db.idempotency_claims, "created_at", expireAfterSeconds=86400, name="ttl_idem_claims")
    await _ci(db.files, [("company_id", ASCENDING), ("entity_type", ASCENDING), ("entity_id", ASCENDING), ("created_at", DESCENDING)])
    await _ci(db.flats, [("block_id", ASCENDING), ("display_state", ASCENDING)])
    await _ci(db.flats, [("block_id", ASCENDING), ("allocation_category_code", ASCENDING)])
    await _ci(db.flats, [("status", ASCENDING), ("hold.expires_at", ASCENDING)])
    await _ci(db.allocation_categories, [("company_id", ASCENDING), ("code", ASCENDING)], unique=True)
    await _ci(db.hold_reasons, [("company_id", ASCENDING), ("code", ASCENDING)], unique=True)
    await _ci(db.files, [("project_id", ASCENDING), ("is_active", ASCENDING)])
    await _ci(db.uploads, "file_id")
    await _ci(db.uploads, "created_at", expireAfterSeconds=172800)
    await _ci(db.rate_limits, [("bucket", ASCENDING), ("slot", ASCENDING)], unique=True)
    await _ci(db.rate_limits, "expires_at", expireAfterSeconds=0)
    await _ci(db.login_events, [("created_at", DESCENDING)])
    await _ci(db.login_events, "email")
    await _ci(db.login_events, [("email", ASCENDING), ("ip", ASCENDING), ("success", ASCENDING), ("created_at", DESCENDING)])


async def _indexes_list_sorts():
    """Phase J2 keyset indexes for every allowed list sort + read-path indexes."""
    # Phase J2: compound keyset indexes (company, sort_key, id) for every allowed list sort + read-path indexes proven on kkt_scale (tools/explain_audit.py → 0 COLLSCAN / 0 in-memory sort)
    from tools.explain_audit import LIST_SORTS
    for coll, keys in LIST_SORTS.items():
        for k in keys:
            spec = ([("company_id", ASCENDING)] if coll != "audit_logs" else []) + [(k, ASCENDING), ("id", ASCENDING)]
            await _safe_index(db[coll], spec, f"ks_company_{k}_id")
        if coll != "audit_logs":
            await _safe_index(db[coll], [("company_id", ASCENDING), ("project_id", ASCENDING), (keys[0], DESCENDING), ("id", DESCENDING)], f"ks_project_{keys[0]}_id")
    for coll, spec, name in [
        ("customers", [("company_id", ASCENDING), ("is_active", ASCENDING), ("full_name", ASCENDING)], "search_name"),
        ("bookings", [("company_id", ASCENDING), ("booking_number", ASCENDING)], "search_booking_number"),
        ("bookings", [("customer_id", ASCENDING), ("booking_date", DESCENDING)], "c360_bookings"),
        ("bookings", [("company_id", ASCENDING), ("status", ASCENDING), ("project_id", ASCENDING)], "active_by_project"),
        ("bookings", [("project_id", ASCENDING), ("status", ASCENDING), ("block_id", ASCENDING)], "project_block_summary"),
        ("bookings", [("project_id", ASCENDING), ("status", ASCENDING), ("booking_date", DESCENDING)], "tower_sales_pace"),
        ("payments", [("booking_id", ASCENDING), ("payment_date", DESCENDING)], "booking_payments"),
        ("payments", [("company_id", ASCENDING), ("status", ASCENDING), ("payment_date", ASCENDING)], "status_date"),
        ("payments", [("company_id", ASCENDING), ("status", ASCENDING), ("project_id", ASCENDING), ("payment_date", ASCENDING)], "status_project_date"),
        ("demands", [("booking_id", ASCENDING), ("voided", ASCENDING), ("installment_seq", ASCENDING)], "booking_installments"),
        ("demands", [("company_id", ASCENDING), ("voided", ASCENDING), ("status", ASCENDING), ("due_date", ASCENDING)], "overdue"),
        ("ledger_entries", [("booking_id", ASCENDING), ("seq", ASCENDING)], "booking_seq"),
        ("audit_logs", [("entity_type", ASCENDING), ("entity_id", ASCENDING), ("created_at", DESCENDING)], "entity_time"),
        ("flats", [("block_id", ASCENDING), ("is_active", ASCENDING), ("floor", ASCENDING), ("position", ASCENDING)], "block_grid"),
        ("flats", [("project_id", ASCENDING), ("is_active", ASCENDING), ("status", ASCENDING)], "project_status"),
        ("leads", [("company_id", ASCENDING), ("is_active", ASCENDING), ("status", ASCENDING)], "pipeline"),
    ]:
        await _safe_index(db[coll], spec, name)

    await _ci(db.counters, [("scope", ASCENDING), ("key", ASCENDING)], unique=True)
    await _ci(db.settings, "key", unique=True)


async def _indexes_catalogues():
    """catalogue collections."""
    for c in ("floor_plan_templates", "plc_types", "spec_categories", "spec_items", "rate_cards", "parking_slots"):
        await db[c].create_index("id", unique=True)
    await _ci(db.rate_cards, [("project_id", ASCENDING), ("status", ASCENDING)])
    await _ci(db.parking_slots, [("project_id", ASCENDING), ("number", ASCENDING)], unique=True)
    await _ci(db.parking_slots, [("project_id", ASCENDING), ("status", ASCENDING)])
    await _ci(db.projects, [("name", "text"), ("code", "text"), ("address.city", "text")])
    await _ci(db.blocks, [("name", "text"), ("code", "text")])
    await _ci(db.flats, [("flat_number", "text")])
    await _ci(db.flats, "flat_number")
    await _ci(db.users, [("name", "text"), ("email", "text")])


async def _indexes_business_compound():
    """per-company compound indexes for business collections + payment_plans migration."""
    for c in ("customers", "leads", "bookings", "payments", "demands", "documents", "ledger_entries", "contra_entries"):
        await db[c].create_index("id", unique=True)
    await _ci(db.customers, [("company_id", ASCENDING), ("phone", ASCENDING)])
    await _ci(db.customers, [("company_id", ASCENDING), ("phone", ASCENDING)], unique=True, name="uniq_active_phone", partialFilterExpression={"is_active": True})
    await _ci(db.customers, "pan_hash")
    await _ci(db.customers, "customer_code", unique=True)
    await _ci(db.customers, [("full_name", "text"), ("phone", "text"), ("customer_code", "text")])
    await _ci(db.leads, [("company_id", ASCENDING), ("status", ASCENDING)])
    await _ci(db.leads, "next_follow_up_at")
    await _ci(db.bookings, "booking_number", unique=True)
    await _ci(db.bookings, [("project_id", ASCENDING), ("status", ASCENDING)])
    await _ci(db.bookings, [("block_id", ASCENDING), ("status", ASCENDING)])
    await _ci(db.bookings, "customer_id")
    await _ci(db.bookings, "flat_id")
    await _ci(db.payments, "receipt_number", unique=True)
    await _ci(db.payments, [("booking_id", ASCENDING), ("status", ASCENDING)])
    await _ci(db.payments, [("company_id", ASCENDING), ("payment_date", DESCENDING)])
    await _ci(db.payments, [("project_id", ASCENDING), ("payment_date", DESCENDING)])
    await _ci(db.payments, [("company_id", ASCENDING), ("status", ASCENDING), ("amount_paise", ASCENDING)], name="payments_totals_covered")
    await _ci(db.payments, [("company_id", ASCENDING), ("payment_category", ASCENDING), ("status", ASCENDING), ("amount_paise", ASCENDING)], name="payments_totals_by_category")
    await _ci(db.demands, [("booking_id", ASCENDING), ("posted_at", ASCENDING)])
    await _ci(db.demands, "demand_number", unique=True, name="uniq_demand_number")
    await _ci(db.demands, [("block_id", ASCENDING), ("milestone_seq", ASCENDING)])
    await _ci(db.demands, [("booking_id", ASCENDING), ("installment_seq", ASCENDING)], unique=True, partialFilterExpression={"voided": False, "installment_seq": {"$type": "int"}})
    await _ci(db.payment_plan_assignments, [("project_id", ASCENDING), ("block_id", ASCENDING), ("is_active", ASCENDING)])
    await _ci(db.construction_stages, "name", unique=True)
    try:
        await db.payment_plans.drop_index("name_1")  # Phase M: names are unique per project+tower, not globally
    except Exception:
        pass
    await _ci(db.payment_plans, [("company_id", ASCENDING), ("project_id", ASCENDING), ("block_id", ASCENDING), ("name", ASCENDING)], unique=True, name="plan_name_scope", partialFilterExpression={"is_active": True})
    await _ci(db.ledger_entries, [("booking_id", ASCENDING), ("seq", ASCENDING)])
    await _ci(db.notifications, [("user_id", ASCENDING), ("read", ASCENDING), ("created_at", DESCENDING)])
    await _ci(db.notifications, [("audit_id", ASCENDING), ("user_id", ASCENDING)])
    await _ci(db.notifications, [("swept_v", ASCENDING), ("user_id", ASCENDING)])
    await _ci(db.audit_logs, [("propagated_complete", ASCENDING), ("created_at", ASCENDING)])
    await _ci(db.refunds, [("booking_id", ASCENDING), ("status", ASCENDING)])
    await _ci(db.refunds, [("company_id", ASCENDING), ("paid_date", ASCENDING)])
    await _ci(db.demands, [("company_id", ASCENDING), ("status", ASCENDING), ("due_date", ASCENDING)])
    await _ci(db.leads, [("company_id", ASCENDING), ("source", ASCENDING), ("is_read", ASCENDING)])
    await _ci(db.backups, "expires_at", expireAfterSeconds=86400)
    await _ci(db.report_presets, [("user_id", ASCENDING), ("report_key", ASCENDING)])
    await _ci(db.documents, [("entity_type", ASCENDING), ("entity_id", ASCENDING)])
    await _ci(db.user_home_layouts, [("user_id", ASCENDING), ("company_id", ASCENDING)], unique=True)
    await _ci(db.contra_entries, "date")


async def _indexes_phase11a():
    """Phase 11A canonical additions + ESR-aligned compound indexes."""
    # ---- Phase 11A: canonical additions + ESR-aligned compound indexes for every list/search path ----
    await _ci(db.catalogue_items, "id", unique=True)
    await _ci(db.catalogue_items, [("company_id", ASCENDING), ("type", ASCENDING), ("code", ASCENDING)], unique=True)
    await _ci(db.catalogue_items, [("company_id", ASCENDING), ("type", ASCENDING), ("is_active", ASCENDING), ("sort_order", ASCENDING)])
    await _ci(db.communications, "id", unique=True)
    await _ci(db.communications, [("company_id", ASCENDING), ("customer_id", ASCENDING), ("happened_at", DESCENDING)])
    await _ci(db.communications, [("company_id", ASCENDING), ("lead_id", ASCENDING), ("happened_at", DESCENDING)])
    await _ci(db.project_summaries, "project_id", unique=True)
    await _ci(db.project_summaries, [("company_id", ASCENDING), ("project_id", ASCENDING)])
    await _ci(db.block_summaries, "block_id", unique=True)
    await _ci(db.block_summaries, "project_id")
    await _ci(db.customer_summaries, "customer_id", unique=True)
    await _ci(db.customer_summaries, [("company_id", ASCENDING), ("engagement_score", DESCENDING)])
    await _ci(db.dashboard_snapshots, [("company_id", ASCENDING), ("scope_hash", ASCENDING)], unique=True)
    await _ci(db.cache, "key", unique=True)
    await _ci(db.cache, "expires_at", expireAfterSeconds=0)
    await _ci(db.locks, "name", unique=True)
    await _ci(db.report_cache, "expires_at", expireAfterSeconds=0)
    # list paths: (company, filter, sort)
    await _ci(db.customers, [("company_id", ASCENDING), ("is_active", ASCENDING), ("created_at", DESCENDING), ("id", ASCENDING)])
    await _ci(db.customers, [("company_id", ASCENDING), ("full_name", ASCENDING)])
    await _ci(db.customers, [("company_id", ASCENDING), ("lifecycle_stage", ASCENDING), ("engagement_score", DESCENDING)])
    await _ci(db.customers, [("company_id", ASCENDING), ("assigned_sales_user_id", ASCENDING), ("next_follow_up_at", ASCENDING)])
    await _ci(db.bookings, [("company_id", ASCENDING), ("status", ASCENDING), ("booking_date", DESCENDING), ("id", ASCENDING)])
    await _ci(db.bookings, [("company_id", ASCENDING), ("customer_id", ASCENDING), ("booking_date", DESCENDING)])
    await _ci(db.bookings, [("company_id", ASCENDING), ("project_id", ASCENDING), ("status", ASCENDING), ("booking_date", DESCENDING)])
    await _ci(db.bookings, "customer_name")
    await _ci(db.payments, [("company_id", ASCENDING), ("status", ASCENDING), ("payment_date", DESCENDING), ("id", ASCENDING)])
    await _ci(db.payments, [("booking_id", ASCENDING), ("against", ASCENDING), ("payment_category", ASCENDING), ("status", ASCENDING)])
    await _ci(db.payments, "customer_id")
    await _ci(db.payments, [("company_id", ASCENDING), ("status", ASCENDING), ("payment_mode_code", ASCENDING)], partialFilterExpression={"status": "Pending"})
    await _ci(db.demands, [("customer_id", ASCENDING), ("status", ASCENDING), ("due_date", ASCENDING)])
    await _ci(db.demands, [("project_id", ASCENDING), ("status", ASCENDING), ("due_date", ASCENDING)], partialFilterExpression={"status": {"$in": ["Open", "Partially Paid"]}})
    await _ci(db.leads, [("company_id", ASCENDING), ("status", ASCENDING), ("created_at", DESCENDING), ("id", ASCENDING)])
    await _ci(db.leads, [("company_id", ASCENDING), ("project_id", ASCENDING), ("status", ASCENDING)])
    await _ci(db.leads, [("company_id", ASCENDING), ("phone", ASCENDING)])
    await _ci(db.leads, [("company_id", ASCENDING), ("assigned_to", ASCENDING), ("next_follow_up_at", ASCENDING)])
    await _ci(db.flats, [("company_id", ASCENDING), ("status", ASCENDING), ("project_id", ASCENDING)])
    await _ci(db.site_visits, [("company_id", ASCENDING), ("date", ASCENDING), ("slot_start", ASCENDING)])
    await _ci(db.site_visits, [("project_id", ASCENDING), ("date", ASCENDING), ("status", ASCENDING)])
    await _ci(db.site_visits, [("lead_id", ASCENDING), ("status", ASCENDING), ("date", ASCENDING)])
    await _ci(db.service_requests, [("company_id", ASCENDING), ("status", ASCENDING), ("created_at", DESCENDING)])
    await _ci(db.service_requests, [("customer_id", ASCENDING), ("created_at", DESCENDING)])
    await _ci(db.notifications, [("user_id", ASCENDING), ("withdrawn", ASCENDING), ("read", ASCENDING)])
    await _ci(db.ledger_entries, [("booking_id", ASCENDING), ("ref", ASCENDING)])
    await _ci(db.brochure_downloads, [("lead_id", ASCENDING), ("at", DESCENDING)])
    await _ci(db.brochure_downloads, [("project_id", ASCENDING), ("at", DESCENDING)])
    await _ci(db.login_events, [("account_id", ASCENDING), ("success", ASCENDING), ("created_at", DESCENDING)])
    await _ci(db.portal_accounts, "customer_id")
    await _ci(db.audit_logs, [("company_id", ASCENDING), ("created_at", DESCENDING)])


async def ensure_indexes():
    """Idempotent index set, one helper per collection group (CR-2 C9). Guarded by tests/test_index_snapshot.py."""
    await _indexes_auth()
    await _indexes_masters_inventory()
    await _indexes_list_sorts()
    await _indexes_catalogues()
    await _indexes_business_compound()
    await _indexes_phase11a()
async def _safe_index(coll, spec, name):
    """Idempotent: ignores 'already exists with a different name' (older ad-hoc indexes) so startup never fails on index drift."""
    try:
        await coll.create_index(spec, name=name, background=True)
    except Exception as e:  # noqa: BLE001
        logging.getLogger("db").info("index %s.%s skipped: %s", coll.name, name, str(e)[:80])
