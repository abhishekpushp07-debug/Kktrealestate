-- Migration 0005: online-migration foundation, ledger epochs, versions on mutable money rows, tenant keys, security/ops columns.
-- Hand-edited after drizzle-kit generate (docs/DATA-MODEL.md "Writing migrations"): every statement here is cheap on a large table
-- (new tables, ADD COLUMN with a constant default, constraints added NOT VALID, small backfills). Indexes on existing tables, the
-- ledger's new unique key and the VALIDATE steps run outside any transaction from src/sql/online/0005_indexes.sql.
ALTER TYPE "public"."ledger_event" ADD VALUE IF NOT EXISTS 'DEMAND_VOIDED';--> statement-breakpoint
ALTER TYPE "public"."ledger_event" ADD VALUE IF NOT EXISTS 'LEDGER_RESTATED';--> statement-breakpoint
CREATE TABLE "storage_deletions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"company_id" uuid,
	"reason" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"done_at" timestamp with time zone,
	CONSTRAINT "storage_deletions_attempts_chk" CHECK ("storage_deletions"."attempts" >= 0)
);--> statement-breakpoint
CREATE TABLE "storage_pending_objects" (
	"key" text PRIMARY KEY NOT NULL,
	"company_id" uuid,
	"purpose" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "audit_seals" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" uuid,
	"first_audit_id" uuid NOT NULL,
	"last_audit_id" uuid NOT NULL,
	"row_count" integer NOT NULL,
	"prev_hash" text,
	"hash" text NOT NULL,
	"sealed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_seals_row_count_chk" CHECK ("audit_seals"."row_count" > 0)
);--> statement-breakpoint
CREATE TABLE "ledger_rebuilds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"from_epoch" integer NOT NULL,
	"to_epoch" integer NOT NULL,
	"reason" text NOT NULL,
	"actor_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "ledger_rebuilds_epochs_chk" CHECK ("ledger_rebuilds"."to_epoch" > "ledger_rebuilds"."from_epoch" AND "ledger_rebuilds"."from_epoch" >= 1)
);--> statement-breakpoint
ALTER TABLE "companies" ALTER COLUMN "settings" SET DEFAULT '{"demand_due_days":15,"default_gst_percent":5,"round_robin_enabled":true,"force_mfa_for_admins":true,"sla_hours":{"LOW":72,"MEDIUM":48,"HIGH":24,"URGENT":8},"booking_hold_hours":48}'::jsonb;--> statement-breakpoint
-- versions on the mutable rows that had none (demands, other-charge lines, rate-card rates/PLC rules, plan installments, enquiries,
-- lead follow-ups); src/sql/0001_triggers.sql bumps them on every UPDATE that does not set version itself
ALTER TABLE "demands" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_other_charges" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "rate_card_rates" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "rate_card_plc_rules" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_plan_installments" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "lead_follow_ups" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
-- ledger epochs (contract C7); UNIQUE (booking_id, epoch, seq) replaces UNIQUE (booking_id, seq) in the online file
ALTER TABLE "bookings" ADD COLUMN "ledger_epoch" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD COLUMN "epoch" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_ledger_epoch_chk" CHECK ("bookings"."ledger_epoch" >= 1) NOT VALID;--> statement-breakpoint
-- cancellation money as columns, backfilled from the jsonb (which stays as the history record)
ALTER TABLE "bookings" ADD COLUMN "cancellation_refund_paise" bigint;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "cancellation_deduction_paise" bigint;--> statement-breakpoint
UPDATE "bookings"
SET "cancellation_refund_paise" = round(("cancellation" ->> 'refund_paise')::numeric)::bigint,
    "cancellation_deduction_paise" = round(("cancellation" ->> 'deduction_paise')::numeric)::bigint
WHERE "cancellation" IS NOT NULL AND jsonb_typeof("cancellation") = 'object'
  AND ("cancellation_refund_paise" IS NULL OR "cancellation_deduction_paise" IS NULL);--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_cancellation_amounts_nonneg_chk" CHECK (("bookings"."cancellation_refund_paise" IS NULL OR "bookings"."cancellation_refund_paise" >= 0) AND ("bookings"."cancellation_deduction_paise" IS NULL OR "bookings"."cancellation_deduction_paise" >= 0)) NOT VALID;--> statement-breakpoint
-- tenant keys (contract C4): slug backfilled from the name (lowercase kebab, "-2", "-3" … on collisions), host list
ALTER TABLE "companies" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "hosts" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
WITH base AS (
  SELECT id, created_at,
         coalesce(nullif(trim(BOTH '-' FROM regexp_replace(lower("name"), '[^a-z0-9]+', '-', 'g')), ''), 'company') AS b
  FROM "companies"
  WHERE "slug" IS NULL OR "slug" = ''
), numbered AS (
  SELECT id, b, row_number() OVER (PARTITION BY b ORDER BY created_at, id) AS n FROM base
)
UPDATE "companies" c
SET "slug" = CASE WHEN numbered.n = 1 THEN numbered.b ELSE numbered.b || '-' || numbered.n END
FROM numbered
WHERE c.id = numbered.id;--> statement-breakpoint
ALTER TABLE "companies" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_slug_format_chk" CHECK ("companies"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$') NOT VALID;--> statement-breakpoint
-- security / operations columns
ALTER TABLE "users" ADD COLUMN "totp_last_step" bigint;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN "family_started_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "refresh_tokens" r
SET "family_started_at" = f.started
FROM (SELECT "family_id", min("created_at") AS started FROM "refresh_tokens" GROUP BY "family_id") f
WHERE r."family_id" = f."family_id" AND r."family_started_at" IS DISTINCT FROM f.started;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN "committed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "job_runs" ADD COLUMN "heartbeat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "job_runs" ADD COLUMN "checkpoint" jsonb;--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "sla_paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "sla_paused_seconds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "site_visits" ADD COLUMN "ics_sequence" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_deletions" ADD CONSTRAINT "storage_deletions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_pending_objects" ADD CONSTRAINT "storage_pending_objects_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_seals" ADD CONSTRAINT "audit_seals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_rebuilds" ADD CONSTRAINT "ledger_rebuilds_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_rebuilds" ADD CONSTRAINT "ledger_rebuilds_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_rebuilds" ADD CONSTRAINT "ledger_rebuilds_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- indexes of the new tables (empty, so built in place)
CREATE INDEX "storage_deletions_due_idx" ON "storage_deletions" USING btree ("done_at","next_attempt_at");--> statement-breakpoint
CREATE INDEX "storage_deletions_company_id_idx" ON "storage_deletions" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "storage_pending_objects_created_idx" ON "storage_pending_objects" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "storage_pending_objects_company_id_idx" ON "storage_pending_objects" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "audit_seals_company_sealed_idx" ON "audit_seals" USING btree ("company_id","sealed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ledger_rebuilds_booking_at_idx" ON "ledger_rebuilds" USING btree ("booking_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ledger_rebuilds_company_id_idx" ON "ledger_rebuilds" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "ledger_rebuilds_actor_id_idx" ON "ledger_rebuilds" USING btree ("actor_id");
