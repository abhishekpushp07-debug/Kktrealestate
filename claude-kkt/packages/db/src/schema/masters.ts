// B. Masters
import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { idColumn, mutable, paise, percent, softDelete, sqft, versioned } from "./_common.js";
import { chargeDemandAtEnum, planTypeEnum, plcCalcModeEnum, servicePriorityEnum, triggerTypeEnum } from "./enums.js";
import { companies } from "./identity.js";
import type { FlatTypeArea, FlatTypeRoom, FloorPlanPosition } from "./json.js";

const companyId = () =>
  uuid("company_id")
    .notNull()
    .references(() => companies.id);

export const roomTypes = pgTable(
  "room_types",
  {
    id: idColumn(),
    companyId: companyId(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    ...softDelete(),
    ...mutable(),
  },
  (t) => [unique("room_types_company_code_uq").on(t.companyId, t.code)],
);

export const areaTypes = pgTable(
  "area_types",
  {
    id: idColumn(),
    companyId: companyId(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    ...softDelete(),
    ...mutable(),
  },
  (t) => [unique("area_types_company_code_uq").on(t.companyId, t.code)],
);

export const flatTypes = pgTable(
  "flat_types",
  {
    id: idColumn(),
    companyId: companyId(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    bhk: numeric("bhk", { precision: 3, scale: 1, mode: "number" }),
    facing: text("facing"),
    description: text("description"),
    rooms: jsonb("rooms").$type<FlatTypeRoom[]>().notNull().default([]),
    areas: jsonb("areas").$type<FlatTypeArea[]>().notNull().default([]),
    carpetSqft: sqft("carpet_sqft").notNull().default(0),
    builtupSqft: sqft("builtup_sqft").notNull().default(0),
    superBuiltupSqft: sqft("super_builtup_sqft").notNull().default(0),
    baseRatePerSqftPaise: paise("base_rate_per_sqft_paise"),
    basePricePaise: paise("base_price_paise"),
    specItemIds: uuid("spec_item_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    ...softDelete(),
    ...mutable(),
  },
  (t) => [
    unique("flat_types_company_code_uq").on(t.companyId, t.code),
    index("flat_types_rooms_gin_idx").using("gin", t.rooms),
    index("flat_types_areas_gin_idx").using("gin", t.areas),
  ],
);

export const blockTypes = pgTable(
  "block_types",
  {
    id: idColumn(),
    companyId: companyId(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    hasFloors: boolean("has_floors").notNull().default(true),
    ...softDelete(),
    ...mutable(),
  },
  (t) => [unique("block_types_company_code_uq").on(t.companyId, t.code)],
);

export const floorPlanTemplates = pgTable(
  "floor_plan_templates",
  {
    id: idColumn(),
    companyId: companyId(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    flatsPerFloor: integer("flats_per_floor").notNull(),
    positions: jsonb("positions").$type<FloorPlanPosition[]>().notNull().default([]),
    ...softDelete(),
    ...mutable(),
  },
  (t) => [
    unique("floor_plan_templates_company_code_uq").on(t.companyId, t.code),
    index("floor_plan_templates_positions_gin_idx").using("gin", t.positions),
  ],
);

export const amenities = pgTable(
  "amenities",
  {
    id: idColumn(),
    companyId: companyId(),
    name: text("name").notNull(),
    category: text("category"),
    icon: text("icon"),
    ...softDelete(),
    ...mutable(),
  },
  (t) => [unique("amenities_company_name_uq").on(t.companyId, t.name)],
);

export const constructionStages = pgTable(
  "construction_stages",
  {
    id: idColumn(),
    companyId: companyId(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isPossession: boolean("is_possession").notNull().default(false),
    ...softDelete(),
    ...mutable(),
  },
  (t) => [
    unique("construction_stages_company_code_uq").on(t.companyId, t.code),
    uniqueIndex("construction_stages_one_possession_uq")
      .on(t.companyId)
      .where(sql`${t.isPossession}`),
  ],
);

export const paymentPlans = pgTable(
  "payment_plans",
  {
    id: idColumn(),
    companyId: companyId(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    planType: planTypeEnum("plan_type").notNull(),
    description: text("description"),
    graceDays: integer("grace_days").notNull().default(0),
    ...softDelete(),
    ...mutable(),
  },
  (t) => [unique("payment_plans_company_code_uq").on(t.companyId, t.code)],
);

export const paymentPlanInstallments = pgTable(
  "payment_plan_installments",
  {
    id: idColumn(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => paymentPlans.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    name: text("name").notNull(),
    percent: percent("percent").notNull(),
    triggerType: triggerTypeEnum("trigger_type").notNull(),
    triggerDays: integer("trigger_days"),
    triggerStageId: uuid("trigger_stage_id").references(() => constructionStages.id),
    triggerDate: date("trigger_date"),
    dueDays: integer("due_days"),
    notes: text("notes"),
    ...versioned(),
  },
  (t) => [
    unique("payment_plan_installments_plan_seq_uq").on(t.planId, t.seq),
    index("payment_plan_installments_trigger_stage_id_idx").on(t.triggerStageId),
  ],
);

export const chargeTypes = pgTable(
  "charge_types",
  {
    id: idColumn(),
    companyId: companyId(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    defaultAmountPaise: paise("default_amount_paise").notNull().default(0),
    isTaxable: boolean("is_taxable").notNull().default(false),
    defaultGstPercent: percent("default_gst_percent").notNull().default(0),
    demandAt: chargeDemandAtEnum("demand_at").notNull().default("MANUAL"),
    ...softDelete(),
    ...mutable(),
  },
  (t) => [unique("charge_types_company_code_uq").on(t.companyId, t.code)],
);

export const paymentModes = pgTable(
  "payment_modes",
  {
    id: idColumn(),
    companyId: companyId(),
    name: text("name").notNull(),
    /** Enum-like text: CASH, CHEQUE, NEFT_RTGS, UPI, DD, LOAN_DISBURSEMENT. */
    code: text("code").notNull(),
    requiresInstrument: boolean("requires_instrument").notNull().default(false),
    clearsImmediately: boolean("clears_immediately").notNull().default(true),
    isCash: boolean("is_cash").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    ...softDelete(),
    ...mutable(),
  },
  (t) => [unique("payment_modes_company_code_uq").on(t.companyId, t.code)],
);

export const bankAccounts = pgTable(
  "bank_accounts",
  {
    id: idColumn(),
    companyId: companyId(),
    bankName: text("bank_name").notNull(),
    branch: text("branch"),
    accountName: text("account_name").notNull(),
    accountNumberEnc: text("account_number_enc").notNull(),
    accountNumberLast4: text("account_number_last4").notNull(),
    ifsc: text("ifsc").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    isEscrow: boolean("is_escrow").notNull().default(false),
    ...softDelete(),
    ...mutable(),
  },
  (t) => [
    uniqueIndex("bank_accounts_one_default_uq")
      .on(t.companyId)
      .where(sql`${t.isDefault}`),
    index("bank_accounts_company_id_idx").on(t.companyId),
  ],
);

export const documentTypes = pgTable(
  "document_types",
  {
    id: idColumn(),
    companyId: companyId(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    /** Entity kinds this type applies to: CUSTOMER, BOOKING, PROJECT, BLOCK, FLAT, PAYMENT. */
    appliesTo: text("applies_to")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    isKyc: boolean("is_kyc").notNull().default(false),
    ...softDelete(),
    ...mutable(),
  },
  (t) => [unique("document_types_company_code_uq").on(t.companyId, t.code)],
);

export const plcTypes = pgTable(
  "plc_types",
  {
    id: idColumn(),
    companyId: companyId(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    calcMode: plcCalcModeEnum("calc_mode").notNull(),
    ...softDelete(),
    ...mutable(),
  },
  (t) => [unique("plc_types_company_code_uq").on(t.companyId, t.code)],
);

export const specCategories = pgTable(
  "spec_categories",
  {
    id: idColumn(),
    companyId: companyId(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    ...softDelete(),
    ...mutable(),
  },
  (t) => [index("spec_categories_company_idx").on(t.companyId)],
);

export const specItems = pgTable(
  "spec_items",
  {
    id: idColumn(),
    companyId: companyId(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => specCategories.id),
    name: text("name").notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),
    ...softDelete(),
    ...mutable(),
  },
  (t) => [
    index("spec_items_category_idx").on(t.categoryId, t.sortOrder),
    index("spec_items_company_id_idx").on(t.companyId),
  ],
);

export const serviceCategories = pgTable(
  "service_categories",
  {
    id: idColumn(),
    companyId: companyId(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    defaultPriority: servicePriorityEnum("default_priority").notNull().default("MEDIUM"),
    ...softDelete(),
    ...mutable(),
  },
  (t) => [index("service_categories_company_idx").on(t.companyId)],
);
