/**
 * Production-size dataset (docs/SEED.md "Production-size data"):
 *
 *   pnpm --filter @kkt/api seed:scale [--factor 1] [--seed 20261027] [--no-verify]
 *
 * Builds ON TOP of the demo seed (run first when the database has no projects): a second company with its own roles, masters and staff,
 * and at factor 1 — demo data included — 2 companies, 20 projects, ~400 towers, ~41 000 flats, 25 000 customers with portal logins,
 * 60 000 leads, 15 000 bookings with their demands, ~160 000 payments and ledgers, 30 000 service requests, ~200 staff across roles and
 * project scopes, and the audit rows of all of it. Rows are inserted in large JSON batches in one transaction (scaleLoad.ts, scaleGen.ts).
 *
 * Money comes from the production engines, never from hand-computed balances (scaleMoney.ts): flats are generated and priced by domain
 * `generateFlats` / `priceFlat`, plan snapshots by the money module's `buildPlanSnapshot`, demands by domain `evaluateDues`, and the
 * ledger, booking summary and demand statuses by the ledger service's event builders + domain `deriveLedger` / `demandStatuses`. Every
 * document number is allocated per company, scope and financial year in posting order and the `sequences` rows are advanced, so the
 * API continues each series. Afterwards the seed runs ANALYZE and the real integrity report for both companies, and fails on a finding.
 *
 * Deterministic: the same seed, factor and run date give the same dataset (ciphertexts differ only by their random IVs). Idempotent: a
 * database whose scale company already has projects is left alone. Never in production.
 */
import { pathToFileURL } from "node:url";
import type { FastifyInstance } from "fastify";
import postgres, { type Sql } from "postgres";
import { SYSTEM_ROLE_NAMES } from "@kkt/contracts";
import { runMigrations } from "@kkt/db";
import { todayIST } from "@kkt/domain";
import { config } from "../config.js";
import { invalidate } from "../lib/cache.js";
import { logger } from "../lib/logger.js";
import { hashPassword } from "../lib/password.js";
import { runReport } from "../modules/money/index.js";
import { ensureBootstrap } from "./bootstrap.js";
import { seedDemo } from "./run.js";
import { SCALE_COMPANY, ensureScaleCompany, loadCompany, type CompanyCtx } from "./scaleCompany.js";
import { Rng } from "./scaleData.js";
import {
  finish,
  genBookings,
  genProjects,
  genStaff,
  loadBooks,
  loadCustomers,
  loadFlats,
  loadLeads,
  loadProjects,
  loadTickets,
  load,
  type BookingGen,
  type Counter,
  type CustomerGen,
  type GenState,
  type ProjectGen,
} from "./scaleGen.js";

export { SCALE_COMPANY } from "./scaleCompany.js";

/** Password of every staff login the scale seed creates (docs/SEED.md). */
export const SCALE_STAFF_PASSWORD = "Scale@12345";
/** Password of every portal login the scale seed creates (the demo portal password). */
export const SCALE_PORTAL_PASSWORD = "Welcome@123";
/** Default PRNG seed. */
export const SCALE_DEFAULT_SEED = 20_261_027;

/** Totals (demo data included) the seed reaches at factor 1; the CLI fails below them. */
export const SCALE_TARGETS = {
  companies: 2,
  projects: 20,
  blocks: 400,
  flats: 40_000,
  customers: 25_000,
  portal_users: 25_000,
  leads: 60_000,
  bookings: 15_000,
  payments: 150_000,
  service_requests: 30_000,
  staff_users: 200,
} as const;

/** New projects per company (demo company first); with the demo seed's two projects that makes 20. */
const PROJECT_NAMES = {
  demo: [
    "Shree Ganesh Residency",
    "Ganesh Vatika",
    "Shree Ganesh Enclave",
    "Ganesh Kunj",
    "Shree Ganesh Towers",
    "Ganesh Nagar Heights",
    "Shree Ganesh Gardens",
    "Ganesh Vihar",
    "Shree Ganesh Palms",
    "Ganesh Sarovar",
    "Shree Ganesh Meadows",
    "Ganesh Utsav Homes",
  ],
  scale: [
    "Patliputra Greens",
    "Patliputra Grand",
    "Patliputra Riverside",
    "Patliputra Skyline",
    "Patliputra Orchid",
    "Patliputra Signature",
  ],
} as const;
/** Share of the volumes per company (demo company, scale company). */
const SHARES = [0.8, 0.2] as const;

/** Options of seedScale. */
export interface ScaleOptions {
  /** Volume multiplier (1 = production size; tests use ~0.01). */
  factor?: number;
  /** PRNG seed. */
  seed?: number;
  /** Run the integrity report afterwards and fail on findings (default true). */
  verify?: boolean;
  log?: (msg: string) => void;
}

