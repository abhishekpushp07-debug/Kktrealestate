import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  IdSchema,
  PortalAccessRequestSchema,
  PortalAccessResponseSchema,
  PortalBulkEnableQuerySchema,
  PortalBulkEnableResponseSchema,
  PortalBulkEnableSchema,
  type PortalAccessAction,
  type PortalAccessResponse,
  type PortalBulkCredential,
} from "@kkt/contracts";
import { bookingCoApplicants, bookings, customers, passwordHistory, portalUsers, type Executor } from "@kkt/db";
import { writeAudit } from "../../lib/audit.js";
import { sendCsv } from "../../lib/csv.js";
import { bumpAuthVersions } from "../../lib/cache.js";
import { temporaryPassword } from "../../lib/crypto.js";
import { ApiError } from "../../lib/errors.js";
import { hashPassword } from "../../lib/password.js";
import { translatePgError } from "../../lib/pgErrors.js";
import { route } from "../../lib/routes.js";
import { ensureProjectAccess } from "../../lib/scope.js";
import { revokeAllFamilies } from "../auth/index.js";
import {
  loadCustomerSelect,
  metaOf,
  portalAccessView,
  type DbCustomer,
  type DbPortalUser,
  type WriteMeta,
} from "./customerService.js";
import { securityRedis } from "../../plugins/auth.js";

const idParams = z.object({ id: IdSchema });

/** Loads the portal user of a customer (FOR UPDATE), or null. */
async function portalUserOf(tx: Executor, customerId: string): Promise<DbPortalUser | null> {
  const [pu] = await tx.select().from(portalUsers).where(eq(portalUsers.customerId, customerId)).limit(1).for("update");
  return pu ?? null;
}

/** Creates or re-enables portal access with a fresh temporary password (hash is computed by the caller so argon2 runs outside row locks). */
async function enablePortal(
  tx: Executor,
  app: FastifyInstance,
  customer: DbCustomer,
  enabledBy: string,
  hash: string,
  meta: WriteMeta,
): Promise<DbPortalUser> {
  if (!customer.isActive || customer.erasedAt)
    throw ApiError.rule("Portal access cannot be enabled for an inactive or erased customer", "CUSTOMER_INACTIVE");
  const existing = await portalUserOf(tx, customer.id);
  let pu: DbPortalUser | undefined;
  if (existing) {
    if (existing.isEnabled)
      throw ApiError.rule(
        "Portal access is already enabled; use reset-password to issue a new temporary password",
        "PORTAL_ALREADY_ENABLED",
      );
    await tx
      .insert(passwordHistory)
      .values({ userType: "CUSTOMER", subjectId: existing.id, passwordHash: existing.passwordHash });
    [pu] = await tx
      .update(portalUsers)
      .set({
        phone: customer.phone,
        passwordHash: hash,
        mustChangePassword: true,
        isEnabled: true,
        failedAttempts: 0,
        lockedUntil: new Date(),
        enabledBy,
        enabledAt: new Date(),
        disabledAt: null,
        version: sql`${portalUsers.version} + 1`,
      })
      .where(eq(portalUsers.id, existing.id))
      .returning();
  } else {
    try {
      [pu] = await tx
        .insert(portalUsers)
        .values({
          companyId: customer.companyId,
          customerId: customer.id,
          phone: customer.phone,
          passwordHash: hash,
          mustChangePassword: true,
          isEnabled: true,
          enabledBy,
          enabledAt: new Date(),
          createdBy: enabledBy,
        })
        .returning();
    } catch (e) {
      translatePgError(e, `A portal login with phone ${customer.phone}`);
    }
  }
  if (!pu) throw new Error("portal user write returned no row");
  await revokeAllFamilies(tx, securityRedis(app), "CUSTOMER", pu.id, "PORTAL_ENABLED");
  await writeAudit(tx, {
    companyId: customer.companyId,
    ...meta,
    action: existing ? "customer.portal_reenable" : "customer.portal_enable",
    entityType: "customer",
    entityId: customer.id,
    after: { portal_user_id: pu.id, phone: pu.phone, must_change_password: true },
  });
  return pu;
}

