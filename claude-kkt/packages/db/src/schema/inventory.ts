// C. Projects & inventory (plus user_project_scopes, which references projects)
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { appendOnly, idColumn, mutable, paise, percent, softDelete, sqft, trgm, versioned } from "./_common.js";
import { documents } from "./documents.js";
import {
  flatStatusEnum,
  parkingStatusEnum,
  parkingTypeEnum,
  plcAppliesToEnum,
  plcCalcModeEnum,
  projectStatusEnum,
  projectTypeEnum,
  rateCardStatusEnum,
  stageStatusEnum,
} from "./enums.js";
import { companies, users } from "./identity.js";
import type {
  Address,
  Approval,
  Faq,
  FlatTypeArea,
  FlatTypeRoom,
  FloorPlanRange,
  Landmark,
  PriceBreakupLine,
  Seo,
  UnitCounts,
} from "./json.js";
import { amenities, bankAccounts, blockTypes, constructionStages, flatTypes, plcTypes } from "./masters.js";

const companyId = () =>
  uuid("company_id")
    .notNull()
    .references(() => companies.id);

const emptyUnitCounts: UnitCounts = { available: 0, hold: 0, blocked: 0, booked: 0, sold: 0, total: 0 };

export const projects = pgTable(
  "projects",
  {
    id: idColumn(),
    companyId: companyId(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    projectType: projectTypeEnum("project_type").notNull().default("RESIDENTIAL"),
    status: projectStatusEnum("status").notNull().default("PLANNING"),
    description: text("description"),
    address: jsonb("address").$type<Address>(),
    city: text("city"),
    reraNumber: text("rera_number"),
    launchDate: date("launch_date"),
    possessionDate: date("possession_date"),
    landAreaSqft: numeric("land_area_sqft", { precision: 14, scale: 2, mode: "number" }),
    latitude: numeric("latitude", { precision: 9, scale: 6, mode: "number" }),
    longitude: numeric("longitude", { precision: 9, scale: 6, mode: "number" }),
    landmarks: jsonb("landmarks").$type<Landmark[]>().notNull().default([]),
    approvals: jsonb("approvals").$type<Approval[]>().notNull().default([]),
    escrowBankAccountId: uuid("escrow_bank_account_id").references(() => bankAccounts.id),
    stageSequence: uuid("stage_sequence")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    unitCounts: jsonb("unit_counts").$type<UnitCounts>().notNull().default(emptyUnitCounts),
    blockCount: integer("block_count").notNull().default(0),
    ...softDelete(),
    ...mutable(),
  },
  (t) => [
    unique("projects_company_code_uq").on(t.companyId, t.code),
    index("projects_company_status_idx").on(t.companyId, t.status),
    trgm("projects_name_trgm_idx", t.name),
    index("projects_escrow_bank_account_id_idx").on(t.escrowBankAccountId),
  ],
);

export const projectAmenities = pgTable(
  "project_amenities",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    amenityId: uuid("amenity_id")
      .notNull()
      .references(() => amenities.id),
    ...appendOnly(),
  },
  (t) => [
    primaryKey({ name: "project_amenities_pk", columns: [t.projectId, t.amenityId] }),
    index("project_amenities_amenity_id_idx").on(t.amenityId),
  ],
);

export const projectTeam = pgTable(
  "project_team",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    roleLabel: text("role_label"),
    ...appendOnly(),
  },
  (t) => [
    primaryKey({ name: "project_team_pk", columns: [t.projectId, t.userId] }),
    index("project_team_user_id_idx").on(t.userId),
  ],
);

/** Identity table (DATA-MODEL §A) kept here because it references `projects`. */
export const userProjectScopes = pgTable(
  "user_project_scopes",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    ...appendOnly(),
  },
  (t) => [
    primaryKey({ name: "user_project_scopes_pk", columns: [t.userId, t.projectId] }),
    index("user_project_scopes_project_id_idx").on(t.projectId),
  ],
);

