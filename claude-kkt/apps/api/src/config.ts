import { readFileSync } from "node:fs";
import { createPrivateKey } from "node:crypto";
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
  "JWT_SIGNING_KEYS",
  "LINK_SIGNING_KEYS",
  "HASH_KEYS",
  "INTERNAL_API_TOKEN",
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
  if (bad.length > 0)
    throw new Error(
      `unknown proxy entr${bad.length === 1 ? "y" : "ies"} ${bad.join(", ")} (use true, false, loopback, linklocal, uniquelocal, an IP or a CIDR)`,
    );
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
  for (const part of raw
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p !== "")) {
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

/** One Ed25519 signing key of JWT_SIGNING_KEYS (contract C9): `kid` goes into every token header; the first key signs. */
export interface JwtKeyConfig {
  kid: string;
  /** PKCS8 DER of the Ed25519 private key. */
  der: Buffer;
}

/**
 * Parses JWT_SIGNING_KEYS (`<kid>:<base64 PKCS8 DER Ed25519 private key>,…`, first = active; every key is published in the JWKS and
 * verifies tokens carrying its kid). Generate one with `openssl genpkey -algorithm ed25519 -outform DER | base64 -w0`.
 */
export function parseJwtSigningKeys(raw: string): JwtKeyConfig[] {
  const keys: JwtKeyConfig[] = [];
  for (const part of raw
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p !== "")) {
    const colon = part.indexOf(":");
    const kid = colon === -1 ? "" : part.slice(0, colon).trim();
    const value = colon === -1 ? "" : part.slice(colon + 1).trim();
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(kid)) throw new Error(`key id "${kid}" must be 1-32 letters, digits, _ or -`);
    if (keys.some((k) => k.kid === kid)) throw new Error(`key id ${kid} appears twice`);
    const der = Buffer.from(value, "base64");
    let ok: boolean;
    try {
      ok = createPrivateKey({ key: der, format: "der", type: "pkcs8" }).asymmetricKeyType === "ed25519";
    } catch {
      ok = false;
    }
    if (!ok) throw new Error(`key ${kid} is not a base64 PKCS8 DER Ed25519 private key`);
    keys.push({ kid, der });
  }
  return keys;
}

/** Words that mark a template value (infra/k8s/secret.example.yaml, .env.example, docs) rather than a real secret. */
const PLACEHOLDER_RE = /change[-_ ]?me|example|placeholder|dev-only|your[-_ ]?secret|replace[-_ ]?me/i;

/**
 * Why a production secret value is unacceptable (null when fine): a template word (change-me, changeme, example, placeholder, …), a
 * single repeated character (`x`, `xxxx…`) or fewer than `minBytes` bytes.
 */
export function placeholderProblem(value: string, minBytes = 32): string | null {
  if (PLACEHOLDER_RE.test(value)) return "is a placeholder value";
  if (/^(.)\1*$/s.test(value)) return "is a placeholder value (one repeated character)";
  if (Buffer.byteLength(value, "utf8") < minBytes) return `must be at least ${minBytes} bytes`;
  return null;
}

/** The password part of a connection URL (null when the URL has none or does not parse). */
function urlPassword(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const p = new URL(url).password;
    return p ? decodeURIComponent(p) : null;
  } catch {
    return null;
  }
}

/**
 * Production secret checks (contract C9): the explicit key rings are required (JWT_SIGNING_KEYS, LINK_SIGNING_KEYS, HASH_KEYS) and no
 * secret may be a template value or shorter than 32 bytes. Returns `[path, message]` problems; outside production nothing.
 */
