/**
 * Hourly SLA breach check ("sla-breach-check"): open tickets past `sla_due_at` not yet flagged get `sla_breached_at` and the assignee
 * plus Super Admin are notified exactly once. The same sweep delivers "notice.published" for notices whose publish_at has arrived.
 */
import { and, eq, isNull, lt, notInArray, sql } from "drizzle-orm";
import type { JobName, SlaBreachCheckResult } from "@kkt/contracts";
import { serviceRequests, type DB } from "@kkt/db";
import { registerJob } from "../../jobs/index.js";
import { SYSTEM_ACTOR, writeAudit } from "../../lib/audit.js";
import { notify, notifyRole } from "../notifications/service.js";
import { notifyDueNotices } from "./notices.js";
import { TERMINAL_STATUSES, TICKET_ADMIN_ROLES, TICKET_ENTITY } from "./ticketService.js";

/** Job name (hourly). Not yet part of the contracts JOB_NAMES enum — see the module report. */
export const SLA_BREACH_JOB = "SLA_BREACH_CHECK" as JobName;

/** Flags overdue open tickets (idempotent: the UPDATE re-checks `sla_breached_at is null`) and notifies assignee + Super Admin once each. */
export async function slaBreachCheck(db: DB, now = new Date()): Promise<SlaBreachCheckResult & { notices_notified: number }> {
  const due = await db
    .select({ id: serviceRequests.id })
    .from(serviceRequests)
    .where(and(notInArray(serviceRequests.status, [...TERMINAL_STATUSES]), isNull(serviceRequests.slaBreachedAt), lt(serviceRequests.slaDueAt, now)));
  const ticketNumbers: string[] = [];
  for (const { id } of due) {
    await db.transaction(async (tx) => {
      const [t] = await tx
        .update(serviceRequests)
        .set({ slaBreachedAt: now, version: sql`${serviceRequests.version} + 1` })
        .where(and(eq(serviceRequests.id, id), isNull(serviceRequests.slaBreachedAt), notInArray(serviceRequests.status, [...TERMINAL_STATUSES])))
        .returning();
      if (!t) return; // resolved or flagged concurrently
      ticketNumbers.push(t.ticketNumber);
      const base = {
        type: "TICKET_SLA_BREACH" as const,
        title: `SLA breached on ${t.ticketNumber}: ${t.subject}`,
        body: `${t.priority} · due ${t.slaDueAt ? new Date(t.slaDueAt).toISOString() : "—"} · ${t.status}`,
        entityType: TICKET_ENTITY, entityId: t.id, link: `/service-requests/${t.id}`,
      };
      if (t.assigneeUserId) await notify(tx, { companyId: t.companyId, recipients: [{ type: "STAFF", id: t.assigneeUserId }], ...base });
      await notifyRole(tx, t.companyId, TICKET_ADMIN_ROLES, base);
      await writeAudit(tx, { companyId: t.companyId, actor: SYSTEM_ACTOR, action: "service_request.sla_breach", entityType: TICKET_ENTITY, entityId: t.id, after: { sla_due_at: base.body, sla_breached_at: now.toISOString(), status: t.status } });
    });
  }
  const noticesNotified = await notifyDueNotices(db, now);
  return { checked_at: now.toISOString(), flagged: ticketNumbers.length, ticket_numbers: ticketNumbers, notices_notified: noticesNotified };
}

/** Registers the hourly job handler with the core job registry. */
export function registerServiceJobs(): void {
  registerJob(SLA_BREACH_JOB, async ({ db }) => slaBreachCheck(db));
}