/** Result of seedScale. */
export interface ScaleResult {
  skipped: boolean;
  reason?: string;
  /** Rows this run wrote, by table. */
  written: Record<string, number>;
  /** Totals in the database afterwards (demo data included), keyed like SCALE_TARGETS. */
  totals: Record<string, number>;
  integrity: { company_id: string; ok: boolean; bookings_checked: number; findings: number }[];
  durationMs: number;
}

/** The volumes of a run (new rows; the demo seed's rows come on top). */
export function scaleVolumes(factor: number): {
  blocksPerProject: number;
  staff: number;
  customers: number;
  bookings: number;
  leads: number;
  tickets: number;
} {
  const n = (x: number, min: number) => Math.max(min, Math.round(x * factor));
  const customers = n(25_000, 20);
  return {
    blocksPerProject: n(22, 1),
    staff: n(200, 2 * SYSTEM_ROLE_NAMES.length),
    customers,
    bookings: Math.min(n(15_000, 10), customers),
    leads: n(60_000, 20),
    tickets: n(30_000, 10),
  };
}

/** Totals in the database, keyed like SCALE_TARGETS (plus demands, ledger rows and audit rows). */
export async function scaleTotals(sql: Sql): Promise<Record<string, number>> {
  const [row] = await sql<Record<string, number>[]>`
    select
      (select count(*)::int from companies) as companies,
      (select count(*)::int from projects) as projects,
      (select count(*)::int from blocks) as blocks,
      (select count(*)::int from flats) as flats,
      (select count(*)::int from customers) as customers,
      (select count(*)::int from portal_users) as portal_users,
      (select count(*)::int from leads) as leads,
      (select count(*)::int from bookings) as bookings,
      (select count(*)::int from demands) as demands,
      (select count(*)::int from payments) as payments,
      (select count(*)::int from ledger_entries) as ledger_entries,
      (select count(*)::int from service_requests) as service_requests,
      (select count(*)::int from users) as staff_users,
      (select count(*)::int from audit_logs) as audit_logs`;
  return row ?? {};
}

/** Generates and loads everything inside the caller's transaction. */
async function generate(st: GenState, companies: readonly CompanyCtx[], factor: number): Promise<void> {
  const v = scaleVolumes(factor);
  const [staffHash, portalHash] = await Promise.all([
    hashPassword(SCALE_STAFF_PASSWORD),
    hashPassword(SCALE_PORTAL_PASSWORD),
  ]);
  const counter: Counter = { next: 0 };
  const allBookings: BookingGen[] = [];
  const allCustomers: CustomerGen[] = [];
  const perCompany: { c: CompanyCtx; projects: ProjectGen[]; bookings: BookingGen[]; share: number }[] = [];
  for (const [i, c] of companies.entries()) {
    const share = SHARES[i] ?? 0;
    const names = c.isDemo ? PROJECT_NAMES.demo : PROJECT_NAMES.scale;
    const projects = genProjects(st, c, names, c.isDemo ? "SGB" : "PID", v.blocksPerProject);
    const projectIds = projects.map((p) => p.id);
    const scopes = await genStaff(
      st,
      c,
      Math.max(SYSTEM_ROLE_NAMES.length, Math.round(v.staff * share)),
      projectIds,
      staffHash,
    );
    await loadProjects(st, c, projects);
    await load(st, "user_project_scopes", scopes);
    const nBookings = Math.round(v.bookings * share);
    const prospects = Math.max(0, Math.round(v.customers * share) - nBookings);
    const { bookings, customers } = genBookings(st, c, projects, nBookings, prospects, counter);
    await loadFlats(st, c, projects);
    const towers = projects.reduce((n, p) => n + p.blocks.length, 0);
    st.log(
      `scale seed: ${c.isDemo ? "demo company" : SCALE_COMPANY.name}: ${projects.length} projects, ${towers} towers, ${bookings.length} bookings, ${customers.length} customers`,
    );
    allBookings.push(...bookings);
    allCustomers.push(...customers);
    perCompany.push({ c, projects, bookings, share });
  }
  await loadCustomers(st, allCustomers, portalHash);
  for (const x of perCompany) await loadLeads(st, x.c, x.projects, x.bookings, Math.round(v.leads * x.share));
  await loadBooks(st, allBookings);
  for (const x of perCompany) await loadTickets(st, x.c, x.bookings, Math.round(v.tickets * x.share));
  await finish(st, companies);
}

/**
 * Seeds the production-size dataset on top of the demo seed (run first on an empty database). Refused in production; skipped when the
 * scale company already has projects.
 */
