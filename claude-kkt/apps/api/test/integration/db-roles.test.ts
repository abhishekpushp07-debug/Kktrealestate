// The API runs as kkt_app in this file: DATABASE_URL must point at it before the app (and its config module) is imported.
const BASE = new URL(process.env["TEST_DATABASE_URL"] ?? "postgres://postgres:postgres@localhost:5432/kkt_api_test");
const DB_NAME = `${BASE.pathname.slice(1)}_roles`;
const OWNER_PW = "owner-pw-integration-0123";
const APP_PW = "app-pw-integration-0123";
const url = (user: string, pw: string, db = DB_NAME) => {
  const u = new URL(BASE.toString());
  u.username = user;
  u.password = pw;
  u.pathname = `/${db}`;
  return u.toString();
};
process.env["DATABASE_URL"] = url("kkt_app", APP_PW);
process.env["REDIS_URL"] = process.env["TEST_REDIS_URL"] ?? "redis://localhost:6379/1";
process.env["NODE_ENV"] = "test";
process.env["RUN_JOBS_IN_API"] = "false";
process.env["KKT_MODULES"] = "web";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, runMigrations } from "@kkt/db";

/**
 * infra/postgres/init/01-roles.sql: migrations run as kkt_owner, the API runs as kkt_app with DML only (docs/DEPLOY.md "Database roles").
 * The file creates its own database (<TEST_DATABASE_URL db>_roles) because the shared test helpers truncate as a superuser.
 */
const ROLES_SQL = readFileSync(
  join(import.meta.dirname, "..", "..", "..", "..", "infra", "postgres", "init", "01-roles.sql"),
  "utf8",
);
const superUrl = (db: string) => {
  const u = new URL(BASE.toString());
  u.pathname = `/${db}`;
  return u.toString();
};

let app: FastifyInstance;
let asApp: postgres.Sql;

async function denied(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "allowed";
  } catch (err) {
    return String((err as { code?: string }).code ?? (err as Error).message);
  }
}

beforeAll(async () => {
  const admin = postgres(superUrl("postgres"), { max: 1, onnotice: () => undefined });
  try {
    await admin.unsafe(
      `select pg_terminate_backend(pid) from pg_stat_activity where datname = '${DB_NAME}' and pid <> pg_backend_pid()`,
    );
    await admin.unsafe(`drop database if exists "${DB_NAME}"`);
    await admin.unsafe(`create database "${DB_NAME}"`);
  } finally {
    await admin.end({ timeout: 5 });
  }
  const su = postgres(superUrl(DB_NAME), { max: 1, onnotice: () => undefined });
  try {
    await su.unsafe(ROLES_SQL);
    await su.unsafe(ROLES_SQL); // idempotent
    await su.unsafe(`alter role kkt_owner password '${OWNER_PW}'`);
    await su.unsafe(`alter role kkt_app password '${APP_PW}'`);
  } finally {
    await su.end({ timeout: 5 });
  }
  await runMigrations(url("kkt_owner", OWNER_PW));
  // first-boot seed as the owner (the migrate job does this)
  const owner = createDb(url("kkt_owner", OWNER_PW), { max: 2 });
  try {
    const { ensureBootstrap } = await import("../../src/seed/bootstrap.js");
    await ensureBootstrap(owner.db);
  } finally {
    await owner.close();
  }
  asApp = postgres(url("kkt_app", APP_PW), { max: 2, onnotice: () => undefined });
  const { buildApp } = await import("../../src/app.js");
  app = await buildApp({ logger: false });
  await app.ready();
  await app.redis.flushdb();
}, 180_000);

afterAll(async () => {
  await app?.close();
  await asApp?.end({ timeout: 5 });
});

describe("database roles (kkt_owner migrates, kkt_app is DML only)", () => {
  it("the migrations ran as kkt_owner, which owns every table", async () => {
    const rows = await asApp<
      { owner: string; n: number }[]
    >`select tableowner as owner, count(*)::int as n from pg_tables where schemaname = 'public' group by 1`;
    expect(rows).toEqual([{ owner: "kkt_owner", n: expect.any(Number) }]);
    expect(rows[0]!.n).toBeGreaterThan(40);
  });

  it("kkt_app can read and write rows", async () => {
    const [c] = await asApp<{ n: number }[]>`select count(*)::int as n from companies`;
    expect(c!.n).toBe(1);
    await asApp`update companies set name = name`;
  });

  it("kkt_app cannot truncate, change the schema, disable triggers or bypass them", async () => {
    expect(await denied(asApp.unsafe("truncate table audit_logs"))).toBe("42501");
    expect(await denied(asApp.unsafe("create table evil (id int)"))).toBe("42501");
    expect(await denied(asApp.unsafe("alter table payments add column evil int"))).toBe("42501");
    expect(await denied(asApp.unsafe("alter table audit_logs disable trigger all"))).toBe("42501");
    expect(await denied(asApp.unsafe("drop table demands"))).toBe("42501");
    expect(await denied(asApp.unsafe("set session_replication_role = replica"))).toBe("42501");
    expect(await denied(asApp.unsafe("create extension if not exists pgcrypto"))).toBe("42501");
    expect(await denied(asApp.unsafe("set role kkt_owner"))).toBe("42501");
  });

  it("the append-only triggers hold against the application role", async () => {
    await asApp`insert into audit_logs (company_id, actor_type, action, entity_type) select id, 'SYSTEM', 'test.roles', 'company' from companies limit 1`;
    expect(await denied(asApp`delete from audit_logs where action = 'test.roles'`)).not.toBe("allowed");
    expect(await denied(asApp`update audit_logs set action = 'tampered' where action = 'test.roles'`)).not.toBe(
      "allowed",
    );
  });

  it("kkt_app carries the safety timeouts as role defaults (PgBouncer ignores startup parameters)", async () => {
    const plain = postgres(url("kkt_app", APP_PW), { max: 1, onnotice: () => undefined });
    try {
      const [r] = await plain<
        { st: string; lt: string; it: string }[]
      >`select current_setting('statement_timeout') as st, current_setting('lock_timeout') as lt, current_setting('idle_in_transaction_session_timeout') as it`;
      expect(r).toEqual({ st: "15s", lt: "5s", it: "30s" });
      const [s] = await plain<
        { n: number }[]
      >`select count(*)::int as n from pg_stat_activity where datname = current_database() and state is not null`;
      expect(s!.n).toBeGreaterThan(0); // pg_read_all_stats: /metrics can see connection states
    } finally {
      await plain.end({ timeout: 5 });
    }
  });

  it("the API works end to end as kkt_app (auth, reads, writes, audit)", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "admin@sgb.in", password: "Admin@12345" },
      headers: { "x-forwarded-for": "10.9.9.9" },
    });
    expect(login.statusCode, login.body).toBe(200);
    const token = (login.json() as { access_token: string }).access_token;
    const auth = { authorization: `Bearer ${token}` };
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/masters/room-types",
      headers: auth,
      payload: { name: "Roles test room", code: "RTR" },
    });
    expect([201, 422]).toContain(created.statusCode);
    const list = await app.inject({ method: "GET", url: "/api/v1/masters/room-types", headers: auth });
    expect(list.statusCode).toBe(200);
    const health = await app.inject({ method: "GET", url: "/api/v1/ready" });
    expect(health.statusCode).toBe(200);
  });
});
