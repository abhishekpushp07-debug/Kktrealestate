import { z } from "zod";
import { PlcAppliesToSchema, PlcCalcModeSchema, RateCardStatusSchema } from "../enums.js";
import {
  AuditedRowSchema,
  DateStringSchema,
  IdSchema,
  hasMaxDecimals,
  ListQuerySchema,
  MoneyBreakupLineSchema,
  NameSchema,
  PaiseSchema,
  VersionedSchema,
  listEnvelope,
  updateOf,
} from "../common.js";

/** Rate for one flat type: exactly one of rate per sq ft or lump sum. */
export const RateCardRateSchema = z
  .strictObject({
    flat_type_id: IdSchema,
    rate_per_sqft_paise: PaiseSchema.optional().nullable(),
    lump_sum_paise: PaiseSchema.optional().nullable(),
  })
  .refine((r) => ((r.rate_per_sqft_paise ?? null) !== null) !== ((r.lump_sum_paise ?? null) !== null), {
    message: "Give either rate_per_sqft_paise or lump_sum_paise",
    path: ["rate_per_sqft_paise"],
  });
export type RateCardRate = z.infer<typeof RateCardRateSchema>;

/** A PLC rule: type, value and the condition the flat must satisfy. */
export const PlcRuleSchema = z
  .strictObject({
    plc_type_id: IdSchema,
    calc_mode: PlcCalcModeSchema,
    value: z.number().min(0).max(1e13),
    applies_to: PlcAppliesToSchema,
    floors_gte: z.int().min(-5).max(200).optional().nullable(),
    facings: z.array(z.string().trim().min(1).max(40)).max(20).optional().nullable(),
    sort_order: z.int().min(0).max(1000).default(0),
  })
  .superRefine((r, ctx) => {
    if (r.calc_mode === "PERCENT" && r.value > 100) {
      ctx.addIssue({ code: "custom", message: "Percent PLC cannot exceed 100", path: ["value"] });
    }
    // the pricing engine works in basis points (packages/domain toBasisPoints): a third decimal would fail every price later
    if (r.calc_mode === "PERCENT" && !hasMaxDecimals(r.value, 2)) {
      ctx.addIssue({ code: "custom", message: "A percent PLC has at most 2 decimal places", path: ["value"] });
    }
    if (r.calc_mode !== "PERCENT" && !Number.isSafeInteger(r.value)) {
      ctx.addIssue({
        code: "custom",
        message: "FIXED, per-sq-ft and floor-rise PLC values are whole paise (integers)",
        path: ["value"],
      });
    }
    if (r.applies_to === "FLOORS_GTE" && (r.floors_gte === undefined || r.floors_gte === null)) {
      ctx.addIssue({ code: "custom", message: "floors_gte is required for FLOORS_GTE", path: ["floors_gte"] });
    }
    if (r.applies_to === "FACING_IN" && (!r.facings || r.facings.length === 0)) {
      ctx.addIssue({ code: "custom", message: "facings is required for FACING_IN", path: ["facings"] });
    }
  });
export type PlcRule = z.infer<typeof PlcRuleSchema>;

const RateCardBase = z.strictObject({
  project_id: IdSchema,
  name: NameSchema,
  effective_from: DateStringSchema,
  rates: z.array(RateCardRateSchema).min(1).max(100),
  plc_rules: z.array(PlcRuleSchema).max(50).default([]),
});

/** Create a rate card (Draft). */
export const RateCardCreateSchema = RateCardBase.refine(
  (c) => new Set(c.rates.map((r) => r.flat_type_id)).size === c.rates.length,
  { message: "Each flat type once", path: ["rates"] },
);
export type RateCardCreate = z.infer<typeof RateCardCreateSchema>;

/** Update a Draft rate card. */
export const RateCardUpdateSchema = updateOf(RateCardBase.omit({ project_id: true }));
export type RateCardUpdate = z.infer<typeof RateCardUpdateSchema>;

/** Rate card row with rates and PLC rules. */
export const RateCardRowSchema = AuditedRowSchema.extend({
  project_id: IdSchema,
  name: z.string(),
  effective_from: DateStringSchema,
  status: RateCardStatusSchema,
  activated_at: z.string().nullable(),
  superseded_at: z.string().nullable(),
  rates: z.array(
    z.object({
      flat_type_id: IdSchema,
      flat_type_code: z.string(),
      flat_type_name: z.string(),
      rate_per_sqft_paise: PaiseSchema.nullable(),
      lump_sum_paise: PaiseSchema.nullable(),
    }),
  ),
  plc_rules: z.array(
    z.object({
      plc_type_id: IdSchema,
      plc_type_name: z.string(),
      calc_mode: PlcCalcModeSchema,
      value: z.number(),
      applies_to: PlcAppliesToSchema,
      floors_gte: z.int().nullable(),
      facings: z.array(z.string()).nullable(),
      sort_order: z.int(),
    }),
  ),
});
export type RateCardRow = z.infer<typeof RateCardRowSchema>;

