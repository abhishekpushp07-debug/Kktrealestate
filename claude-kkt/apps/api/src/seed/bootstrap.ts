import { and, asc, eq, sql } from "drizzle-orm";
import { SYSTEM_ROLES, SYSTEM_ROLE_NAMES, type SystemRoleName } from "@kkt/contracts";
import { companies, roles, users, type DB, type Executor } from "@kkt/db";
import { config } from "../config.js";
import { hashPassword, passwordPolicyProblems } from "../lib/password.js";

/** Staff logins created by the DEMO bootstrap (docs/SEED.md). Never created in production unless SEED_DEMO=true. */
export const BOOTSTRAP_USERS: readonly {
  role: SystemRoleName;
  name: string;
  email: string;
  password: string;
  allProjects: boolean;
}[] = [
  { role: "Super Admin", name: "Suresh Agarwal", email: "admin@sgb.in", password: "Admin@12345", allProjects: true },
  {
    role: "Project Admin",
    name: "Rohit Kumar",
    email: "projects@sgb.in",
    password: "Project@12345",
    allProjects: false,
  },
  { role: "Accounts", name: "Meena Sharma", email: "accounts@sgb.in", password: "Accounts@12345", allProjects: true },
  { role: "Sales", name: "Ankit Verma", email: "sales@sgb.in", password: "Sales@12345", allProjects: true },
  { role: "Marketing", name: "Nisha Singh", email: "marketing@sgb.in", password: "Marketing@12345", allProjects: true },
  { role: "Employee", name: "Deepak Prasad", email: "employee@sgb.in", password: "Employee@12345", allProjects: true },
];

/** Transaction-scoped advisory lock key serialising bootstrap across replicas (one company, one set of roles, one admin). */
export const BOOTSTRAP_LOCK_KEY = "kkt:bootstrap";

/** Result of ensureBootstrap. */
export interface BootstrapResult {
  companyId: string;
  created: boolean;
  roleIds: Record<SystemRoleName, string>;
  mode: BootstrapMode;
  /** E-mail of the first Super Admin created by a production bootstrap (null otherwise). */
  adminEmail: string | null;
}

/**
 * `demo`: the demo builder (Shree Ganesh Builders) with one login per role and published passwords (development, tests, and production
 * only with SEED_DEMO=true). `production`: the company named by BOOTSTRAP_COMPANY_NAME, the six system roles and ONE Super Admin from
 * BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD (policy-checked, must change the password at first sign-in); no demo user ever.
 */
export type BootstrapMode = "demo" | "production";

/** The mode the current configuration asks for: production without SEED_DEMO → `production`, everything else → `demo`. */
export function bootstrapMode(): BootstrapMode {
  return config.NODE_ENV === "production" && !config.SEED_DEMO ? "production" : "demo";
}

/** Thrown when a production database cannot be bootstrapped safely (missing or weak BOOTSTRAP_* settings). */
export class BootstrapRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BootstrapRefused";
  }
}

const DEMO_COMPANY = {
  name: "Shree Ganesh Builders",
  legalName: "Shree Ganesh Builders Private Limited",
  gstin: "10AABCS1234A1Z5",
  phone: "6122200000",
  email: "info@sgb.in",
  address: {
    line1: "SGB House, Boring Road",
    locality: "Sri Krishna Puri",
    city: "Patna",
    state: "Bihar",
    pincode: "800001",
  },
  letterhead: {
    tagline: "Building homes, building trust",
    phone: "+91 612 2200000",
    email: "info@sgb.in",
    website: "https://www.sgb.in",
    signatory_name: "Suresh Agarwal",
    signatory_title: "Managing Director",
  },
} as const;

/**
 * Company settings of a production first boot. `force_mfa_for_admins` is ON (audit D): every role that can manage settings, users,
 * roles or admin tools must enrol TOTP before using the ERP; the Super Admin enrols right after the first sign-in.
 */
const DEFAULT_SETTINGS = {
  demand_due_days: 15,
  default_gst_percent: 5,
  round_robin_enabled: true,
  force_mfa_for_admins: true,
  sla_hours: { LOW: 72, MEDIUM: 48, HIGH: 24, URGENT: 8 },
  booking_hold_hours: 48,
};

/**
 * The demo company (development, tests, SEED_DEMO) explicitly turns forced admin MFA OFF: its published demo logins (docs/SEED.md) must
 * work without an authenticator app. Never used for a production first boot.
 */
const DEMO_SETTINGS = { ...DEFAULT_SETTINGS, force_mfa_for_admins: false };
const DEFAULT_NUMBERING = {
  customer: { prefix: "CUST-" },
  booking: { prefix: "BK-" },
  demand: { prefix: "DM-" },
  receipt: { prefix: "RCPT/" },
  ticket: { prefix: "SR-" },
  visit: { prefix: "SV-" },
};

