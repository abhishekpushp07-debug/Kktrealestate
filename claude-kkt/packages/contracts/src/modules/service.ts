import { z } from "zod";
import { ActorTypeSchema, ServicePrioritySchema, ServiceStatusSchema } from "../enums.js";
import {
  BoolQuerySchema,
  IdSchema,
  ListQuerySchema,
  NoteSchema,
  ReasonSchema,
  TextSchema,
  TimestampSchema,
  VersionSchema,
  VersionedSchema,
  listEnvelope,
} from "../common.js";

/** Staff creates a ticket on behalf of a customer. */
export const ServiceRequestCreateSchema = z.strictObject({
  customer_id: IdSchema,
  booking_id: IdSchema.optional().nullable(),
  category_id: IdSchema,
  priority: ServicePrioritySchema.optional(),
  subject: z.string().trim().min(3).max(200),
  description: TextSchema.min(1),
  attachment_ids: z.array(IdSchema).max(10).default([]),
  assignee_user_id: IdSchema.optional().nullable(),
});
export type ServiceRequestCreate = z.infer<typeof ServiceRequestCreateSchema>;

/** Staff message on a ticket; is_internal notes are never shown to the customer. */
export const ServiceMessageCreateSchema = z.strictObject({
  body: z.string().trim().min(1).max(5000),
  is_internal: z.boolean().default(false),
  attachment_ids: z.array(IdSchema).max(10).default([]),
  /** Optional explicit status to move the ticket to with this reply (e.g. AWAITING_CUSTOMER when asking for information). */
  status: ServiceStatusSchema.optional(),
});
export type ServiceMessageCreate = z.infer<typeof ServiceMessageCreateSchema>;

/** Assign a ticket. */
export const ServiceAssignSchema = z.strictObject({ ...VersionedSchema.shape, assignee_user_id: IdSchema.nullable() });
export type ServiceAssign = z.infer<typeof ServiceAssignSchema>;

/** Change ticket status (RESOLVED/CLOSED may carry a note). */
export const ServiceStatusChangeSchema = z.strictObject({
  ...VersionedSchema.shape,
  status: ServiceStatusSchema,
  note: NoteSchema.optional().nullable(),
});
export type ServiceStatusChange = z.infer<typeof ServiceStatusChangeSchema>;

/** Staff edits a ticket's editable fields (priority, category, subject, description) with optimistic concurrency. */
export const ServiceRequestUpdateSchema = z.strictObject({
  ...VersionedSchema.shape,
  priority: ServicePrioritySchema.optional(),
  category_id: IdSchema.optional(),
  subject: z.string().trim().min(3).max(200).optional(),
  description: TextSchema.min(1).optional(),
});
export type ServiceRequestUpdate = z.infer<typeof ServiceRequestUpdateSchema>;

/** Change priority. */
export const ServicePriorityChangeSchema = z.strictObject({
  ...VersionedSchema.shape,
  priority: ServicePrioritySchema,
});
export type ServicePriorityChange = z.infer<typeof ServicePriorityChangeSchema>;

/** Satisfaction rating 1–5 at close. */
export const ServiceRatingSchema = z.strictObject({
  rating: z.int().min(1).max(5),
  comment: NoteSchema.optional().nullable(),
});
export type ServiceRating = z.infer<typeof ServiceRatingSchema>;

/** Reopen within 7 days of Resolved. */
export const ServiceReopenSchema = z.strictObject({ reason: ReasonSchema });
export type ServiceReopen = z.infer<typeof ServiceReopenSchema>;

/** Message row. */
export const ServiceMessageRowSchema = z.object({
  id: IdSchema,
  ticket_id: IdSchema,
  author_type: ActorTypeSchema,
  author_id: IdSchema.nullable(),
  author_name: z.string(),
  body: z.string(),
  is_internal: z.boolean(),
  attachments: z.array(
    z.object({ id: IdSchema, file_name: z.string(), mime: z.string(), thumb_url: z.string().nullable() }),
  ),
  created_at: TimestampSchema,
});
export type ServiceMessageRow = z.infer<typeof ServiceMessageRowSchema>;

