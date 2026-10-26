import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import YAML from "yaml";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig, type Env } from "../../src/config.js";

/**
 * The shipped deployments must boot: every API/worker/migrate environment in docker-compose.yml, docker-compose.prod.yml and
 * infra/k8s, fed the secrets infra/scripts/gen-secrets.sh produces (the documented path), passes the API's configuration validation and
 * has the production roles the docs promise (replicas never migrate or seed, the API talks to PgBouncer as kkt_app, the migrate job
 * talks to Postgres as kkt_owner). No Docker needed: Compose files are interpolated and merged here the way `docker compose config` does.
 */

const ROOT = join(import.meta.dirname, "..", "..", "..", "..");
let secretsDir: string;

beforeAll(() => {
  secretsDir = mkdtempSync(join(tmpdir(), "kkt-secrets-"));
  execFileSync("sh", [join(ROOT, "infra", "scripts", "gen-secrets.sh"), secretsDir], { stdio: "ignore" });
});

afterAll(() => {
  if (secretsDir) rmSync(secretsDir, { recursive: true, force: true });
});

/** Compose variable interpolation: ${VAR}, ${VAR:-default}, ${VAR-default}, ${VAR:?error}, ${VAR?error}, $$. */
function interpolate(text: string, vars: Record<string, string | undefined>): string {
  return text.replace(
    /\$\$|\$\{([A-Za-z0-9_]+)(?:(:?)([-?])([^}]*))?\}/g,
    (whole, name: string | undefined, colon: string, op: string, arg: string) => {
      if (whole === "$$") return "$";
      const v = vars[name!];
      const missing = v === undefined || (colon === ":" && v === "");
      if (op === "?" && missing) throw new Error(`required variable ${name} is missing a value: ${arg}`);
      if (op === "-" && missing) return arg;
      return v ?? "";
    },
  );
}

type ComposeService = { environment?: Record<string, string | number | null> | string[] };

function composeServices(file: string, vars: Record<string, string>): Record<string, ComposeService> {
  const doc = YAML.parse(interpolate(readFileSync(join(ROOT, file), "utf8"), vars), { merge: true }) as {
    services: Record<string, ComposeService>;
  };
  return doc.services;
}

function envOf(svc: ComposeService): Record<string, string> {
  const raw = svc.environment ?? {};
  const pairs = Array.isArray(raw)
    ? raw.map((e) => e.split(/=(.*)/s).slice(0, 2) as [string, string])
    : Object.entries(raw).map(([k, v]) => [k, v === null ? "" : String(v)] as [string, string]);
  return Object.fromEntries(pairs);
}

/** Secret files as mounted in the containers (/run/secrets/<name> in Compose, /run/secrets/kkt/<name> in Kubernetes). */
function readSecret(path: string): string {
  if (!path.startsWith("/run/secrets/"))
    throw Object.assign(new Error(`unexpected secret path ${path}`), { code: "ENOENT" });
  return readFileSync(join(secretsDir, basename(path)), "utf8");
}

function boot(env: Record<string, string>): Env {
  return loadConfig({ ...env }, { readFile: readSecret });
}

const user = (url: string) => new URL(url).username;
const host = (url: string) => `${new URL(url).hostname}:${new URL(url).port}`;

describe("docker-compose.yml (quick start)", () => {
  const vars = {
    JWT_SECRET: "j".repeat(96),
    FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    HASH_KEY: "h".repeat(64),
    POSTGRES_PASSWORD: "pg0123456789abcdef",
    KKT_OWNER_DB_PASSWORD: "owner0123456789abcdef",
    KKT_APP_DB_PASSWORD: "app0123456789abcdef",
  };

  it("api, worker and migrate boot; replicas never migrate, seed or run jobs; only migrate uses the owner role", () => {
    const s = composeServices("docker-compose.yml", vars);
    const api = boot(envOf(s["api"]!));
    const worker = boot(envOf(s["worker"]!));
    const migrate = boot(envOf(s["migrate"]!));
    for (const c of [api, worker]) {
      expect(c.NODE_ENV).toBe("production");
      expect(c.RUN_MIGRATIONS_ON_BOOT).toBe(false);
      expect(c.SEED_ON_BOOT).toBe(false);
      expect(user(c.DATABASE_URL)).toBe("kkt_app");
    }
    expect(api.RUN_JOBS_IN_API).toBe(false);
    expect(api.API_WORKERS).toBe(0); // auto
    expect(user(migrate.DATABASE_URL)).toBe("kkt_owner");
    expect(migrate.SEED_ON_BOOT).toBe(true);
    expect(migrate.SEED_DEMO).toBe(false);
  });

  it("refuses to render without the required secrets", () => {
    expect(() => composeServices("docker-compose.yml", { ...vars, JWT_SECRET: "" })).toThrow(/JWT_SECRET/);
  });
});