/** Executes one portal access action and returns the card (temp password only for ENABLE / RESET_PASSWORD). */
async function portalAction(
  app: FastifyInstance,
  req: FastifyRequest,
  customerId: string,
  action: PortalAccessAction,
): Promise<PortalAccessResponse> {
  const user = req.user!;
  const meta = metaOf(req);
  const plain = action === "ENABLE" || action === "RESET_PASSWORD" ? temporaryPassword() : null;
  const hash = plain ? await hashPassword(plain) : null;
  let portalUserId: string | null = null;
  const view = await app.db.transaction(async (tx) => {
    const sel = await loadCustomerSelect(tx, user.companyId, customerId, true, user);
    const customer = sel.c;
    if (action === "ENABLE") {
      portalUserId = (await enablePortal(tx, app, customer, user.id, hash!, meta)).id;
      return portalAccessView(tx, user.companyId, customer, plain);
    }
    const pu = await portalUserOf(tx, customer.id);
    if (!pu) throw ApiError.rule("Portal access has not been enabled for this customer", "PORTAL_NOT_ENABLED");
    portalUserId = pu.id;
    if (action === "RESET_PASSWORD") {
      if (!pu.isEnabled)
        throw ApiError.rule("Portal access is disabled; enable it to issue a new password", "PORTAL_NOT_ENABLED");
      await tx
        .insert(passwordHistory)
        .values({ userType: "CUSTOMER", subjectId: pu.id, passwordHash: pu.passwordHash });
      await tx
        .update(portalUsers)
        .set({
          passwordHash: hash!,
          mustChangePassword: true,
          failedAttempts: 0,
          lockedUntil: new Date(),
          version: sql`${portalUsers.version} + 1`,
        })
        .where(eq(portalUsers.id, pu.id));
      const revoked = await revokeAllFamilies(tx, securityRedis(app), "CUSTOMER", pu.id, "PASSWORD_RESET");
      await writeAudit(tx, {
        companyId: user.companyId,
        ...meta,
        action: "customer.portal_reset_password",
        entityType: "customer",
        entityId: customer.id,
        after: { portal_user_id: pu.id, must_change_password: true, sessions_revoked: revoked },
      });
      return portalAccessView(tx, user.companyId, customer, plain);
    }
    if (action === "DISABLE") {
      if (!pu.isEnabled) throw ApiError.rule("Portal access is already disabled", "PORTAL_ALREADY_DISABLED");
      await tx
        .update(portalUsers)
        .set({ isEnabled: false, disabledAt: new Date(), version: sql`${portalUsers.version} + 1` })
        .where(eq(portalUsers.id, pu.id));
      const revoked = await revokeAllFamilies(tx, securityRedis(app), "CUSTOMER", pu.id, "PORTAL_DISABLED");
      await writeAudit(tx, {
        companyId: user.companyId,
        ...meta,
        action: "customer.portal_disable",
        entityType: "customer",
        entityId: customer.id,
        before: { is_enabled: true },
        after: { is_enabled: false, sessions_revoked: revoked },
      });
      return portalAccessView(tx, user.companyId, customer);
    }
    const revoked = await revokeAllFamilies(tx, securityRedis(app), "CUSTOMER", pu.id, "ADMIN_REVOKED");
    await writeAudit(tx, {
      companyId: user.companyId,
      ...meta,
      action: "customer.portal_revoke_sessions",
      entityType: "customer",
      entityId: customer.id,
      after: { portal_user_id: pu.id, sessions_revoked: revoked },
    });
    return portalAccessView(tx, user.companyId, customer);
  });
  // only this customer's cached portal identity is re-read
  if (portalUserId) await bumpAuthVersions(app.redis, { portalUsers: [portalUserId] }, req.log);
  return view;
}

const ACTION_PATHS: Record<string, PortalAccessAction> = {
  enable: "ENABLE",
  "reset-password": "RESET_PASSWORD",
  disable: "DISABLE",
  "revoke-sessions": "REVOKE_SESSIONS",
};