/** Ticket row. */
export const ServiceRequestRowSchema = z.object({
  id: IdSchema,
  company_id: IdSchema,
  ticket_number: z.string(),
  customer_id: IdSchema,
  customer_name: z.string(),
  customer_phone: z.string(),
  booking_id: IdSchema.nullable(),
  booking_number: z.string().nullable(),
  project_name: z.string().nullable(),
  flat_number: z.string().nullable(),
  category_id: IdSchema,
  category_name: z.string(),
  priority: ServicePrioritySchema,
  subject: z.string(),
  description: z.string(),
  status: ServiceStatusSchema,
  assignee_user_id: IdSchema.nullable(),
  assignee_name: z.string().nullable(),
  /** Effective SLA deadline: shifted forward by every AWAITING_CUSTOMER pause when the ticket resumes; reset from the reopen time. */
  sla_due_at: TimestampSchema.nullable(),
  sla_breached_at: TimestampSchema.nullable(),
  is_sla_breached: z.boolean(),
  /** Set while the SLA clock is paused (status AWAITING_CUSTOMER): the deadline moves on by the pause length on resume. */
  sla_paused_at: TimestampSchema.nullable().optional(),
  /** Seconds the clock was paused in the current SLA window (already added to sla_due_at; reset on reopen). */
  sla_paused_seconds: z.int().min(0).optional(),
  resolved_at: TimestampSchema.nullable(),
  closed_at: TimestampSchema.nullable(),
  reopened_count: z.int().min(0),
  rating: z.int().min(1).max(5).nullable(),
  rating_comment: z.string().nullable(),
  last_message_at: TimestampSchema.nullable(),
  message_count: z.int().min(0),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
  version: VersionSchema,
});
export type ServiceRequestRow = z.infer<typeof ServiceRequestRowSchema>;

/** Ticket detail: row + thread (internal notes included for staff). */
export const ServiceRequestDetailResponseSchema = ServiceRequestRowSchema.extend({
  messages: z.array(ServiceMessageRowSchema),
});
export type ServiceRequestDetailResponse = z.infer<typeof ServiceRequestDetailResponseSchema>;

/** List filter for tickets. */
export const ServiceFilterSchema = ListQuerySchema.extend({
  status: ServiceStatusSchema.optional(),
  priority: ServicePrioritySchema.optional(),
  category_id: IdSchema.optional(),
  assignee_user_id: IdSchema.optional(),
  customer_id: IdSchema.optional(),
  booking_id: IdSchema.optional(),
  project_id: IdSchema.optional(),
  sla_breached: BoolQuerySchema.optional(),
  unassigned: BoolQuerySchema.optional(),
});
export type ServiceFilter = z.infer<typeof ServiceFilterSchema>;
export const ServiceListResponseSchema = listEnvelope(ServiceRequestRowSchema);
export type ServiceListResponse = z.infer<typeof ServiceListResponseSchema>;

/** Kanban by status. */
export const ServiceKanbanResponseSchema = z.object({
  columns: z.array(
    z.object({ status: ServiceStatusSchema, count: z.int().min(0), tickets: z.array(ServiceRequestRowSchema) }),
  ),
});
export type ServiceKanbanResponse = z.infer<typeof ServiceKanbanResponseSchema>;

/** Kanban filters (subset of the list filter; every column is limited to `column_limit` tickets). */
export const ServiceBoardQuerySchema = z.object({
  priority: ServicePrioritySchema.optional(),
  category_id: IdSchema.optional(),
  assignee_user_id: IdSchema.optional(),
  project_id: IdSchema.optional(),
  column_limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ServiceBoardQuery = z.infer<typeof ServiceBoardQuerySchema>;

/** Customer-facing ticket row (portal module maps it onto PortalRequestRow): staff ids are kept out, reopen/rate eligibility is computed. */
export const CustomerTicketRowSchema = ServiceRequestRowSchema.omit({
  assignee_user_id: true,
  assignee_name: true,
  sla_due_at: true,
  sla_breached_at: true,
  is_sla_breached: true,
  sla_paused_at: true,
  sla_paused_seconds: true,
}).extend({
  can_reopen: z.boolean(),
  can_rate: z.boolean(),
});
export type CustomerTicketRow = z.infer<typeof CustomerTicketRowSchema>;

/** Customer-facing ticket detail: internal notes are never included. */
export const CustomerTicketDetailSchema = CustomerTicketRowSchema.extend({
  messages: z.array(ServiceMessageRowSchema),
});
export type CustomerTicketDetail = z.infer<typeof CustomerTicketDetailSchema>;

/** Result of the hourly SLA breach check job. */
export const SlaBreachCheckResultSchema = z.object({
  checked_at: TimestampSchema,
  flagged: z.int().min(0),
  ticket_numbers: z.array(z.string()),
});
export type SlaBreachCheckResult = z.infer<typeof SlaBreachCheckResultSchema>;

/** Days after RESOLVED during which a customer may reopen. */
export const SERVICE_REOPEN_WINDOW_DAYS = 7;
