-- Online part of migration 0006 (see drizzle/0006_list_order_indexes.sql): every DESC index key becomes plain DESC (= NULLS FIRST), so
-- `ORDER BY col DESC` (forward scan) and `ORDER BY col ASC` (backward scan) both use it. Per index, idempotently:
--   1. a DO block renames the old index (DESC NULLS LAST) to <name>_nl — catalog only, SHARE UPDATE EXCLUSIVE, no table scan; it is skipped
--      when the index already has the new order (a re-run) and on a partitioned table (packages/db/partitions: DROP INDEX CONCURRENTLY
--      cannot drop a partitioned index; those installs keep the old order until a maintenance window, docs/DATA-MODEL.md §J);
--   2. CREATE INDEX CONCURRENTLY IF NOT EXISTS builds the new index under the original name without blocking writes;
--   3. DROP INDEX CONCURRENTLY IF EXISTS removes the renamed old one.
-- The planner keeps using the old index until the new one is valid, so no query loses its index at any point.
-- packages/db/test/online.test.ts fails on any DESC NULLS LAST index key.


DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'agreement_revisions_booking_idx' AND indexdef LIKE '%NULLS LAST%')
     AND (SELECT c.relkind FROM pg_class c WHERE c.oid = 'public.agreement_revisions'::regclass) <> 'p' THEN
    ALTER INDEX "agreement_revisions_booking_idx" RENAME TO "agreement_revisions_booking_idx_nl";
  END IF;
END
$$;
CREATE INDEX CONCURRENTLY IF NOT EXISTS "agreement_revisions_booking_idx" ON "agreement_revisions" USING btree ("booking_id", "revised_at" DESC);
DROP INDEX CONCURRENTLY IF EXISTS "agreement_revisions_booking_idx_nl";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'booking_drafts_user_updated_idx' AND indexdef LIKE '%NULLS LAST%')
     AND (SELECT c.relkind FROM pg_class c WHERE c.oid = 'public.booking_drafts'::regclass) <> 'p' THEN
    ALTER INDEX "booking_drafts_user_updated_idx" RENAME TO "booking_drafts_user_updated_idx_nl";
  END IF;
END
$$;
CREATE INDEX CONCURRENTLY IF NOT EXISTS "booking_drafts_user_updated_idx" ON "booking_drafts" USING btree ("user_id", "updated_at" DESC);
DROP INDEX CONCURRENTLY IF EXISTS "booking_drafts_user_updated_idx_nl";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'booking_plan_revisions_booking_idx' AND indexdef LIKE '%NULLS LAST%')
     AND (SELECT c.relkind FROM pg_class c WHERE c.oid = 'public.booking_plan_revisions'::regclass) <> 'p' THEN
    ALTER INDEX "booking_plan_revisions_booking_idx" RENAME TO "booking_plan_revisions_booking_idx_nl";
  END IF;
END
$$;
CREATE INDEX CONCURRENTLY IF NOT EXISTS "booking_plan_revisions_booking_idx" ON "booking_plan_revisions" USING btree ("booking_id", "at" DESC);
DROP INDEX CONCURRENTLY IF EXISTS "booking_plan_revisions_booking_idx_nl";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'bookings_company_project_status_date_idx' AND indexdef LIKE '%NULLS LAST%')
     AND (SELECT c.relkind FROM pg_class c WHERE c.oid = 'public.bookings'::regclass) <> 'p' THEN
    ALTER INDEX "bookings_company_project_status_date_idx" RENAME TO "bookings_company_project_status_date_idx_nl";
  END IF;
END
$$;
CREATE INDEX CONCURRENTLY IF NOT EXISTS "bookings_company_project_status_date_idx" ON "bookings" USING btree ("company_id", "project_id", "status", "booking_date" DESC);
DROP INDEX CONCURRENTLY IF EXISTS "bookings_company_project_status_date_idx_nl";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'bookings_company_booking_date_idx' AND indexdef LIKE '%NULLS LAST%')
     AND (SELECT c.relkind FROM pg_class c WHERE c.oid = 'public.bookings'::regclass) <> 'p' THEN
    ALTER INDEX "bookings_company_booking_date_idx" RENAME TO "bookings_company_booking_date_idx_nl";
  END IF;
