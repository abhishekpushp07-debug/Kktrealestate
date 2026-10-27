# Monthly partitioning (opt-in)

`audit_logs`, `ledger_entries`, `login_events` and `notifications` only ever grow. At a few tens of millions of rows (ARCHITECTURE §6
suggests ~50 M) monthly range partitions on `created_at` keep their indexes small, make retention a `DROP TABLE` of an old month and let
the planner skip months a query cannot touch. Nothing here runs with the normal migrations: a fresh install stays unpartitioned until an
operator applies these scripts.

| File                       | What it does                                                                                                                                                                                                                                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `001_functions.sql`        | Idempotent helper functions: `kkt_partition_table(table)` converts one table, `kkt_create_month_partition(table, month)`, `kkt_create_next_partitions(months_ahead)` (what job PARTITION_MAINTENANCE calls), `kkt_partitioned_tables()`, `ledger_entries_booking_seq_unique_fn()` and `kkt_copy_statement_triggers()`. |
| `002_partition_tables.sql` | Converts the four tables and creates the coming months. Safe to re-run (an already partitioned table is reported and left alone).                                                                                                                                                                                      |

## Applying

```sh
# during a maintenance window, API and worker stopped (each table is locked ACCESS EXCLUSIVE while it is converted).
# Run as the schema OWNER (kkt_owner, the role the migrate job uses) — never as the application role kkt_app, which has no DDL rights.
psql "$OWNER_DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f packages/db/partitions/001_functions.sql -f packages/db/partitions/002_partition_tables.sql
# then switch the maintenance job on for the API/worker
PARTITIONING_ENABLED=true
```

The API and the worker connect as the DML-only role `kkt_app`, which may not create tables. `kkt_create_next_partitions()` (what the
job calls) is therefore `SECURITY DEFINER` with a pinned `search_path`: it runs with the privileges of the role that applied the scripts,
takes only a month count and touches only the four tables. `EXECUTE` on it is revoked from `PUBLIC` and granted to `kkt_app` (when that
role exists). The other helpers (`kkt_partition_table`, `kkt_create_month_partition`, …) stay `SECURITY INVOKER`, so the application
role cannot convert or add partitions on its own. If the scripts were applied before `kkt_app` existed, re-run `001_functions.sql`
(idempotent) or `GRANT EXECUTE ON FUNCTION kkt_create_next_partitions(int) TO kkt_app`.

What a conversion does (no row is copied):

1. The table is renamed `<table>_legacy` and attached as the partition for everything **before the first day of next month (UTC)**,
   `FROM (MINVALUE) TO (<next month>)`. Its primary key becomes `(id, created_at)` (a partitioned table's keys must contain the partition
   key); attaching validates its rows against the range and the foreign keys, which costs one scan per table.
2. A new partitioned parent takes the original name with the same columns, defaults, NOT NULL/CHECK constraints, foreign keys, indexes
   and triggers. Row triggers (the append-only guard of `audit_logs`) are cloned to every partition by PostgreSQL; statement-level
   triggers (`audit_logs_no_truncate`) are copied onto every partition the scripts create, so `TRUNCATE` of a single partition is
   refused too.
3. A `<table>_default` partition (safety net: rows outside every month land there instead of failing) and the next two months
   (`<table>_yYYYYmMM`, UTC calendar months) are created.

Uniqueness that does not include `created_at` cannot be a unique index on a partitioned table. The only such rule is the ledger's
`UNIQUE (booking_id, epoch, seq)` (migration 0005; ledger epochs); after the conversion it is a plain index plus the trigger
`ledger_entries_booking_seq_unique`, which takes a transaction-scoped advisory lock on `(booking, epoch, seq)` and raises the same
`23505 ledger_entries_booking_epoch_seq_uq` error on a duplicate
(race-free under READ COMMITTED, the isolation level the API uses; the money module also serialises ledger appends per booking).
A database partitioned BEFORE migration 0005 keeps its plain `(booking_id, seq)` index (it serves the trigger's lookup); the online file
only swaps in the epoch-aware trigger function, so no index is rebuilt over the partitions. New non-unique indexes on a partitioned table
are built online by the migration runner: `ON ONLY` the parent, then `CONCURRENTLY` per partition and attached (docs/DATA-MODEL.md §J).

## Keeping months ahead

Job `PARTITION_MAINTENANCE` (daily 02:20 IST) runs `kkt_create_next_partitions(2)` when `PARTITIONING_ENABLED=true`; it is registered
always but neither scheduled nor active otherwise. Creating a month that already exists, or that the legacy partition still covers, is a
no-op. If rows for a month reached `<table>_default` before its partition existed, creating that month fails loudly: move those rows
out of the default partition first (`WITH m AS (DELETE FROM t_default WHERE created_at >= … RETURNING *) INSERT INTO t SELECT * FROM m`,
for `audit_logs` with the immutability trigger temporarily disabled by a superuser).

## Compatibility

- `pnpm --filter @kkt/db migrate` keeps working: `src/sql/0001_triggers.sql` re-creates the `audit_logs` triggers on the partitioned
  parent, and none of the four tables has an `updated_at` trigger. Future migrations that add columns or indexes to these tables work on
  the parent (`CREATE INDEX` without `CONCURRENTLY`).
- The Drizzle schema keeps declaring `id` as the primary key; queries never depend on the key's shape.
- Backups (`POST /admin/backup`) read the parent tables, so every partition is included; a restore loads into an unpartitioned database
  (apply these scripts again afterwards if wanted).
- Retention: dropping a month is `DROP TABLE <table>_yYYYYmMM` (for `audit_logs` only when the law allows; the immutability trigger does
  not block dropping a whole partition, so restrict that to the database owner).

## Rolling back

There is no in-place rollback; restore the pre-conversion backup (`pnpm --filter @kkt/api restore`) into a new database, or recreate an
unpartitioned table and `INSERT … SELECT` the rows back during a maintenance window.

`apps/api/test/integration/partitions.test.ts` applies both scripts to a scratch database with data, re-runs them and the migrations,
and checks the guards, routing, the ledger rule under concurrency and the maintenance job.
