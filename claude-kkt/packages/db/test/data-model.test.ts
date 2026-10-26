// Diffs the migrated database against docs/DATA-MODEL.md: every table, every named column,
// every listed index/unique (matched by column list, not by name), every enum's labels vs
// @kkt/contracts, and the column-type conventions (paise = bigint, percent = numeric(5,2)).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTableColumns, getTableName, is } from "drizzle-orm";
import { isPgEnum, PgTable } from "drizzle-orm/pg-core";

interface EnumLike {
  enumName: string;
  enumValues: readonly string[];
}

/** Every exported value of the schema module, untyped so `is()` / `isPgEnum()` can narrow it. */
function schemaExports(): unknown[] {
  return Object.values(schema as Record<string, unknown>);
}

/** All pgTable exports of the schema module. */
function schemaTables(): PgTable[] {
  return schemaExports().filter((v): v is PgTable => is(v, PgTable));
}

/** All pgEnum exports of the schema module. */
function schemaEnums(): EnumLike[] {
  return schemaExports().filter((v): v is EnumLike => isPgEnum(v));
}
import { createDb, type DbHandle } from "../src/client.js";
import * as schema from "../src/schema/index.js";
import { TEST_DATABASE_URL } from "./env.js";

/** table → columns named in DATA-MODEL.md (snake_case). `id` is implied on entity tables. */
const EXPECTED_COLUMNS: Record<string, string[]> = {
  // A. Identity & platform
  companies: [
    "id",
    "name",
    "legal_name",
    "gstin",
    "phone",
    "email",
    "address",
    "logo_document_id",
    "letterhead",
    "fy_start_month",
    "numbering",
    "settings",
    "created_at",
    "updated_at",
    "version",
  ],
  roles: ["id", "company_id", "name", "description", "permissions", "is_system", "version"],
  users: [
    "id",
    "company_id",
    "name",
    "email",
    "phone",
    "password_hash",
    "role_id",
    "all_projects",
    "is_active",
    "must_change_password",
    "mfa_enabled",
    "mfa_secret_enc",
    "mfa_pending_secret_enc",
    "failed_attempts",
    "locked_until",
    "last_login_at",
    "password_changed_at",
    "avatar_document_id",
    "version",
  ],
  user_project_scopes: ["user_id", "project_id"],
  password_history: ["user_type", "subject_id", "password_hash", "created_at"],
  refresh_tokens: [
    "company_id",
    "subject_type",
    "subject_id",
    "family_id",
    "token_hash",
    "expires_at",
    "revoked_at",
    "revoke_reason",
    "replaced_by_id",
    "user_agent",
    "ip",
    "created_at",
    "last_used_at",
  ],
  login_events: ["company_id", "subject_type", "identifier", "success", "reason", "ip", "user_agent", "created_at"],
  audit_logs: [
    "company_id",
    "actor_type",
    "actor_id",
    "actor_name",
    "action",
    "entity_type",
    "entity_id",
    "before",
    "after",
    "ip",
    "request_id",
    "created_at",
  ],
  idempotency_keys: [
    "scope_key",
    "key",
    "method",
    "path",
    "request_hash",
    "status_code",
    "response_body",
    "created_at",
    "expires_at",
  ],
  sequences: ["company_id", "scope", "fy", "value"],
  job_runs: ["job_name", "started_at", "finished_at", "status", "result", "error"],
  // B. Masters
  room_types: ["company_id", "name", "code", "sort_order", "is_active", "deactivated_at", "version"],
  area_types: ["company_id", "name", "code", "sort_order", "is_active", "deactivated_at", "version"],
  flat_types: [
    "company_id",
    "name",
    "code",
    "bhk",
    "facing",
    "description",
    "rooms",
    "areas",
    "carpet_sqft",
    "builtup_sqft",
    "super_builtup_sqft",
    "base_rate_per_sqft_paise",
    "base_price_paise",
    "spec_item_ids",
    "is_active",
    "version",
  ],
  block_types: ["company_id", "name", "code", "has_floors", "is_active", "version"],
  floor_plan_templates: ["company_id", "name", "code", "flats_per_floor", "positions", "is_active", "version"],
  amenities: ["company_id", "name", "category", "icon", "is_active", "version"],
  construction_stages: ["company_id", "name", "code", "sort_order", "is_possession", "is_active", "version"],
  payment_plans: ["company_id", "name", "code", "plan_type", "description", "grace_days", "is_active", "version"],
  payment_plan_installments: [
    "plan_id",
    "seq",
    "name",
    "percent",
    "trigger_type",
    "trigger_days",
    "trigger_stage_id",
    "trigger_date",
    "due_days",
    "notes",
  ],
  charge_types: [
    "company_id",
    "name",
    "code",
    "default_amount_paise",
    "is_taxable",
    "default_gst_percent",
    "demand_at",
    "is_active",
    "version",
  ],
  payment_modes: [
    "company_id",
    "name",
    "code",
    "requires_instrument",
    "clears_immediately",
    "is_cash",
    "sort_order",
    "is_active",
    "version",
  ],
  bank_accounts: [
    "company_id",
    "bank_name",
    "branch",
    "account_name",
    "account_number_enc",
    "account_number_last4",
    "ifsc",
    "is_default",
    "is_escrow",
    "is_active",
    "version",
  ],
  document_types: ["company_id", "name", "code", "applies_to", "is_kyc", "is_active", "version"],
  plc_types: ["company_id", "name", "code", "calc_mode", "is_active", "version"],
  spec_categories: ["company_id", "name", "sort_order", "is_active", "version"],
  spec_items: ["company_id", "category_id", "name", "description", "sort_order", "is_active", "version"],
  service_categories: ["company_id", "name", "sort_order", "default_priority", "is_active", "version"],
  // C. Projects & inventory
  projects: [
    "company_id",
    "name",
    "code",
    "project_type",
    "status",
    "description",
    "address",
    "city",
    "rera_number",
    "launch_date",
    "possession_date",
    "land_area_sqft",
    "latitude",
    "longitude",
    "landmarks",
    "approvals",
    "escrow_bank_account_id",
    "stage_sequence",
    "unit_counts",
    "block_count",
    "is_active",
    "version",
  ],
  project_amenities: ["project_id", "amenity_id"],
  project_team: ["project_id", "user_id", "role_label"],
  project_website_settings: [
    "project_id",
    "is_published",
    "slug",
    "show_prices",
    "show_availability",
    "show_progress",
    "starting_price_override_paise",
    "hero_document_ids",
    "highlights",
    "video_urls",
    "tour_urls",
    "map_embed_url",
    "brochure_document_id",
    "faqs",
    "seo",
    "brochure_download_count",
    "published_at",
  ],
  project_visit_settings: [
    "project_id",
    "enabled",
    "visit_days",
    "start_time",
    "end_time",
    "slot_minutes",
    "seats_per_slot",
    "min_lead_hours",
    "max_days_ahead",
    "blackout_dates",
    "site_office_address",
    "maps_link",
    "instructions",
  ],
  blocks: [
    "company_id",
    "project_id",
    "block_type_id",
    "name",
    "code",
    "floors",
    "floor_start",
    "ground_floor_label",
    "skip_floors",
    "refuge_floors",
    "podium_floors",
    "floor_plans",
    "numbering_pattern",
    "stage_sequence",
    "construction_percent",
    "unit_counts",
    "status",
    "sort_order",
    "is_active",
    "version",
  ],
  block_stages: [
    "company_id",
    "block_id",
    "stage_id",
    "sort_order",
    "name",
    "is_possession",
    "status",
    "started_on",
    "completed_on",
    "completed_by",
    "notes",
    "completed_at",
  ],
  stage_photos: [
    "company_id",
    "block_stage_id",
    "document_id",
    "caption",
    "visible_to_buyers",
    "show_on_website",
    "sort_order",
  ],
  flats: [
    "company_id",
    "project_id",
    "block_id",
    "flat_number",
    "floor",
    "floor_label",
    "position",
    "flat_type_id",
    "flat_type_code",
    "facing",
    "is_corner",
    "status",
    "rooms_snapshot",
    "areas_snapshot",
    "carpet_sqft",
    "builtup_sqft",
    "super_builtup_sqft",
    "rate_per_sqft_paise",
    "price_paise",
    "price_breakup",
    "rate_card_id",
    "booking_id",
    "hold_by_user_id",
    "hold_until",
    "status_changed_at",
    "status_changed_by",
    "notes",
    "version",
  ],
  parking_slots: [
    "company_id",
    "project_id",
    "number",
    "slot_type",
    "level",
    "price_paise",
    "status",
    "booking_id",
    "version",
  ],
  rate_cards: [
    "company_id",
    "project_id",
    "name",
    "effective_from",
    "status",
    "activated_at",
    "superseded_at",
    "version",
  ],
  rate_card_rates: ["rate_card_id", "flat_type_id", "rate_per_sqft_paise", "lump_sum_paise"],
  rate_card_plc_rules: [
    "rate_card_id",
    "plc_type_id",
    "calc_mode",
    "value",
    "applies_to",
    "floors_gte",
    "facings",
    "sort_order",
  ],
  // D. Customers & portal identity
  customers: [
    "company_id",
    "customer_code",
    "salutation",
    "full_name",
    "father_or_spouse_name",
    "dob",
    "gender",
    "phone",
    "alt_phone",
    "email",
    "address_current",
    "address_permanent",
    "same_as_current",
    "occupation",
    "company_name",
    "income_band",
    "source",
    "relationship_manager_id",
    "pan_enc",
    "pan_hash",
    "pan_last4",
    "aadhaar_enc",
    "aadhaar_hash",
    "aadhaar_last4",
    "bank",
    "nominee",
    "kyc_status",
    "kyc_submitted_by",
    "kyc_submitted_at",
    "kyc_verified_by",
    "kyc_verified_at",
    "kyc_remarks",
    "notes",
    "tags",
    "is_active",
    "erased_at",
    "version",
  ],
  co_applicants: [
    "company_id",
    "customer_id",
    "full_name",
    "relation",
    "phone",
    "email",
    "pan_enc",
    "pan_hash",
    "pan_last4",
    "aadhaar_enc",
    "aadhaar_last4",
    "sort_order",
    "version",
  ],
  portal_users: [
    "company_id",
    "customer_id",
    "phone",
    "password_hash",
    "must_change_password",
    "is_enabled",
    "failed_attempts",
    "locked_until",
    "last_login_at",
    "enabled_by",
    "enabled_at",
    "disabled_at",
    "version",
  ],
  // E. Leads & visits
  leads: [
    "company_id",
    "lead_number",
    "full_name",
    "phone",
    "email",
    "project_id",
    "flat_type_id",
    "budget_min_paise",
    "budget_max_paise",
    "source",
    "stage",
    "previous_stage",
    "lost_reason",
    "assigned_user_id",
    "customer_id",
    "booking_id",
    "utm",
    "message",
    "next_follow_up_at",
    "is_read",
    "consent",
    "last_activity_at",
    "version",
  ],
  lead_stage_history: ["lead_id", "from_stage", "to_stage", "by_user_id", "reason", "at"],
  lead_follow_ups: ["lead_id", "note", "done_at", "next_at", "by_user_id", "created_at"],
  lead_activities: ["lead_id", "type", "payload", "actor_type", "actor_id", "at"],
  site_visits: [
    "company_id",
    "visit_number",
    "project_id",
    "lead_id",
    "customer_id",
    "visit_date",
    "slot_start",
    "slot_end",
    "visitors",
    "name",
    "phone",
    "email",
    "message",
    "status",
    "assignee_user_id",
    "manage_token_hash",
    "manage_token_expires_at",
    "superseded_token_hashes",
    "source",
    "rescheduled_from",
    "cancel_reason",
    "notes",
    "outcome_marked_at",
    "version",
  ],
  brochure_downloads: [
    "company_id",
    "project_id",
    "lead_id",
    "token_hash",
    "expires_at",
    "downloaded_at",
    "ip",
    "user_agent",
    "created_at",
  ],
  enquiries: [
    "company_id",
    "lead_id",
    "project_id",
    "name",
    "phone",
    "email",
    "flat_type_id",
    "message",
    "source_page",
    "utm",
    "ip",
    "reference_number",
    "is_read",
    "created_at",
  ],
  // F. Plans ↔ towers, bookings, money
  payment_plan_assignments: [
    "company_id",
    "plan_id",
    "project_id",
    "block_id",
    "is_default",
    "effective_from",
    "effective_to",
    "is_active",
  ],
  booking_drafts: ["company_id", "user_id", "payload", "step", "updated_at", "version"],
  bookings: [
    "company_id",
    "booking_number",
    "project_id",
    "block_id",
    "flat_id",
    "customer_id",
    "booking_date",
    "status",
    "agreement_value_paise",
    "cash_agreed_paise",
    "account_agreed_paise",
    "list_price_paise",
    "price_deviation_reason",
    "price_deviation_by",
    "flat_snapshot",
    "rate_per_sqft_paise",
    "payment_plan_id",
    "plan_snapshot",
    "plan_accepted_on",
    "plan_acceptance_mode",
    "plan_acceptance_document_id",
    "sales_user_id",
    "lead_id",
    "broker_name",
    "remarks",
    "raised_percent",
    "cash_order_raised_paise",
    "account_order_raised_paise",
    "cash_paid_paise",
    "account_paid_paise",
    "other_charges_demanded_paise",
    "other_charges_paid_paise",
    "pending_cheques_paise",
    "last_payment_at",
    "cancellation",
    "completed_at",
    "completed_by",
    "completion_notes",
    "version",
  ],
  booking_co_applicants: ["booking_id", "customer_id"],
  booking_other_charges: [
    "company_id",
    "booking_id",
    "charge_type_id",
    "name",
    "code",
    "amount_paise",
    "gst_percent",
    "gst_paise",
    "total_paise",
    "demand_at",
    "demanded_at",
    "demand_number",
    "due_date",
    "paid_paise",
    "sort_order",
  ],
  agreement_revisions: [
    "company_id",
    "booking_id",
    "revised_at",
    "revised_by",
    "revised_by_name",
    "reason",
    "before",
    "after",
  ],
  booking_plan_revisions: [
    "company_id",
    "booking_id",
    "at",
    "by",
    "reason",
    "before_plan_snapshot",
    "after_plan_snapshot",
  ],
  demands: [
    "company_id",
    "booking_id",
    "project_id",
    "block_id",
    "customer_id",
    "demand_number",
    "installment_seq",
    "installment_name",
    "trigger_type",
    "trigger_label",
    "trigger_stage_id",
    "percent",
    "cumulative_percent",
    "cash_demand_paise",
    "account_demand_paise",
    "total_demand_paise",
    "demand_date",
    "due_date",
    "status",
    "paid_paise",
    "voided_at",
    "void_reason",
    "posted_at",
    "created_at",
  ],
  payments: [
    "company_id",
    "booking_id",
    "project_id",
    "block_id",
    "customer_id",
    "receipt_number",
    "against",
    "bucket",
    "other_charge_id",
    "amount_paise",
    "payment_date",
    "payment_mode_id",
    "mode_code",
    "instrument",
    "bank_account_id",
    "remarks",
    "received_by",
    "status",
    "cleared_at",
    "cleared_by",
    "bounced_at",
    "bounced_by",
    "bounce_reason",
    "reversed_at",
    "reversed_by",
    "reversal_reason",
    "receipt_cancelled",
    "posted_at",
    "idempotency_key",
    "version",
  ],
  ledger_entries: [
    "company_id",
    "booking_id",
    "seq",
    "at",
    "entry_date",
    "event",
    "label",
    "bucket",
    "amount_paise",
    "cash_paid_cum_paise",
    "account_paid_cum_paise",
    "cash_order_raised_paise",
    "account_order_raised_paise",
    "cash_due_paise",
    "account_due_paise",
    "total_due_paise",
    "other_charges_due_paise",
    "ref_number",
    "ref_id",
    "note",
  ],
  contra_entries: [
    "company_id",
    "entry_date",
    "type",
    "amount_paise",
    "bank_account_id",
    "remarks",
    "by_user_id",
    "created_at",
  ],
  // G. Documents, service, notifications, CMS
  documents: [
    "company_id",
    "entity_type",
    "entity_id",
    "document_type_id",
    "title",
    "file_name",
    "mime",
    "size_bytes",
    "sha256",
    "storage_key",
    "variants",
    "is_sensitive",
    "shared_with_customer",
    "uploaded_by_type",
    "uploaded_by",
    "is_deleted",
    "deleted_at",
    "created_at",
  ],
  service_requests: [
    "company_id",
    "ticket_number",
    "customer_id",
    "booking_id",
    "category_id",
    "priority",
    "subject",
    "description",
    "status",
    "assignee_user_id",
    "sla_due_at",
    "sla_breached_at",
    "resolved_at",
    "closed_at",
    "reopened_count",
    "rating",
    "rating_comment",
    "last_message_at",
    "version",
  ],
  service_request_messages: [
    "ticket_id",
    "author_type",
    "author_id",
    "author_name",
    "body",
    "is_internal",
    "attachment_ids",
    "created_at",
  ],
  notifications: [
    "company_id",
    "recipient_type",
    "recipient_id",
    "type",
    "title",
    "body",
    "entity_type",
    "entity_id",
    "link",
    "is_read",
    "read_at",
    "is_withdrawn",
    "created_at",
  ],
  notices: ["company_id", "project_id", "title", "body_md", "publish_at", "expires_at", "is_published", "created_by"],
  site_settings: [
    "company_id",
    "brand",
    "contacts",
    "offices",
    "social",
    "trust_stats",
    "value_props",
    "disclaimer",
    "seo_defaults",
    "analytics",
    "site_live",
    "coming_soon_message",
    "portal_url",
    "erp_url",
    "featured_project_ids",
    "walkthrough_video_url",
    "version",
  ],
  cms_banners: [
    "company_id",
    "title",
    "subtitle",
    "cta_label",
    "cta_url",
    "document_id",
    "sort_order",
    "starts_at",
    "ends_at",
    "is_active",
  ],
  cms_home_sections: ["company_id", "key", "title", "body", "sort_order", "is_active"],
  cms_testimonials: [
    "company_id",
    "customer_id",
    "name",
    "project_id",
    "quote",
    "rating",
    "photo_document_id",
    "is_published",
    "sort_order",
  ],
  cms_gallery: ["company_id", "project_id", "document_id", "caption", "category", "sort_order", "is_published"],
  cms_posts: [
    "company_id",
    "title",
    "slug",
    "excerpt",
    "body_md",
    "cover_document_id",
    "status",
    "published_at",
    "seo",
    "author_user_id",
    "tags",
    "version",
  ],
  cms_pages: ["company_id", "slug", "title", "body_md", "is_published", "seo", "version"],
  cms_people: ["company_id", "name", "title", "bio", "photo_document_id", "sort_order", "is_published"],
  report_presets: ["company_id", "user_id", "report_key", "name", "params"],
  integrity_runs: ["company_id", "ran_at", "triggered_by", "ok", "counts", "findings"],
  exports: [
    "company_id",
    "user_id",
    "path",
    "query",
    "status",
    "row_count",
    "storage_key",
    "error",
    "created_at",
    "finished_at",
    "expires_at",
  ],
};

