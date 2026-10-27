/**
 * First-boot preparation of the database, run by the migrate job (`node dist/server.js migrate`), the cluster primary and the single
 * process before they serve (docs/DEPLOY.md "First boot"):
 *
 *   1. Whenever the database has NO company, `ensureBootstrap` runs — independent of SEED_ON_BOOT. In production that is the company
 *      and one Super Admin from BOOTSTRAP_COMPANY_NAME / BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD, and the boot is REFUSED
 *      (BootstrapRefused, nothing written) when they are missing or weak. A deployment can therefore never come up with an empty,
 *      un-loginable database, nor with the demo logins by accident.
 *   2. With SEED_ON_BOOT the bootstrap also runs when a company exists (idempotent: keeps the system roles' permission bundles in sync).
 *   3. The demo dataset (Shree Ganesh Builders: projects, customers, bookings, ledgers) is created ONLY when SEED_ON_BOOT and SEED_DEMO are
 *      both true. Outside production the bootstrap itself uses the demo company and logins (development convenience); in production
 *      the demo bootstrap is used only together with the demo dataset.
 */
import { sql } from "drizzle-orm";
import type { DB } from "@kkt/db";
import type { Env } from "../config.js";
import { logger } from "../lib/logger.js";
import { ensureBootstrap, type BootstrapMode, type BootstrapResult } from "./bootstrap.js";
import type { SeedResult } from "./run.js";

/** The configuration fields the first boot reads. */
export type FirstBootConfig = Pick<Env, "NODE_ENV" | "SEED_ON_BOOT" | "SEED_DEMO">;

/** What firstBoot did. */
export interface FirstBootResult {
  /** True when the database had no company when the boot started. */
  emptyDatabase: boolean;
  /** Result of ensureBootstrap (null when it was not needed: a company exists and SEED_ON_BOOT is off). */
  bootstrap: BootstrapResult | null;
  /** Result of the demo seed (null unless SEED_ON_BOOT and SEED_DEMO). */
  demo: SeedResult | null;
}

/** Options of firstBoot. */
export interface FirstBootOptions {
  db: DB;
  config: FirstBootConfig;
  /** Runs the demo dataset seed (builds an app when needed); called only when SEED_ON_BOOT and SEED_DEMO. */
  seedDemo: () => Promise<SeedResult>;
  log?: Pick<typeof logger, "info" | "warn">;
}

/** True when the demo dataset is to be created at boot. */
export function wantsDemoDataset(cfg: FirstBootConfig): boolean {
  return cfg.SEED_ON_BOOT && cfg.SEED_DEMO;
}

/** Bootstrap mode of a boot: the demo company/logins outside production, or in production only together with the demo dataset. */
export function firstBootMode(cfg: FirstBootConfig): BootstrapMode {
  return cfg.NODE_ENV !== "production" || wantsDemoDataset(cfg) ? "demo" : "production";
}

/** True when the database has at least one company (one cheap query). */
export async function hasCompany(db: DB): Promise<boolean> {
  const rows = await db.execute<{ present: boolean }>(sql`select exists (select 1 from companies) as present`);
  return Boolean(rows[0]?.present);
}

/** Prepares the database for serving (see the module comment). Throws BootstrapRefused on a fresh production database without BOOTSTRAP_*. */
export async function firstBoot(opts: FirstBootOptions): Promise<FirstBootResult> {
  const log = opts.log ?? logger;
  const cfg = opts.config;
  const emptyDatabase = !(await hasCompany(opts.db));
  let bootstrap: BootstrapResult | null = null;
  if (emptyDatabase || cfg.SEED_ON_BOOT) {
    bootstrap = await ensureBootstrap(opts.db, { mode: firstBootMode(cfg) });
    if (bootstrap.created)
      log.info(
        { companyId: bootstrap.companyId, mode: bootstrap.mode, admin: bootstrap.adminEmail },
        "first boot: company, system roles and first logins created",
      );
  }
  let demo: SeedResult | null = null;
  if (wantsDemoDataset(cfg)) {
    demo = await opts.seedDemo();
    if (!demo.skipped) log.info({ counts: demo.counts, durationMs: demo.durationMs }, "demo seed created");
  }
  return { emptyDatabase, bootstrap, demo };
}
