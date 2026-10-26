-- Monthly range partitioning helpers for the append-heavy tables (audit_logs, ledger_entries, login_events, notifications).
-- OPT-IN (see README.md): nothing here runs with the normal migrations. Every function is idempotent (CREATE OR REPLACE) and safe to
-- re-run. Partitions are calendar months in UTC on created_at: <table>_yYYYYmMM, plus <table>_default as a safety net.

-- Name of the partition of `parent` holding `month`.
CREATE OR REPLACE FUNCTION kkt_partition_name(parent text, month date) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT format('%s_y%sm%s', parent, to_char(month, 'YYYY'), to_char(month, 'MM'))
$$;

-- Statement-level triggers (e.g. audit_logs_no_truncate) are not cloned to partitions; copy them so a TRUNCATE aimed at one
-- partition is refused exactly like a TRUNCATE of the parent.
CREATE OR REPLACE FUNCTION kkt_copy_statement_triggers(parent text, child text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT tg.tgname, pg_get_triggerdef(tg.oid) AS def
    FROM pg_trigger tg
    WHERE tg.tgrelid = format('public.%I', parent)::regclass AND NOT tg.tgisinternal AND (tg.tgtype & 1) = 0  -- bit 0 = FOR EACH ROW
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = format('public.%I', child)::regclass AND tgname = t.tgname) THEN
      EXECUTE replace(t.def, format(' ON public.%s ', parent), format(' ON public.%I ', child));
    END IF;
  END LOOP;
END;
$$;

-- Creates the [month, month + 1) UTC partition of `parent` unless it exists or the month is already covered by another partition
-- (the <table>_legacy partition covers everything before the month after partitioning); returns its name, or NULL when nothing was
-- created. Rows already sitting in the DEFAULT partition for that month make this fail loudly (move them first).
CREATE OR REPLACE FUNCTION kkt_create_month_partition(parent text, month date) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  start_d date := date_trunc('month', month)::date;
  name text := kkt_partition_name(parent, start_d);
BEGIN
  IF to_regclass(format('public.%I', name)) IS NOT NULL THEN
    RETURN NULL;
  END IF;
  BEGIN
    EXECUTE format(
      'CREATE TABLE public.%I PARTITION OF public.%I FOR VALUES FROM (%L) TO (%L)',
      name, parent, (start_d::timestamp AT TIME ZONE 'UTC'), ((start_d + interval '1 month')::timestamp AT TIME ZONE 'UTC')
    );
  EXCEPTION WHEN invalid_object_definition THEN
    -- "partition would overlap partition …": that month is already covered (legacy partition)
    RETURN NULL;
  END;
  PERFORM kkt_copy_statement_triggers(parent, name);
  RETURN name;
END;
$$;

-- The tables this plan partitions.
CREATE OR REPLACE FUNCTION kkt_partitioned_tables() RETURNS SETOF text
LANGUAGE sql STABLE AS $$
  SELECT c.relname::text
  FROM pg_partitioned_table p JOIN pg_class c ON c.oid = p.partrelid
  WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('audit_logs', 'ledger_entries', 'login_events', 'notifications')
  ORDER BY 1
$$;

-- Creates the partitions of the current UTC month and the next `months_ahead` months for every partitioned table (job
-- PARTITION_MAINTENANCE calls this daily when PARTITIONING_ENABLED=true). Returns the partitions it created.
-- SECURITY DEFINER: the API/worker connect as the DML-only role kkt_app (infra/postgres/init/01-roles.sql), which may not create tables,
-- so this one entry point runs with the privileges of its owner (whoever applied these scripts: kkt_owner). It takes only a month count
-- and touches only the four tables above; the other helpers stay SECURITY INVOKER (owner-only in practice). search_path is pinned.
CREATE OR REPLACE FUNCTION kkt_create_next_partitions(months_ahead int DEFAULT 2) RETURNS SETOF text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  parent text;
  i int;
  created text;
  this_month date := date_trunc('month', now() AT TIME ZONE 'UTC')::date;
BEGIN
  FOR parent IN SELECT kkt_partitioned_tables() LOOP
    FOR i IN 0..GREATEST(months_ahead, 0) LOOP
      created := kkt_create_month_partition(parent, (this_month + make_interval(months => i))::date);
      IF created IS NOT NULL THEN
        RETURN NEXT created;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