export async function seedScale(app: FastifyInstance, opts: ScaleOptions = {}): Promise<ScaleResult> {
  const started = Date.now();
  const log = opts.log ?? ((msg: string) => logger.info({ seed: "scale" }, msg));
  const factor = opts.factor ?? 1;
  if (!(factor > 0 && factor <= 4)) throw new Error("scale seed: factor must be in (0, 4]");
  if (config.NODE_ENV === "production") throw new Error("scale seed: refused when NODE_ENV=production");
  const result: ScaleResult = { skipped: false, written: {}, totals: {}, integrity: [], durationMs: 0 };
  const [projects] = await app.sql<{ n: number }[]>`select count(*)::int as n from projects`;
  if ((projects?.n ?? 0) === 0) {
    log("scale seed: empty database — running the demo seed first");
    const demo = await seedDemo(app, { log });
    if (demo.refused) throw new Error("scale seed: the demo seed was refused");
  }
  const sql = postgres(config.DATABASE_URL, { max: 1, onnotice: () => undefined });
  try {
    const [done] = await sql<{ n: number }[]>`
      select count(*)::int as n from projects p join companies c on c.id = p.company_id where c.slug = ${SCALE_COMPANY.slug}`;
    if ((done?.n ?? 0) > 0) {
      log("scale seed: skipped — the scale company already has projects");
      return { ...result, skipped: true, reason: "already seeded", durationMs: Date.now() - started };
    }
    const boot = await ensureBootstrap(app.db, { mode: "demo" });
    const rng = new Rng(opts.seed ?? SCALE_DEFAULT_SEED);
    const scaleCompanyId = await ensureScaleCompany(sql, rng.fork("company"), boot.companyId);
    const companies = [await loadCompany(app, boot.companyId, true), await loadCompany(app, scaleCompanyId, false)];
    // back-dated audit rows only while no seal covers them yet (audit/seal.ts: a back-dated row under a seal reads as tampering)
    const [seals] = await sql<{ n: number }[]>`select count(*)::int as n from audit_seals`;
    await sql.begin(async (tx) => {
      const st: GenState = {
        tx: tx as unknown as Sql,
        rng,
        today: todayIST(),
        now: new Date(),
        written: result.written,
        audit: [],
        historicalAudit: (seals?.n ?? 0) === 0,
        log,
      };
      await generate(st, companies, factor);
      const written = Object.entries(result.written).map(([k, n]) => `${k}=${n}`);
      log(`scale seed: written ${written.join(", ")}`);
    });
    log("scale seed: committed; ANALYZE");
    await sql.unsafe("analyze");
    for (const prefix of ["pub:", "dash:", "company:", "perm:"]) await invalidate(app.redis, prefix);
    if (opts.verify !== false)
      for (const c of companies) {
        const { report } = await runReport(app.db, { companyId: c.id }, { triggeredBy: null });
        result.integrity.push({
          company_id: c.id,
          ok: report.ok,
          bookings_checked: report.bookings_checked,
          findings: report.findings.length,
        });
        const who = c.isDemo ? "demo company" : SCALE_COMPANY.name;
        log(`scale seed: integrity ${who}: ${report.bookings_checked} bookings, ${report.findings.length} findings`);
        if (!report.ok)
          throw new Error(
            `scale seed: the integrity report found ${report.findings.length} finding(s) ${JSON.stringify(report.counts)}; first: ${report.findings[0]?.detail ?? ""}`,
          );
      }
    result.totals = await scaleTotals(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
  result.durationMs = Date.now() - started;
  log(`scale seed complete in ${Math.round(result.durationMs / 1000)} s`);
  return result;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** CLI: migrate (idempotent), demo seed when the database is empty, scale seed; fails below SCALE_TARGETS at factor ≥ 1. */
async function main(): Promise<void> {
  const factor = Number(arg("factor") ?? process.env["SCALE_FACTOR"] ?? 1);
  const seed = Number(arg("seed") ?? process.env["SCALE_SEED"] ?? SCALE_DEFAULT_SEED);
  await runMigrations(config.DATABASE_URL);
  const { buildApp } = await import("../app.js");
  const app = await buildApp({ logger: false });
  await app.ready();
  try {
    const r = await seedScale(app, { factor, seed, verify: !process.argv.includes("--no-verify") });
    if (r.skipped) return;
    const summary = { seconds: Math.round(r.durationMs / 1000), totals: r.totals, integrity: r.integrity };
    console.log(JSON.stringify(summary, null, 2));
    if (factor >= 1) {
      const short = Object.entries(SCALE_TARGETS).filter(([k, min]) => (r.totals[k] ?? 0) < min);
      if (short.length > 0)
        throw new Error(
          `scale seed below target: ${short.map(([k, min]) => `${k} ${r.totals[k] ?? 0} < ${min}`).join(", ")}`,
        );
    }
  } finally {
    await app.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    logger.fatal({ err }, "scale seed failed");
    process.exit(1);
  });
}
