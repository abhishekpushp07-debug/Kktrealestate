import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import { z } from "zod";

/**
 * Secrets that may also be supplied as `<NAME>_FILE` (path to a file holding the value: Docker/Kubernetes secrets). Setting both
 * `<NAME>` and `<NAME>_FILE` is a configuration error; the file's surrounding whitespace (the trailing newline) is trimmed.
 */
export const SECRET_FILE_VARS = [
  "JWT_SECRET",
  "FIELD_ENCRYPTION_KEY",
  "FIELD_ENCRYPTION_KEYS",
  "HASH_KEY",
  "DATABASE_URL",
  "DATABASE_REPLICA_URL",
  "REDIS_URL",
  "REDIS_SECURITY_URL",
  "S3_ACCESS_KEY",
  "S3_SECRET_KEY",
  "METRICS_TOKEN",
  "BOOTSTRAP_ADMIN_PASSWORD",
  "ERROR_WEBHOOK_URL",
] as const;

/** Fastify `trustProxy` value: `false` (socket address only), `true` (trust every hop — only behind a proxy that strips spoofed headers) or proxy-addr names/addresses/CIDRs. */
export type TrustProxy = boolean | string[];

const PROXY_ADDR_NAMES = new Set(["loopback", "linklocal", "uniquelocal"]);

/** True for an IP literal, `ip/prefix` or `ip/netmask` accepted by proxy-addr. */
function isAddressOrCidr(entry: string): boolean {
  const slash = entry.indexOf("/");
  if (slash === -1) return isIP(entry) !== 0;
  const ip = entry.slice(0, slash);
  const range = entry.slice(slash + 1);
  const family = isIP(ip);
  if (family === 0) return false;
  if (/^\d{1,3}$/.test(range)) return Number(range) <= (family === 4 ? 32 : 128);
  return family === 4 && isIP(range) === 4;
}

/**
 * Parses TRUST_PROXY: `"true"`/`"1"` → true, `"false"`/`"0"` → false, otherwise a comma list of proxy-addr names (`loopback`,
 * `linklocal`, `uniquelocal`), IP addresses and CIDRs (`10.0.0.0/8`). Throws on an unknown entry so a typo never trusts everyone.
 */
export function parseTrustProxy(raw: string): TrustProxy {
  const v = raw.trim().toLowerCase();
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0" || v === "") return false;
  const entries = raw
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e !== "");
  const bad = entries.filter((e) => !PROXY_ADDR_NAMES.has(e.toLowerCase()) && !isAddressOrCidr(e));
  if (bad.length > 0) throw new Error(`unknown proxy entr${bad.length === 1 ? "y" : "ies"} ${bad.join(", ")} (use true, false, loopback, linklocal, uniquelocal, an IP or a CIDR)`);
  return entries.map((e) => (PROXY_ADDR_NAMES.has(e.toLowerCase()) ? e.toLowerCase() : e));
}

/** One field-encryption key: `kid` is written into every ciphertext so old rows stay readable after rotation. */
export interface FieldKey {
  kid: string;
  secret: string;
}

/** Parses FIELD_ENCRYPTION_KEYS (`kid:secret,kid:secret`, first = active). Secrets are base64 (or raw text) of at least 32 characters. */
export function parseFieldKeys(raw: string): FieldKey[] {
  const keys: FieldKey[] = [];
  for (const part of raw.split(",").map((p) => p.trim()).filter((p) => p !== "")) {
    const colon = part.indexOf(":");
    const kid = colon === -1 ? "" : part.slice(0, colon).trim();
    const secret = colon === -1 ? "" : part.slice(colon + 1).trim();
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(kid)) throw new Error(`key id "${kid}" must be 1-32 letters, digits, _ or -`);
    if (secret.length < 32) throw new Error(`key ${kid} must be at least 32 characters`);
    if (keys.some((k) => k.kid === kid)) throw new Error(`key id ${kid} appears twice`);
    keys.push({ kid, secret });
  }
  return keys;
}

const bool = (def: "true" | "false") => z.string().default(def).transform((v) => v === "true" || v === "1");
const int = (def: number, min: number, max: number) => z.coerce.number().int().min(min).max(max).default(def);

