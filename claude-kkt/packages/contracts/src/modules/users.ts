import { z } from "zod";
import {
  BoolQuerySchema,
  EmailSchema,
  IdSchema,
  ListQuerySchema,
  MasterRowSchema,
  NameSchema,
  PasswordSchema,
  PhoneSchema,
  TimestampSchema,
  VersionedSchema,
  listEnvelope,
  updateOf,
} from "../common.js";

/** Create a staff user. */
export const UserCreateSchema = z
  .strictObject({
    name: NameSchema,
    email: EmailSchema,
    phone: PhoneSchema.optional().nullable(),
    role_id: IdSchema,
    all_projects: z.boolean().default(true),
    project_ids: z.array(IdSchema).max(200).default([]),
    password: PasswordSchema.optional(),
    must_change_password: z.boolean().default(true),
  })
  .refine((u) => u.all_projects || u.project_ids.length > 0, {
    message: "Pick at least one project for a scoped user",
    path: ["project_ids"],
  });
export type UserCreate = z.infer<typeof UserCreateSchema>;

const UserUpdateBase = z.strictObject({
  name: NameSchema,
  email: EmailSchema,
  phone: PhoneSchema.nullable(),
  role_id: IdSchema,
  all_projects: z.boolean(),
  project_ids: z.array(IdSchema).max(200),
  must_change_password: z.boolean(),
});

/** Update a staff user (partial + version). */
export const UserUpdateSchema = updateOf(UserUpdateBase);
export type UserUpdate = z.infer<typeof UserUpdateSchema>;

/** Staff user row (never carries password material). */
export const UserRowSchema = MasterRowSchema.extend({
  name: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
  role_id: IdSchema,
  role_name: z.string(),
  all_projects: z.boolean(),
  project_ids: z.array(IdSchema),
  must_change_password: z.boolean(),
  mfa_enabled: z.boolean(),
  locked_until: TimestampSchema.nullable(),
  last_login_at: TimestampSchema.nullable(),
  avatar_document_id: IdSchema.nullable(),
});
export type UserRow = z.infer<typeof UserRowSchema>;

/** List filter for users. */
export const UserFilterSchema = ListQuerySchema.extend({
  role_id: IdSchema.optional(),
  project_id: IdSchema.optional(),
  is_locked: BoolQuerySchema.optional(),
});
export type UserFilter = z.infer<typeof UserFilterSchema>;

export const UserListResponseSchema = listEnvelope(UserRowSchema);
export type UserListResponse = z.infer<typeof UserListResponseSchema>;

/** Admin reset of a user's password; omit password to generate one. */
export const UserResetPasswordSchema = z.strictObject({
  ...VersionedSchema.shape,
  new_password: PasswordSchema.optional(),
  must_change_password: z.boolean().default(true),
});
export type UserResetPassword = z.infer<typeof UserResetPasswordSchema>;

/** Response of a reset: temporary password shown once. */
export const UserResetPasswordResponseSchema = z.object({ id: IdSchema, temp_password: z.string().optional(), version: z.int() });
export type UserResetPasswordResponse = z.infer<typeof UserResetPasswordResponseSchema>;

/** Unlock a locked-out user. */
export const UserUnlockSchema = z.strictObject(VersionedSchema.shape);
export type UserUnlock = z.infer<typeof UserUnlockSchema>;

/** Set a user's project scope. */
export const UserProjectScopeSchema = z.strictObject({
  ...VersionedSchema.shape,
  all_projects: z.boolean(),
  project_ids: z.array(IdSchema).max(200),
});
export type UserProjectScope = z.infer<typeof UserProjectScopeSchema>;