END
$$;
CREATE INDEX CONCURRENTLY IF NOT EXISTS "bookings_company_booking_date_idx" ON "bookings" USING btree ("company_id", "booking_date" DESC,"id" DESC);
DROP INDEX CONCURRENTLY IF EXISTS "bookings_company_booking_date_idx_nl";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'cms_posts_company_status_published_idx' AND indexdef LIKE '%NULLS LAST%')
     AND (SELECT c.relkind FROM pg_class c WHERE c.oid = 'public.cms_posts'::regclass) <> 'p' THEN
    ALTER INDEX "cms_posts_company_status_published_idx" RENAME TO "cms_posts_company_status_published_idx_nl";
  END IF;
END
$$;
CREATE INDEX CONCURRENTLY IF NOT EXISTS "cms_posts_company_status_published_idx" ON "cms_posts" USING btree ("company_id", "status", "published_at" DESC);
DROP INDEX CONCURRENTLY IF EXISTS "cms_posts_company_status_published_idx_nl";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'customers_company_created_idx' AND indexdef LIKE '%NULLS LAST%')
     AND (SELECT c.relkind FROM pg_class c WHERE c.oid = 'public.customers'::regclass) <> 'p' THEN
    ALTER INDEX "customers_company_created_idx" RENAME TO "customers_company_created_idx_nl";
  END IF;
END
$$;
CREATE INDEX CONCURRENTLY IF NOT EXISTS "customers_company_created_idx" ON "customers" USING btree ("company_id", "created_at" DESC,"id" DESC);
DROP INDEX CONCURRENTLY IF EXISTS "customers_company_created_idx_nl";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'audit_logs_entity_idx' AND indexdef LIKE '%NULLS LAST%')
     AND (SELECT c.relkind FROM pg_class c WHERE c.oid = 'public.audit_logs'::regclass) <> 'p' THEN
    ALTER INDEX "audit_logs_entity_idx" RENAME TO "audit_logs_entity_idx_nl";
  END IF;
END
$$;
CREATE INDEX CONCURRENTLY IF NOT EXISTS "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type", "entity_id", "created_at" DESC);
DROP INDEX CONCURRENTLY IF EXISTS "audit_logs_entity_idx_nl";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'audit_logs_actor_idx' AND indexdef LIKE '%NULLS LAST%')
     AND (SELECT c.relkind FROM pg_class c WHERE c.oid = 'public.audit_logs'::regclass) <> 'p' THEN
    ALTER INDEX "audit_logs_actor_idx" RENAME TO "audit_logs_actor_idx_nl";
  END IF;
END
$$;
CREATE INDEX CONCURRENTLY IF NOT EXISTS "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_id", "created_at" DESC);
DROP INDEX CONCURRENTLY IF EXISTS "audit_logs_actor_idx_nl";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'audit_logs_created_idx' AND indexdef LIKE '%NULLS LAST%')
     AND (SELECT c.relkind FROM pg_class c WHERE c.oid = 'public.audit_logs'::regclass) <> 'p' THEN
    ALTER INDEX "audit_logs_created_idx" RENAME TO "audit_logs_created_idx_nl";
  END IF;
END
$$;
CREATE INDEX CONCURRENTLY IF NOT EXISTS "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at" DESC);
DROP INDEX CONCURRENTLY IF EXISTS "audit_logs_created_idx_nl";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'audit_logs_company_created_idx' AND indexdef LIKE '%NULLS LAST%')
     AND (SELECT c.relkind FROM pg_class c WHERE c.oid = 'public.audit_logs'::regclass) <> 'p' THEN
    ALTER INDEX "audit_logs_company_created_idx" RENAME TO "audit_logs_company_created_idx_nl";
  END IF;
END
$$;
CREATE INDEX CONCURRENTLY IF NOT EXISTS "audit_logs_company_created_idx" ON "audit_logs" USING btree ("company_id", "created_at" DESC,"id" DESC);
DROP INDEX CONCURRENTLY IF EXISTS "audit_logs_company_created_idx_nl";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'audit_seals_company_sealed_idx' AND indexdef LIKE '%NULLS LAST%')
     AND (SELECT c.relkind FROM pg_class c WHERE c.oid = 'public.audit_seals'::regclass) <> 'p' THEN
    ALTER INDEX "audit_seals_company_sealed_idx" RENAME TO "audit_seals_company_sealed_idx_nl";
  END IF;
END
$$;
CREATE INDEX CONCURRENTLY IF NOT EXISTS "audit_seals_company_sealed_idx" ON "audit_seals" USING btree ("company_id", "sealed_at" DESC);
DROP INDEX CONCURRENTLY IF EXISTS "audit_seals_company_sealed_idx_nl";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'job_runs_name_started_idx' AND indexdef LIKE '%NULLS LAST%')
     AND (SELECT c.relkind FROM pg_class c WHERE c.oid = 'public.job_runs'::regclass) <> 'p' THEN
    ALTER INDEX "job_runs_name_started_idx" RENAME TO "job_runs_name_started_idx_nl";
  END IF;
