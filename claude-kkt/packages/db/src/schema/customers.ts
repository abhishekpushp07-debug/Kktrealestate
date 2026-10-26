// D. Customers & portal identity
import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { idColumn, mutable, timestamps, trgm } from "./_common.js";
import { genderEnum, kycStatusEnum } from "./enums.js";
import { companies, users } from "./identity.js";
import type { Address, BankDetails, Nominee } from "./json.js";

const companyId = () =>
  uuid("company_id")
    .notNull()
    .references(() => companies.id);

export const customers = pgTable(
  "customers",
  {
    id: idColumn(),
    companyId: companyId(),
    customerCode: text("customer_code").notNull(),
    salutation: text("salutation"),
    fullName: text("full_name").notNull(),
    fatherOrSpouseName: text("father_or_spouse_name"),
    dob: date("dob"),
    gender: genderEnum("gender"),
    /** 10-digit canonical Indian mobile number. */
    phone: text("phone").notNull(),
    altPhone: text("alt_phone"),
    email: text("email"),
    addressCurrent: jsonb("address_current").$type<Address>(),
    addressPermanent: jsonb("address_permanent").$type<Address>(),
    sameAsCurrent: boolean("same_as_current").notNull().default(true),
    occupation: text("occupation"),
    companyName: text("company_name"),
    incomeBand: text("income_band"),
    source: text("source"),
    relationshipManagerId: uuid("relationship_manager_id").references(() => users.id),
    panEnc: text("pan_enc"),
    panHash: text("pan_hash"),
    panLast4: text("pan_last4"),
    aadhaarEnc: text("aadhaar_enc"),
    aadhaarHash: text("aadhaar_hash"),
    aadhaarLast4: text("aadhaar_last4"),
    bank: jsonb("bank").$type<BankDetails>(),
    nominee: jsonb("nominee").$type<Nominee>(),
    kycStatus: kycStatusEnum("kyc_status").notNull().default("PENDING"),
    kycSubmittedBy: uuid("kyc_submitted_by"),
    kycSubmittedAt: timestamp("kyc_submitted_at", { withTimezone: true }),
    kycVerifiedBy: uuid("kyc_verified_by"),
    kycVerifiedAt: timestamp("kyc_verified_at", { withTimezone: true }),
    kycRemarks: text("kyc_remarks"),
    notes: text("notes"),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    isActive: boolean("is_active").notNull().default(true),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    erasedAt: timestamp("erased_at", { withTimezone: true }),
    ...mutable(),
  },
  (t) => [
    unique("customers_company_code_uq").on(t.companyId, t.customerCode),
    index("customers_company_phone_idx").on(t.companyId, t.phone),
    index("customers_company_pan_hash_idx").on(t.companyId, t.panHash),
    index("customers_company_full_name_idx").on(t.companyId, t.fullName),
    index("customers_company_created_idx").on(t.companyId, t.createdAt.desc(), t.id.desc()),
    // Database twin of crm/customerService.ts assertNoDuplicate: one live (not erased) customer per phone and per PAN in a company.
    uniqueIndex("customers_company_phone_live_uq")
      .on(t.companyId, t.phone)
      .where(sql`${t.erasedAt} IS NULL`),
    uniqueIndex("customers_company_pan_hash_live_uq")
      .on(t.companyId, t.panHash)
      .where(sql`${t.erasedAt} IS NULL AND ${t.panHash} IS NOT NULL`),
    trgm("customers_full_name_trgm_idx", t.fullName),
    trgm("customers_phone_trgm_idx", t.phone),
    trgm("customers_customer_code_trgm_idx", t.customerCode),
    trgm("customers_email_trgm_idx", t.email),
  ],
);

export const coApplicants = pgTable(
  "co_applicants",
  {
    id: idColumn(),
    companyId: companyId(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    fullName: text("full_name").notNull(),
    relation: text("relation"),
    phone: text("phone"),
    email: text("email"),
    panEnc: text("pan_enc"),
    panHash: text("pan_hash"),
    panLast4: text("pan_last4"),
    aadhaarEnc: text("aadhaar_enc"),
    aadhaarLast4: text("aadhaar_last4"),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps(),
    version: integer("version").notNull().default(1),
  },
  (t) => [index("co_applicants_customer_idx").on(t.customerId, t.sortOrder)],
);

export const portalUsers = pgTable(
  "portal_users",
  {
    id: idColumn(),
    companyId: companyId(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id)
      .unique("portal_users_customer_uq"),
    phone: text("phone").notNull(),
    passwordHash: text("password_hash").notNull(),
    mustChangePassword: boolean("must_change_password").notNull().default(true),
    isEnabled: boolean("is_enabled").notNull().default(true),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    enabledBy: uuid("enabled_by"),
    enabledAt: timestamp("enabled_at", { withTimezone: true }),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    ...mutable(),
  },
  (t) => [unique("portal_users_company_phone_uq").on(t.companyId, t.phone)],
);