interface ExpectedIndex {
  table: string;
  columns: string[];
  unique?: boolean;
  /** Substring that must appear in the index's WHERE clause (partial indexes). */
  where?: string;
}

/** Every UNIQUE / PK / INDEX listed in DATA-MODEL.md, matched by column list. */
const EXPECTED_INDEXES: ExpectedIndex[] = [
  { table: "roles", columns: ["company_id", "name"], unique: true },
  { table: "users", columns: ["company_id", "email"], unique: true },
  { table: "user_project_scopes", columns: ["user_id", "project_id"], unique: true },
  { table: "password_history", columns: ["subject_id", "created_at"] },
  { table: "refresh_tokens", columns: ["token_hash"], unique: true },
  { table: "refresh_tokens", columns: ["subject_type", "subject_id"] },
  { table: "refresh_tokens", columns: ["family_id"] },
  { table: "login_events", columns: ["created_at"] },
  { table: "login_events", columns: ["identifier"] },
  { table: "audit_logs", columns: ["entity_type", "entity_id", "created_at"] },
  { table: "audit_logs", columns: ["actor_id", "created_at"] },
  { table: "audit_logs", columns: ["created_at"] },
  { table: "audit_logs", columns: ["company_id", "created_at", "id"] },
  { table: "idempotency_keys", columns: ["scope_key", "key"], unique: true },
  { table: "idempotency_keys", columns: ["expires_at"] },
  { table: "sequences", columns: ["company_id", "scope", "fy"], unique: true },
  ...[
    "room_types",
    "area_types",
    "flat_types",
    "block_types",
    "floor_plan_templates",
    "construction_stages",
    "payment_plans",
    "charge_types",
    "payment_modes",
    "document_types",
    "plc_types",
  ].map((table) => ({ table, columns: ["company_id", "code"], unique: true })),
  { table: "amenities", columns: ["company_id", "name"], unique: true },
  { table: "construction_stages", columns: ["company_id"], unique: true, where: "is_possession" },
  { table: "payment_plan_installments", columns: ["plan_id", "seq"], unique: true },
  { table: "bank_accounts", columns: ["company_id"], unique: true, where: "is_default" },
  { table: "projects", columns: ["company_id", "code"], unique: true },
  { table: "projects", columns: ["company_id", "status"] },
  { table: "project_amenities", columns: ["project_id", "amenity_id"], unique: true },
  { table: "project_team", columns: ["project_id", "user_id"], unique: true },
  { table: "project_website_settings", columns: ["slug"], unique: true },
  { table: "blocks", columns: ["project_id", "code"], unique: true },
  { table: "blocks", columns: ["company_id", "project_id"] },
  { table: "block_stages", columns: ["block_id", "stage_id"], unique: true },
  { table: "block_stages", columns: ["block_id", "sort_order"] },
  { table: "flats", columns: ["block_id", "flat_number"], unique: true },
  { table: "flats", columns: ["project_id", "status"] },
  { table: "flats", columns: ["block_id", "floor", "position"] },
  { table: "flats", columns: ["company_id", "status", "flat_type_id"] },
  { table: "flats", columns: ["status", "hold_until"], where: "'HOLD'" },
  { table: "parking_slots", columns: ["project_id", "number"], unique: true },
  { table: "parking_slots", columns: ["project_id", "status"] },
  { table: "rate_cards", columns: ["project_id"], unique: true, where: "'ACTIVE'" },
  { table: "rate_card_rates", columns: ["rate_card_id", "flat_type_id"], unique: true },
  { table: "customers", columns: ["company_id", "customer_code"], unique: true },
  { table: "customers", columns: ["company_id", "phone"] },
  { table: "customers", columns: ["company_id", "pan_hash"] },
  { table: "customers", columns: ["company_id", "full_name"] },
  { table: "customers", columns: ["company_id", "created_at", "id"] },
  { table: "customers", columns: ["company_id", "phone"], unique: true, where: "erased_at IS NULL" },
  { table: "customers", columns: ["company_id", "pan_hash"], unique: true, where: "pan_hash IS NOT NULL" },
  { table: "portal_users", columns: ["customer_id"], unique: true },
  { table: "portal_users", columns: ["company_id", "phone"], unique: true },
  { table: "leads", columns: ["company_id", "lead_number"], unique: true },
  { table: "leads", columns: ["company_id", "phone", "project_id"] },
  { table: "leads", columns: ["company_id", "stage"] },
  { table: "leads", columns: ["assigned_user_id", "next_follow_up_at"] },
  { table: "leads", columns: ["company_id", "source", "created_at"] },
  { table: "leads", columns: ["company_id", "created_at", "id"] },
  { table: "lead_activities", columns: ["lead_id", "at"] },
  { table: "site_visits", columns: ["company_id", "visit_number"], unique: true },
  { table: "site_visits", columns: ["project_id", "visit_date", "slot_start", "status"] },
  { table: "site_visits", columns: ["assignee_user_id", "visit_date"] },
  { table: "site_visits", columns: ["company_id", "visit_date", "id"] },
  { table: "site_visits", columns: ["superseded_token_hashes"] },
  { table: "brochure_downloads", columns: ["token_hash"], unique: true },
  { table: "enquiries", columns: ["company_id", "is_read", "created_at"] },
  { table: "enquiries", columns: ["company_id", "created_at", "id"] },
  { table: "payment_plan_assignments", columns: ["plan_id", "project_id", "block_id"], unique: true },
  { table: "payment_plan_assignments", columns: ["project_id", "block_id", "is_active"] },
  { table: "booking_drafts", columns: ["user_id", "updated_at"] },
  { table: "bookings", columns: ["company_id", "booking_number"], unique: true },
  { table: "bookings", columns: ["flat_id"], unique: true, where: "'ACTIVE'" },
  { table: "bookings", columns: ["company_id", "project_id", "status", "booking_date"] },
  { table: "bookings", columns: ["block_id", "status"] },
  { table: "bookings", columns: ["customer_id"] },
  { table: "bookings", columns: ["company_id", "booking_date", "id"] },
  { table: "booking_co_applicants", columns: ["booking_id", "customer_id"], unique: true },
  { table: "booking_co_applicants", columns: ["customer_id"] },
  { table: "booking_other_charges", columns: ["booking_id"] },
  { table: "demands", columns: ["company_id", "demand_number"], unique: true },
  { table: "demands", columns: ["booking_id", "installment_seq"], unique: true, where: "'VOID'" },
  { table: "demands", columns: ["company_id", "status", "due_date"] },
  { table: "demands", columns: ["block_id", "trigger_stage_id"] },
  { table: "demands", columns: ["booking_id", "posted_at"] },
  { table: "demands", columns: ["company_id", "posted_at", "id"] },
  { table: "payments", columns: ["company_id", "receipt_number"], unique: true },
  { table: "payments", columns: ["booking_id", "status"] },
  { table: "payments", columns: ["company_id", "payment_date", "id"] },
  { table: "payments", columns: ["company_id", "idempotency_key"], unique: true, where: "idempotency_key IS NOT NULL" },
  { table: "payments", columns: ["project_id", "payment_date"] },
  { table: "payments", columns: ["company_id", "status", "payment_date"] },
  { table: "ledger_entries", columns: ["booking_id", "seq"], unique: true },
  { table: "contra_entries", columns: ["company_id", "entry_date"] },
  { table: "documents", columns: ["entity_type", "entity_id", "is_deleted"] },
  { table: "service_requests", columns: ["company_id", "ticket_number"], unique: true },
  { table: "service_requests", columns: ["company_id", "status", "priority"] },
  { table: "service_requests", columns: ["customer_id"] },
  { table: "service_requests", columns: ["assignee_user_id", "status"] },
  { table: "service_requests", columns: ["company_id", "created_at", "id"] },
  { table: "service_request_messages", columns: ["ticket_id", "created_at"] },
  { table: "notifications", columns: ["recipient_type", "recipient_id", "is_read", "created_at"] },
  { table: "notifications", columns: ["entity_type", "entity_id"] },
  { table: "notices", columns: ["company_id", "project_id", "is_published", "publish_at"] },
  { table: "cms_home_sections", columns: ["company_id", "key"], unique: true },
  { table: "cms_posts", columns: ["company_id", "slug"], unique: true },
  { table: "cms_pages", columns: ["company_id", "slug"], unique: true },
  { table: "exports", columns: ["user_id", "created_at"] },
  { table: "exports", columns: ["status", "expires_at"] },
];

