import { z } from "zod";

/**
 * Every business-rule id the API raises inside 422 BUSINESS_RULE (`details.rule`). `ApiError.rule()` (apps/api/src/lib/errors.ts)
 * takes a {@link RuleId}, so an unregistered id does not compile, and apps/api/test/unit/error-registry.test.ts scans the API source for
 * rule literals as a second guard. Clients may switch on these ids; an id they do not know yet is shown with the server's message.
 * Append new ids; never rename one (VERSIONING.md: additive within /api/v1).
 */
export const BUSINESS_RULES = [
  // master data is selectable only while active
  "AMENITY_INACTIVE",
  "AREA_TYPE_INACTIVE",
  "BANK_ACCOUNT_INACTIVE",
  "BLOCK_TYPE_INACTIVE",
  "CATEGORY_INACTIVE",
  "CHARGE_TYPE_INACTIVE",
  "CUSTOMER_INACTIVE",
  "FLAT_TYPE_INACTIVE",
  "PAYMENT_MODE_INACTIVE",
  "PLAN_INACTIVE",
  "PLC_TYPE_INACTIVE",
  "PROJECT_INACTIVE",
  "ROLE_INACTIVE",
  "ROOM_TYPE_INACTIVE",
  "TEMPLATE_INACTIVE",
  "ASSIGNEE_INACTIVE",
  "DOCUMENT_TYPE_NOT_APPLICABLE",
  // inventory, flat generation and pricing (packages/domain FlatGenerationError / PricingError codes included)
  "STAGES_STARTED",
  "REGENERATE_REQUIRED",
  "FLAT_TYPE_INVALID",
  "FLAT_NOT_AVAILABLE",
  "FLATS_NOT_AVAILABLE",
  "NOT_ON_HOLD",
  "PRICE_FROZEN",
  "ENGINE_STATUS",
  "INVALID_STATUS_TRANSITION",
  "INVALID_FLOORS",
  "FLOOR_PLAN_GAP",
  "FLOOR_PLAN_OVERLAP",
  "TEMPLATE_NOT_FOUND",
  "FLAT_TYPE_NOT_FOUND",
  "DUPLICATE_FLAT_NUMBER",
  "INVALID_FLAT_TYPE",
  "INVALID_PATTERN",
  "NO_RATE_FOR_FLAT_TYPE",
  "INVALID_RATE",
  "INVALID_RULE",
  "RATE_CARD_ALREADY_ACTIVE",
  "RATE_CARD_EMPTY",
  "RATE_CARD_NOT_ACTIVE",
  "RATE_CARD_NOT_DRAFT",
  "RATE_CARD_SUPERSEDED",
  // bookings, plans, payments
  "BOOKING_DATE_FUTURE",
  "PRICE_DEVIATION_NOT_ALLOWED",
  "SAME_PLAN",
  "PAYMENT_PLAN_INVALID",
  "PAYMENT_DATE_FUTURE",
  "PAYMENT_DATE_BEFORE_BOOKING",
  "REFUND_PLUS_DEDUCTION",
  // construction
  "STAGE_ALREADY_COMPLETED",
  "STAGE_COMPLETED",
  "STAGE_NOT_COMPLETED",
  "SAME_STAGE",
  // customers, KYC, portal, erasure
  "CUSTOMER_ERASED",
  "ALREADY_ERASED",
  "KYC_STATUS_INVALID",
  "KYC_NOT_SHAREABLE",
  "PORTAL_ALREADY_ENABLED",
  "PORTAL_ALREADY_DISABLED",
  "PORTAL_NOT_ENABLED",
  // leads and site visits
  "LEAD_CLOSED",
  "LOST_REASON_REQUIRED",
  "USE_CONVERT",
  "VISITS_DISABLED",
  "VISIT_CANCELLED",
  "VISIT_CLOSED",
  "VISIT_PAST",
  "SLOT_INVALID",
  "SAME_SLOT",
  "OUTCOME_MARKED",
  // service requests
  "TICKET_NOT_RESOLVED",
  // auth / MFA
  "MFA_CODE_INVALID",
  "MFA_NOT_ENABLED",
  "MFA_NOT_PENDING",
  // admin tools, import
  "IMPORT_HAS_ERRORS",
  "JOB_NOT_REGISTERED",
  "RESEED_DISABLED",
  "NO_CHANGE",
] as const;

/** A registered business-rule id. */
export type RuleId = (typeof BUSINESS_RULES)[number];

/** Zod schema for a registered rule id. */
export const RuleIdSchema = z.enum(BUSINESS_RULES);

/** True when `id` is a registered business-rule id. */
export function isKnownRuleId(id: string): id is RuleId {
  return (BUSINESS_RULES as readonly string[]).includes(id);
}