/** Portal access card routes under /customers/:id/portal and the bulk enable. */
export function portalAccessRoutes(app: FastifyInstance): void {
  route(app, {
    method: "GET",
    url: "/customers/:id/portal",
    permission: "customer.read",
    schema: {
      params: idParams,
      response: { 200: PortalAccessResponseSchema },
      summary: "Portal access state (last login, sessions, login link)",
    },
    handler: async (req) => {
      const sel = await loadCustomerSelect(app.dbReplica, req.user!.companyId, req.params.id, false, req.user!);
      return portalAccessView(app.dbReplica, req.user!.companyId, sel.c);
    },
  });

  // Deliberately NOT idempotent: the idempotency store would keep the one-time temporary password for 24 h. A repeated enable is
  // refused with 422 PORTAL_ALREADY_ENABLED, which makes the action safe to retry anyway.
  for (const [path, action] of Object.entries(ACTION_PATHS)) {
    route(app, {
      method: "POST",
      url: `/customers/:id/portal/${path}`,
      permission: "customer.portal_manage",
      schema: {
        params: idParams,
        body: z.object({}).strict().optional(),
        response: { 200: PortalAccessResponseSchema },
        summary: `Portal access: ${action.toLowerCase().replace(/_/g, " ")}`,
      },
      handler: async (req, reply) => {
        reply.header("Cache-Control", "no-store");
        return portalAction(app, req, req.params.id, action);
      },
    });
  }

  route(app, {
    method: "POST",
    url: "/customers/:id/portal",
    permission: "customer.portal_manage",
    schema: {
      params: idParams,
      body: PortalAccessRequestSchema,
      response: { 200: PortalAccessResponseSchema },
      summary: "Portal access action {action: ENABLE|RESET_PASSWORD|DISABLE|REVOKE_SESSIONS}",
    },
    handler: async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      return portalAction(app, req, req.params.id, req.body.action);
    },
  });

  route(app, {
    method: "POST",
    url: "/customers/portal/bulk-enable",
    permission: "customer.portal_manage",
    schema: {
      body: PortalBulkEnableSchema,
      querystring: PortalBulkEnableQuerySchema,
      response: { 200: PortalBulkEnableResponseSchema },
      summary:
        "Enable portal access for every customer with an ACTIVE booking; the one-time credentials [{customer_id, customer_code, full_name, phone, temporary_password}] are returned once (JSON, or CSV with ?format=csv), never stored or audited",
    },
    handler: async (req, reply) => {
      const user = req.user!;
      if (req.body.project_id) ensureProjectAccess(user, req.body.project_id);
      // Customers (primary or co-applicant) with an ACTIVE booking in scope; those already enabled are counted separately. The booking
      // of the raw sub-select is aliased `b`, so the scope is spelled on `b.project_id` (audit G: a Drizzle column condition here rendered
      // "bookings"."project_id", an invalid FROM reference → 500 for every scoped user).
      const scopeIds = user.allProjects
        ? null
        : user.projectIds.length > 0
          ? sql.join(
              user.projectIds.map((id) => sql`${id}::uuid`),
              sql`, `,
            )
          : null;
      const scope = user.allProjects ? sql`` : scopeIds ? sql`and b.project_id in (${scopeIds})` : sql`and false`;
      const candidates = await app.db
        .select({
          c: customers,
          enabled: sql<
            boolean | null
          >`(select pu.is_enabled from ${portalUsers} pu where pu.customer_id = "customers"."id")`,
        })
        .from(customers)
        .where(
          and(
            eq(customers.companyId, user.companyId),
            eq(customers.isActive, true),
            sql`exists (select 1 from ${bookings} b where b.status = 'ACTIVE' ${scope} ${req.body.project_id ? sql`and b.project_id = ${req.body.project_id}` : sql``}
                      and (b.customer_id = "customers"."id" or exists (select 1 from ${bookingCoApplicants} bc where bc.booking_id = b.id and bc.customer_id = "customers"."id")))`,
          ),
        )
        .orderBy(customers.customerCode);
      const todo = candidates.filter((r) => r.enabled !== true);
      const alreadyEnabled = candidates.length - todo.length;
      if (req.body.dry_run)
        return { dry_run: true, enabled: todo.length, already_enabled: alreadyEnabled, credentials: [] };
      const credentials: PortalBulkCredential[] = [];
      const enabledPortalUsers: string[] = [];
      const meta = metaOf(req);
      let failed = 0;
      for (const r of todo) {
        // One short transaction per customer; argon2 runs outside the row lock.
        const plain = temporaryPassword();
        const hash = await hashPassword(plain);
        try {
          await app.db.transaction(async (tx) => {
            const [fresh] = await tx.select().from(customers).where(eq(customers.id, r.c.id)).limit(1).for("update");
            if (!fresh) return;
            const pu = await enablePortal(tx, app, fresh, user.id, hash, meta);
            enabledPortalUsers.push(pu.id);
            credentials.push({
              customer_id: fresh.id,
              customer_code: fresh.customerCode,
              full_name: fresh.fullName,
              phone: pu.phone,
              temporary_password: plain,
              temp_password: plain,
            });
          });
        } catch (e) {
          // Raced (enabled meanwhile) or phone already used by another portal login: skip this customer, never fail the batch.
          if (e instanceof ApiError && (e.code === "BUSINESS_RULE" || e.code === "DUPLICATE")) continue;
          // Anything else (a database hiccup): never throw away the passwords already issued in this batch — they exist only in this
          // response. Count the failure and stop; the next run enables the rest.
          req.log.error({ err: e, customer_id: r.c.id }, "portal bulk enable stopped early");
          failed = todo.length - credentials.length;
          break;
        }
      }
      // The batch audit row carries counts only (each customer also has its own customer.portal_enable row without any password); the
      // temporary passwords exist in this one response and nowhere else (the route is deliberately not idempotent: no stored replay).
      await app.db.transaction((tx) =>
        writeAudit(tx, {
          companyId: user.companyId,
          ...meta,
          action: "customer.portal_bulk_enable",
          entityType: "company",
          entityId: user.companyId,
          after: {
            enabled: credentials.length,
            already_enabled: alreadyEnabled,
            failed,
            project_id: req.body.project_id ?? null,
            format: req.query.format ?? "json",
          },
        }),
      );
      await bumpAuthVersions(app.redis, { portalUsers: enabledPortalUsers }, req.log);
      reply.header("Cache-Control", "no-store"); // one-time passwords: never cached by a browser or proxy
      if (req.query.format === "csv") {
        reply.header("Pragma", "no-cache");
        return sendCsv(
          reply,
          "portal-credentials.csv",
          ["customer_code", "full_name", "phone", "temporary_password", "customer_id"].map((k) => ({
            key: k,
            header: k,
          })),
          credentials as unknown as Record<string, unknown>[],
        );
      }
      return {
        dry_run: false,
        enabled: credentials.length,
        already_enabled: alreadyEnabled,
        ...(failed > 0 ? { failed } : {}),
        credentials,
      };
    },
  });
}