/** Tables that legitimately have no company_id (the company itself, pure children/joins keyed by a parent that has one). */
const NO_COMPANY_ID = new Set([
  "companies",
  "user_project_scopes",
  "password_history",
  "idempotency_keys",
  "job_runs",
  "payment_plan_installments",
  "project_amenities",
  "project_team",
  "project_website_settings",
  "project_visit_settings",
  "rate_card_rates",
  "rate_card_plc_rules",
  "lead_stage_history",
  "lead_follow_ups",
  "lead_activities",
  "booking_co_applicants",
  "service_request_messages",
]);

/** Tables with updated_at but, per DATA-MODEL.md, no optimistic-concurrency version (engine/child rows). */
const UPDATABLE_WITHOUT_VERSION = new Set([
  "payment_plan_installments",
  "rate_card_rates",
  "rate_card_plc_rules",
  "enquiries",
  "lead_follow_ups",
  "booking_other_charges",
  "demands",
]);

interface ColumnRow {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  numeric_precision: number | null;
  numeric_scale: number | null;
  is_nullable: "YES" | "NO";
  column_default: string | null;
}

interface IndexRow {
  tablename: string;
  indexname: string;
  indexdef: string;
}

interface ParsedIndex {
  table: string;
  columns: string[];
  unique: boolean;
  where: string;
}