-- Only the application role may call the definer function (not PUBLIC); a no-op where kkt_app does not exist (plain dev databases).
REVOKE ALL ON FUNCTION kkt_create_next_partitions(int) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'kkt_app') THEN
    GRANT EXECUTE ON FUNCTION kkt_create_next_partitions(int) TO kkt_app;
  END IF;
END
$$;

-- ledger_entries keeps its "one seq per booking" invariant after partitioning: a UNIQUE index on a partitioned table must contain the
-- partition key, so (booking_id, seq) uniqueness is enforced by this trigger instead. The transaction-scoped advisory lock on
-- (booking, seq) serialises concurrent inserts of the same pair, and the EXISTS check (a new snapshot under READ COMMITTED, the
-- isolation level the API uses) then sees the committed winner. The money module already serialises ledger appends per booking.
CREATE OR REPLACE FUNCTION ledger_entries_booking_seq_unique_fn() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('ledger_entries:' || NEW.booking_id::text), NEW.seq);
  IF EXISTS (SELECT 1 FROM public.ledger_entries WHERE booking_id = NEW.booking_id AND seq = NEW.seq AND id <> NEW.id) THEN
    RAISE EXCEPTION 'duplicate key value violates unique constraint "ledger_entries_booking_seq_uq"'
      USING ERRCODE = 'unique_violation', DETAIL = format('Key (booking_id, seq)=(%s, %s) already exists.', NEW.booking_id, NEW.seq),
            CONSTRAINT = 'ledger_entries_booking_seq_uq';
  END IF;
  RETURN NEW;
END;
$$;

