import { z } from "zod";
import { BoolQuerySchema, ListQuerySchema, MasterRowSchema, NameSchema, TextSchema, listEnvelope, updateOf } from "../common.js";
import { PermissionListSchema } from "../permissions.js";

const RoleBase = z.strictObject({
  name: NameSchema,
  description: TextSchema.optional().nullable(),
  permissions: PermissionListSchema,
});

/** Create a custom role (bundle of permission codes). */
export const RoleCreateSchema = RoleBase.refine((r) => r.permissions.length > 0, {
  message: "Pick at least one permission",
  path: ["permissions"],
});
export type RoleCreate = z.infer<typeof RoleCreateSchema>;

/** Update a role (system roles may only change description). */
export const RoleUpdateSchema = updateOf(RoleBase);
export type RoleUpdate = z.infer<typeof RoleUpdateSchema>;

/** Role row. */
export const RoleRowSchema = MasterRowSchema.extend({
  name: z.string(),
  description: z.string().nullable(),
  permissions: z.array(z.string()),
  is_system: z.boolean(),
  user_count: z.int().min(0),
});
export type RoleRow = z.infer<typeof RoleRowSchema>;

/** List filter for roles. */
export const RoleFilterSchema = ListQuerySchema.extend({ is_system: BoolQuerySchema.optional() });
export type RoleFilter = z.infer<typeof RoleFilterSchema>;

export const RoleListResponseSchema = listEnvelope(RoleRowSchema);
export type RoleListResponse = z.infer<typeof RoleListResponseSchema>;

/** A permission group as served to the role editor. */
export const PermissionGroupResponseSchema = z.object({
  key: z.string(),
  label: z.string(),
  permissions: z.array(z.object({ code: z.string(), label: z.string() })),
});
export type PermissionGroupResponse = z.infer<typeof PermissionGroupResponseSchema>;

/** Response to `GET /roles/permissions`. */
export const PermissionCatalogResponseSchema = z.object({ groups: z.array(PermissionGroupResponseSchema) });
export type PermissionCatalogResponse = z.infer<typeof PermissionCatalogResponseSchema>;
