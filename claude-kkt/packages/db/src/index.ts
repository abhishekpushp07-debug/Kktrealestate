// @kkt/db — Drizzle schema, client factory, transaction helpers and migration runner.
export * as schema from "./schema/index.js";
export * from "./schema/index.js";
export {
  createDb,
  createDbCluster,
  withAdvisoryLock,
  withSessionAdvisoryLock,
  withTransactionRetry,
  retryableTransactionError,
  RETRYABLE_TRANSACTION_SQLSTATES,
  dbTimeoutsFromEnv,
  DEFAULT_DB_TIMEOUTS,
  nextSequence,
  DEFAULT_DATABASE_URL,
  BigIntPrecisionError,
  parseBigint,
} from "./client.js";
export type {
  DB,
  Tx,
  Executor,
  DbHandle,
  DbCluster,
  CreateDbOptions,
  DbTimeouts,
  TransactionRetryOptions,
} from "./client.js";
export {
  runMigrations,
  migrateHandle,
  listSqlFiles,
  listOnlineSqlFiles,
  applyOnlineSql,
  splitSqlStatements,
  parseConcurrentIndex,
  MIGRATIONS_FOLDER,
  SQL_FOLDER,
  MIGRATION_LOCK_KEY,
  SCHEMA_FILES_TABLE,
  DEFAULT_MIGRATION_LOCK_TIMEOUT_MS,
  DEFAULT_MIGRATION_LOCK_RETRIES,
  withLockRetry,
  partitionIndexName,
} from "./migrate.js";
export type {
  MigrateOptions,
  MigrateReport,
  OnlineStatementResult,
  ConcurrentIndexStatement,
  OnlineSqlOptions,
  LockRetryOptions,
} from "./migrate.js";
export { resetDatabase, resetRefusalReason } from "./reset.js";
export type { ResetGuards } from "./reset.js";