-- Converts one existing table into a monthly range-partitioned table on created_at WITHOUT copying rows:
--   1. the table is renamed <table>_legacy and becomes the partition for everything before next month (MINVALUE .. next month, UTC);
--   2. a new partitioned parent takes the original name with the same columns, defaults, NOT NULL/CHECK constraints, foreign keys,
--      indexes and triggers; the primary key becomes (id, created_at) and UNIQUE constraints without created_at become plain indexes
--      (ledger_entries keeps (booking_id, seq) unique through ledger_entries_booking_seq_unique_fn);
--   3. a DEFAULT partition and the next months' partitions are created.
-- Takes an ACCESS EXCLUSIVE lock on the table for the duration (validation scans of the legacy rows). Returns a summary line.
CREATE OR REPLACE FUNCTION kkt_partition_table(parent text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  legacy text := parent || '_legacy';
  next_month timestamptz := ((date_trunc('month', now() AT TIME ZONE 'UTC') + interval '1 month')::timestamp AT TIME ZONE 'UTC');
  r record;
  idx_defs text[] := '{}';
  fk_defs text[] := '{}';
  row_trg_defs text[] := '{}';
  stmt_trg_defs text[] := '{}';
  unique_cols text[] := '{}';
  def text;
  rows_moved bigint;
BEGIN
  IF parent NOT IN ('audit_logs', 'ledger_entries', 'login_events', 'notifications') THEN
    RAISE EXCEPTION 'kkt_partition_table: % is not one of the partitioned tables', parent;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_partitioned_table WHERE partrelid = format('public.%I', parent)::regclass) THEN
    RETURN format('%s: already partitioned', parent);
  END IF;
  EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE', parent);
  EXECUTE format('SELECT count(*) FROM public.%I', parent) INTO rows_moved;

  -- capture what the parent must get: secondary indexes, foreign keys, triggers
  FOR r IN
    SELECT i.indexrelid, pg_get_indexdef(i.indexrelid) AS def, i.indisunique, i.indisprimary, c.relname AS idxname,
           EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid = i.indexrelid AND k.contype IN ('p', 'u')) AS is_constraint
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE i.indrelid = format('public.%I', parent)::regclass
  LOOP
    IF r.indisprimary THEN
      CONTINUE;
    ELSIF r.indisunique AND position('created_at' IN r.def) = 0 THEN
      -- unique without the partition key: keep a plain index on the parent (uniqueness: see ledger trigger above)
      idx_defs := idx_defs || replace(r.def, 'CREATE UNIQUE INDEX', 'CREATE INDEX');
      unique_cols := unique_cols || r.idxname;
    ELSE
      idx_defs := idx_defs || r.def;
    END IF;
  END LOOP;
  FOR r IN SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = format('public.%I', parent)::regclass AND contype = 'f' LOOP
    fk_defs := fk_defs || format('ALTER TABLE public.%I ADD CONSTRAINT %I %s', parent, r.conname, r.def);
  END LOOP;
  FOR r IN SELECT tgname, tgtype, pg_get_triggerdef(oid) AS def FROM pg_trigger WHERE tgrelid = format('public.%I', parent)::regclass AND NOT tgisinternal LOOP
    IF (r.tgtype & 1) = 1 THEN
      row_trg_defs := row_trg_defs || r.def;
      EXECUTE format('DROP TRIGGER %I ON public.%I', r.tgname, parent);
    ELSE
      stmt_trg_defs := stmt_trg_defs || r.def;  -- statement triggers stay on the legacy partition and are re-created on the parent
    END IF;
  END LOOP;

  -- 1. the old table becomes the legacy partition: free the names its indexes/constraints use, key on (id, created_at)
  EXECUTE format('ALTER TABLE public.%I RENAME TO %I', parent, legacy);
  FOR r IN SELECT conname FROM pg_constraint WHERE conrelid = format('public.%I', legacy)::regclass AND contype = 'f' LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', legacy, r.conname);
  END LOOP;
  FOR r IN SELECT conname FROM pg_constraint WHERE conrelid = format('public.%I', legacy)::regclass AND contype IN ('p', 'u') LOOP
    EXECUTE format('ALTER TABLE public.%I RENAME CONSTRAINT %I TO %I', legacy, r.conname, left(r.conname, 50) || '_legacy');
  END LOOP;
  FOR r IN
    SELECT c.relname FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE i.indrelid = format('public.%I', legacy)::regclass AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid = i.indexrelid)
  LOOP
    EXECUTE format('ALTER INDEX public.%I RENAME TO %I', r.relname, left(r.relname, 50) || '_legacy');
  END LOOP;
  EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', legacy, (SELECT conname FROM pg_constraint WHERE conrelid = format('public.%I', legacy)::regclass AND contype = 'p'));
  EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I PRIMARY KEY (id, created_at)', legacy, left(parent, 50) || '_legacy_pkey');

  -- 2. the partitioned parent
  EXECUTE format('CREATE TABLE public.%I (LIKE public.%I INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING GENERATED INCLUDING STORAGE INCLUDING COMMENTS) PARTITION BY RANGE (created_at)', parent, legacy);
  EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I PRIMARY KEY (id, created_at)', parent, parent || '_pkey');
  FOREACH def IN ARRAY idx_defs LOOP
    EXECUTE def;
  END LOOP;
  FOREACH def IN ARRAY fk_defs LOOP
    EXECUTE def;
  END LOOP;
  EXECUTE format('ALTER TABLE public.%I ATTACH PARTITION public.%I FOR VALUES FROM (MINVALUE) TO (%L)', parent, legacy, next_month);
  FOREACH def IN ARRAY row_trg_defs LOOP
    EXECUTE def;  -- row triggers on a partitioned table are cloned to every partition (legacy included)
  END LOOP;
  FOREACH def IN ARRAY stmt_trg_defs LOOP
    EXECUTE def;
  END LOOP;
  IF parent = 'ledger_entries' THEN
    EXECUTE 'DROP TRIGGER IF EXISTS ledger_entries_booking_seq_unique ON public.ledger_entries';
    EXECUTE 'CREATE TRIGGER ledger_entries_booking_seq_unique BEFORE INSERT OR UPDATE OF booking_id, seq ON public.ledger_entries FOR EACH ROW EXECUTE FUNCTION ledger_entries_booking_seq_unique_fn()';
  END IF;

  -- 3. safety-net default partition + the coming months
  IF to_regclass(format('public.%I', parent || '_default')) IS NULL THEN
    EXECUTE format('CREATE TABLE public.%I PARTITION OF public.%I DEFAULT', parent || '_default', parent);
    PERFORM kkt_copy_statement_triggers(parent, parent || '_default');
  END IF;
  PERFORM kkt_create_month_partition(parent, (next_month AT TIME ZONE 'UTC')::date);
  PERFORM kkt_create_month_partition(parent, ((next_month + interval '1 month') AT TIME ZONE 'UTC')::date);
  RETURN format('%s: partitioned (%s existing rows kept in %s; unique without created_at turned into indexes: %s)', parent, rows_moved, legacy, coalesce(array_to_string(unique_cols, ', '), ''));
END;
$$;
