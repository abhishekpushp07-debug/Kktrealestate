import { generateKeyPairSync } from "node:crypto";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "../../src/config.js";
import { BOOTSTRAP_USERS, BootstrapRefused, ensureBootstrap } from "../../src/seed/bootstrap.js";
import { firstBoot, firstBootMode, wantsDemoDataset, type FirstBootConfig } from "../../src/seed/firstBoot.js";
import type { SeedResult } from "../../src/seed/run.js";
import { buildTestApp, TEST_DATABASE_URL, truncateAll, type TestContext } from "./helpers.js";

/**
 * First boot (cross-track item 1): every boot path bootstraps a database that has no company — independent of SEED_ON_BOOT — using
 * BOOTSTRAP_* in production and refusing to start without them; the demo dataset needs SEED_ON_BOOT and SEED_DEMO. Covered in-process
 * (seed/firstBoot.ts) and end to end through `node src/server.ts migrate` in production mode against a scratch database.
 */
const API_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
let t: TestContext;
const saved = {
  NODE_ENV: config.NODE_ENV,
  name: config.BOOTSTRAP_COMPANY_NAME,
  email: config.BOOTSTRAP_ADMIN_EMAIL,
  password: config.BOOTSTRAP_ADMIN_PASSWORD,
  SEED_DEMO: config.SEED_DEMO,
};
const PROD_ADMIN = { name: "Acme Builders", email: "owner@acme.example", password: "Strong-Owner-Pass-1" };

function bootstrapEnv(env: { name?: string; email?: string; password?: string } = {}): void {
  config.BOOTSTRAP_COMPANY_NAME = env.name;
  config.BOOTSTRAP_ADMIN_EMAIL = env.email;
  config.BOOTSTRAP_ADMIN_PASSWORD = env.password;
}

async function counts(): Promise<{ companies: number; users: number; projects: number }> {
  const [r] = await t.app.sql<{ companies: number; users: number; projects: number }[]>`
    select (select count(*)::int from companies) as companies, (select count(*)::int from users) as users, (select count(*)::int from projects) as projects`;
  return r!;
}

const demoResult: SeedResult = { skipped: false, counts: { projects: 3 }, durationMs: 1 };

beforeAll(async () => {
  t = await buildTestApp();
});
afterEach(() => {
  config.NODE_ENV = saved.NODE_ENV;
  config.SEED_DEMO = saved.SEED_DEMO;
  bootstrapEnv({ name: saved.name, email: saved.email, password: saved.password });
});
afterAll(async () => {
  await truncateAll(t.app.sql);
  await ensureBootstrap(t.app.db, { mode: "demo" });
  await t?.close();
});

describe("first boot policy (seed/firstBoot.ts)", () => {
  const prod = (seedOnBoot: boolean, seedDemo: boolean): FirstBootConfig => ({
    NODE_ENV: "production",
    SEED_ON_BOOT: seedOnBoot,
    SEED_DEMO: seedDemo,
  });

  it("mode and demo switches: the demo dataset needs SEED_ON_BOOT and SEED_DEMO; production bootstraps from BOOTSTRAP_* otherwise", () => {
    expect(wantsDemoDataset(prod(true, true))).toBe(true);
    expect(wantsDemoDataset(prod(false, true))).toBe(false);
    expect(wantsDemoDataset(prod(true, false))).toBe(false);
    expect(firstBootMode(prod(false, false))).toBe("production");
    expect(firstBootMode(prod(false, true))).toBe("production"); // SEED_DEMO alone never brings the published demo logins
    expect(firstBootMode(prod(true, true))).toBe("demo");
    expect(firstBootMode({ NODE_ENV: "development", SEED_ON_BOOT: false, SEED_DEMO: false })).toBe("demo");
  });

  it("production, SEED_ON_BOOT=false, empty database, no BOOTSTRAP_*: refuses to start and writes nothing", async () => {
    await truncateAll(t.app.sql);
    config.NODE_ENV = "production";
    bootstrapEnv();
    const seedDemo = vi.fn(async () => demoResult);
    await expect(firstBoot({ db: t.app.db, config: prod(false, false), seedDemo })).rejects.toBeInstanceOf(
      BootstrapRefused,
    );
    expect(seedDemo).not.toHaveBeenCalled();
    expect(await counts()).toEqual({ companies: 0, users: 0, projects: 0 });
  });

  it("production, SEED_ON_BOOT=false, empty database with BOOTSTRAP_*: creates the company and one Super Admin, no demo data", async () => {
    await truncateAll(t.app.sql);
    config.NODE_ENV = "production";
    config.SEED_DEMO = true; // even with SEED_DEMO the demo logins/dataset need SEED_ON_BOOT too
    bootstrapEnv(PROD_ADMIN);
    const seedDemo = vi.fn(async () => demoResult);
    const r = await firstBoot({ db: t.app.db, config: prod(false, true), seedDemo });
    expect(r).toMatchObject({
      emptyDatabase: true,
      demo: null,
      bootstrap: { created: true, mode: "production", adminEmail: PROD_ADMIN.email },
    });
    expect(seedDemo).not.toHaveBeenCalled();
    expect(await counts()).toEqual({ companies: 1, users: 1, projects: 0 });
    const emails = (await t.app.sql<{ email: string }[]>`select email from users`).map((u) => u.email);
    for (const demo of BOOTSTRAP_USERS) expect(emails).not.toContain(demo.email);
  });

  it("once a company exists a replica without BOOTSTRAP_* boots (no bootstrap needed with SEED_ON_BOOT=false; idempotent with it)", async () => {
    config.NODE_ENV = "production";
    bootstrapEnv();
    const seedDemo = vi.fn(async () => demoResult);
    const quiet = await firstBoot({ db: t.app.db, config: prod(false, false), seedDemo });
    expect(quiet).toEqual({ emptyDatabase: false, bootstrap: null, demo: null });
    const sync = await firstBoot({ db: t.app.db, config: prod(true, false), seedDemo });
    expect(sync.bootstrap).toMatchObject({ created: false, mode: "production" });
    expect(seedDemo).not.toHaveBeenCalled();
    expect(await counts()).toEqual({ companies: 1, users: 1, projects: 0 });
  });

  it("SEED_ON_BOOT and SEED_DEMO: the demo bootstrap and the demo dataset run", async () => {
    await truncateAll(t.app.sql);
    const seedDemo = vi.fn(async () => demoResult);
    const r = await firstBoot({
      db: t.app.db,
      config: { NODE_ENV: "development", SEED_ON_BOOT: true, SEED_DEMO: true },
      seedDemo,
    });
    expect(r.bootstrap).toMatchObject({ created: true, mode: "demo" });
    expect(seedDemo).toHaveBeenCalledTimes(1);
    expect(r.demo).toBe(demoResult);
    expect((await counts()).users).toBe(BOOTSTRAP_USERS.length);
  });
});

