import { z } from "zod";
import { NotificationRecipientTypeSchema, NotificationTypeSchema } from "../enums.js";
import { BoolQuerySchema, IdSchema, ListQuerySchema, TimestampSchema, listEnvelope } from "../common.js";

/** In-app notification row. */
export const NotificationRowSchema = z.object({
  id: IdSchema,
  recipient_type: NotificationRecipientTypeSchema,
  recipient_id: IdSchema,
  type: NotificationTypeSchema,
  title: z.string(),
  body: z.string(),
  entity_type: z.string().nullable(),
  entity_id: IdSchema.nullable(),
  link: z.string().nullable(),
  is_read: z.boolean(),
  read_at: TimestampSchema.nullable(),
  is_withdrawn: z.boolean(),
  created_at: TimestampSchema,
});
export type NotificationRow = z.infer<typeof NotificationRowSchema>;

/** List filter for the bell. */
export const NotificationFilterSchema = ListQuerySchema.extend({
  unread_only: BoolQuerySchema.default(false),
  type: NotificationTypeSchema.optional(),
  include_withdrawn: BoolQuerySchema.default(false),
});
export type NotificationFilter = z.infer<typeof NotificationFilterSchema>;
export const NotificationListResponseSchema = listEnvelope(NotificationRowSchema);
export type NotificationListResponse = z.infer<typeof NotificationListResponseSchema>;

/** Mark some (or all) notifications read. */
export const NotificationMarkReadSchema = z
  .strictObject({ ids: z.array(IdSchema).max(500).optional(), all: z.boolean().default(false) })
  .refine((m) => m.all || (m.ids !== undefined && m.ids.length > 0), { message: "Give ids or all=true", path: ["ids"] });
export type NotificationMarkRead = z.infer<typeof NotificationMarkReadSchema>;

/** Unread count (excludes withdrawn). */
export const NotificationCountResponseSchema = z.object({ unread: z.int().min(0) });
export type NotificationCountResponse = z.infer<typeof NotificationCountResponseSchema>;