END
$$;
CREATE INDEX CONCURRENTLY IF NOT EXISTS "job_runs_name_started_idx" ON "job_runs" USING btree ("job_name", "started_at" DESC);
DROP INDEX CONCURRENTLY IF EXISTS "job_runs_name_started_idx_nl";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'login_events_created_idx' AND indexdef LIKE '%NULLS LAST%')
     AND (SELECT c.relkind FROM pg_class c WHERE c.oid = 'public.login_events'::regclass) <> 'p' THEN
    ALTER INDEX "login_events_created_idx" RENAME TO "login_events_created_idx_nl";
  END IF;
END
$$;
CREATE INDEX CONCURRENTLY IF NOT EXISTS "login_events_created_idx" ON "login_events" USING btree ("created_at" DESC);
DROP INDEX CONCURRENTLY IF EXISTS "login_events_created_idx_nl";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'password_history_subject_idx' AND indexdef LIKE '%NULLS LAST%')
     AND (SELECT c.relkind FROM pg_class c WHERE c.oid = 'public.password_history'::regclass) <> 'p' THEN
    ALTER INDEX "password_history_subject_idx" RENAME TO "password_history_subject_idx_nl";
  END IF;
END
$$;
CREATE INDEX CONCURRENTLY IF NOT EXISTS "password_history_subject_idx" ON "password_history" USING btree ("subject_id", "created_at" DESC);
DROP INDEX CONCURRENTLY IF EXISTS "password_history_subject_idx_nl";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'rate_cards_project_idx' AND indexdef LIKE '%NULLS LAST%')
     AND (SELECT c.relkind FROM pg_class c WHERE c.oid = 'public.rate_cards'::regclass) <> 'p' THEN
    ALTER INDEX "rate_cards_project_idx" RENAME TO "rate_cards_project_idx_nl";
  END IF;
END
$$;
CREATE INDEX CONCURRENTLY IF NOT EXISTS "rate_cards_project_idx" ON "rate_cards" USING btree ("project_id", "effective_from" DESC);
DROP INDEX CONCURRENTLY IF EXISTS "rate_cards_project_idx_nl";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'brochure_downloads_project_created_idx' AND indexdef LIKE '%NULLS LAST%')
     AND (SELECT c.relkind FROM pg_class c WHERE c.oid = 'public.brochure_downloads'::regclass) <> 'p' THEN
    ALTER INDEX "brochure_downloads_project_created_idx" RENAME TO "brochure_downloads_project_created_idx_nl";
  END IF;
END
$$;
CREATE INDEX CONCURRENTLY IF NOT EXISTS "brochure_downloads_project_created_idx" ON "brochure_downloads" USING btree ("project_id", "created_at" DESC);
DROP INDEX CONCURRENTLY IF EXISTS "brochure_downloads_project_created_idx_nl";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'enquiries_company_read_created_idx' AND indexdef LIKE '%NULLS LAST%')
     AND (SELECT c.relkind FROM pg_class c WHERE c.oid = 'public.enquiries'::regclass) <> 'p' THEN
    ALTER INDEX "enquiries_company_read_created_idx" RENAME TO "enquiries_company_read_created_idx_nl";
  END IF;
END
$$;
CREATE INDEX CONCURRENTLY IF NOT EXISTS "enquiries_company_read_created_idx" ON "enquiries" USING btree ("company_id", "is_read", "created_at" DESC);
DROP INDEX CONCURRENTLY IF EXISTS "enquiries_company_read_created_idx_nl";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'enquiries_company_created_idx' AND indexdef LIKE '%NULLS LAST%')
     AND (SELECT c.relkind FROM pg_class c WHERE c.oid = 'public.enquiries'::regclass) <> 'p' THEN
    ALTER INDEX "enquiries_company_created_idx" RENAME TO "enquiries_company_created_idx_nl";
  END IF;
END
$$;
CREATE INDEX CONCURRENTLY IF NOT EXISTS "enquiries_company_created_idx" ON "enquiries" USING btree ("company_id", "created_at" DESC,"id" DESC);
DROP INDEX CONCURRENTLY IF EXISTS "enquiries_company_created_idx_nl";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'lead_activities_lead_idx' AND indexdef LIKE '%NULLS LAST%')
     AND (SELECT c.relkind FROM pg_class c WHERE c.oid = 'public.lead_activities'::regclass) <> 'p' THEN
    ALTER INDEX "lead_activities_lead_idx" RENAME TO "lead_activities_lead_idx_nl";
  END IF;
