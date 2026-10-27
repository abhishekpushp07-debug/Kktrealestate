// Tests of the CI gate scripts: node --test scripts/ci/*.test.mjs   (run by the "Supply chain" job of .github/workflows/ci.yml)
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { evaluate } from "./audit-gate.mjs";
import { checkRef, usesOf } from "./check-action-pins.mjs";
import { gate, parseReport } from "./load-gate.mjs";
import { lintMigrations, migrationFiles, splitStatements } from "./lint-migrations.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lint = (text, path = "packages/db/drizzle/0099_new.sql", prior = []) =>
  lintMigrations([...prior, { path, text }], [path]).map((p) => p.rule);

// ---- lint-migrations -------------------------------------------------------------------------------------------------------------

test("splitStatements keeps dollar-quoted bodies, quotes and comments together", () => {
  const s = splitStatements(
    "-- c;\nCREATE TABLE a (x text DEFAULT ';');--> statement-breakpoint\nDO $$ BEGIN PERFORM 1; END $$;\n/* x; */ SELECT 1",
  );
  assert.deepEqual(
    s.map((x) => [x.sql, x.line]),
    [
      ["CREATE TABLE a (x text DEFAULT ';')", 2],
      ["DO $$ BEGIN PERFORM 1; END $$", 3],
      ["SELECT 1", 4],
    ],
  );
});

test("CREATE INDEX on an existing table is rejected outside src/sql/online, allowed on a table the file creates", () => {
  assert.deepEqual(lint('CREATE INDEX "x_idx" ON "bookings" ("a");'), ["index-not-concurrent"]);
  assert.deepEqual(lint("CREATE INDEX CONCURRENTLY IF NOT EXISTS x ON bookings (a);"), ["index-not-concurrent"]);
  assert.deepEqual(
    lint('CREATE TABLE "t" ("a" int);--> statement-breakpoint\nCREATE INDEX "t_a" ON "t" USING btree ("a");'),
    [],
  );
  const online = "packages/db/src/sql/online/0099_x.sql";
  assert.deepEqual(lint('CREATE INDEX CONCURRENTLY IF NOT EXISTS "x" ON "bookings" ("a");', online), []);
  assert.deepEqual(lint('CREATE UNIQUE INDEX "x" ON "bookings" ("a");', online), ["index-not-concurrent"]);
});

test("CHECK / FOREIGN KEY constraints on existing tables need NOT VALID; UNIQUE needs USING INDEX", () => {
  assert.deepEqual(lint('ALTER TABLE "demands" ADD CONSTRAINT "c" CHECK ("demands"."a" >= 0);'), [
    "constraint-not-valid",
  ]);
  assert.deepEqual(lint('ALTER TABLE "demands" ADD CONSTRAINT "c" CHECK ("demands"."a" >= 0) NOT VALID;'), []);
  assert.deepEqual(
    lint(
      'ALTER TABLE "p" ADD CONSTRAINT "p_b_fk" FOREIGN KEY ("b") REFERENCES "public"."b"("id") ON DELETE no action ON UPDATE no action;',
    ),
    ["constraint-not-valid"],
  );
  assert.deepEqual(lint("ALTER TABLE p ADD CONSTRAINT p_b_fk FOREIGN KEY (b) REFERENCES b(id) NOT VALID;"), []);
  assert.deepEqual(lint('ALTER TABLE "p" ADD COLUMN "b" uuid REFERENCES "b"("id");'), ["constraint-not-valid"]);
  assert.deepEqual(lint('ALTER TABLE "p" ADD COLUMN "b" uuid;'), []);
  assert.deepEqual(lint('ALTER TABLE "p" ADD CONSTRAINT "u" UNIQUE ("a");'), ["unique-without-index"]);
  assert.deepEqual(lint('ALTER TABLE "p" ADD CONSTRAINT "u" UNIQUE USING INDEX "p_a_uq";'), []);
  // a table created in the same file may get validated constraints straight away
  assert.deepEqual(lint('CREATE TABLE "n" ("a" int);\nALTER TABLE "n" ADD CONSTRAINT "c" CHECK ("a" > 0);'), []);
});