describe("server.ts migrate in production mode (end to end, scratch database)", () => {
  const scratch = (() => {
    const u = new URL(TEST_DATABASE_URL);
    const name = `${u.pathname.slice(1)}_firstboot`;
    return { name, url: Object.assign(new URL(TEST_DATABASE_URL), { pathname: `/${name}` }).toString() };
  })();
  const admin = () => {
    const u = new URL(TEST_DATABASE_URL);
    u.pathname = "/postgres";
    return postgres(u.toString(), { max: 1, onnotice: () => undefined });
  };

  beforeAll(async () => {
    const sql = admin();
    try {
      await sql.unsafe(`drop database if exists "${scratch.name}" with (force)`);
      await sql.unsafe(`create database "${scratch.name}"`);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
  afterAll(async () => {
    const sql = admin();
    try {
      await sql.unsafe(`drop database if exists "${scratch.name}" with (force)`);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  function runMigrate(extra: Record<string, string>): Promise<{ code: number | null; output: string }> {
    const env: Record<string, string | undefined> = {
      PATH: process.env["PATH"],
      HOME: process.env["HOME"],
      NODE_ENV: "production",
      DATABASE_URL: scratch.url,
      REDIS_URL: process.env["REDIS_URL"],
      JWT_SECRET: "first-boot-test-jwt-secret-0123456789abcdef-xyz",
      FIELD_ENCRYPTION_KEY: "Zmlyc3QtYm9vdC10ZXN0LWZpZWxkLWtleS0wMTIzNDU2Nzg5",
      // contract C9: production needs the explicit rings (an Ed25519 JWT key, link and hash keys) and no secret under 32 bytes
      HASH_KEYS: "h1:first-boot-test-hash-key-0123456789abcdef",
      JWT_SIGNING_KEYS: `fb1:${generateKeyPairSync("ed25519").privateKey.export({ format: "der", type: "pkcs8" }).toString("base64")}`,
      LINK_SIGNING_KEYS: "l1:first-boot-test-link-key-0123456789abcdef",
      LOG_LEVEL: "info",
      SEED_ON_BOOT: "false",
      SEED_DEMO: "false",
      ...extra,
    };
    return new Promise((resolveRun, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts", "migrate"], {
        cwd: API_DIR,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.on("data", (c: Buffer) => {
        output += c.toString();
      });
      child.stderr.on("data", (c: Buffer) => {
        output += c.toString();
      });
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`migrate timed out: ${output}`));
      }, 120_000);
      child.on("exit", (code) => {
        clearTimeout(timer);
        resolveRun({ code, output });
      });
    });
  }

  async function scratchCounts(): Promise<{
    companies: number;
    users: number;
    projects: number;
    must_change: boolean[];
  }> {
    const sql = postgres(scratch.url, { max: 1, onnotice: () => undefined });
    try {
      const [r] = await sql<
        { companies: number; users: number; projects: number }[]
      >`select (select count(*)::int from companies) as companies, (select count(*)::int from users) as users, (select count(*)::int from projects) as projects`;
      const must = await sql<{ must_change_password: boolean }[]>`select must_change_password from users`;
      return { ...r!, must_change: must.map((m) => m.must_change_password) };
    } finally {
      await sql.end({ timeout: 5 });
    }
  }

  it("without BOOTSTRAP_* the first boot is refused (exit 1, reason logged) even with SEED_ON_BOOT=false; with them it creates one company and one admin", async () => {
    const refused = await runMigrate({});
    expect(refused.code, refused.output).toBe(1);
    expect(refused.output).toContain("Refusing to start on a fresh production database");
    expect(await scratchCounts()).toMatchObject({ companies: 0, users: 0, projects: 0 });

    const ok = await runMigrate({
      BOOTSTRAP_COMPANY_NAME: "Scratch Builders",
      BOOTSTRAP_ADMIN_EMAIL: "owner@scratch.example",
      BOOTSTRAP_ADMIN_PASSWORD: "Scratch-Owner-Pass-1",
    });
    expect(ok.code, ok.output).toBe(0);
    expect(ok.output).toContain("migrate job finished");
    expect(await scratchCounts()).toEqual({ companies: 1, users: 1, projects: 0, must_change: [true] });

    // later boots need no BOOTSTRAP_* (a company exists) and never add demo data without SEED_ON_BOOT + SEED_DEMO
    const again = await runMigrate({ SEED_DEMO: "true" });
    expect(again.code, again.output).toBe(0);
    expect(await scratchCounts()).toEqual({ companies: 1, users: 1, projects: 0, must_change: [true] });
  }, 300_000);
});