/** List filter for rate cards. */
export const RateCardFilterSchema = ListQuerySchema.extend({
  project_id: IdSchema.optional(),
  status: RateCardStatusSchema.optional(),
});
export type RateCardFilter = z.infer<typeof RateCardFilterSchema>;

export const RateCardListResponseSchema = listEnvelope(RateCardRowSchema);
export type RateCardListResponse = z.infer<typeof RateCardListResponseSchema>;

/** Activate a Draft rate card (supersedes the current Active one). */
export const RateCardActivateSchema = z.strictObject({
  ...VersionedSchema.shape,
  apply_to_available_flats: z.boolean().default(true),
});
export type RateCardActivate = z.infer<typeof RateCardActivateSchema>;

/** Apply the Active rate card: re-prices ONLY Available flats. */
export const RateCardApplySchema = z.strictObject({
  block_id: IdSchema.optional(),
  dry_run: z.boolean().default(false),
});
export type RateCardApply = z.infer<typeof RateCardApplySchema>;

export const RateCardApplyResponseSchema = z.object({
  rate_card_id: IdSchema,
  dry_run: z.boolean(),
  repriced: z.int().min(0),
  skipped_not_available: z.int().min(0),
  skipped_no_rate: z.int().min(0),
});
export type RateCardApplyResponse = z.infer<typeof RateCardApplyResponseSchema>;

/** Price preview for one flat against a rate card (or the Active one). */
export const PricePreviewQuerySchema = z.object({ flat_id: IdSchema, rate_card_id: IdSchema.optional() });
export type PricePreviewQuery = z.infer<typeof PricePreviewQuerySchema>;

export const PricePreviewResponseSchema = z.object({
  flat_id: IdSchema,
  rate_card_id: IdSchema.nullable(),
  base_paise: PaiseSchema,
  breakup: z.array(MoneyBreakupLineSchema),
  total_paise: PaiseSchema,
});
export type PricePreviewResponse = z.infer<typeof PricePreviewResponseSchema>;

/**
 * Price preview request (POST /rate-cards/preview): either an existing flat (`flat_id`) or a hypothetical flat
 * (`flat_type_id` + `floor` + optional `facing` / `is_corner`) within a project, against a given rate card or the Active one.
 */
export const RateCardPreviewRequestSchema = z
  .strictObject({
    project_id: IdSchema,
    rate_card_id: IdSchema.optional().nullable(),
    flat_id: IdSchema.optional().nullable(),
    flat_type_id: IdSchema.optional().nullable(),
    floor: z.int().min(-5).max(200).optional().nullable(),
    floor_start: z.int().min(-5).max(200).optional().nullable(),
    facing: z.string().trim().max(40).optional().nullable(),
    is_corner: z.boolean().optional().nullable(),
  })
  .superRefine((p, ctx) => {
    const hasFlat = p.flat_id !== undefined && p.flat_id !== null;
    const hasType = p.flat_type_id !== undefined && p.flat_type_id !== null;
    if (hasFlat === hasType) {
      ctx.addIssue({ code: "custom", message: "Give either flat_id or flat_type_id (+ floor)", path: ["flat_id"] });
    }
    if (hasType && (p.floor === undefined || p.floor === null)) {
      ctx.addIssue({ code: "custom", message: "floor is required with flat_type_id", path: ["floor"] });
    }
  });
export type RateCardPreviewRequest = z.infer<typeof RateCardPreviewRequestSchema>;

/** Price preview result: base line, PLC lines and total; `rate_card_id` is null when the flat type's base price was used. */
export const RateCardPreviewResponseSchema = z.object({
  project_id: IdSchema,
  flat_id: IdSchema.nullable(),
  flat_type_id: IdSchema,
  flat_type_code: z.string(),
  floor: z.int(),
  facing: z.string().nullable(),
  is_corner: z.boolean(),
  super_builtup_sqft: z.number(),
  rate_card_id: IdSchema.nullable(),
  rate_card_name: z.string().nullable(),
  base_paise: PaiseSchema,
  rate_per_sqft_paise: PaiseSchema.nullable(),
  breakup: z.array(MoneyBreakupLineSchema),
  total_paise: PaiseSchema,
});
export type RateCardPreviewResponse = z.infer<typeof RateCardPreviewResponseSchema>;
