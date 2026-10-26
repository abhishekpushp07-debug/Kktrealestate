-- KKT database roles (docs/DEPLOY.md "Database roles"). Runs once, as the bootstrap superuser, in the application database:
--   * by the postgres image on first start (mounted at /docker-entrypoint-initdb.d), or
--   * by hand / a Kubernetes Job against a managed database:  psql "$SUPERUSER_URL" -v ON_ERROR_STOP=1 -f 01-roles.sql
-- It is idempotent (safe to re-run after an upgrade). Passwords are set separately (02-passwords.sh reads Docker/Kubernetes secrets).
--
--   kkt_owner  owns the schema; the migrate job connects as this role (DDL, extensions it may create, the migration lock).
--   kkt_app    the API and the worker: DML only. No TRUNCATE, no DDL, cannot disable triggers or set session_replication_role, so
--              the append-only triggers on audit_logs / payments / demands protect against the application itself, not just bugs.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'kkt_owner') THEN
    CREATE ROLE kkt_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'kkt_app') THEN
    CREATE ROLE kkt_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END
$$;

-- Never let the application role act as the owner.
REVOKE kkt_owner FROM kkt_app;

-- The owner owns the database and the public schema (migrations create every table, index, trigger and function as kkt_owner).
DO $$ BEGIN EXECUTE format('ALTER DATABASE %I OWNER TO kkt_owner', current_database()); END $$;
ALTER SCHEMA public OWNER TO kkt_owner;

-- Lock the database and schema down: nobody but the owner creates objects.
DO $$ BEGIN EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database()); END $$;
DO $$ BEGIN EXECUTE format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO kkt_app', current_database()); END $$;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO kkt_app;

-- Extensions the migrations use (both are "trusted", so the owner could create them too; creating them here keeps upgrades simple).
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- Query statistics (needs shared_preload_libraries = 'pg_stat_statements', set in infra/postgres/postgresql.conf).
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Privileges on everything the owner creates from now on (every migration) …
ALTER DEFAULT PRIVILEGES FOR ROLE kkt_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO kkt_app;
ALTER DEFAULT PRIVILEGES FOR ROLE kkt_owner IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO kkt_app;
ALTER DEFAULT PRIVILEGES FOR ROLE kkt_owner IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO kkt_app;
ALTER DEFAULT PRIVILEGES FOR ROLE kkt_owner IN SCHEMA public GRANT USAGE ON TYPES TO kkt_app;
-- … and on what already exists (re-running this file after the roles were introduced to an existing database).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO kkt_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO kkt_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO kkt_app;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM kkt_app;
-- The books stay append-only for the application itself (migration 0005; packages/db/src/sql/0002_privileges.sql applies the same
-- revokes after every schema change, so tables created later are covered too):
--   ledger_entries, audit_logs, audit_seals, ledger_rebuilds — no UPDATE / DELETE (rows are only appended);
--   payments, demands — no DELETE (reversed / voided with a reason, never deleted).
-- On a fresh database the tables do not exist yet when this file runs; to_regclass() skips them and the migration applies the revokes.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ledger_entries', 'audit_logs', 'audit_seals', 'ledger_rebuilds'] LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON public.%I FROM kkt_app', t);
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['payments', 'demands'] LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('REVOKE DELETE, TRUNCATE ON public.%I FROM kkt_app', t);
    END IF;
  END LOOP;
END
$$;

-- Behind PgBouncer (transaction pooling) the client's per-connection startup parameters are ignored, so the API's safety limits
-- (DB_STATEMENT_TIMEOUT_MS / DB_LOCK_TIMEOUT_MS / DB_IDLE_IN_TX_TIMEOUT_MS defaults) are also role defaults.
ALTER ROLE kkt_app SET statement_timeout = '15s';
ALTER ROLE kkt_app SET lock_timeout = '5s';
ALTER ROLE kkt_app SET idle_in_transaction_session_timeout = '30s';
-- Migrations may legitimately run long (index builds) and wait for the migration advisory lock.
ALTER ROLE kkt_owner SET statement_timeout = 0;
ALTER ROLE kkt_owner SET lock_timeout = 0;

-- /metrics reads pg_stat_activity by state (kkt_db_connections); this grants statistics visibility only, no data.
GRANT pg_read_all_stats TO kkt_app;
