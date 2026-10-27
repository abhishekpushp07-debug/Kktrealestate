-- Hand-written SQL applied by src/migrate.ts after the drizzle-kit migrations.
-- Everything here is idempotent, and lock-light on re-runs: functions are CREATE OR REPLACE (no table lock) and every trigger is
-- created only when it is missing (kkt_ensure_trigger), so a deploy never DROPs and re-CREATEs a trigger — that took an ACCESS
-- EXCLUSIVE lock on every table on every deploy (audit v3 B7). migrate.ts re-applies this file only when its checksum changed or a new
-- drizzle migration was applied (new tables need their updated_at / version triggers). To change an existing trigger's definition,
-- drop it explicitly in the same change (the next run re-creates it).

-- 0. Helper: CREATE TRIGGER <name> ON <table> <definition> unless that trigger already exists on that table.
CREATE OR REPLACE FUNCTION kkt_ensure_trigger(tbl regclass, trg name, definition text) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = tbl AND tgname = trg AND NOT tgisinternal) THEN
    RETURN false;
  END IF;
  EXECUTE format('CREATE TRIGGER %I %s', trg, replace(definition, '{table}', tbl::text));
  RETURN true;
END;
$$;

-- 1. audit_logs is append-only: any UPDATE, DELETE or TRUNCATE raises.
--    UPDATE/DELETE are row-level triggers; TRUNCATE never fires row triggers, so it
--    needs its own statement-level trigger or a plain TRUNCATE would wipe the log.
CREATE OR REPLACE FUNCTION audit_logs_immutable_fn() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is immutable: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

SELECT kkt_ensure_trigger('audit_logs', 'audit_logs_immutable',
  'BEFORE UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable_fn()');
SELECT kkt_ensure_trigger('audit_logs', 'audit_logs_no_truncate',
  'BEFORE TRUNCATE ON {table} FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_immutable_fn()');

-- 1b. audit_seals (the hash chain over audit_logs, migration 0005) is append-only for the same reason.
SELECT kkt_ensure_trigger('audit_seals', 'audit_seals_immutable',
  'BEFORE UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable_fn()');
SELECT kkt_ensure_trigger('audit_seals', 'audit_seals_no_truncate',
  'BEFORE TRUNCATE ON {table} FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_immutable_fn()');

-- 2. Financial source records are never deleted (SPEC §2): payments are REVERSED and
--    demands are VOIDED with a reason. The application role additionally has no DELETE privilege on them (0002_privileges.sql).
CREATE OR REPLACE FUNCTION financial_row_no_delete_fn() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are never deleted: reverse or void them with a reason instead', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;

SELECT kkt_ensure_trigger('payments', 'payments_no_delete',
  'BEFORE DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION financial_row_no_delete_fn()');
SELECT kkt_ensure_trigger('demands', 'demands_no_delete',
  'BEFORE DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION financial_row_no_delete_fn()');

-- 3. updated_at maintenance: one trigger per table that has an updated_at column (created only where missing).
CREATE OR REPLACE FUNCTION set_updated_at_fn() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables tb
      ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'updated_at'
      AND tb.table_type = 'BASE TABLE'
  LOOP
    PERFORM kkt_ensure_trigger(format('public.%I', t.table_name)::regclass, 'set_updated_at',
      'BEFORE UPDATE ON {table} FOR EACH ROW EXECUTE FUNCTION set_updated_at_fn()');
  END LOOP;
END;
$$;

-- 4. Version maintenance for the child/engine rows versioned by migration 0005 (demands, other-charge lines, rate-card rates and PLC
--    rules, plan installments, enquiries, lead follow-ups): engines update them in place (a payment raising a demand's paid amount),
--    so every UPDATE bumps `version` unless the statement already changed it (applyUpdate sets version = version + 1 WHERE version = n).
--    A client acting on a demand it read before such a change gets 409 VERSION_CONFLICT instead of overwriting it.
CREATE OR REPLACE FUNCTION bump_version_fn() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.version IS NOT DISTINCT FROM OLD.version THEN
    NEW.version = OLD.version + 1;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['demands', 'booking_other_charges', 'rate_card_rates', 'rate_card_plc_rules', 'payment_plan_installments',
                           'enquiries', 'lead_follow_ups']
  LOOP
    PERFORM kkt_ensure_trigger(format('public.%I', t)::regclass, 'bump_version',
      'BEFORE UPDATE ON {table} FOR EACH ROW EXECUTE FUNCTION bump_version_fn()');
  END LOOP;
END;
$$;

-- 5. companies.slug (migration 0005, contract C4): derived from the name when an insert (or an update) leaves it NULL or empty —
--    lowercase kebab, "company" when nothing is left, "-2", "-3" … while taken.
CREATE OR REPLACE FUNCTION kkt_slugify(input text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(nullif(trim(BOTH '-' FROM regexp_replace(lower(coalesce(input, '')), '[^a-z0-9]+', '-', 'g')), ''), 'company')
$$;

CREATE OR REPLACE FUNCTION companies_set_slug_fn() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  base text;
  candidate text;
  n int := 1;
BEGIN
  IF NEW.slug IS NOT NULL AND NEW.slug <> '' THEN
    RETURN NEW;
  END IF;
  base := kkt_slugify(NEW.name);
  candidate := base;
  WHILE EXISTS (SELECT 1 FROM companies WHERE slug = candidate AND id IS DISTINCT FROM NEW.id) LOOP
    n := n + 1;
    candidate := base || '-' || n;
  END LOOP;
  NEW.slug := candidate;
  RETURN NEW;
END;
$$;

SELECT kkt_ensure_trigger('companies', 'companies_set_slug',
  'BEFORE INSERT OR UPDATE OF slug ON {table} FOR EACH ROW EXECUTE FUNCTION companies_set_slug_fn()');

-- 6. Partial unique indexes (database-enforced invariants, DATA-MODEL §H).
--    drizzle-kit emits these in the generated migration; they are repeated here so a database whose migration predates them is still
--    covered. Only a MISSING index is created: a plain `CREATE INDEX IF NOT EXISTS` takes its SHARE lock on the table before it notices
--    the index exists, so every re-run of this file would queue behind any open write transaction on the table and stall every write
--    that arrives meanwhile (packages/db/test/online.test.ts re-applies this file while a writer holds the tables).
DO $$
BEGIN
  IF to_regclass('public.demands_booking_seq_nonvoid_uq') IS NULL THEN
    CREATE UNIQUE INDEX demands_booking_seq_nonvoid_uq ON demands (booking_id, installment_seq) WHERE status <> 'VOID';
  END IF;
  IF to_regclass('public.bookings_one_active_per_flat_uq') IS NULL THEN
    CREATE UNIQUE INDEX bookings_one_active_per_flat_uq ON bookings (flat_id) WHERE status = 'ACTIVE';
  END IF;
  IF to_regclass('public.rate_cards_one_active_uq') IS NULL THEN
    CREATE UNIQUE INDEX rate_cards_one_active_uq ON rate_cards (project_id) WHERE status = 'ACTIVE';
  END IF;
  IF to_regclass('public.bank_accounts_one_default_uq') IS NULL THEN
    CREATE UNIQUE INDEX bank_accounts_one_default_uq ON bank_accounts (company_id) WHERE is_default;
  END IF;
  IF to_regclass('public.construction_stages_one_possession_uq') IS NULL THEN
    CREATE UNIQUE INDEX construction_stages_one_possession_uq ON construction_stages (company_id) WHERE is_possession;
  END IF;
END;
$$;