/** Environment schema: the process refuses to start when a required secret is missing or weak. */
const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    API_HOST: z.string().default("0.0.0.0"),
    API_PUBLIC_URL: z.string().url().default("http://localhost:4000"),
    /** Required in production (no localhost default there). */
    DATABASE_URL: z.string({ error: "DATABASE_URL is required in production" }).min(1),
    DATABASE_REPLICA_URL: z.string().optional(),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(500).default(20),
    /** Per-statement / lock-wait / idle-in-transaction limits applied to every pooled connection (packages/db reads the same variables). */
    DB_STATEMENT_TIMEOUT_MS: int(15_000, 0, 3_600_000),
    DB_LOCK_TIMEOUT_MS: int(5_000, 0, 3_600_000),
    DB_IDLE_IN_TX_TIMEOUT_MS: int(30_000, 0, 3_600_000),
    DB_CONNECT_TIMEOUT_S: int(10, 1, 300),
    /** Required in production (no localhost default there). */
    REDIS_URL: z.string({ error: "REDIS_URL is required in production" }).min(1),
    /**
     * Upper bound of one command on the API's Redis clients (ioredis commandTimeout), queued commands included: during an outage a write
     * that is not budgeted (cache invalidation, permission-version bump) fails after this long instead of waiting on reconnects.
     * Cache and auth reads have their own much shorter budgets (lib/cache.ts CACHE_BUDGET_MS, plugins/auth.ts).
     */
    REDIS_COMMAND_TIMEOUT_MS: int(2_000, 100, 60_000),
    /** Optional separate `noeviction` Redis for revocation markers, locks and rate limits (falls back to REDIS_URL). */
    REDIS_SECURITY_URL: z.string().min(1).optional(),
    JWT_SECRET: z.string({ error: "JWT_SECRET is required" }).min(32, "JWT_SECRET must be at least 32 characters"),
    /** Comma list of previous JWT secrets, accepted for verification only (rotation window). */
    JWT_PREVIOUS_SECRETS: z
      .string()
      .optional()
      .transform((v, ctx) => {
        const list = (v ?? "").split(",").map((s) => s.trim()).filter((s) => s !== "");
        if (list.some((s) => s.length < 32)) {
          ctx.addIssue({ code: "custom", message: "every JWT_PREVIOUS_SECRETS entry must be at least 32 characters" });
          return z.NEVER;
        }
        return list;
      }),
    FIELD_ENCRYPTION_KEY: z
      .string({ error: "FIELD_ENCRYPTION_KEY is required" })
      .min(32, "FIELD_ENCRYPTION_KEY must be at least 32 characters (base64 of 32 bytes recommended)"),
    /** Optional key ring `kid:secret,kid:secret` (first = active for new ciphertexts). FIELD_ENCRYPTION_KEY is always key id `k1`. */
    FIELD_ENCRYPTION_KEYS: z
      .string()
      .optional()
      .transform((v, ctx) => {
        try {
          return parseFieldKeys(v ?? "");
        } catch (err) {
          ctx.addIssue({ code: "custom", message: (err as Error).message });
          return z.NEVER;
        }
      }),
    HASH_KEY: z.string({ error: "HASH_KEY is required" }).min(16),
    ACCESS_TOKEN_MINUTES: z.coerce.number().int().min(1).max(120).default(15),
    REFRESH_TOKEN_DAYS: z.coerce.number().int().min(1).max(90).default(7),
    ERP_ORIGIN: z.string().default("http://localhost:5173"),
    WEB_ORIGIN: z.string().default("http://localhost:3000"),
    PORTAL_ORIGIN: z.string().default("http://localhost:8081"),
    STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
    STORAGE_LOCAL_DIR: z.string().default("./storage"),
    /** Required when STORAGE_DRIVER=s3. */
    S3_BUCKET: z.string().optional(),
    /** Required when STORAGE_DRIVER=s3. */
    S3_REGION: z.string().optional(),
    S3_ENDPOINT: z.string().optional(),
    /** Optional: without keys the AWS SDK's default chain (IAM role, instance profile) is used. */
    S3_ACCESS_KEY: z.string().optional(),
    S3_SECRET_KEY: z.string().optional(),
    /** Run the first-boot seed (bootstrap company + admin; the demo dataset too when SEED_DEMO). Default: true outside production, false in production. */
    SEED_ON_BOOT: bool("true"),
    /** The demo dataset (Shree Ganesh Builders, demo staff and customers) may be created. Default: true outside production, false in production. */
    SEED_DEMO: bool("true"),
    /** First-boot company and Super Admin used in production instead of the demo users. */
    BOOTSTRAP_COMPANY_NAME: z.string().min(2).max(200).optional(),
    BOOTSTRAP_ADMIN_EMAIL: z.string().email("BOOTSTRAP_ADMIN_EMAIL must be an e-mail address").optional(),
    BOOTSTRAP_ADMIN_PASSWORD: z.string().min(12, "BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters").optional(),
    RUN_MIGRATIONS_ON_BOOT: bool("true"),
    /**
     * Serve the OpenAPI document (/api/v1/openapi.json, /api/v1/docs/json) and Swagger UI (/api/v1/docs) to anyone. Default: true outside
     * production, false in production — there only a staff bearer token holding admin.tools may read them.
     */
    DOCS_PUBLIC: bool("true"),
    /** Run BullMQ jobs inside the API (first HTTP worker). Default: true outside production, false in production (use the worker). */
    RUN_JOBS_IN_API: bool("true"),
    /**
     * HTTP worker processes (node:cluster). `1` = single process (default outside production). `auto` = one per available CPU (default in
     * production). Each worker is a full stateless API instance sharing the port; migrations and the demo seed run once in the primary
     * before forking, and the in-process job worker (RUN_JOBS_IN_API) runs in the first HTTP worker only.
     */
    API_WORKERS: z
      .string()
      .default("1")
      .transform((v, ctx) => {
        if (v.trim().toLowerCase() === "auto") return 0;
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > 64) {
          ctx.addIssue({ code: "custom", message: "API_WORKERS must be 1..64 or 'auto'" });
          return z.NEVER;
        }
        return n;
      }),
    LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
    LOG_PRETTY: bool("false"),
    /**
     * Which peers may set X-Forwarded-For: `false`, `true`, or a comma list of proxy-addr names/IPs/CIDRs. Default `loopback`, so a client
     * that reaches the API directly can never choose its own IP; behind a reverse proxy on a private network use e.g. `uniquelocal`.
     */
    TRUST_PROXY: z
      .string()
      .default("loopback")
      .transform((v, ctx): TrustProxy => {
        try {
          return parseTrustProxy(v);
        } catch (err) {
          ctx.addIssue({ code: "custom", message: (err as Error).message });
          return z.NEVER;
        }
      }),
    /** Per-IP request limit for public (unauthenticated) routes, per minute. */
    PUBLIC_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(300),
    /** Per-user limit for staff/portal write requests (POST/PATCH/PUT/DELETE), per minute. */
    WRITE_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(120),
    /** Max requests in flight per worker process before the excess is answered 503 + Retry-After (0 = off). */
    API_MAX_INFLIGHT: z.coerce.number().int().min(0).max(100_000).default(0),
    /** Version string reported by /health and /metrics. */
    APP_VERSION: z.string().default("2.0.0"),
    /** Identity of this rollout (set by the deploy pipeline); keys the once-per-deploy boot-job lock. Falls back to GIT_SHA. */
    DEPLOY_ID: z.string().min(1).max(200).optional(),
    /** Commit of the running build (CI sets it); the boot-job lock falls back to it when DEPLOY_ID is unset. */
    GIT_SHA: z.string().min(1).max(200).optional(),
    /** Bearer token for scraping /metrics without a staff session (unset = staff JWT only). */
    METRICS_TOKEN: z.string().min(16, "METRICS_TOKEN must be at least 16 characters").optional(),
    /** Port of the cluster-wide metrics listener. */
    METRICS_PORT: z.coerce.number().int().min(1).max(65535).default(9464),
    /** OTLP/HTTP collector endpoint; tracing is off when unset. */
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
    OTEL_SERVICE_NAME: z.string().min(1).default("kkt-api"),
    /** Webhook (Slack-compatible JSON POST) for unhandled errors and failed jobs; off when unset. */
    ERROR_WEBHOOK_URL: z.string().url().optional(),
    /** Shared secret for internal callers (e.g. the website's SSR forwarding the visitor IP); off when unset. */
    INTERNAL_API_TOKEN: z.string().min(32, "INTERNAL_API_TOKEN must be at least 32 characters").optional(),
  })
  .superRefine((env, ctx) => {
    if (env.STORAGE_DRIVER === "s3") {
      if (!env.S3_BUCKET) ctx.addIssue({ code: "custom", path: ["S3_BUCKET"], message: "S3_BUCKET is required when STORAGE_DRIVER=s3" });
      if (!env.S3_REGION) ctx.addIssue({ code: "custom", path: ["S3_REGION"], message: "S3_REGION is required when STORAGE_DRIVER=s3" });
      if (Boolean(env.S3_ACCESS_KEY) !== Boolean(env.S3_SECRET_KEY)) {
        ctx.addIssue({ code: "custom", path: ["S3_SECRET_KEY"], message: "S3_ACCESS_KEY and S3_SECRET_KEY must be set together (or both left unset for an IAM role)" });
      }
    }
    if (Boolean(env.BOOTSTRAP_ADMIN_EMAIL) !== Boolean(env.BOOTSTRAP_ADMIN_PASSWORD)) {
      ctx.addIssue({ code: "custom", path: ["BOOTSTRAP_ADMIN_PASSWORD"], message: "BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD must be set together" });
    }
    const k1 = env.FIELD_ENCRYPTION_KEYS.find((k) => k.kid === "k1");
    if (k1 && k1.secret !== env.FIELD_ENCRYPTION_KEY) {
      ctx.addIssue({ code: "custom", path: ["FIELD_ENCRYPTION_KEYS"], message: "key id k1 is FIELD_ENCRYPTION_KEY; give the new key another id" });
    }
  })
  .transform((env) => ({
    ...env,
    /** Field-encryption key ring, active key first: FIELD_ENCRYPTION_KEYS in order, then FIELD_ENCRYPTION_KEY as `k1` when not listed. */
    FIELD_KEY_RING: env.FIELD_ENCRYPTION_KEYS.some((k) => k.kid === "k1")
      ? env.FIELD_ENCRYPTION_KEYS
      : [...env.FIELD_ENCRYPTION_KEYS, { kid: "k1", secret: env.FIELD_ENCRYPTION_KEY }],
  }));