export const projectWebsiteSettings = pgTable(
  "project_website_settings",
  {
    projectId: uuid("project_id")
      .primaryKey()
      .references(() => projects.id, { onDelete: "cascade" }),
    isPublished: boolean("is_published").notNull().default(false),
    slug: text("slug"),
    showPrices: boolean("show_prices").notNull().default(false),
    showAvailability: boolean("show_availability").notNull().default(true),
    showProgress: boolean("show_progress").notNull().default(true),
    startingPriceOverridePaise: paise("starting_price_override_paise"),
    heroDocumentIds: uuid("hero_document_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    highlights: jsonb("highlights").$type<string[]>().notNull().default([]),
    videoUrls: text("video_urls")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    tourUrls: text("tour_urls")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    mapEmbedUrl: text("map_embed_url"),
    brochureDocumentId: uuid("brochure_document_id"),
    faqs: jsonb("faqs").$type<Faq[]>().notNull().default([]),
    seo: jsonb("seo").$type<Seo>().notNull().default({}),
    brochureDownloadCount: integer("brochure_download_count").notNull().default(0),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    ...mutable(),
  },
  (t) => [unique("project_website_settings_slug_uq").on(t.slug)],
);

export const projectVisitSettings = pgTable(
  "project_visit_settings",
  {
    projectId: uuid("project_id")
      .primaryKey()
      .references(() => projects.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    /** 0 = Sunday … 6 = Saturday. */
    visitDays: integer("visit_days")
      .array()
      .notNull()
      .default(sql`'{1,2,3,4,5,6}'::integer[]`),
    startTime: time("start_time").notNull().default("10:00"),
    endTime: time("end_time").notNull().default("18:00"),
    slotMinutes: integer("slot_minutes").notNull().default(60),
    seatsPerSlot: integer("seats_per_slot").notNull().default(2),
    minLeadHours: integer("min_lead_hours").notNull().default(4),
    maxDaysAhead: integer("max_days_ahead").notNull().default(14),
    blackoutDates: date("blackout_dates")
      .array()
      .notNull()
      .default(sql`'{}'::date[]`),
    siteOfficeAddress: text("site_office_address"),
    mapsLink: text("maps_link"),
    instructions: text("instructions"),
    ...mutable(),
  },
  (t) => [check("project_visit_settings_slot_minutes_chk", sql`${t.slotMinutes} IN (30, 60)`)],
);

export const blocks = pgTable(
  "blocks",
  {
    id: idColumn(),
    companyId: companyId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    blockTypeId: uuid("block_type_id")
      .notNull()
      .references(() => blockTypes.id),
    name: text("name").notNull(),
    code: text("code").notNull(),
    floors: integer("floors").notNull().default(1),
    floorStart: integer("floor_start").notNull().default(1),
    groundFloorLabel: text("ground_floor_label"),
    skipFloors: integer("skip_floors")
      .array()
      .notNull()
      .default(sql`'{}'::integer[]`),
    refugeFloors: integer("refuge_floors")
      .array()
      .notNull()
      .default(sql`'{}'::integer[]`),
    podiumFloors: integer("podium_floors")
      .array()
      .notNull()
      .default(sql`'{}'::integer[]`),
    floorPlans: jsonb("floor_plans").$type<FloorPlanRange[]>().notNull().default([]),
    numberingPattern: text("numbering_pattern").notNull().default("{block}-{floor}{pos2}"),
    stageSequence: uuid("stage_sequence")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    constructionPercent: percent("construction_percent").notNull().default(0),
    unitCounts: jsonb("unit_counts").$type<UnitCounts>().notNull().default(emptyUnitCounts),
    status: projectStatusEnum("status").notNull().default("PLANNING"),
    sortOrder: integer("sort_order").notNull().default(0),
    ...softDelete(),
    ...mutable(),
  },
  (t) => [
    unique("blocks_project_code_uq").on(t.projectId, t.code),
    index("blocks_company_project_idx").on(t.companyId, t.projectId),
    index("blocks_floor_plans_gin_idx").using("gin", t.floorPlans),
    trgm("blocks_name_trgm_idx", t.name),
    index("blocks_block_type_id_idx").on(t.blockTypeId),
  ],
);

export const blockStages = pgTable(
  "block_stages",
  {
    id: idColumn(),
    companyId: companyId(),
    blockId: uuid("block_id")
      .notNull()
      .references(() => blocks.id, { onDelete: "cascade" }),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => constructionStages.id),
    sortOrder: integer("sort_order").notNull(),
    name: text("name").notNull(),
    isPossession: boolean("is_possession").notNull().default(false),
    status: stageStatusEnum("status").notNull().default("PENDING"),
    startedOn: date("started_on"),
    completedOn: date("completed_on"),
    completedBy: uuid("completed_by"),
    notes: text("notes"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...mutable(),
  },
  (t) => [
    unique("block_stages_block_stage_uq").on(t.blockId, t.stageId),
    index("block_stages_block_sort_idx").on(t.blockId, t.sortOrder),
    index("block_stages_company_id_idx").on(t.companyId),
    index("block_stages_stage_id_idx").on(t.stageId),
  ],
);

export const stagePhotos = pgTable(
  "stage_photos",
  {
    id: idColumn(),
    companyId: companyId(),
    blockStageId: uuid("block_stage_id")
      .notNull()
      .references(() => blockStages.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
    caption: text("caption"),
    visibleToBuyers: boolean("visible_to_buyers").notNull().default(false),
    showOnWebsite: boolean("show_on_website").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    ...mutable(),
  },
  (t) => [
    index("stage_photos_block_stage_idx").on(t.blockStageId, t.sortOrder),
    index("stage_photos_company_id_idx").on(t.companyId),
    index("stage_photos_document_id_idx").on(t.documentId),
  ],
);

export const flats = pgTable(
  "flats",
  {
    id: idColumn(),
    companyId: companyId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    blockId: uuid("block_id")
      .notNull()
      .references(() => blocks.id, { onDelete: "cascade" }),
    flatNumber: text("flat_number").notNull(),
    floor: integer("floor").notNull(),
    floorLabel: text("floor_label"),
    position: integer("position").notNull().default(1),
    flatTypeId: uuid("flat_type_id")
      .notNull()
      .references(() => flatTypes.id),
    flatTypeCode: text("flat_type_code").notNull(),
    facing: text("facing"),
    isCorner: boolean("is_corner").notNull().default(false),
    status: flatStatusEnum("status").notNull().default("AVAILABLE"),
    roomsSnapshot: jsonb("rooms_snapshot").$type<FlatTypeRoom[]>().notNull().default([]),
    areasSnapshot: jsonb("areas_snapshot").$type<FlatTypeArea[]>().notNull().default([]),
    carpetSqft: sqft("carpet_sqft").notNull().default(0),
    builtupSqft: sqft("builtup_sqft").notNull().default(0),
    superBuiltupSqft: sqft("super_builtup_sqft").notNull().default(0),
    ratePerSqftPaise: paise("rate_per_sqft_paise"),
    pricePaise: paise("price_paise").notNull().default(0),
    priceBreakup: jsonb("price_breakup").$type<PriceBreakupLine[]>().notNull().default([]),
    rateCardId: uuid("rate_card_id"),
    /** Set by the booking engine only; no FK to avoid a flats ↔ bookings cycle. */
    bookingId: uuid("booking_id"),
    holdByUserId: uuid("hold_by_user_id"),
    holdUntil: timestamp("hold_until", { withTimezone: true }),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
    statusChangedBy: uuid("status_changed_by"),
    notes: text("notes"),
    ...mutable(),
  },
  (t) => [
    unique("flats_block_number_uq").on(t.blockId, t.flatNumber),
    index("flats_project_status_idx").on(t.projectId, t.status),
    index("flats_block_floor_position_idx").on(t.blockId, t.floor, t.position),
    index("flats_company_status_type_idx").on(t.companyId, t.status, t.flatTypeId),
    // Expired-hold sweep: only HOLD rows, ordered by expiry.
    index("flats_hold_until_idx")
      .on(t.status, t.holdUntil)
      .where(sql`${t.status} = 'HOLD'`),
    trgm("flats_flat_number_trgm_idx", t.flatNumber),
    check(
      "flats_price_nonneg_chk",
      sql`${t.pricePaise} >= 0 AND (${t.ratePerSqftPaise} IS NULL OR ${t.ratePerSqftPaise} >= 0)`,
    ),
    index("flats_flat_type_id_idx").on(t.flatTypeId),
  ],
);

export const parkingSlots = pgTable(
  "parking_slots",
  {
    id: idColumn(),
    companyId: companyId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    number: text("number").notNull(),
    slotType: parkingTypeEnum("slot_type").notNull().default("OPEN"),
    level: text("level"),
    pricePaise: paise("price_paise").notNull().default(0),
    status: parkingStatusEnum("status").notNull().default("AVAILABLE"),
    bookingId: uuid("booking_id"),
    ...mutable(),
  },
  (t) => [
    unique("parking_slots_project_number_uq").on(t.projectId, t.number),
    index("parking_slots_project_status_idx").on(t.projectId, t.status),
    check("parking_slots_price_nonneg_chk", sql`${t.pricePaise} >= 0`),
    index("parking_slots_company_id_idx").on(t.companyId),
  ],
);

export const rateCards = pgTable(
  "rate_cards",
  {
    id: idColumn(),
    companyId: companyId(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    name: text("name").notNull(),
    effectiveFrom: date("effective_from").notNull(),
    status: rateCardStatusEnum("status").notNull().default("DRAFT"),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    ...mutable(),
  },
  (t) => [
    uniqueIndex("rate_cards_one_active_uq")
      .on(t.projectId)
      .where(sql`${t.status} = 'ACTIVE'`),
    index("rate_cards_project_idx").on(t.projectId, t.effectiveFrom.desc().nullsFirst()),
    index("rate_cards_company_id_idx").on(t.companyId),
  ],
);

export const rateCardRates = pgTable(
  "rate_card_rates",
  {
    id: idColumn(),
    rateCardId: uuid("rate_card_id")
      .notNull()
      .references(() => rateCards.id, { onDelete: "cascade" }),
    flatTypeId: uuid("flat_type_id")
      .notNull()
      .references(() => flatTypes.id),
    ratePerSqftPaise: paise("rate_per_sqft_paise"),
    lumpSumPaise: paise("lump_sum_paise"),
    ...versioned(),
  },
  (t) => [
    unique("rate_card_rates_card_type_uq").on(t.rateCardId, t.flatTypeId),
    index("rate_card_rates_flat_type_id_idx").on(t.flatTypeId),
  ],
);

export const rateCardPlcRules = pgTable(
  "rate_card_plc_rules",
  {
    id: idColumn(),
    rateCardId: uuid("rate_card_id")
      .notNull()
      .references(() => rateCards.id, { onDelete: "cascade" }),
    plcTypeId: uuid("plc_type_id")
      .notNull()
      .references(() => plcTypes.id),
    calcMode: plcCalcModeEnum("calc_mode").notNull(),
    /** Paise for PER_SQFT/FIXED/FLOOR_RISE, percent for PERCENT. */
    value: numeric("value", { precision: 14, scale: 4, mode: "number" }).notNull(),
    appliesTo: plcAppliesToEnum("applies_to").notNull().default("ALL"),
    floorsGte: integer("floors_gte"),
    facings: text("facings")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    sortOrder: integer("sort_order").notNull().default(0),
    ...versioned(),
  },
  (t) => [
    index("rate_card_plc_rules_card_idx").on(t.rateCardId, t.sortOrder),
    index("rate_card_plc_rules_plc_type_id_idx").on(t.plcTypeId),
  ],
);