test("unnamed constraints (ADD CHECK / FOREIGN KEY / UNIQUE / PRIMARY KEY) follow the same rules as named ones", () => {
  assert.deepEqual(lint("ALTER TABLE demands ADD CHECK (a >= 0);"), ["constraint-not-valid"]);
  assert.deepEqual(lint("ALTER TABLE demands ADD CHECK (a >= 0) NOT VALID;"), []);
  assert.deepEqual(lint("ALTER TABLE p ADD FOREIGN KEY (b) REFERENCES b(id);"), ["constraint-not-valid"]);
  // NOT VALID is honoured (it used to be taken for `ADD COLUMN … REFERENCES` and always flagged)
  assert.deepEqual(lint("ALTER TABLE p ADD FOREIGN KEY (b) REFERENCES b(id) NOT VALID;"), []);
  assert.deepEqual(lint("ALTER TABLE p ADD UNIQUE (a);"), ["unique-without-index"]);
  assert.deepEqual(lint("ALTER TABLE p ADD PRIMARY KEY (a);"), ["unique-without-index"]);
  assert.deepEqual(lint("ALTER TABLE p ADD UNIQUE USING INDEX p_a_uq;"), []);
});

test("statements inside DO blocks (idempotent constraint adds) are linted like top-level ones", () => {
  const wrap = (body) => `DO $$ BEGIN\n  ${body}\nEXCEPTION WHEN duplicate_object THEN null;\nEND $$;`;
  assert.deepEqual(lint(wrap('ALTER TABLE "p" ADD CONSTRAINT "f" FOREIGN KEY ("b") REFERENCES "b"("id");')), [
    "constraint-not-valid",
  ]);
  assert.deepEqual(
    lint(wrap('ALTER TABLE "p" ADD CONSTRAINT "f" FOREIGN KEY ("b") REFERENCES "b"("id") NOT VALID;')),
    [],
  );
  assert.deepEqual(lint("DO $do$ BEGIN CREATE INDEX x ON bookings (a); END $do$;"), ["index-not-concurrent"]);
  assert.deepEqual(
    lint(
      "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'c') THEN ALTER TABLE t ADD CONSTRAINT c CHECK (a > 0); END IF; END $$;",
    ),
    ["constraint-not-valid"],
  );
  assert.deepEqual(lint("DO $$ BEGIN RAISE NOTICE 'hello; world'; END $$;"), []);
  // an allow comment before the DO covers its body
  assert.deepEqual(
    lint(
      "-- lint-migrations: allow constraint-not-valid — companies holds one row per tenant\nDO $$ BEGIN ALTER TABLE companies ADD CHECK (a > 0); END $$;",
    ),
    [],
  );
});

test("ALTER COLUMN TYPE on an existing table is rejected", () => {
  assert.deepEqual(lint('ALTER TABLE "flats" ALTER COLUMN "area" SET DATA TYPE numeric(14, 4);'), [
    "alter-column-type",
  ]);
  assert.deepEqual(lint("ALTER TABLE flats ALTER area TYPE bigint USING area::bigint;"), ["alter-column-type"]);
  assert.deepEqual(lint('ALTER TABLE "flats" ALTER COLUMN "area" SET DEFAULT 0;'), []);
});

test("SET NOT NULL needs a prior validated CHECK (col IS NOT NULL), possibly from an earlier file", () => {
  assert.deepEqual(lint('ALTER TABLE "users" ALTER COLUMN "phone" SET NOT NULL;'), ["set-not-null"]);
  // NOT VALID check without VALIDATE is not enough
  assert.deepEqual(
    lint(
      "ALTER TABLE users ADD CONSTRAINT users_phone_nn CHECK (phone IS NOT NULL) NOT VALID;\nALTER TABLE users ALTER COLUMN phone SET NOT NULL;",
    ),
    ["set-not-null"],
  );
  const prior = [
    {
      path: "packages/db/drizzle/0098_check.sql",
      text: 'ALTER TABLE "users" ADD CONSTRAINT "users_phone_nn" CHECK ("phone" IS NOT NULL) NOT VALID;',
    },
    {
      path: "packages/db/src/sql/online/0098_validate.sql",
      text: 'ALTER TABLE "users" VALIDATE CONSTRAINT "users_phone_nn";',
    },
  ];
  assert.deepEqual(
    lint('ALTER TABLE "users" ALTER COLUMN "phone" SET NOT NULL;', "packages/db/drizzle/0099_nn.sql", prior),
    [],
  );
  // other column: still rejected
  assert.deepEqual(
    lint('ALTER TABLE "users" ALTER COLUMN "email" SET NOT NULL;', "packages/db/drizzle/0099_nn.sql", prior),
    ["set-not-null"],
  );
});

test("an inline allow comment exempts one statement; exemptions only for their file/rule/table", () => {
  assert.deepEqual(
    lint("-- lint-migrations: allow alter-column-type — tiny lookup table\nALTER TABLE t ALTER COLUMN a TYPE text;"),
    [],
  );
  const p = "packages/db/drizzle/0099_new.sql";
  const text =
    'ALTER TABLE "companies" ALTER COLUMN "slug" SET NOT NULL;\nALTER TABLE "users" ALTER COLUMN "x" SET NOT NULL;';
  const ex = [{ file: p, rule: "set-not-null", table: "companies", reason: "one row per tenant" }];
  assert.deepEqual(
    lintMigrations([{ path: p, text }], [p], ex).map((x) => `${x.rule}@${x.line}`),
    ["set-not-null@2"],
  );
});

