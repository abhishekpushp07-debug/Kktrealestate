import type { Env } from "../../config.js";

/** Host/port/database of a connection URL with credentials removed (`postgres://db:5432/kkt`); `<invalid>` when it does not parse. */
export function redactUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.hostname}${u.port ? `:${u.port}` : ""}${u.pathname && u.pathname !== "/" ? u.pathname : ""}`;
  } catch {
    return "<invalid>";
  }
}

/**
 * The effective configuration logged once at boot: every knob an operator needs to confirm, never a secret. Secrets are reported only
 * as `set`/`unset` (or a count for key rings); connection strings lose their credentials and query strings.
 */
export function effectiveConfig(c: Env, extra: { workers: number; role: string }): Record<string, unknown> {
  return {
    role: extra.role,
    node_env: c.NODE_ENV,
    version: c.APP_VERSION,
    node: process.version,
    port: c.API_PORT,
    host: c.API_HOST,
    public_url: c.API_PUBLIC_URL,
    workers: extra.workers,
    run_migrations_on_boot: c.RUN_MIGRATIONS_ON_BOOT,
    seed_on_boot: c.SEED_ON_BOOT,
    seed_demo: c.SEED_DEMO,
    run_jobs_in_api: c.RUN_JOBS_IN_API,
    database: redactUrl(c.DATABASE_URL),
    database_replica: redactUrl(c.DATABASE_REPLICA_URL),
    database_pool_max: c.DATABASE_POOL_MAX,
    database_prepare: (process.env["DATABASE_PREPARE"] ?? "true").toLowerCase() !== "false",
    db_timeouts_ms: { statement: c.DB_STATEMENT_TIMEOUT_MS, lock: c.DB_LOCK_TIMEOUT_MS, idle_in_tx: c.DB_IDLE_IN_TX_TIMEOUT_MS, connect: c.DB_CONNECT_TIMEOUT_S * 1000 },
    redis: redactUrl(c.REDIS_URL),
    redis_security: redactUrl(c.REDIS_SECURITY_URL),
    storage: c.STORAGE_DRIVER === "s3"
      ? { driver: "s3", bucket: c.S3_BUCKET, region: c.S3_REGION, endpoint: redactUrl(c.S3_ENDPOINT), static_keys: Boolean(c.S3_ACCESS_KEY) }
      : { driver: "local", dir: c.STORAGE_LOCAL_DIR },
    origins: { erp: c.ERP_ORIGIN, web: c.WEB_ORIGIN, portal: c.PORTAL_ORIGIN },
    trust_proxy: c.TRUST_PROXY,
    rate_limits_per_min: { public: c.PUBLIC_RATE_LIMIT_PER_MIN, writes: c.WRITE_RATE_LIMIT_PER_MIN },
    max_inflight: c.API_MAX_INFLIGHT,
    tokens: { access_minutes: c.ACCESS_TOKEN_MINUTES, refresh_days: c.REFRESH_TOKEN_DAYS, previous_jwt_secrets: c.JWT_PREVIOUS_SECRETS.length, field_keys: c.FIELD_KEY_RING.length },
    observability: {
      metrics_port: c.METRICS_PORT,
      metrics_token: c.METRICS_TOKEN ? "set" : "unset",
      tracing: c.OTEL_EXPORTER_OTLP_ENDPOINT ? redactUrl(c.OTEL_EXPORTER_OTLP_ENDPOINT) : "off",
      service_name: c.OTEL_SERVICE_NAME,
      error_webhook: c.ERROR_WEBHOOK_URL ? "set" : "unset",
    },
    bootstrap: { company: c.BOOTSTRAP_COMPANY_NAME ?? null, admin_email: c.BOOTSTRAP_ADMIN_EMAIL ? "set" : "unset" },
    internal_api_token: c.INTERNAL_API_TOKEN ? "set" : "unset",
    log_level: c.LOG_LEVEL,
  };
}
