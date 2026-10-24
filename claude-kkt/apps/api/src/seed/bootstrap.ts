import { and, eq } from "drizzle-orm";
import { SYSTEM_ROLES, SYSTEM_ROLE_NAMES, type SystemRoleName } from "@kkt/contracts";
import { companies, roles, users, type DB } from "@kkt/db";
import { hashPassword } from "../lib/password.js";

/** Staff logins created by the bootstrap (docs/SEED.md). */
export const BOOTSTRAP_USERS: readonly { role: SystemRoleName; name: string; email: string; password: string; allProjects: boolean }[] = [
  { role: "Super Admin", name: "Suresh Agarwal", email: "admin@sgb.in", password: "Admin@12345", allProjects: true },
  { role: "Project Admin", name: "Rohit Kumar", email: "projects@sgb.in", password: "Project@12345", allProjects: false },
  { role: "Accounts", name: "Meena Sharma", email: "accounts@sgb.in", password: "Accounts@12345", allProjects: true },
  { role: "Sales", name: "Ankit Verma", email: "sales@sgb.in", password: "Sales@12345", allProjects: true },
  { role: "Marketing", name: "Nisha Singh", email: "marketing@sgb.in", password: "Marketing@12345", allProjects: true },
  { role: "Employee", name: "Deepak Prasad", email: "employee@sgb.in", password: "Employee@12345", allProjects: true },
];

/** Result of ensureBootstrap. */
export interface BootstrapResult {
  companyId: string;
  created: boolean;
  roleIds: Record<SystemRoleName, string>;
}

/**
 * Idempotently creates the demo company ("Shree Ganesh Builders", Patna), the six system roles and the six staff logins.
 * Safe to run at every boot: existing rows are left untouched (passwords are never reset).
 */
export async function ensureBootstrap(db: DB): Promise<BootstrapResult> {
  return db.transaction(async (tx) => {
    let created = false;
    let [company] = await tx.select().from(companies).limit(1);
    if (!company) {
      created = true;
      [company] = await tx
        .insert(companies)
        .values({
          name: "Shree Ganesh Builders",
          legalName: "Shree Ganesh Builders Private Limited",
          gstin: "10AABCS1234A1Z5",
          phone: "6122200000",
          email: "info@sgb.in",
          address: { line1: "SGB House, Boring Road", locality: "Sri Krishna Puri", city: "Patna", state: "Bihar", pincode: "800001" },
          letterhead: { tagline: "Building homes, building trust", phone: "+91 612 2200000", email: "info@sgb.in", website: "https://www.sgb.in", signatory_name: "Suresh Agarwal", signatory_title: "Managing Director" },
          fyStartMonth: 4,
          numbering: { customer: { prefix: "CUST-" }, booking: { prefix: "BK-" }, demand: { prefix: "DM-" }, receipt: { prefix: "SGB/" }, ticket: { prefix: "SR-" }, visit: { prefix: "SV-" } },
          settings: { demand_due_days: 15, default_gst_percent: 5, round_robin_enabled: true, force_mfa_for_admins: false, sla_hours: { LOW: 72, MEDIUM: 48, HIGH: 24, URGENT: 8 }, booking_hold_hours: 48 },
        })
        .returning();
    }
    if (!company) throw new Error("bootstrap: company insert returned no row");
    const companyId = company.id;

    const roleIds = {} as Record<SystemRoleName, string>;
    for (const name of SYSTEM_ROLE_NAMES) {
      const def = SYSTEM_ROLES[name];
      const [existing] = await tx.select({ id: roles.id }).from(roles).where(and(eq(roles.companyId, companyId), eq(roles.name, name))).limit(1);
      if (existing) {
        roleIds[name] = existing.id;
        // Keep system-role permission bundles in sync with the contracts registry.
        await tx.update(roles).set({ permissions: [...def.permissions], description: def.description, isSystem: true }).where(eq(roles.id, existing.id));
        continue;
      }
      const [r] = await tx.insert(roles).values({ companyId, name, description: def.description, permissions: [...def.permissions], isSystem: true }).returning({ id: roles.id });
      roleIds[name] = r!.id;
    }

    for (const u of BOOTSTRAP_USERS) {
      const [existing] = await tx.select({ id: users.id }).from(users).where(and(eq(users.companyId, companyId), eq(users.email, u.email))).limit(1);
      if (existing) continue;
      await tx.insert(users).values({
        companyId, name: u.name, email: u.email, passwordHash: await hashPassword(u.password), roleId: roleIds[u.role],
        allProjects: u.allProjects, mustChangePassword: false, passwordChangedAt: new Date(),
      });
    }
    return { companyId, created, roleIds };
  });
}