describe("docker-compose.prod.yml", () => {
  const vars = {
    DOMAIN: "kkt.example.in",
    BOOTSTRAP_COMPANY_NAME: "Example Builders",
    BOOTSTRAP_ADMIN_EMAIL: "owner@kkt.example.in",
  };

  it("api, worker and migrate boot with the gen-secrets.sh files; API/worker via PgBouncer as kkt_app, migrate direct as kkt_owner", () => {
    const s = composeServices("docker-compose.prod.yml", vars);
    const api = boot(envOf(s["api"]!));
    const worker = boot(envOf(s["worker"]!));
    const migrate = boot(envOf(s["migrate"]!));
    for (const c of [api, worker]) {
      expect(c.RUN_MIGRATIONS_ON_BOOT).toBe(false);
      expect(c.SEED_ON_BOOT).toBe(false);
      expect(c.RUN_JOBS_IN_API).toBe(false);
      expect(user(c.DATABASE_URL)).toBe("kkt_app");
      expect(host(c.DATABASE_URL)).toBe("pgbouncer:6432");
      expect(c.STORAGE_DRIVER).toBe("s3");
      expect(c.METRICS_TOKEN?.length).toBeGreaterThanOrEqual(16);
      // opt-in secrets stay unset unless .env points at them (their generated placeholders are not valid values)
      expect(c.ERROR_WEBHOOK_URL).toBeUndefined();
      expect(c.S3_ACCESS_KEY).toBeUndefined();
    }
    expect(api.API_WORKERS).toBe(0);
    expect(user(migrate.DATABASE_URL)).toBe("kkt_owner");
    expect(host(migrate.DATABASE_URL)).toBe("postgres:5432"); // the migration lock is a session advisory lock: never via PgBouncer
    expect(migrate.BOOTSTRAP_ADMIN_EMAIL).toBe("owner@kkt.example.in");
    expect(migrate.BOOTSTRAP_ADMIN_PASSWORD?.length).toBeGreaterThanOrEqual(12);
  });

  it("stops at render time when BOOTSTRAP_ADMIN_EMAIL is missing (the password file is always mounted, so migrate could never boot)", () => {
    expect(() => composeServices("docker-compose.prod.yml", { ...vars, BOOTSTRAP_ADMIN_EMAIL: "" })).toThrow(
      /BOOTSTRAP_ADMIN_EMAIL/,
    );
  });

  it("generated secret files are readable by the non-root containers that bind-mount them; the directory is private", () => {
    expect(statSync(secretsDir).mode & 0o777).toBe(0o700);
    for (const f of readdirSync(secretsDir)) expect(statSync(join(secretsDir, f)).mode & 0o004, f).toBe(0o004);
  });

  it("every secret the stack mounts is produced by gen-secrets.sh", () => {
    const doc = YAML.parse(interpolate(readFileSync(join(ROOT, "docker-compose.prod.yml"), "utf8"), vars), {
      merge: true,
    }) as { secrets: Record<string, { file: string }> };
    for (const [name, def] of Object.entries(doc.secrets))
      expect(() => readFileSync(join(secretsDir, basename(def.file))), name).not.toThrow();
  });
});

describe("infra/k8s (Secret created from the gen-secrets.sh files, as docs/DEPLOY.md describes)", () => {
  type Container = { name: string; env?: { name: string; value?: string; valueFrom?: unknown }[]; envFrom?: unknown[] };
  type Workload = {
    kind: string;
    metadata: { name: string };
    spec: { template?: { spec: { containers: Container[] } }; data?: never };
  };

  function workloads(): { config: Record<string, string>; containers: Record<string, Container> } {
    const docs: Workload[] = [];
    for (const f of ["configmap.yaml", "api.yaml", "worker.yaml", "migrate-job.yaml"]) {
      for (const d of YAML.parseAllDocuments(readFileSync(join(ROOT, "infra", "k8s", f), "utf8")))
        docs.push(d.toJSON() as Workload);
    }
    const cm = docs.find((d) => d.kind === "ConfigMap") as unknown as { data: Record<string, string> };
    const containers: Record<string, Container> = {};
    for (const d of docs)
      if (d.kind === "Deployment" || d.kind === "Job")
        containers[d.metadata.name] = d.spec.template!.spec.containers[0]!;
    return { config: cm.data, containers };
  }

  function k8sEnv(config: Record<string, string>, c: Container): Record<string, string> {
    const env: Record<string, string> = { ...config };
    for (const e of c.env ?? []) env[e.name] = e.value ?? (e.name === "API_WORKERS" ? "2" : "");
    return env;
  }

  it("api, worker and the migrate Job boot", () => {
    const { config, containers } = workloads();
    const api = boot(k8sEnv(config, containers["api"]!));
    const worker = boot(k8sEnv(config, containers["worker"]!));
    const migrate = boot(k8sEnv(config, containers["migrate"]!));
    for (const c of [api, worker]) {
      expect(c.RUN_MIGRATIONS_ON_BOOT).toBe(false);
      expect(c.SEED_ON_BOOT).toBe(false);
      expect(user(c.DATABASE_URL)).toBe("kkt_app");
    }
    expect(api.API_WORKERS).toBe(2);
    expect(user(migrate.DATABASE_URL)).toBe("kkt_owner");
    expect(migrate.SEED_ON_BOOT).toBe(true);
  });
});
