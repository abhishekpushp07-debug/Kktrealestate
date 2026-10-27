import { generateKeyPairSync } from "node:crypto";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import {
  loadConfig,
  parseFieldKeys,
  parseJwtSigningKeys,
  parseTrustProxy,
  placeholderProblem,
  SECRET_FILE_VARS,
} from "../../src/config.js";

/** A base64 PKCS8 DER Ed25519 private key (JWT_SIGNING_KEYS entry value). */
const edKey = () =>
  generateKeyPairSync("ed25519").privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");

/** A complete production secret set (contract C9: explicit rings, no template values, 32+ bytes). */
const PROD_SECRETS = {
  NODE_ENV: "production",
  JWT_SECRET: "Jw7qR2xLm9vTz4pKs8dNc1fGh6bYe3uAo5iW",
  FIELD_ENCRYPTION_KEY: "Zk3mQ9vT2xLp8wR4nC7bY1dF6gH0jK5sA2uE9iO3tWq=",
  HASH_KEY: "Hk4zP8sWq2mXv6nRt1cLb9dFg3jYe7uAo0iQ",
  JWT_SIGNING_KEYS: `ed1:${edKey()}`,
  LINK_SIGNING_KEYS: "l1:Lk5yN3wQa8pZr2mTv7cXb1dFh6jGe4uSo9iP",
  HASH_KEYS: "h2:Hs8tB5vM1qWx7zKp3nRc9dLf2gJy6eUa4iOw",
  DATABASE_URL: "postgres://app:Pg5tR8wQ2mZx@db:5432/kkt",
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
        "JWT_SIGNING_KEYS",
        "LINK_SIGNING_KEYS",
        "HASH_KEYS",
        "INTERNAL_API_TOKEN",
        "WEB_REVALIDATE_TOKEN",
      ].sort(),
    );
  });

  it("reads each value from its file (trimmed), satisfying production requirements", () => {
    const files: Record<string, string> = {
      "/run/secrets/jwt": "Jt9wQ4mZ7xLp2vR8nC3bY6dF1gH5jK0sA4uE\n",
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
    expect(c.JWT_SECRET).toBe("Jt9wQ4mZ7xLp2vR8nC3bY6dF1gH5jK0sA4uE");
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

describe("production secrets (contract C9)", () => {
  it("refuses to boot without the explicit key rings", () => {
    const { JWT_SIGNING_KEYS: _j, LINK_SIGNING_KEYS: _l, HASH_KEYS: _h, ...noRings } = PROD_SECRETS;
    const msg = failure(noRings);
    expect(msg).toMatch(/JWT_SIGNING_KEYS is required in production/);
    expect(msg).toMatch(/LINK_SIGNING_KEYS is required in production/);
    expect(msg).toMatch(/HASH_KEYS is required in production/);
    // outside production they are derived (JWT_SECRET / HASH_KEY) as before
    const dev = loadConfig({ NODE_ENV: "development" });
    expect(dev.JWT_SIGNING_KEYS).toEqual([]);
    expect(dev.HASH_KEY_RING.map((k) => k.kid)).toEqual(["h1"]);
  });

  it("refuses template values from the examples, single-character fills and secrets under 32 bytes", () => {
    for (const [key, value] of [
      ["JWT_SECRET", "CHANGE-ME-at-least-32-characters-long-random"], // infra/k8s/secret.example.yaml
      ["JWT_SECRET", "change-me-use-openssl-rand-base64-48"], // .env.example
      ["FIELD_ENCRYPTION_KEY", "changeme-changeme-changeme-changeme-0001"],
      ["HASH_KEY", "placeholder-hash-key-value-0123456789abc"],
      ["HASH_KEY", "this-is-an-example-value-0123456789abcdef"],
      ["JWT_SECRET", "x".repeat(48)],
      ["HASH_KEY", "Hk4zP8sWq2mXv6nR"], // 16 bytes
      ["LINK_SIGNING_KEYS", `l1:${"X".repeat(40)}`],
      ["HASH_KEYS", "h2:CHANGE-ME-at-least-16-chars-0123456789"],
      ["METRICS_TOKEN", "CHANGE-ME-at-least-16-chars"],
      ["INTERNAL_API_TOKEN", "change-me-internal-api-token-0123456789"],
    ] as const) {
      expect(failure({ ...PROD_SECRETS, [key]: value }), `${key}=${value}`).toMatch(new RegExp(key.replace(/S$/, "")));
    }
    expect(failure({ ...PROD_SECRETS, DATABASE_URL: "postgres://kkt_app:CHANGE-ME@pgbouncer:6432/kkt" })).toMatch(
      /DATABASE_URL carries a placeholder password/,
    );
    expect(
      failure({
        ...PROD_SECRETS,
        BOOTSTRAP_ADMIN_EMAIL: "a@b.in",
        BOOTSTRAP_ADMIN_PASSWORD: "CHANGE-ME-first-admin-password",
      }),
    ).toMatch(/BOOTSTRAP_ADMIN_PASSWORD is a placeholder/);
    // the same values are fine outside production (dev defaults are exactly such values)
    expect(
      loadConfig({ NODE_ENV: "development", JWT_SECRET: "CHANGE-ME-at-least-32-characters-long-random" }).JWT_SECRET,
    ).toMatch(/CHANGE-ME/);
    expect(placeholderProblem("Jw7qR2xLm9vTz4pKs8dNc1fGh6bYe3uAo5iW")).toBeNull();
    expect(placeholderProblem("short")).toMatch(/32 bytes/);
  });

  it("accepts a complete production set; rings are ordered, active first, HASH_KEY joins the hash ring as h1", () => {
    const c = loadConfig({ ...PROD_SECRETS, JWT_SIGNING_KEYS: `ed2:${edKey()},ed1:${edKey()}` });
    expect(c.JWT_SIGNING_KEYS.map((k) => k.kid)).toEqual(["ed2", "ed1"]);
    expect(c.LINK_SIGNING_KEYS.map((k) => k.kid)).toEqual(["l1"]);
    expect(c.HASH_KEY_RING.map((k) => k.kid)).toEqual(["h2", "h1"]);
    expect(failure({ ...PROD_SECRETS, HASH_KEYS: `h1:${"Q".repeat(20)}w${"R".repeat(20)}` })).toMatch(
      /key id h1 is HASH_KEY/,
    );
  });

  it("JWT_SIGNING_KEYS entries must be base64 PKCS8 DER Ed25519 private keys", () => {
    const rsa = generateKeyPairSync("rsa", { modulusLength: 1024 })
      .privateKey.export({ format: "der", type: "pkcs8" })
      .toString("base64");
    expect(() => parseJwtSigningKeys(`r1:${rsa}`)).toThrow(/not a base64 PKCS8 DER Ed25519/);
    expect(() => parseJwtSigningKeys("e1:not-base64-at-all")).toThrow(/Ed25519/);
    const k = edKey();
    expect(() => parseJwtSigningKeys(`e1:${k},e1:${k}`)).toThrow(/twice/);
    expect(parseJwtSigningKeys(`e1:${k}`)[0]!.kid).toBe("e1");
  });
});