END
$$;
CREATE INDEX CONCURRENTLY IF NOT EXISTS "lead_activities_lead_idx" ON "lead_activities" USING btree ("lead_id", "at" DESC);
DROP INDEX CONCURRENTLY IF EXISTS "lead_activities_lead_idx_nl";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'lead_follow_ups_lead_idx' AND indexdef LIKE '%NULLS LAST%')
     AND (SELECT c.relkind FROM pg_class c WHERE c.oid = 'public.lead_follow_ups'::regclass) <> 'p' THEN
    ALTER INDEX "lead_follow_ups_lead_idx" RENAME TO "lead_follow_ups_lead_idx_nl";
  END IF;
END
$$;
CREATE INDEX CONCURRENTLY IF NOT EXISTS "lead_follow_ups_lead_idx" ON "lead_follow_ups" USING btree ("lead_id", "created_at" DESC);
DROP INDEX CONCURRENTLY IF EXISTS "lead_follow_ups_lead_idx_nl";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'lead_stage_history_lead_idx' AND indexdef LIKE '%NULLS LAST%')
     AND (SELECT c.relkind FROM pg_class c WHERE c.oid = 'public.lead_stage_history'::regclass) <> 'p' THEN
    ALTER INDEX "lead_stage_history_lead_idx" RENAME TO "lead_stage_history_lead_idx_nl";
  END IF;
END
$$;
CREATE INDEX CONCURRENTLY IF NOT EXISTS "lead_stage_history_lead_idx" ON "lead_stage_history" USING btree ("lead_id", "at" DESC);
DROP INDEX CONCURRENTLY IF EXISTS "lead_stage_history_lead_idx_nl";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'leads_company_source_created_idx' AND indexdef LIKE '%NULLS LAST%')
     AND (SELECT c.relkind FROM pg_class c WHERE c.oid = 'public.leads'::regclass) <> 'p' THEN
    ALTER INDEX "leads_company_source_created_idx" RENAME TO "leads_company_source_created_idx_nl";
  END IF;
END
$$;
CREATE INDEX CONCURRENTLY IF NOT EXISTS "leads_company_source_created_idx" ON "leads" USING btree ("company_id", "source", "created_at" DESC);
DROP INDEX CONCURRENTLY IF EXISTS "leads_company_source_created_idx_nl";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'leads_company_created_idx' AND indexdef LIKE '%NULLS LAST%')
     AND (SELECT c.relkind FROM pg_class c WHERE c.oid = 'public.leads'::regclass) <> 'p' THEN
    ALTER INDEX "leads_company_created_idx" RENAME TO "leads_company_created_idx_nl";
  END IF;
END
$$;
CREATE INDEX CONCURRENTLY IF NOT EXISTS "leads_company_created_idx" ON "leads" USING btree ("company_id", "created_at" DESC,"id" DESC);
DROP INDEX CONCURRENTLY IF EXISTS "leads_company_created_idx_nl";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'site_visits_company_visit_date_idx' AND indexdef LIKE '%NULLS LAST%')
     AND (SELECT c.relkind FROM pg_class c WHERE c.oid = 'public.site_visits'::regclass) <> 'p' THEN
    ALTER INDEX "site_visits_company_visit_date_idx" RENAME TO "site_visits_company_visit_date_idx_nl";
  END IF;
END
$$;
CREATE INDEX CONCURRENTLY IF NOT EXISTS "site_visits_company_visit_date_idx" ON "site_visits" USING btree ("company_id", "visit_date" DESC,"id" DESC);
DROP INDEX CONCURRENTLY IF EXISTS "site_visits_company_visit_date_idx_nl";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'demands_company_posted_idx' AND indexdef LIKE '%NULLS LAST%')
     AND (SELECT c.relkind FROM pg_class c WHERE c.oid = 'public.demands'::regclass) <> 'p' THEN
    ALTER INDEX "demands_company_posted_idx" RENAME TO "demands_company_posted_idx_nl";
  END IF;
