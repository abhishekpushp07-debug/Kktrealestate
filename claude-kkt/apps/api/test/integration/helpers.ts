import type { FastifyInstance, InjectOptions } from "fastify";
import postgres from "postgres";
import { runMigrations } from "@kkt/db";

export const TEST_DATABASE_URL =
  process.env["TEST_DATABASE_URL"] ?? "postgres://postgres:postgres@localhost:5432/kkt_api_test";
process.env["NODE_ENV"] = "test";
process.env["DATABASE_URL"] = TEST_DATABASE_URL;
process.env["REDIS_URL"] = process.env["TEST_REDIS_URL"] ?? process.env["REDIS_URL"] ?? "redis://localhost:6379/1";
process.env["WRITE_RATE_LIMIT_PER_MIN"] ??= "100000";
process.env["PUBLIC_RATE_LIMIT_PER_MIN"] ??= "100000";
process.env["RUN_JOBS_IN_API"] = "false";

/** Normalised response of a test request. */
export interface TestResponse<T = unknown> {
  status: number;
  body: T;
  text: string;
  headers: Record<string, string | string[] | undefined>;
}

/** Options for a test request. */
export interface RequestOptions {
  token?: string | null;
  body?: unknown;
  headers?: Record<string, string>;
  ip?: string;
}

/** Login result. */
export interface LoginResult {
  access_token: string;
  refresh_token: string;
  user: { id: string; email: string; role_name: string; permissions: string[] };
  must_change_password: boolean;
}

let ipCounter = 0;
/** A fresh fake client IP so per-IP login limits never trip in tests. */
export function freshIp(): string {
  ipCounter += 1;
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}

/** Creates the test database when missing and migrates it. */
export async function ensureTestDatabase(): Promise<void> {
  const u = new URL(TEST_DATABASE_URL);
  const dbName = u.pathname.slice(1);
  u.pathname = "/postgres";
  const admin = postgres(u.toString(), { max: 1, onnotice: () => undefined });
  try {
    const rows = await admin`select 1 from pg_database where datname = ${dbName}`;
    if (rows.length === 0) await admin.unsafe(`create database "${dbName}"`);
  } finally {
    await admin.end({ timeout: 5 });
  }
  await runMigrations(TEST_DATABASE_URL);
}

/** Truncates every public table (the drizzle journal lives in schema `drizzle`); the append-only guards are bypassed for the test reset only. */
export async function truncateAll(sql: FastifyInstance["sql"]): Promise<void> {
  const rows = await sql<{ tablename: string }[]>`select tablename from pg_tables where schemaname = 'public'`;
  if (rows.length === 0) return;
  await sql.begin(async (tx) => {
    await tx.unsafe("set local session_replication_role = replica");
    await tx.unsafe(`truncate table ${rows.map((r) => `"${r.tablename}"`).join(", ")} cascade`);
  });
}

/** Everything a test needs: the app, a login helper and a typed request helper. */
export interface TestContext {
  app: FastifyInstance;
  companyId: string;
  request<T = unknown>(method: InjectOptions["method"], url: string, opts?: RequestOptions): Promise<TestResponse<T>>;
  login(email: string, password: string, extra?: Record<string, unknown>): Promise<LoginResult>;
  loginAs(role: "admin" | "projects" | "accounts" | "sales" | "marketing" | "employee"): Promise<LoginResult>;
  close(): Promise<void>;
}

/** Seeded credentials (docs/SEED.md). */
export const CREDS = {
  admin: { email: "admin@sgb.in", password: "Admin@12345" },
  projects: { email: "projects@sgb.in", password: "Project@12345" },
  accounts: { email: "accounts@sgb.in", password: "Accounts@12345" },
  sales: { email: "sales@sgb.in", password: "Sales@12345" },
  marketing: { email: "marketing@sgb.in", password: "Marketing@12345" },
  employee: { email: "employee@sgb.in", password: "Employee@12345" },
} as const;

/** Builds a fresh app on an empty, bootstrapped test database with a flushed Redis db. */
export async function buildTestApp(
  opts: { extraRoutes?: (app: FastifyInstance) => Promise<void> | void } = {},
): Promise<TestContext> {
  await ensureTestDatabase();
  const { buildApp } = await import("../../src/app.js");
  const { ensureBootstrap } = await import("../../src/seed/bootstrap.js");
  const app = await buildApp({ logger: process.env["TEST_LOG"] === "1", extraRoutes: opts.extraRoutes });
  await app.ready();
  await truncateAll(app.sql);
  await app.redis.flushdb();
  const boot = await ensureBootstrap(app.db);

  async function request<T = unknown>(
    method: InjectOptions["method"],
    url: string,
    o: RequestOptions = {},
  ): Promise<TestResponse<T>> {
    const headers: Record<string, string> = { "x-forwarded-for": o.ip ?? freshIp(), ...(o.headers ?? {}) };
    if (o.token) headers["authorization"] = `Bearer ${o.token}`;
    if (o.body !== undefined) headers["content-type"] = "application/json";
    const res = await app.inject({
      method,
      url,
      headers,
      ...(o.body !== undefined ? { payload: JSON.stringify(o.body) } : {}),
    });
    let body: unknown;
    const ct = String(res.headers["content-type"] ?? "");
    if (ct.includes("application/json") && res.body) {
      try {
        body = JSON.parse(res.body);
      } catch {
        body = res.body;
      }
    } else body = res.body;
    return {
      status: res.statusCode,
      body: body as T,
      text: res.body,
      headers: res.headers as Record<string, string | string[] | undefined>,
    };
  }

  async function login(email: string, password: string, extra: Record<string, unknown> = {}): Promise<LoginResult> {
    const res = await request<LoginResult>("POST", "/api/v1/auth/login", { body: { email, password, ...extra } });
    if (res.status !== 200) throw new Error(`login failed (${res.status}): ${res.text}`);
    return res.body;
  }

  return {
    app,
    companyId: boot.companyId,
    request,
    login,
    loginAs: (role) => login(CREDS[role].email, CREDS[role].password),
    close: async () => {
      await app.close();
    },
  };
}

/** Shorthand for an error body. */
export interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown>; request_id?: string };
}