test("the current tree: the newest migrations pass, and the linter does find the blocking DDL of 0002 (audit v3 B9)", () => {
  const files = migrationFiles(ROOT).map((p) => ({ path: p, text: readFileSync(join(ROOT, p), "utf8") }));
  const all = lintMigrations(files);
  assert.ok(all.some((x) => x.path.endsWith("0002_foundation_hardening.sql") && x.rule === "index-not-concurrent"));
  assert.ok(all.some((x) => x.path.endsWith("0002_foundation_hardening.sql") && x.rule === "constraint-not-valid"));
  const out = execFileSync(
    process.execPath,
    [
      join(ROOT, "scripts/ci/lint-migrations.mjs"),
      "packages/db/drizzle/0005_online_foundation.sql",
      "packages/db/src/sql/online/0005_indexes.sql",
    ],
    { cwd: ROOT, encoding: "utf8" },
  );
  assert.match(out, /2 file\(s\) checked, 0 problem\(s\)/);
});

// ---- audit gate ----------------------------------------------------------------------------------------------------------------------

const report = (sev, ghsa = "GHSA-aaaa-bbbb-cccc", module = "lib", paths = ["apps__api>lib"]) => ({
  advisories: {
    1: {
      id: 1,
      module_name: module,
      severity: sev,
      github_advisory_id: ghsa,
      title: "t",
      url: "u",
      findings: [{ paths }],
    },
  },
});
const entry = {
  id: "GHSA-aaaa-bbbb-cccc",
  module: "lib",
  reason: "reachable only from build tooling, never shipped",
  expires: "2027-01-31",
};

test("audit gate: high/critical fail, moderate passes, allowlisted passes until it expires", () => {
  assert.equal(evaluate(report("high"), { entries: [] }, "2026-10-27").failures.length, 1);
  assert.equal(evaluate(report("critical"), { entries: [] }, "2026-10-27").failures.length, 1);
  assert.equal(evaluate(report("moderate"), { entries: [] }, "2026-10-27").failures.length, 0);
  assert.deepEqual(evaluate(report("high"), { entries: [entry] }, "2026-10-27").failures, []);
  assert.match(evaluate(report("high"), { entries: [entry] }, "2027-02-01").failures[0], /expired on 2027-01-31/);
  // an entry scoped to paths does not cover the same advisory reached another way
  const scoped = { ...entry, paths: ["apps__portal>expo>lib"] };
  assert.equal(evaluate(report("high"), { entries: [scoped] }, "2026-10-27").failures.length, 1);
  // entries need a reason; unused entries are warned about
  assert.match(evaluate(report("low"), { entries: [{ ...entry, reason: "" }] }, "2026-10-27").failures[0], /reason/);
  assert.match(evaluate(report("low"), { entries: [entry] }, "2026-10-27").warnings[0], /matches no advisory/);
});

test("audit gate: npm v7 report format", () => {
  const v7 = {
    vulnerabilities: {
      lib: {
        severity: "high",
        nodes: ["node_modules/lib"],
        via: [
          {
            source: 9,
            name: "lib",
            severity: "high",
            title: "t",
            url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
          },
        ],
      },
    },
  };
  assert.equal(evaluate(v7, { entries: [] }, "2026-10-27").failures.length, 1);
  assert.equal(evaluate(v7, { entries: [entry] }, "2026-10-27").failures.length, 0);
});

test("the shipped allowlist entries are complete and unexpired", () => {
  const al = JSON.parse(readFileSync(join(ROOT, "scripts/ci/audit-allowlist.json"), "utf8"));
  const today = new Date().toISOString().slice(0, 10);
  const r = evaluate({ advisories: {} }, al, today);
  assert.deepEqual(r.failures, []);
  assert.ok(
    al.entries.every((e) => e.module === "node-forge"),
    "node-forge via @expo/cli is the only accepted advisory",
  );
});

// ---- action pins ---------------------------------------------------------------------------------------------------------------------

