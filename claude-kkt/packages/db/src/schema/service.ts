// G (part). Service requests, notifications, notices
import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { appendOnly, idColumn, mutable, trgm } from "./_common.js";
import { bookings } from "./bookings.js";
import { customers } from "./customers.js";
import { actorTypeEnum, notificationRecipientTypeEnum, servicePriorityEnum, serviceStatusEnum } from "./enums.js";
import { companies, users } from "./identity.js";
import { projects } from "./inventory.js";
import { serviceCategories } from "./masters.js";

const companyId = () =>
  uuid("company_id")
    .notNull()
    .references(() => companies.id);

export const serviceRequests = pgTable(
  "service_requests",
  {
    id: idColumn(),
    companyId: companyId(),
    ticketNumber: text("ticket_number").notNull(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    bookingId: uuid("booking_id").references(() => bookings.id),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => serviceCategories.id),
    priority: servicePriorityEnum("priority").notNull().default("MEDIUM"),
    subject: text("subject").notNull(),
    description: text("description"),
    status: serviceStatusEnum("status").notNull().default("NEW"),
    assigneeUserId: uuid("assignee_user_id").references(() => users.id),
    slaDueAt: timestamp("sla_due_at", { withTimezone: true }),
    slaBreachedAt: timestamp("sla_breached_at", { withTimezone: true }),
    /** Set while the SLA clock is paused (AWAITING_CUSTOMER); NULL while it runs (migration 0005). */
    slaPausedAt: timestamp("sla_paused_at", { withTimezone: true }),
    /** Seconds the SLA clock has been paused in the current SLA window; each pause is already added to sla_due_at on resume. */
    slaPausedSeconds: integer("sla_paused_seconds").notNull().default(0),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    reopenedCount: integer("reopened_count").notNull().default(0),
    rating: integer("rating"),
    ratingComment: text("rating_comment"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    ...mutable(),
  },
  (t) => [
    unique("service_requests_company_ticket_uq").on(t.companyId, t.ticketNumber),
    index("service_requests_company_status_priority_idx").on(t.companyId, t.status, t.priority),
    index("service_requests_customer_idx").on(t.customerId),
    index("service_requests_assignee_status_idx").on(t.assigneeUserId, t.status),
    index("service_requests_company_created_idx").on(t.companyId, t.createdAt.desc(), t.id.desc()),
    trgm("service_requests_subject_trgm_idx", t.subject),
    trgm("service_requests_ticket_number_trgm_idx", t.ticketNumber),
    check("service_requests_rating_chk", sql`${t.rating} IS NULL OR ${t.rating} BETWEEN 1 AND 5`),
    index("service_requests_booking_id_idx").on(t.bookingId),
    index("service_requests_category_id_idx").on(t.categoryId),
  ],
);

export const serviceRequestMessages = pgTable(
  "service_request_messages",
  {
    id: idColumn(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => serviceRequests.id, { onDelete: "cascade" }),
    authorType: actorTypeEnum("author_type").notNull(),
    authorId: uuid("author_id"),
    authorName: text("author_name"),
    body: text("body").notNull(),
    isInternal: boolean("is_internal").notNull().default(false),
    attachmentIds: uuid("attachment_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    ...appendOnly(),
  },
  (t) => [index("service_request_messages_ticket_idx").on(t.ticketId, t.createdAt)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: idColumn(),
    companyId: companyId(),
    recipientType: notificationRecipientTypeEnum("recipient_type").notNull(),
    recipientId: uuid("recipient_id").notNull(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    link: text("link"),
    isRead: boolean("is_read").notNull().default(false),
    readAt: timestamp("read_at", { withTimezone: true }),
    isWithdrawn: boolean("is_withdrawn").notNull().default(false),
    ...appendOnly(),
  },
  (t) => [
    index("notifications_recipient_idx").on(t.recipientType, t.recipientId, t.isRead, t.createdAt.desc()),
    index("notifications_entity_idx").on(t.entityType, t.entityId),
    index("notifications_company_id_idx").on(t.companyId),
  ],
);

export const notices = pgTable(
  "notices",
  {
    id: idColumn(),
    companyId: companyId(),
    projectId: uuid("project_id").references(() => projects.id),
    title: text("title").notNull(),
    bodyMd: text("body_md").notNull().default(""),
    publishAt: timestamp("publish_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    isPublished: boolean("is_published").notNull().default(false),
    ...mutable(),
  },
  (t) => [
    index("notices_company_project_published_idx").on(t.companyId, t.projectId, t.isPublished, t.publishAt),
    index("notices_project_id_idx").on(t.projectId),
  ],
);
