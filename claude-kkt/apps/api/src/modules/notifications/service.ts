import { and, eq, inArray } from "drizzle-orm";
import type { NotificationRecipientType, NotificationType } from "@kkt/contracts";
import { notifications, roles, users, type Executor } from "@kkt/db";

/** A notification recipient. */
export interface Recipient {
  type: NotificationRecipientType;
  id: string;
}

/** Payload of an in-app notification. */
export interface NotifyInput {
  companyId: string;
  recipients: Recipient[];
  type: NotificationType;
  title: string;
  body?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  link?: string | null;
}

/** Inserts one notification per recipient inside the caller's transaction (deduplicated by recipient). */
export async function notify(tx: Executor, input: NotifyInput): Promise<number> {
  const seen = new Set<string>();
  const rows = input.recipients
    .filter((r) => { const k = `${r.type}:${r.id}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .map((r) => ({
      companyId: input.companyId, recipientType: r.type, recipientId: r.id, type: input.type, title: input.title, body: input.body ?? null,
      entityType: input.entityType ?? null, entityId: input.entityId ?? null, link: input.link ?? null,
    }));
  if (rows.length === 0) return 0;
  await tx.insert(notifications).values(rows);
  return rows.length;
}

/** Notifies every active staff user holding one of the given role names. */
export async function notifyRole(tx: Executor, companyId: string, roleNames: readonly string[], input: Omit<NotifyInput, "companyId" | "recipients">): Promise<number> {
  if (roleNames.length === 0) return 0;
  const staff = await tx
    .select({ id: users.id })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(and(eq(users.companyId, companyId), eq(users.isActive, true), inArray(roles.name, [...roleNames])));
  return notify(tx, { ...input, companyId, recipients: staff.map((s) => ({ type: "STAFF" as const, id: s.id })) });
}

/** Retraction rule: notifications about an entity are deleted when unread and flagged withdrawn when already read. */
export async function withdraw(tx: Executor, entityType: string, entityId: string): Promise<{ deleted: number; withdrawn: number }> {
  const deleted = await tx.delete(notifications).where(and(eq(notifications.entityType, entityType), eq(notifications.entityId, entityId), eq(notifications.isRead, false))).returning({ id: notifications.id });
  const withdrawn = await tx.update(notifications).set({ isWithdrawn: true }).where(and(eq(notifications.entityType, entityType), eq(notifications.entityId, entityId), eq(notifications.isRead, true), eq(notifications.isWithdrawn, false))).returning({ id: notifications.id });
  return { deleted: deleted.length, withdrawn: withdrawn.length };
}