test("action pins: SHA + version comment required; local and pending actions pass", () => {
  const sha = "9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0";
  assert.deepEqual(checkRef(`actions/checkout@${sha}`, "v7.0.0"), []);
  assert.match(checkRef(`actions/checkout@${sha}`, "")[0], /comment/);
  assert.match(checkRef("actions/checkout@v4", "")[0], /full commit SHA/);
  assert.deepEqual(checkRef("./.github/actions/setup", ""), []);
  const pending = [{ action: "github/codeql-action/init", reason: "r", expires: "2026-12-31" }];
  assert.deepEqual(checkRef("github/codeql-action/init@v3", "", pending, "2026-10-27"), []);
  assert.match(checkRef("github/codeql-action/init@v3", "", pending, "2027-01-01")[0], /expired/);
  assert.match(checkRef("docker://alpine:3.20", "")[0], /sha256/);
  assert.deepEqual(
    usesOf(
      `steps:\n  - uses: actions/checkout@${sha} # v7.0.0\n  - name: x\n    uses: "./.github/actions/setup"\n`,
    ).map((u) => [u.line, u.ref, u.comment]),
    [
      [2, `actions/checkout@${sha}`, "v7.0.0"],
      [4, "./.github/actions/setup", ""],
    ],
  );
});

test("every workflow in .github passes the pin gate", () => {
  const out = execFileSync(process.execPath, [join(ROOT, "scripts/ci/check-action-pins.mjs")], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.match(out, /0 problem\(s\)/);
});

// ---- load gate -----------------------------------------------------------------------------------------------------------------------

test("load gate: p95 per route, failure ratio and scenario count; only the last run of the report counts", () => {
  const md = [
    "### Run 1",
    "| Scenario | Conns | Requests | non-2xx | p50 ms | p95 ms | p97.5 ms | p99 ms | req/s |",
    "| GET /projects | 50 | 100 | 0 | 900 | 999 | 999 | 999 | 10 |",
    "",
    "### Run 2",
    "| Scenario | Conns | Requests | non-2xx | p50 ms | p95 ms | p97.5 ms | p99 ms | req/s |",
    "| GET /projects | 50 | 1000 | 0 | 40 | 120.5 | 150 | 200 | 100 |",
    "| GET /public/projects (no auth, cached) | 50 | 1000 | 5 | 10 | 150 | 160 | 170 | 100 |",
    "| POST /payments (₹100, 10 conns) | 10 | 100 | 2 (409 x2) | 100 | 300 | 310 | 320 | 10 |",
  ].join("\n");
  const rows = parseReport(md);
  assert.deepEqual(
    rows.map((r) => [r.name, r.p95, r.non2xx]),
    [
      ["GET /projects", 120.5, 0],
      ["GET /public/projects (no auth, cached)", 150, 5],
      ["POST /payments (₹100, 10 conns)", 300, 2],
    ],
  );
  const t = JSON.parse(readFileSync(join(ROOT, "scripts/ci/load-thresholds.json"), "utf8"));
  const { failures } = gate(rows, { ...t, min_scenarios: 3 });
  assert.deepEqual(failures, [
    "GET /public/projects (no auth, cached): p95 150 ms above 100 ms",
    "POST /payments (₹100, 10 conns): 2.00% non-2xx (limit 1%)",
  ]);
  assert.match(gate(rows, t).failures[0], /only 3 scenario\(s\) ran/);
});

// ---- deploy workflow (static checks of what cannot run outside a cluster) ----------------------------------------------------------

test("deploy workflow: never applies the Namespace (namespaced service account) and smoke-checks only pods of the new version", async () => {
  const { parse } = await import("yaml");
  const wf = parse(readFileSync(join(ROOT, ".github", "workflows", "deploy.yml"), "utf8"));
  const ns = parse(readFileSync(join(ROOT, "infra", "k8s", "namespace.yaml"), "utf8"));
  assert.equal(ns.metadata.labels["app.kubernetes.io/component"], "namespace");
  assert.equal(wf.env.NOT_NAMESPACE, "app.kubernetes.io/component!=namespace");
  const steps = wf.jobs.deploy.steps;
  const applies = steps
    .flatMap((s) => (s.run ?? "").split("\n"))
    .filter((l) => /kubectl apply\b.*rendered\.yaml/.test(l));
  assert.ok(applies.length >= 4, "dry run, shared objects, migrate Job, everything");
  for (const l of applies)
    assert.ok(
      /-l "\$NOT_NAMESPACE"|component=migrate|notin \([^)]*\bnamespace\b/.test(l),
      `apply without the namespace exclusion: ${l}`,
    );
  const smoke = steps.find((s) => s.id === "smoke").run;
  assert.match(smoke, /deletionTimestamp/, "terminating (draining) pods are skipped");
  assert.match(smoke, /no running worker pod/, "no worker at all fails instead of passing vacuously");
  assert.doesNotMatch(smoke, /exec deploy\//);
});