export function productionSecretProblems(env: {
  NODE_ENV: string;
  JWT_SECRET: string;
  JWT_PREVIOUS_SECRETS: readonly string[];
  JWT_SIGNING_KEYS: readonly JwtKeyConfig[];
  LINK_SIGNING_KEYS: readonly FieldKey[];
  HASH_KEYS: readonly FieldKey[];
  HASH_KEY?: string | undefined;
  FIELD_ENCRYPTION_KEY: string;
  FIELD_ENCRYPTION_KEYS: readonly FieldKey[];
  METRICS_TOKEN?: string | undefined;
  INTERNAL_API_TOKEN?: string | undefined;
  BOOTSTRAP_ADMIN_PASSWORD?: string | undefined;
  DATABASE_URL: string;
  DATABASE_REPLICA_URL?: string | undefined;
  REDIS_URL: string;
  REDIS_SECURITY_URL?: string | undefined;
  S3_SECRET_KEY?: string | undefined;
}): [string, string][] {
  if (env.NODE_ENV !== "production") return [];
  const out: [string, string][] = [];
  if (env.JWT_SIGNING_KEYS.length === 0)
    out.push(["JWT_SIGNING_KEYS", "JWT_SIGNING_KEYS is required in production (<kid>:<base64 PKCS8 Ed25519 key>,…)"]);
  if (env.LINK_SIGNING_KEYS.length === 0)
    out.push(["LINK_SIGNING_KEYS", "LINK_SIGNING_KEYS is required in production (<kid>:<secret>,…)"]);
  if (env.HASH_KEYS.length === 0) out.push(["HASH_KEYS", "HASH_KEYS is required in production (<kid>:<secret>,…)"]);
  const check = (path: string, value: string | undefined, minBytes = 32) => {
    if (value === undefined) return;
    const p = placeholderProblem(value, minBytes);
    if (p) out.push([path, `${path} ${p}`]);
  };
  check("JWT_SECRET", env.JWT_SECRET);
  env.JWT_PREVIOUS_SECRETS.forEach((s, i) => check(`JWT_PREVIOUS_SECRETS[${i}]`, s));
  for (const k of env.LINK_SIGNING_KEYS) check(`LINK_SIGNING_KEYS:${k.kid}`, k.secret);
  for (const k of env.HASH_KEYS) check(`HASH_KEYS:${k.kid}`, k.secret);
  check("HASH_KEY", env.HASH_KEY);
  check("FIELD_ENCRYPTION_KEY", env.FIELD_ENCRYPTION_KEY);
  for (const k of env.FIELD_ENCRYPTION_KEYS) check(`FIELD_ENCRYPTION_KEYS:${k.kid}`, k.secret);
  check("METRICS_TOKEN", env.METRICS_TOKEN, 16);
  check("INTERNAL_API_TOKEN", env.INTERNAL_API_TOKEN);
  check("S3_SECRET_KEY", env.S3_SECRET_KEY, 16);
  // the bootstrap password follows the password policy (12+), but a template value is still refused
  if (env.BOOTSTRAP_ADMIN_PASSWORD && PLACEHOLDER_RE.test(env.BOOTSTRAP_ADMIN_PASSWORD))
    out.push(["BOOTSTRAP_ADMIN_PASSWORD", "BOOTSTRAP_ADMIN_PASSWORD is a placeholder value"]);
  for (const [name, url] of [
    ["DATABASE_URL", env.DATABASE_URL],
    ["DATABASE_REPLICA_URL", env.DATABASE_REPLICA_URL],
    ["REDIS_URL", env.REDIS_URL],
    ["REDIS_SECURITY_URL", env.REDIS_SECURITY_URL],
  ] as const) {
    const pw = urlPassword(url);
    if (pw && (PLACEHOLDER_RE.test(pw) || /^(.)\1*$/s.test(pw)))
      out.push([name, `${name} carries a placeholder password`]);
  }
  return out;
}

/** Parses a `kid:secret,…` ring for zod (issue on error). */
function ringField(v: string | undefined, ctx: z.RefinementCtx): FieldKey[] {
  try {
    return parseFieldKeys(v ?? "");
  } catch (err) {
    ctx.addIssue({ code: "custom", message: (err as Error).message });
    return z.NEVER;
  }
}