export type Env = z.infer<typeof EnvSchema>;

/** Insecure values only ever used outside production. */
const DEV_DEFAULTS: Record<string, string> = {
  JWT_SECRET: "dev-only-jwt-secret-change-me-dev-only-jwt-secret",
  FIELD_ENCRYPTION_KEY: "ZGV2LW9ubHktZmllbGQta2V5LWNoYW5nZS1tZS1kZXYtb25seS0wMQ==",
  HASH_KEY: "dev-only-hash-key-change-me",
  DATABASE_URL: "postgres://postgres:postgres@localhost:5432/kkt",
  REDIS_URL: "redis://localhost:6379/0",
};

/** Defaults that differ between production and everything else. */
const MODE_DEFAULTS: Record<"production" | "other", Record<string, string>> = {
  production: { SEED_ON_BOOT: "false", SEED_DEMO: "false", RUN_JOBS_IN_API: "false", API_WORKERS: "auto", DOCS_PUBLIC: "false" },
  other: { SEED_ON_BOOT: "true", SEED_DEMO: "true", RUN_JOBS_IN_API: "true", API_WORKERS: "1", DOCS_PUBLIC: "true" },
};

/** Resolves every `<NAME>_FILE` secret into `<NAME>`; returns the problems found (never the file contents). */
function applySecretFiles(env: Record<string, string | undefined>, readFile: (path: string) => string): string[] {
  const problems: string[] = [];
  for (const name of SECRET_FILE_VARS) {
    const fileVar = `${name}_FILE`;
    const path = env[fileVar];
    delete env[fileVar];
    if (path === undefined) continue;
    if (env[name] !== undefined) {
      problems.push(`${name}: set either ${name} or ${fileVar}, not both`);
      continue;
    }
    try {
      const value = readFile(path).trim();
      if (value === "") problems.push(`${fileVar}: ${path} is empty`);
      else env[name] = value;
    } catch (err) {
      problems.push(`${fileVar}: cannot read ${path} (${(err as NodeJS.ErrnoException).code ?? "error"})`);
    }
  }
  return problems;
}

