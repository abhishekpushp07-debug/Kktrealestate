import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { loadConfig, parseFieldKeys, parseTrustProxy, SECRET_FILE_VARS } from "../../src/config.js";

const PROD_SECRETS = {
  NODE_ENV: "production",
  JWT_SECRET: "p".repeat(48),
  FIELD_ENCRYPTION_KEY: "f".repeat(44),
  HASH_KEY: "h".repeat(32),
  DATABASE_URL: "postgres://app:secret@db:5432/kkt",
  REDIS_URL: "redis://cache:6379/0",
} as const;

function failure(env: NodeJS.ProcessEnv, readFile?: (p: string) => string): string {
  try {
    loadConfig(env, readFile ? { readFile } : {});
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error("expected loadConfig to throw");
}

describe("TRUST_PROXY parsing", () => {
  it("accepts booleans, proxy-addr names, IPs and CIDRs; rejects anything else", () => {
    expect(parseTrustProxy("true")).toBe(true);
    expect(parseTrustProxy("1")).toBe(true);
    expect(parseTrustProxy("false")).toBe(false);
    expect(parseTrustProxy("0")).toBe(false);
    expect(parseTrustProxy("loopback")).toEqual(["loopback"]);
    expect(parseTrustProxy(" Loopback , uniquelocal,10.0.0.0/8, 172.16.0.0/255.240.0.0, ::1, fd00::/8 ")).toEqual([
      "loopback",
      "uniquelocal",
      "10.0.0.0/8",
      "172.16.0.0/255.240.0.0",
      "::1",
      "fd00::/8",
    ]);
    expect(() => parseTrustProxy("loopbak")).toThrow(/loopbak/);
    expect(() => parseTrustProxy("10.0.0.0/33")).toThrow(/10\.0\.0\.0\/33/);
    expect(() => parseTrustProxy("everyone")).toThrow();
  });

  it("defaults to loopback and reports a bad value as a configuration error", () => {
    expect(loadConfig({ NODE_ENV: "test" }).TRUST_PROXY).toEqual(["loopback"]);
    expect(loadConfig({ NODE_ENV: "test", TRUST_PROXY: "" }).TRUST_PROXY).toEqual(["loopback"]);
    expect(failure({ NODE_ENV: "test", TRUST_PROXY: "proxy" })).toMatch(/TRUST_PROXY: unknown proxy entry proxy/);
  });

  it("gives Fastify a req.ip that only honours X-Forwarded-For from trusted peers (right-most untrusted hop)", async () => {
    const app = Fastify({ trustProxy: loadConfig({ NODE_ENV: "test" }).TRUST_PROXY });
    app.get("/ip", (req) => ({ ip: req.ip }));
    const ip = async (remoteAddress: string, xff?: string) =>
      (
        await app.inject({ method: "GET", url: "/ip", remoteAddress, headers: xff ? { "x-forwarded-for": xff } : {} })
      ).json<{ ip: string }>().ip;
    expect(await ip("127.0.0.1", "203.0.113.9")).toBe("203.0.113.9");
    expect(await ip("127.0.0.1", "198.51.100.1, 203.0.113.9")).toBe("203.0.113.9");
    expect(await ip("198.51.100.5", "203.0.113.9")).toBe("198.51.100.5");
    await app.close();

    const lan = Fastify({ trustProxy: loadConfig({ NODE_ENV: "test", TRUST_PROXY: "uniquelocal" }).TRUST_PROXY });
    lan.get("/ip", (req) => ({ ip: req.ip }));
    const lanIp = async (remoteAddress: string, xff: string) =>
      (await lan.inject({ method: "GET", url: "/ip", remoteAddress, headers: { "x-forwarded-for": xff } })).json<{
        ip: string;
      }>().ip;
    expect(await lanIp("172.18.0.4", "203.0.113.9")).toBe("203.0.113.9");
    expect(await lanIp("127.0.0.1", "203.0.113.9")).toBe("127.0.0.1");
    await lan.close();
  });
});

describe("environment-dependent defaults", () => {
  it("development/test: local database, Redis and secrets; demo seed and in-API jobs on; one HTTP worker", () => {
    const c = loadConfig({ NODE_ENV: "development" });
    expect(c.DATABASE_URL).toBe("postgres://postgres:postgres@localhost:5432/kkt");
    expect(c.REDIS_URL).toBe("redis://localhost:6379/0");
    expect([c.SEED_ON_BOOT, c.SEED_DEMO, c.RUN_JOBS_IN_API, c.API_WORKERS]).toEqual([true, true, true, 1]);
    expect(c.DB_STATEMENT_TIMEOUT_MS).toBe(15_000);
    expect(c.DB_LOCK_TIMEOUT_MS).toBe(5_000);
    expect(c.DB_IDLE_IN_TX_TIMEOUT_MS).toBe(30_000);
    expect(c.DB_CONNECT_TIMEOUT_S).toBe(10);
    expect(c.METRICS_PORT).toBe(9464);
    expect(c.OTEL_SERVICE_NAME).toBe("kkt-api");
    expect(c.JWT_PREVIOUS_SECRETS).toEqual([]);
    expect(c.FIELD_KEY_RING.map((k) => k.kid)).toEqual(["k1"]);
  });

  it("production: seed, demo data and in-API jobs off, API_WORKERS auto (0) unless set explicitly", () => {
    const c = loadConfig({ ...PROD_SECRETS });
    expect([c.SEED_ON_BOOT, c.SEED_DEMO, c.RUN_JOBS_IN_API, c.API_WORKERS]).toEqual([false, false, false, 0]);
    const explicit = loadConfig({ ...PROD_SECRETS, SEED_ON_BOOT: "true", RUN_JOBS_IN_API: "1", API_WORKERS: "2" });
    expect([explicit.SEED_ON_BOOT, explicit.SEED_DEMO, explicit.RUN_JOBS_IN_API, explicit.API_WORKERS]).toEqual([
      true,
      false,
      true,
      2,
    ]);
  });

  it("API docs are public outside production and private in production unless DOCS_PUBLIC=true", () => {
    expect(loadConfig({ NODE_ENV: "development" }).DOCS_PUBLIC).toBe(true);
    expect(loadConfig({ NODE_ENV: "test" }).DOCS_PUBLIC).toBe(true);
    expect(loadConfig({ ...PROD_SECRETS }).DOCS_PUBLIC).toBe(false);
    expect(loadConfig({ ...PROD_SECRETS, DOCS_PUBLIC: "true" }).DOCS_PUBLIC).toBe(true);
    expect(loadConfig({ NODE_ENV: "development", DOCS_PUBLIC: "false" }).DOCS_PUBLIC).toBe(false);
  });

  it("deploy identity and the Redis command timeout", () => {
    const c = loadConfig({ NODE_ENV: "development" });
    expect(c.DEPLOY_ID).toBeUndefined();
    expect(c.GIT_SHA).toBeUndefined();
    expect(c.REDIS_COMMAND_TIMEOUT_MS).toBe(2_000);
    const set = loadConfig({
      NODE_ENV: "development",
      DEPLOY_ID: "2026-10-26.1",
      GIT_SHA: "abc123",
      REDIS_COMMAND_TIMEOUT_MS: "500",
    });
    expect([set.DEPLOY_ID, set.GIT_SHA, set.REDIS_COMMAND_TIMEOUT_MS]).toEqual(["2026-10-26.1", "abc123", 500]);
    expect(failure({ NODE_ENV: "development", REDIS_COMMAND_TIMEOUT_MS: "10" })).toMatch(/REDIS_COMMAND_TIMEOUT_MS/);
  });

  it("production requires secrets, DATABASE_URL and REDIS_URL (no localhost fallbacks)", () => {
    const { DATABASE_URL: _d, REDIS_URL: _r, ...noUrls } = PROD_SECRETS;
    const msg = failure(noUrls);
    expect(msg).toMatch(/DATABASE_URL: DATABASE_URL is required in production/);
    expect(msg).toMatch(/REDIS_URL: REDIS_URL is required in production/);
    expect(failure({ ...PROD_SECRETS, DATABASE_URL: "" })).toMatch(/DATABASE_URL/);
    const { JWT_SECRET: _j, ...noJwt } = PROD_SECRETS;
    expect(failure(noJwt)).toMatch(/JWT_SECRET/);
    expect(failure({ ...PROD_SECRETS, JWT_SECRET: "short" })).toMatch(/JWT_SECRET must be at least 32 characters/);
  });
});

describe("storage and bootstrap validation", () => {
  it("STORAGE_DRIVER=s3 requires S3_BUCKET and S3_REGION; keys are optional (IAM role) but must come in pairs", () => {
    const msg = failure({ NODE_ENV: "test", STORAGE_DRIVER: "s3" });
    expect(msg).toMatch(/S3_BUCKET is required when STORAGE_DRIVER=s3/);
    expect(msg).toMatch(/S3_REGION is required when STORAGE_DRIVER=s3/);
    const ok = loadConfig({ ...PROD_SECRETS, STORAGE_DRIVER: "s3", S3_BUCKET: "kkt-docs", S3_REGION: "ap-south-1" });
    expect([ok.S3_BUCKET, ok.S3_REGION, ok.S3_ACCESS_KEY]).toEqual(["kkt-docs", "ap-south-1", undefined]);
    expect(
      failure({ NODE_ENV: "test", STORAGE_DRIVER: "s3", S3_BUCKET: "b", S3_REGION: "r", S3_ACCESS_KEY: "AKIA" }),
    ).toMatch(/must be set together/);
    expect(loadConfig({ NODE_ENV: "test" }).S3_REGION).toBeUndefined();
  });

  it("bootstrap admin e-mail and password come together; the password is at least 12 characters", () => {
    const c = loadConfig({
      ...PROD_SECRETS,
      BOOTSTRAP_COMPANY_NAME: "Acme Builders",
      BOOTSTRAP_ADMIN_EMAIL: "owner@acme.in",
      BOOTSTRAP_ADMIN_PASSWORD: "Very$trong-pass1",
    });
    expect([c.BOOTSTRAP_COMPANY_NAME, c.BOOTSTRAP_ADMIN_EMAIL]).toEqual(["Acme Builders", "owner@acme.in"]);
    expect(failure({ ...PROD_SECRETS, BOOTSTRAP_ADMIN_EMAIL: "owner@acme.in" })).toMatch(/must be set together/);
    expect(
      failure({ ...PROD_SECRETS, BOOTSTRAP_ADMIN_EMAIL: "owner@acme.in", BOOTSTRAP_ADMIN_PASSWORD: "short" }),
    ).toMatch(/at least 12/);
  });
});

describe("<NAME>_FILE secrets", () => {
  it("covers every secret named by the deployment docs", () => {
    expect([...SECRET_FILE_VARS].sort()).toEqual(
      [
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
      ].sort(),
    );
  });

  it("reads each value from its file (trimmed), satisfying production requirements", () => {
    const files: Record<string, string> = {
      "/run/secrets/jwt": `${"j".repeat(40)}\n`,
      "/run/secrets/db": "postgres://app:pw@db/kkt\n",
      "/run/secrets/redis": "redis://cache:6379/2",
      "/run/secrets/metrics": "metrics-token-0123456789",
    };
    const read = (p: string) => {
      const v = files[p];
      if (v === undefined) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return v;
    };
    const { JWT_SECRET: _j, DATABASE_URL: _d, REDIS_URL: _r, ...rest } = PROD_SECRETS;
    const c = loadConfig(
      {
        ...rest,
        JWT_SECRET_FILE: "/run/secrets/jwt",
        DATABASE_URL_FILE: "/run/secrets/db",
        REDIS_URL_FILE: "/run/secrets/redis",
        METRICS_TOKEN_FILE: "/run/secrets/metrics",
      },
      { readFile: read },
    );
    expect(c.JWT_SECRET).toBe("j".repeat(40));
    expect(c.DATABASE_URL).toBe("postgres://app:pw@db/kkt");
    expect(c.REDIS_URL).toBe("redis://cache:6379/2");
    expect(c.METRICS_TOKEN).toBe("metrics-token-0123456789");
    expect(failure({ ...PROD_SECRETS, HASH_KEY_FILE: "/run/secrets/nope" }, read)).toMatch(
      /HASH_KEY: set either HASH_KEY or HASH_KEY_FILE, not both/,
    );
    const { HASH_KEY: _h, ...noHash } = PROD_SECRETS;
    const missing = failure({ ...noHash, HASH_KEY_FILE: "/run/secrets/nope" }, read);
    expect(missing).toMatch(/HASH_KEY_FILE: cannot read \/run\/secrets\/nope \(ENOENT\)/);
    expect(
      failure({ ...noHash, HASH_KEY_FILE: "/run/secrets/empty" }, (p) => (p === "/run/secrets/empty" ? "\n" : read(p))),
    ).toMatch(/is empty/);
  });
});

describe("key rotation inputs", () => {
  it("FIELD_ENCRYPTION_KEYS: ordered ring, active first, FIELD_ENCRYPTION_KEY appended as k1", () => {
    const k2 = "k2:" + "B".repeat(44);
    const c = loadConfig({ NODE_ENV: "test", FIELD_ENCRYPTION_KEYS: k2 });
    expect(c.FIELD_KEY_RING.map((k) => k.kid)).toEqual(["k2", "k1"]);
    expect(parseFieldKeys(`k3:${"C".repeat(32)}, k2:${"B".repeat(32)}`).map((k) => k.kid)).toEqual(["k3", "k2"]);
    expect(() => parseFieldKeys("k2:short")).toThrow(/at least 32/);
    expect(() => parseFieldKeys(`bad kid:${"x".repeat(32)}`)).toThrow(/key id/);
    expect(() => parseFieldKeys(`k2:${"x".repeat(32)},k2:${"y".repeat(32)}`)).toThrow(/twice/);
    expect(failure({ NODE_ENV: "test", FIELD_ENCRYPTION_KEYS: `k1:${"Z".repeat(40)}` })).toMatch(
      /key id k1 is FIELD_ENCRYPTION_KEY/,
    );
  });

  it("JWT_PREVIOUS_SECRETS is a verify-only list of strong secrets", () => {
    expect(
      loadConfig({ NODE_ENV: "test", JWT_PREVIOUS_SECRETS: `${"a".repeat(32)}, ${"b".repeat(40)}` })
        .JWT_PREVIOUS_SECRETS,
    ).toEqual(["a".repeat(32), "b".repeat(40)]);
    expect(failure({ NODE_ENV: "test", JWT_PREVIOUS_SECRETS: "tooshort" })).toMatch(/JWT_PREVIOUS_SECRETS/);
  });

  it("validates the optional observability and internal-call settings", () => {
    expect(failure({ NODE_ENV: "test", OTEL_EXPORTER_OTLP_ENDPOINT: "not a url" })).toMatch(
      /OTEL_EXPORTER_OTLP_ENDPOINT/,
    );
    expect(failure({ NODE_ENV: "test", INTERNAL_API_TOKEN: "short" })).toMatch(
      /INTERNAL_API_TOKEN must be at least 32/,
    );
    expect(failure({ NODE_ENV: "test", DB_STATEMENT_TIMEOUT_MS: "-1" })).toMatch(/DB_STATEMENT_TIMEOUT_MS/);
    const c = loadConfig({
      NODE_ENV: "test",
      REDIS_SECURITY_URL: "redis://sec:6379/0",
      ERROR_WEBHOOK_URL: "https://hooks.example/x",
      METRICS_PORT: "9100",
    });
    expect([c.REDIS_SECURITY_URL, c.ERROR_WEBHOOK_URL, c.METRICS_PORT]).toEqual([
      "redis://sec:6379/0",
      "https://hooks.example/x",
      9100,
    ]);
  });
});
