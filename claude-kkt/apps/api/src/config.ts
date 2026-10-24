import { z } from "zod";

/** Environment schema: the process refuses to start when a required secret is missing or weak. */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_HOST: z.string().default("0.0.0.0"),
  API_PUBLIC_URL: z.string().url().default("http://localhost:4000"),
  DATABASE_URL: z.string().min(1).default("postgres://postgres:postgres@localhost:5432/kkt"),
  DATABASE_REPLICA_URL: z.string().optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(500).default(20),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379/0"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  FIELD_ENCRYPTION_KEY: z.string().min(32, "FIELD_ENCRYPTION_KEY must be at least 32 characters (base64 of 32 bytes recommended)"),
  HASH_KEY: z.string().min(16),
  ACCESS_TOKEN_MINUTES: z.coerce.number().int().min(1).max(120).default(15),
  REFRESH_TOKEN_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  ERP_ORIGIN: z.string().default("http://localhost:5173"),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
  PORTAL_ORIGIN: z.string().default("http://localhost:8081"),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default("./storage"),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default("ap-south-1"),
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  SEED_ON_BOOT: z.string().default("true").transform((v) => v === "true" || v === "1"),
  RUN_MIGRATIONS_ON_BOOT: z.string().default("true").transform((v) => v === "true" || v === "1"),
  RUN_JOBS_IN_API: z.string().default("true").transform((v) => v === "true" || v === "1"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  LOG_PRETTY: z.string().default("false").transform((v) => v === "true" || v === "1"),
  TRUST_PROXY: z.string().default("true").transform((v) => v === "true" || v === "1"),
  /** Per-IP request limit for public (unauthenticated) routes, per minute. */
  PUBLIC_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(300),
  /** Per-user limit for staff/portal write requests (POST/PATCH/PUT/DELETE), per minute. */
  WRITE_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(120),
  /** Version string reported by /health and /metrics. */
  APP_VERSION: z.string().default("2.0.0"),
});

export type Env = z.infer<typeof EnvSchema>;

const DEV_DEFAULTS: Partial<Record<keyof Env, string>> = {
  JWT_SECRET: "dev-only-jwt-secret-change-me-dev-only-jwt-secret",
  FIELD_ENCRYPTION_KEY: "ZGV2LW9ubHktZmllbGQta2V5LWNoYW5nZS1tZS1kZXYtb25seS0wMQ==",
  HASH_KEY: "dev-only-hash-key-change-me",
};

/** Load and validate configuration from process.env (dev/test fall back to insecure defaults, production never does). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Env {
  const merged: NodeJS.ProcessEnv = { ...env };
  if ((merged.NODE_ENV ?? "development") !== "production") {
    for (const [k, v] of Object.entries(DEV_DEFAULTS)) if (!merged[k]) merged[k] = v;
  }
  const parsed = EnvSchema.safeParse(merged);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${msg}`);
  }
  return parsed.data;
}

export const config: Env = loadConfig();
export const isProd = config.NODE_ENV === "production";
export const isTest = config.NODE_ENV === "test";