END
$$;
CREATE INDEX CONCURRENTLY IF NOT EXISTS "demands_company_posted_idx" ON "demands" USING btree ("company_id", "posted_at" DESC,"id" DESC);
DROP INDEX CONCURRENTLY IF EXISTS "demands_company_posted_idx_nl";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'ledger_rebuilds_booking_at_idx' AND indexdef LIKE '%NULLS LAST%')
     AND (SELECT c.relkind FROM pg_class c WHERE c.oid = 'public.ledger_rebuilds'::regclass) <> 'p' THEN
    ALTER INDEX "ledger_rebuilds_booking_at_idx" RENAME TO "ledger_rebuilds_booking_at_idx_nl";
  END IF;
END
$$;
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ledger_rebuilds_booking_at_idx" ON "ledger_rebuilds" USING btree ("booking_id", "at" DESC);
DROP INDEX CONCURRENTLY IF EXISTS "ledger_rebuilds_booking_at_idx_nl";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'payments_company_date_idx' AND indexdef LIKE '%NULLS LAST%')
     AND (SELECT c.relkind FROM pg_class c WHERE c.oid = 'public.payments'::regclass) <> 'p' THEN
    ALTER INDEX "payments_company_date_idx" RENAME TO "payments_company_date_idx_nl";
  END IF;
END
$$;
CREATE INDEX CONCURRENTLY IF NOT EXISTS "payments_company_date_idx" ON "payments" USING btree ("company_id", "payment_date" DESC,"id" DESC);
DROP INDEX CONCURRENTLY IF EXISTS "payments_company_date_idx_nl";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'payments_project_date_idx' AND indexdef LIKE '%NULLS LAST%')
     AND (SELECT c.relkind FROM pg_class c WHERE c.oid = 'public.payments'::regclass) <> 'p' THEN
    ALTER INDEX "payments_project_date_idx" RENAME TO "payments_project_date_idx_nl";
  END IF;
END
$$;
CREATE INDEX CONCURRENTLY IF NOT EXISTS "payments_project_date_idx" ON "payments" USING btree ("project_id", "payment_date" DESC);
DROP INDEX CONCURRENTLY IF EXISTS "payments_project_date_idx_nl";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'notifications_recipient_idx' AND indexdef LIKE '%NULLS LAST%')
     AND (SELECT c.relkind FROM pg_class c WHERE c.oid = 'public.notifications'::regclass) <> 'p' THEN
    ALTER INDEX "notifications_recipient_idx" RENAME TO "notifications_recipient_idx_nl";
  END IF;
END
$$;
CREATE INDEX CONCURRENTLY IF NOT EXISTS "notifications_recipient_idx" ON "notifications" USING btree ("recipient_type", "recipient_id", "is_read", "created_at" DESC);
DROP INDEX CONCURRENTLY IF EXISTS "notifications_recipient_idx_nl";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'service_requests_company_created_idx' AND indexdef LIKE '%NULLS LAST%')
     AND (SELECT c.relkind FROM pg_class c WHERE c.oid = 'public.service_requests'::regclass) <> 'p' THEN
    ALTER INDEX "service_requests_company_created_idx" RENAME TO "service_requests_company_created_idx_nl";
  END IF;
END
$$;
CREATE INDEX CONCURRENTLY IF NOT EXISTS "service_requests_company_created_idx" ON "service_requests" USING btree ("company_id", "created_at" DESC,"id" DESC);
DROP INDEX CONCURRENTLY IF EXISTS "service_requests_company_created_idx_nl";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'exports_user_created_idx' AND indexdef LIKE '%NULLS LAST%')
     AND (SELECT c.relkind FROM pg_class c WHERE c.oid = 'public.exports'::regclass) <> 'p' THEN
    ALTER INDEX "exports_user_created_idx" RENAME TO "exports_user_created_idx_nl";
  END IF;
END
$$;
CREATE INDEX CONCURRENTLY IF NOT EXISTS "exports_user_created_idx" ON "exports" USING btree ("user_id", "created_at" DESC);
DROP INDEX CONCURRENTLY IF EXISTS "exports_user_created_idx_nl";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'integrity_runs_company_ran_idx' AND indexdef LIKE '%NULLS LAST%')
     AND (SELECT c.relkind FROM pg_class c WHERE c.oid = 'public.integrity_runs'::regclass) <> 'p' THEN
    ALTER INDEX "integrity_runs_company_ran_idx" RENAME TO "integrity_runs_company_ran_idx_nl";
  END IF;
END
$$;
CREATE INDEX CONCURRENTLY IF NOT EXISTS "integrity_runs_company_ran_idx" ON "integrity_runs" USING btree ("company_id", "ran_at" DESC);
DROP INDEX CONCURRENTLY IF EXISTS "integrity_runs_company_ran_idx_nl";