export interface LoadConfigOptions {
  /** File reader for `<NAME>_FILE` secrets (tests inject one). */
  readFile?: (path: string) => string;
}

/**
 * Load and validate configuration from process.env. Empty values count as unset. Dev/test fall back to insecure local defaults;
 * production never does (secrets, DATABASE_URL and REDIS_URL are required) and turns the demo seed, in-API jobs and single-process mode off.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, options: LoadConfigOptions = {}): Env {
  const merged: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && v !== "") merged[k] = v;
  const problems = applySecretFiles(merged, options.readFile ?? ((p) => readFileSync(p, "utf8")));
  const prod = (merged["NODE_ENV"] ?? "development") === "production";
  const defaults = prod ? MODE_DEFAULTS.production : { ...DEV_DEFAULTS, ...MODE_DEFAULTS.other };
  for (const [k, v] of Object.entries(defaults)) if (merged[k] === undefined) merged[k] = v;
  const parsed = EnvSchema.safeParse(merged);
  if (!parsed.success) problems.push(...parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  if (problems.length > 0 || !parsed.success) throw new Error(`Invalid configuration: ${problems.join("; ")}`);
  return parsed.data;
}

export const config: Env = loadConfig();
export const isProd = config.NODE_ENV === "production";
export const isTest = config.NODE_ENV === "test";