const bool = (def: "true" | "false") =>
  z
    .string()
    .default(def)
    .transform((v) => v === "true" || v === "1");
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
        const list = (v ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s !== "");
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
    /** Legacy single keyed-hash key; it is key id `h1` of the hash ring. Optional once HASH_KEYS is set (required in production). */
    HASH_KEY: z.string().min(16).optional(),
    /**
     * Keyed-hash ring `kid:secret,…` (contract C9; first = active for new hashes, every key is tried on lookups and duplicate checks;
     * REENCRYPT_FIELDS rehashes to the active key). Required in production. HASH_KEY, when set, is key id `h1`.
     */
    HASH_KEYS: z
      .string()
      .optional()
      .transform((v, ctx) => ringField(v, ctx)),
    /**
     * Ed25519 JWT signing keys `<kid>:<base64 PKCS8 DER>,…` (contract C9; first signs, all verify and are published in the JWKS).
     * Required in production; elsewhere derived from JWT_SECRET / JWT_PREVIOUS_SECRETS when unset.
     */
    JWT_SIGNING_KEYS: z
      .string()
      .optional()
      .transform((v, ctx) => {
        try {
          return parseJwtSigningKeys(v ?? "");
        } catch (err) {
          ctx.addIssue({ code: "custom", message: (err as Error).message });
          return z.NEVER;
        }
      }),
    /**
     * HMAC keys of signed links (downloads, exports, backups, MFA step tokens, visitor tokens) `kid:secret,…` (contract C9; first signs,
     * the kid travels in the link, older keys verify). Required in production; elsewhere derived from JWT_SECRET when unset.
     */
    LINK_SIGNING_KEYS: z
      .string()
      .optional()
      .transform((v, ctx) => ringField(v, ctx)),
    /** Absolute lifetime of a refresh-token family (contract C1): rotation never extends it; past it refresh answers 401 SESSION_EXPIRED. */
    REFRESH_ABSOLUTE_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    /** Per-user limit for authenticated reads (GET), per minute; 429 + Retry-After beyond it. */
    READ_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(1200),
    /** Per-user limit for CSV exports (sync `format=csv` lists and POST /exports), per minute. */
    EXPORT_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(10),
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
    /** Max requests in flight per worker process before the excess is answered 503 + Retry-After (0 = off; 256 in production). */
    API_MAX_INFLIGHT: z.coerce.number().int().min(0).max(100_000).default(0),
    /**
     * Event-loop pressure (plugins/loadShed.ts): when the mean event-loop delay of a 500 ms window exceeds this, the process lowers its
     * in-flight cap to a quarter (never below 8) until the delay falls under half of it again (0 = off).
     */
    API_SHED_EVENT_LOOP_DELAY_MS: z.coerce.number().int().min(0).max(60_000).default(500),
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
    // --- phase 7 domain track (docs/ARCHITECTURE.md "Website caching") ---
    /** The website's on-demand revalidation route (e.g. https://www.example.com/api/revalidate); CMS / project-website writes POST to it, best-effort. Off when unset. */
    WEB_REVALIDATE_URL: z.string().url().optional(),
    /** Shared secret sent as `x-kkt-revalidate-token` to WEB_REVALIDATE_URL (the website's WEB_REVALIDATE_TOKEN). */
    WEB_REVALIDATE_TOKEN: z.string().min(32, "WEB_REVALIDATE_TOKEN must be at least 32 characters").optional(),
    // --- phase 7 platform track (docs/OBSERVABILITY.md, docs/DEPLOY.md) ---
    /** Port of the job worker's health listener (contract C8): GET /health → 200/503 with Redis, queues and the last heartbeat. */
    WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(9465),
    /** How long a stopping worker waits for in-flight critical jobs (heavy jobs checkpoint at their next batch and resume later). */
    WORKER_DRAIN_TIMEOUT_MS: z.coerce.number().int().min(0).max(3_600_000).default(120_000),
    /** Parallel jobs on the critical queue (dues, integrity, notifications, SLA, sweeps). */
    WORKER_CRITICAL_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(2),
    /** Parallel jobs on the heavy queue (backups, exports, ledger rebuild, re-encryption, image renditions). */
    WORKER_HEAVY_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(1),
    /** libuv thread pool size (argon2, sharp, zlib, fs); applied by src/preload.ts before the pool is first used. */
    UV_THREADPOOL_SIZE: z.coerce.number().int().min(1).max(1024).default(16),
    /** Image pipelines (sharp) running at once per process; libvips threads per pipeline follow sharp.concurrency(1). */
    IMAGE_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(2),
    /** Idempotency claim lease: a running request renews it every third of this; a retry may take a claim over only after it lapsed. */
    IDEMPOTENCY_LEASE_SECONDS: z.coerce.number().int().min(2).max(3600).default(30),
    /** Per-IP limit of POST /client-errors (contract C2), per minute. */
    CLIENT_ERROR_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(30),
    /** /health reports `degraded` when the worker heartbeat in Redis is older than this. */
    HEALTH_WORKER_STALE_SECONDS: z.coerce.number().int().min(15).max(86_400).default(90),
  })
  .superRefine((env, ctx) => {
    if (env.STORAGE_DRIVER === "s3") {
      if (!env.S3_BUCKET)
        ctx.addIssue({ code: "custom", path: ["S3_BUCKET"], message: "S3_BUCKET is required when STORAGE_DRIVER=s3" });
      if (!env.S3_REGION)
        ctx.addIssue({ code: "custom", path: ["S3_REGION"], message: "S3_REGION is required when STORAGE_DRIVER=s3" });
      if (Boolean(env.S3_ACCESS_KEY) !== Boolean(env.S3_SECRET_KEY)) {
        ctx.addIssue({
          code: "custom",
          path: ["S3_SECRET_KEY"],
          message: "S3_ACCESS_KEY and S3_SECRET_KEY must be set together (or both left unset for an IAM role)",
        });
      }
    }
    if (Boolean(env.BOOTSTRAP_ADMIN_EMAIL) !== Boolean(env.BOOTSTRAP_ADMIN_PASSWORD)) {
      ctx.addIssue({
        code: "custom",
        path: ["BOOTSTRAP_ADMIN_PASSWORD"],
        message: "BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD must be set together",
      });
    }
    const k1 = env.FIELD_ENCRYPTION_KEYS.find((k) => k.kid === "k1");
    if (k1 && k1.secret !== env.FIELD_ENCRYPTION_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["FIELD_ENCRYPTION_KEYS"],
        message: "key id k1 is FIELD_ENCRYPTION_KEY; give the new key another id",
      });
    }
    // Secret rings (contract C9): a hash ring must exist; h1 is HASH_KEY; production needs every explicit ring and no template value.
    if (env.HASH_KEYS.length === 0 && !env.HASH_KEY)
      ctx.addIssue({ code: "custom", path: ["HASH_KEYS"], message: "HASH_KEYS (or HASH_KEY) is required" });
    const h1 = env.HASH_KEYS.find((k) => k.kid === "h1");
    if (h1 && env.HASH_KEY && h1.secret !== env.HASH_KEY)
      ctx.addIssue({
        code: "custom",
        path: ["HASH_KEYS"],
        message: "key id h1 is HASH_KEY; give the new key another id",
      });
    for (const [path, message] of productionSecretProblems(env))
      ctx.addIssue({ code: "custom", path: [path], message });
  })
  .transform((env) => ({
    ...env,
    /** Field-encryption key ring, active key first: FIELD_ENCRYPTION_KEYS in order, then FIELD_ENCRYPTION_KEY as `k1` when not listed. */
    FIELD_KEY_RING: env.FIELD_ENCRYPTION_KEYS.some((k) => k.kid === "k1")
      ? env.FIELD_ENCRYPTION_KEYS
      : [...env.FIELD_ENCRYPTION_KEYS, { kid: "k1", secret: env.FIELD_ENCRYPTION_KEY }],
    /** Keyed-hash ring, active first: HASH_KEYS in order, then HASH_KEY as `h1` when set and not listed. */
    HASH_KEY_RING:
      env.HASH_KEY && !env.HASH_KEYS.some((k) => k.kid === "h1")
        ? [...env.HASH_KEYS, { kid: "h1", secret: env.HASH_KEY }]
        : env.HASH_KEYS,
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
  production: {
    SEED_ON_BOOT: "false",
    SEED_DEMO: "false",
    RUN_JOBS_IN_API: "false",
    API_WORKERS: "auto",
    DOCS_PUBLIC: "false",
    API_MAX_INFLIGHT: "256",
  },
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
