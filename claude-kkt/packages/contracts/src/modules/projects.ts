import { z } from "zod";
import { FlatStatusSchema, ProjectStatusSchema, ProjectTypeSchema } from "../enums.js";
import {
  AddressSchema,
  DateStringSchema,
  IdSchema,
  ListQuerySchema,
  MasterRowSchema,
  NameSchema,
  CodeSchema,
  TextSchema,
  VersionedSchema,
  listEnvelope,
  updateOf,
} from "../common.js";

/** A landmark near the project with its distance. */
export const LandmarkSchema = z.strictObject({ name: NameSchema, distance_km: z.number().min(0).max(999) });
export type Landmark = z.infer<typeof LandmarkSchema>;

/** Status of a statutory approval. */
export const APPROVAL_STATUSES = ["APPLIED", "RECEIVED", "NA"] as const;
export const ApprovalStatusSchema = z.enum(APPROVAL_STATUSES);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

/** A statutory approval (RERA, building plan, fire NOC…). */
export const ApprovalSchema = z.strictObject({
  name: NameSchema,
  number: z.string().trim().max(80).optional().nullable(),
  issued_on: DateStringSchema.optional().nullable(),
  status: ApprovalStatusSchema.default("RECEIVED"),
});
export type Approval = z.infer<typeof ApprovalSchema>;

/** A project team member. */
export const ProjectTeamMemberSchema = z.strictObject({
  user_id: IdSchema,
  role_label: z.string().trim().max(60).optional().nullable(),
});
export type ProjectTeamMember = z.infer<typeof ProjectTeamMemberSchema>;

/** Unit counts by status plus total. */
export const UnitCountsSchema = z.object({
  available: z.int().min(0),
  hold: z.int().min(0),
  blocked: z.int().min(0),
  booked: z.int().min(0),
  sold: z.int().min(0),
  total: z.int().min(0),
});
export type UnitCounts = z.infer<typeof UnitCountsSchema>;

/** Empty unit counts. */
export const EMPTY_UNIT_COUNTS: UnitCounts = { available: 0, hold: 0, blocked: 0, booked: 0, sold: 0, total: 0 };

/** Maps a flat status to its unit_counts key. */
export function unitCountKey(status: z.infer<typeof FlatStatusSchema>): keyof Omit<UnitCounts, "total"> {
  switch (status) {
    case "AVAILABLE":
      return "available";
    case "HOLD":
      return "hold";
    case "BLOCKED":
      return "blocked";
    case "BOOKED":
      return "booked";
    case "SOLD":
      return "sold";
  }
}

const ProjectBase = z.strictObject({
  name: NameSchema,
  code: CodeSchema,
  project_type: ProjectTypeSchema,
  status: ProjectStatusSchema.default("PLANNING"),
  description: TextSchema.optional().nullable(),
  address: AddressSchema,
  rera_number: z.string().trim().max(60).optional().nullable(),
  launch_date: DateStringSchema.optional().nullable(),
  possession_date: DateStringSchema.optional().nullable(),
  land_area_sqft: z.number().min(0).optional().nullable(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  landmarks: z.array(LandmarkSchema).max(50).default([]),
  approvals: z.array(ApprovalSchema).max(50).default([]),
  escrow_bank_account_id: IdSchema.optional().nullable(),
  stage_sequence: z.array(IdSchema).max(100).optional(),
  amenity_ids: z.array(IdSchema).max(200).default([]),
  team: z.array(ProjectTeamMemberSchema).max(100).default([]),
});

/** Create a project. */
export const ProjectCreateSchema = ProjectBase.refine(
  (p) => !p.launch_date || !p.possession_date || p.launch_date <= p.possession_date,
  { message: "Possession date must be after launch date", path: ["possession_date"] },
);
export type ProjectCreate = z.infer<typeof ProjectCreateSchema>;

/** Update a project (partial + version). */
export const ProjectUpdateSchema = updateOf(ProjectBase);
export type ProjectUpdate = z.infer<typeof ProjectUpdateSchema>;

/** Project row. */
export const ProjectRowSchema = MasterRowSchema.extend({
  name: z.string(),
  code: z.string(),
  project_type: ProjectTypeSchema,
  status: ProjectStatusSchema,
  description: z.string().nullable(),
  address: AddressSchema,
  city: z.string(),
  rera_number: z.string().nullable(),
  launch_date: DateStringSchema.nullable(),
  possession_date: DateStringSchema.nullable(),
  land_area_sqft: z.number().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  landmarks: z.array(z.object({ name: z.string(), distance_km: z.number() })),
  approvals: z.array(
    z.object({
      name: z.string(),
      number: z.string().nullable(),
      issued_on: DateStringSchema.nullable(),
      status: ApprovalStatusSchema,
    }),
  ),
  escrow_bank_account_id: IdSchema.nullable(),
  stage_sequence: z.array(IdSchema),
  amenity_ids: z.array(IdSchema),
  team: z.array(z.object({ user_id: IdSchema, user_name: z.string(), role_label: z.string().nullable() })),
  unit_counts: UnitCountsSchema,
  block_count: z.int().min(0),
  construction_percent: z.number().min(0).max(100),
  is_published: z.boolean(),
});
export type ProjectRow = z.infer<typeof ProjectRowSchema>;

/** List filter for projects. */
export const ProjectFilterSchema = ListQuerySchema.extend({
  status: ProjectStatusSchema.optional(),
  project_type: ProjectTypeSchema.optional(),
  city: z.string().trim().max(80).optional(),
});
export type ProjectFilter = z.infer<typeof ProjectFilterSchema>;

export const ProjectListResponseSchema = listEnvelope(ProjectRowSchema);
export type ProjectListResponse = z.infer<typeof ProjectListResponseSchema>;

/** Replace a project's stage sequence (ordered stage ids). */
export const ProjectStageSequenceUpdateSchema = z.strictObject({
  ...VersionedSchema.shape,
  stage_sequence: z.array(IdSchema).min(1).max(100),
});
export type ProjectStageSequenceUpdate = z.infer<typeof ProjectStageSequenceUpdateSchema>;

/** Project summary card used by dashboards and command palette. */
export const ProjectSummarySchema = z.object({
  id: IdSchema,
  name: z.string(),
  code: z.string(),
  status: ProjectStatusSchema,
  unit_counts: UnitCountsSchema,
  construction_percent: z.number(),
});
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;