/** Validates the production first-boot settings; throws BootstrapRefused naming every problem (never the password itself). */
function productionAdmin(): { companyName: string; email: string; password: string } {
  const problems: string[] = [];
  const companyName = config.BOOTSTRAP_COMPANY_NAME?.trim();
  const email = config.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = config.BOOTSTRAP_ADMIN_PASSWORD;
  if (!companyName) problems.push("BOOTSTRAP_COMPANY_NAME is not set");
  if (!email) problems.push("BOOTSTRAP_ADMIN_EMAIL is not set");
  if (!password) problems.push("BOOTSTRAP_ADMIN_PASSWORD is not set");
  else {
    const weak = passwordPolicyProblems(password);
    if (weak.length > 0) problems.push(`BOOTSTRAP_ADMIN_PASSWORD must have ${weak.join(", ")}`);
  }
  if (problems.length > 0 || !companyName || !email || !password) {
    throw new BootstrapRefused(
      `Refusing to start on a fresh production database: ${problems.join("; ")}. Set them for the first boot (the admin must change the password at first sign-in), or run with SEED_DEMO=true for a demo.`,
    );
  }
  return { companyName, email, password };
}

async function ensureRoles(tx: Executor, companyId: string): Promise<Record<SystemRoleName, string>> {
  const roleIds = {} as Record<SystemRoleName, string>;
  for (const name of SYSTEM_ROLE_NAMES) {
    const def = SYSTEM_ROLES[name];
    const [existing] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.companyId, companyId), eq(roles.name, name)))
      .limit(1);
    if (existing) {
      roleIds[name] = existing.id;
      // Keep system-role permission bundles in sync with the contracts registry.
      await tx
        .update(roles)
        .set({ permissions: [...def.permissions], description: def.description, isSystem: true })
        .where(eq(roles.id, existing.id));
      continue;
    }
    const [r] = await tx
      .insert(roles)
      .values({ companyId, name, description: def.description, permissions: [...def.permissions], isSystem: true })
      .returning({ id: roles.id });
    roleIds[name] = r!.id;
  }
  return roleIds;
}

/**
 * Idempotently creates the company, the six system roles and the first logins (see BootstrapMode). Safe to run at every boot and from
 * several replicas at once: a transaction-scoped advisory lock serialises the check-then-insert, so exactly one company exists (the
 * oldest one is always reused) and passwords of existing users are never reset. On a fresh production database without valid
 * BOOTSTRAP_* settings it throws BootstrapRefused before writing anything.
 */
export async function ensureBootstrap(db: DB, opts: { mode?: BootstrapMode } = {}): Promise<BootstrapResult> {
  const mode = opts.mode ?? bootstrapMode();
  const prodAdmin =
    mode === "production"
      ? await (async () => {
          // Validate first so a misconfigured replica fails fast; the hash is computed outside the lock.
          const [any] = await db.select({ id: companies.id }).from(companies).limit(1);
          if (any) return null;
          const a = productionAdmin();
          return { ...a, hash: await hashPassword(a.password) };
        })()
      : null;
  const demoHashes = mode === "demo" ? new Map<string, Promise<string>>() : null;

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${BOOTSTRAP_LOCK_KEY}))`);
    let created = false;
    let adminEmail: string | null = null;
    let [company] = await tx.select().from(companies).orderBy(asc(companies.createdAt), asc(companies.id)).limit(1);
    if (!company) {
      created = true;
      if (mode === "production") {
        const a = prodAdmin ?? { ...productionAdmin(), hash: await hashPassword(productionAdmin().password) };
        [company] = await tx
          .insert(companies)
          .values({ name: a.companyName, fyStartMonth: 4, numbering: DEFAULT_NUMBERING, settings: DEFAULT_SETTINGS })
          .returning();
      } else {
        [company] = await tx
          .insert(companies)
          .values({
            ...DEMO_COMPANY,
            address: { ...DEMO_COMPANY.address },
            letterhead: { ...DEMO_COMPANY.letterhead },
            fyStartMonth: 4,
            numbering: { ...DEFAULT_NUMBERING, receipt: { prefix: "SGB/" } },
            settings: DEMO_SETTINGS,
          })
          .returning();
      }
    }
    if (!company) throw new Error("bootstrap: company insert returned no row");
    const companyId = company.id;
    const roleIds = await ensureRoles(tx, companyId);

    if (mode === "production") {
      if (created) {
        const a = prodAdmin ?? { ...productionAdmin(), hash: await hashPassword(productionAdmin().password) };
        await tx.insert(users).values({
          companyId,
          name: "Administrator",
          email: a.email,
          passwordHash: a.hash,
          roleId: roleIds["Super Admin"],
          allProjects: true,
          mustChangePassword: true,
          passwordChangedAt: new Date(),
        });
        adminEmail = a.email;
      }
      return { companyId, created, roleIds, mode, adminEmail };
    }

    for (const u of BOOTSTRAP_USERS) {
      const [existing] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.companyId, companyId), eq(users.email, u.email)))
        .limit(1);
      if (existing) continue;
      let hash = demoHashes!.get(u.email);
      if (!hash) {
        hash = hashPassword(u.password);
        demoHashes!.set(u.email, hash);
      }
      await tx.insert(users).values({
        companyId,
        name: u.name,
        email: u.email,
        passwordHash: await hash,
        roleId: roleIds[u.role],
        allProjects: u.allProjects,
        mustChangePassword: false,
        passwordChangedAt: new Date(),
      });
    }
    return { companyId, created, roleIds, mode, adminEmail };
  });
}