/** Parses `CREATE [UNIQUE] INDEX name ON public.t USING btree (a, "b" DESC) [NULLS NOT DISTINCT] [WHERE ...]` into its parts. */
function parseIndex(row: IndexRow): ParsedIndex {
  const match = /USING \w+ \((.*?)\)(?: NULLS NOT DISTINCT)?(?: WHERE (.*))?$/.exec(row.indexdef);
  const list = match?.[1] ?? "";
  const columns = list.split(",").map((c) =>
    c
      .trim()
      .replace(/"/g, "")
      .replace(/ (DESC|ASC)( NULLS (FIRST|LAST))?$/, ""),
  );
  return {
    table: row.tablename,
    columns,
    unique: row.indexdef.startsWith("CREATE UNIQUE INDEX"),
    where: match?.[2] ?? "",
  };
}

describe("DATA-MODEL.md conformance", () => {
  let handle: DbHandle;
  let columns: ColumnRow[];
  let indexes: ParsedIndex[];
  const byTable = new Map<string, Map<string, ColumnRow>>();

  beforeAll(async () => {
    handle = createDb(TEST_DATABASE_URL, { max: 2 });
    columns = await handle.sql<ColumnRow[]>`
      SELECT c.table_name, c.column_name, c.data_type, c.udt_name, c.numeric_precision, c.numeric_scale, c.is_nullable, c.column_default
      FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'`;
    for (const col of columns) {
      const cols = byTable.get(col.table_name) ?? new Map<string, ColumnRow>();
      cols.set(col.column_name, col);
      byTable.set(col.table_name, cols);
    }
    const rows = await handle.sql<
      IndexRow[]
    >`SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'`;
    indexes = rows.map(parseIndex);
  });

  afterAll(async () => {
    await handle.close();
  });

  it("has exactly the 78 tables of DATA-MODEL.md and nothing else", () => {
    const expected = Object.keys(EXPECTED_COLUMNS).sort();
    expect(expected).toHaveLength(78);
    expect([...byTable.keys()].sort()).toEqual(expected);
  });

  it("every table named in the Drizzle schema exists in the database under the same name", () => {
    const names = schemaTables()
      .map((t) => getTableName(t))
      .sort();
    expect(names).toEqual([...byTable.keys()].sort());
  });

  it("has every column DATA-MODEL.md names, on every table", () => {
    const missing: string[] = [];
    for (const [table, cols] of Object.entries(EXPECTED_COLUMNS)) {
      const actual = byTable.get(table);
      for (const col of cols) {
        if (!actual?.has(col)) missing.push(`${table}.${col}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("every Drizzle column maps to a real database column (no silent snapshot drift)", () => {
    const mismatches: string[] = [];
    for (const value of schemaTables()) {
      const table = getTableName(value);
      const actual = byTable.get(table);
      for (const col of Object.values(getTableColumns(value))) {
        if (!actual?.has(col.name)) mismatches.push(`${table}.${col.name}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("every index / unique / primary key listed in DATA-MODEL.md exists with the listed columns", () => {
    const missing: string[] = [];
    for (const exp of EXPECTED_INDEXES) {
      const found = indexes.find(
        (ix) =>
          ix.table === exp.table &&
          ix.columns.join(",") === exp.columns.join(",") &&
          (exp.unique !== true || ix.unique) &&
          (exp.where === undefined ? ix.where === "" : ix.where.includes(exp.where)),
      );
      if (!found)
        missing.push(
          `${exp.table}(${exp.columns.join(", ")})${exp.unique ? " UNIQUE" : ""}${exp.where ? ` WHERE ~${exp.where}` : ""}`,
        );
    }
    expect(missing).toEqual([]);
  });

  it("payment_plan_assignments uniqueness treats NULL block_id as a value (NULLS NOT DISTINCT)", async () => {
    const rows = await handle.sql<{ def: string }[]>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'payment_plan_assignments'::regclass AND contype = 'u'`;
    expect(rows.map((r) => r.def)).toContain("UNIQUE NULLS NOT DISTINCT (plan_id, project_id, block_id)");
  });

  it("every Postgres enum has exactly the labels (and order) of its @kkt/contracts array", async () => {
    const rows = await handle.sql<{ typname: string; labels: string[] }[]>`
      SELECT t.typname, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
      FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' GROUP BY t.typname`;
    const dbEnums = new Map(rows.map((r) => [r.typname, r.labels]));
    const enums = schemaEnums();
    expect(enums.length).toBeGreaterThan(30);
    for (const e of enums) {
      expect(dbEnums.get(e.enumName), e.enumName).toEqual([...e.enumValues]);
      for (const v of e.enumValues) expect(v, `${e.enumName}.${v}`).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
    expect([...dbEnums.keys()].sort()).toEqual(enums.map((e) => e.enumName).sort());
  });

  it("every *_paise column is a bigint and no money column uses another type or suffix", () => {
    const wrong = columns
      .filter((c) => c.column_name.endsWith("_paise") && c.data_type !== "bigint")
      .map((c) => `${c.table_name}.${c.column_name}:${c.data_type}`);
    expect(wrong).toEqual([]);
    const suspicious = columns
      .filter((c) =>
        /(amount|price|paid|agreed|raised|demand|refund|deduction|budget|lump_sum|rate_per_sqft)/.test(c.column_name),
      )
      .filter((c) => !c.column_name.endsWith("_paise") && !c.column_name.endsWith("_percent"))
      .filter((c) => c.data_type === "bigint" || c.data_type === "numeric" || c.data_type === "integer")
      .map((c) => `${c.table_name}.${c.column_name}`);
    // `rate_card_plc_rules.value` is numeric(14,4) by design (paise or percent depending on calc_mode).
    expect(suspicious).toEqual([]);
  });

  it("percent columns are numeric(5,2) and area columns numeric(10,2)", () => {
    const percentCols = columns.filter((c) => /percent$/.test(c.column_name));
    expect(percentCols.length).toBeGreaterThan(0);
    for (const c of percentCols) {
      expect([c.data_type, c.numeric_precision, c.numeric_scale], `${c.table_name}.${c.column_name}`).toEqual([
        "numeric",
        5,
        2,
      ]);
    }
    const areaCols = columns.filter((c) => /_sqft$/.test(c.column_name) && c.column_name !== "land_area_sqft");
    expect(areaCols.length).toBeGreaterThan(0);
    for (const c of areaCols) {
      expect([c.data_type, c.numeric_precision, c.numeric_scale], `${c.table_name}.${c.column_name}`).toEqual([
        "numeric",
        10,
        2,
      ]);
    }
  });

  it("business dates are `date` and event times are `timestamptz`", () => {
    const dateCols = columns.filter((c) => /(_date|_on|^dob$|^fy$)$/.test(c.column_name) && c.column_name !== "fy");
    for (const c of dateCols) {
      expect(c.data_type, `${c.table_name}.${c.column_name}`).toBe("date");
    }
    // `demand_at` is the ON_BOOKING / ON_POSSESSION / MANUAL enum, not a timestamp.
    const timeCols = columns.filter(
      (c) => (/_at$/.test(c.column_name) && c.column_name !== "demand_at") || c.column_name === "at",
    );
    for (const c of timeCols) {
      expect(c.data_type, `${c.table_name}.${c.column_name}`).toBe("timestamp with time zone");
    }
  });

  it("every business table carries company_id uuid NOT NULL referencing companies", async () => {
    const fks = await handle.sql<{ table_name: string }[]>`
      SELECT c.conrelid::regclass::text AS table_name
      FROM pg_constraint c
      WHERE c.contype = 'f' AND c.confrelid = 'companies'::regclass
        AND (SELECT attname FROM pg_attribute WHERE attrelid = c.conrelid AND attnum = c.conkey[1]) = 'company_id'`;
    const withFk = new Set(fks.map((r) => r.table_name));
    const problems: string[] = [];
    for (const [table, cols] of byTable) {
      if (NO_COMPANY_ID.has(table)) {
        continue;
      }
      const col = cols.get("company_id");
      if (!col) problems.push(`${table}: missing company_id`);
      else if (col.udt_name !== "uuid") problems.push(`${table}: company_id is ${col.udt_name}`);
      else if (col.is_nullable === "YES" && table !== "login_events") problems.push(`${table}: company_id nullable`);
      if (!withFk.has(table)) problems.push(`${table}: company_id has no FK to companies`);
    }
    expect(problems).toEqual([]);
  });

  it("every table has a primary key, and every entity table's id is uuid DEFAULT gen_random_uuid()", async () => {
    const pks = await handle.sql<{ table_name: string }[]>`
      SELECT conrelid::regclass::text AS table_name FROM pg_constraint WHERE contype = 'p'`;
    const withPk = new Set(pks.map((r) => r.table_name));
    expect([...byTable.keys()].filter((t) => !withPk.has(t))).toEqual([]);
    for (const [table, cols] of byTable) {
      const id = cols.get("id");
      if (!id) continue;
      expect(id.udt_name, `${table}.id`).toBe("uuid");
      expect(id.column_default, `${table}.id default`).toBe("gen_random_uuid()");
    }
  });

  it("every mutable row has created_at, updated_at and version (except the listed engine/child rows)", () => {
    const problems: string[] = [];
    for (const [table, cols] of byTable) {
      const hasUpdated = cols.has("updated_at");
      if (!hasUpdated) continue;
      if (!cols.has("created_at")) problems.push(`${table}: updated_at without created_at`);
      const version = cols.get("version");
      if (UPDATABLE_WITHOUT_VERSION.has(table)) {
        if (version) problems.push(`${table}: has version but is allow-listed as versionless`);
        continue;
      }
      if (!version) problems.push(`${table}: missing version`);
      else if (version.data_type !== "integer" || version.is_nullable === "YES" || version.column_default !== "1")
        problems.push(`${table}: version must be integer NOT NULL DEFAULT 1`);
    }
    expect(problems).toEqual([]);
  });

  it("the CHECK constraints of DATA-MODEL §H exist", async () => {
    const rows = await handle.sql<{ conname: string; def: string }[]>`
      SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE contype = 'c' AND connamespace = 'public'::regnamespace`;
    const defs = rows.map((r) => r.def.replace(/\s+/g, " "));
    expect(defs.some((d) => /amount_paise > 0/.test(d) && !/contra/.test(d))).toBe(true);
    expect(defs.some((d) => /visitors >= 1\) AND \(visitors <= 6/.test(d))).toBe(true);
    expect(defs.some((d) => /rating >= 1\) AND \(rating <= 5/.test(d))).toBe(true);
    expect(defs.some((d) => /slot_minutes = ANY \(ARRAY\[30, 60\]\)/.test(d))).toBe(true);
  });

  it("the money CHECK constraints of migration 0002 exist under their documented names", async () => {
    const rows = await handle.sql<{ conname: string; def: string }[]>`
      SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE contype = 'c' AND connamespace = 'public'::regnamespace`;
    const byName = new Map(rows.map((r) => [r.conname, r.def.replace(/\s+/g, " ")]));
    expect(byName.get("bookings_agreement_split_chk")).toBe(
      "CHECK (((cash_agreed_paise + account_agreed_paise) = agreement_value_paise))",
    );
    expect(byName.get("bookings_agreed_nonneg_chk")).toBe(
      "CHECK (((cash_agreed_paise >= 0) AND (account_agreed_paise >= 0)))",
    );
    expect(byName.get("demands_split_chk")).toBe(
      "CHECK (((cash_demand_paise + account_demand_paise) = total_demand_paise))",
    );
    expect(byName.get("demands_amounts_nonneg_chk")).toBe(
      "CHECK (((cash_demand_paise >= 0) AND (account_demand_paise >= 0) AND (paid_paise >= 0)))",
    );
    expect(byName.get("booking_other_charges_total_chk")).toBe("CHECK ((total_paise = (amount_paise + gst_paise)))");
    for (const name of [
      "bookings_list_price_nonneg_chk",
      "booking_other_charges_nonneg_chk",
      "flats_price_nonneg_chk",
      "parking_slots_price_nonneg_chk",
      "exports_row_count_nonneg_chk",
    ]) {
      expect(byName.has(name), name).toBe(true);
    }
  });
});
