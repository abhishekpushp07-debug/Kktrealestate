import { z } from "zod";

// ---------------------------------------------------------------------------
// Scalars
// ---------------------------------------------------------------------------

/** UUID identifier. */
export const IdSchema = z.uuid();
export type Id = z.infer<typeof IdSchema>;

/** Row version for optimistic concurrency (≥ 1). */
export const VersionSchema = z.int().min(1);
export type Version = z.infer<typeof VersionSchema>;

/** Non-negative integer paise (fits in 2^53). */
export const PaiseSchema = z.int().min(0).max(Number.MAX_SAFE_INTEGER);
export type Paise = z.infer<typeof PaiseSchema>;

/** Strictly positive integer paise. */
export const PositivePaiseSchema = z.int().min(1).max(Number.MAX_SAFE_INTEGER);
export type PositivePaise = z.infer<typeof PositivePaiseSchema>;

/** Signed integer paise (negative = advance / reversal). */
export const SignedPaiseSchema = z.int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
export type SignedPaise = z.infer<typeof SignedPaiseSchema>;

/** Returns true when a number has at most `dp` decimal places. */
export function hasMaxDecimals(value: number, dp: number): boolean {
  const factor = 10 ** dp;
  return Math.abs(value * factor - Math.round(value * factor)) < 1e-6;
}

/** Percent 0..100 with at most two decimals. */
export const PercentSchema = z
  .number()
  .min(0)
  .max(100)
  .refine((v) => hasMaxDecimals(v, 2), { message: "At most 2 decimal places" });
export type Percent = z.infer<typeof PercentSchema>;

/** Area in square feet, non-negative, at most two decimals. */
export const SqftSchema = z
  .number()
  .min(0)
  .max(99_999_999.99)
  .refine((v) => hasMaxDecimals(v, 2), { message: "At most 2 decimal places" });
export type Sqft = z.infer<typeof SqftSchema>;

/** Positive area in square feet. */
export const PositiveSqftSchema = SqftSchema.refine((v) => v > 0, { message: "Must be greater than 0" });

/** Business date YYYY-MM-DD (must be a real calendar date). */
export const DateStringSchema = z.iso.date();
export type DateString = z.infer<typeof DateStringSchema>;

/** RFC 3339 timestamp (event time). */
export const TimestampSchema = z.iso.datetime({ offset: true });
export type Timestamp = z.infer<typeof TimestampSchema>;

/** Wall-clock time HH:MM (24 h). */
export const TimeStringSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM");
export type TimeString = z.infer<typeof TimeStringSchema>;

/** Normalises an Indian phone: strips spaces/punctuation, a leading +91 / 91 / 0. */
export function normalisePhone(input: unknown): unknown {
  if (typeof input !== "string") return input;
  const digits = input.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return digits;
}

/** 10-digit Indian mobile number starting 6–9; accepts +91 / 0 / spaces on input. */
export const PhoneSchema = z.preprocess(
  normalisePhone,
  z.string().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit Indian mobile number"),
);
export type Phone = z.infer<typeof PhoneSchema>;

/** Uppercases and trims a string input. */
export function upperTrim(input: unknown): unknown {
  return typeof input === "string" ? input.trim().toUpperCase() : input;
}

/** PAN: five letters, four digits, one letter (upper-cased on input). */
export const PANSchema = z.preprocess(upperTrim, z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "Invalid PAN"));
export type PAN = z.infer<typeof PANSchema>;

/** Removes whitespace from a string input. */
export function stripSpaces(input: unknown): unknown {
  return typeof input === "string" ? input.replace(/\s+/g, "") : input;
}

/** Aadhaar: 12 digits (spaces allowed on input). Verhoeff checksum is verified in the domain layer. */
export const AadhaarSchema = z.preprocess(stripSpaces, z.string().regex(/^[2-9]\d{11}$/, "Invalid Aadhaar number"));
export type Aadhaar = z.infer<typeof AadhaarSchema>;

/** IFSC: four letters, a zero, six alphanumerics. */
export const IFSCSchema = z.preprocess(upperTrim, z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Invalid IFSC"));
export type IFSC = z.infer<typeof IFSCSchema>;

/** Lowercases and trims a string input. */
export function lowerTrim(input: unknown): unknown {
  return typeof input === "string" ? input.trim().toLowerCase() : input;
}

/** E-mail address, lower-cased. */
export const EmailSchema = z.preprocess(lowerTrim, z.email().max(254));
export type Email = z.infer<typeof EmailSchema>;

/** GSTIN (15 characters). */
export const GSTINSchema = z.preprocess(
  upperTrim,
  z.string().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, "Invalid GSTIN"),
);
export type GSTIN = z.infer<typeof GSTINSchema>;

/** Indian PIN code (6 digits, not starting with 0). */
export const PincodeSchema = z.string().regex(/^[1-9][0-9]{5}$/, "Invalid PIN code");
export type Pincode = z.infer<typeof PincodeSchema>;

/** Bank account number: 9–18 digits. */
export const BankAccountNumberSchema = z.preprocess(
  stripSpaces,
  z.string().regex(/^\d{9,18}$/, "Invalid account number"),
);
export type BankAccountNumber = z.infer<typeof BankAccountNumberSchema>;

/** URL slug: lower-case letters, digits and single hyphens. */
export const SlugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lower-case letters, digits and hyphens");
export type Slug = z.infer<typeof SlugSchema>;

/** Upper-case business code (letters, digits, underscore, hyphen). */
export const CodeSchema = z.preprocess(
  upperTrim,
  z.string().regex(/^[A-Z0-9][A-Z0-9_-]{0,29}$/, "Code: upper-case letters, digits, _ or -, max 30"),
);
export type Code = z.infer<typeof CodeSchema>;

/** Short human name/title (1–120 chars). */
export const NameSchema = z.string().trim().min(1).max(120);
/** Longer free text (≤ 2000 chars). */
export const TextSchema = z.string().trim().max(2000);
/** Long markdown body (≤ 100 000 chars). */
export const MarkdownSchema = z.string().max(100_000);
/** Mandatory reason for sensitive actions (3–500 chars). */
export const ReasonSchema = z.string().trim().min(3).max(500);
/** Free-text note (≤ 1000 chars). */
export const NoteSchema = z.string().trim().max(1000);
/** Absolute http(s) URL. */
export const UrlSchema = z.url({ protocol: /^https?$/ }).max(2048);
/** Idempotency-Key header value. */
export const IdempotencyKeySchema = z.string().min(8).max(128);
/** Password policy: 10–128 chars with lower, upper and digit. */
export const PasswordSchema = z
  .string()
  .min(10, "At least 10 characters")
  .max(128)
  .refine((p) => /[a-z]/.test(p) && /[A-Z]/.test(p) && /[0-9]/.test(p), {
    message: "Use upper-case, lower-case and a digit",
  });
export type Password = z.infer<typeof PasswordSchema>;

/** Accepts booleans and "true"/"false"/"1"/"0" strings (query strings). */
export function coerceBoolean(input: unknown): unknown {
  if (input === "true" || input === "1") return true;
  if (input === "false" || input === "0" || input === "") return false;
  return input;
}

/** Boolean that also accepts query-string spellings. */
export const BoolQuerySchema = z.preprocess(coerceBoolean, z.boolean());

/** Positive integer that also accepts numeric strings (query strings). */
export const IntQuerySchema = z.coerce.number().int();

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

/** Maximum page size for any list endpoint. */
export const MAX_PAGE_SIZE = 200;
/** Default page size. */
export const DEFAULT_PAGE_SIZE = 25;
/**
 * Highest `page` an offset list accepts: deep OFFSET scans every skipped row, so beyond it the client must page with `cursor`/`limit`
 * (keyset, constant cost per page). A larger page answers 400 VALIDATION_ERROR naming cursor mode.
 */
export const MAX_PAGE = 1000;

/** `page` query parameter of offset lists: 1 … {@link MAX_PAGE}, default 1. */
export const PageQuerySchema = IntQuerySchema.min(1)
  .max(MAX_PAGE, {
    message: `page must be at most ${MAX_PAGE}; page deeper with cursor mode (cursor + limit, next_cursor)`,
  })
  .default(1);

/** Sort expression: `field` or `-field`. */
export const SortSchema = z.string().regex(/^-?[a-z][a-z0-9_.]{0,49}$/, "Sort must be field or -field");
export type Sort = z.infer<typeof SortSchema>;

/** Common list query (offset or cursor pagination, search, sort, csv). */
export const ListQuerySchema = z.object({
  page: PageQuerySchema,
  page_size: IntQuerySchema.min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  cursor: z.string().max(512).optional(),
  limit: IntQuerySchema.min(1).max(MAX_PAGE_SIZE).optional(),
  search: z.string().trim().max(100).optional(),
  sort: SortSchema.optional(),
  include_inactive: BoolQuerySchema.default(false),
  format: z.enum(["csv"]).optional(),
  /** Force an exact `total` (large tables otherwise report the planner's estimate). */
  exact: BoolQuerySchema.default(false),
});
export type ListQuery = z.infer<typeof ListQuerySchema>;

/** Parses a sort expression into field and direction. */
export function parseSort(sort: string): { field: string; direction: "asc" | "desc" } {
  return sort.startsWith("-") ? { field: sort.slice(1), direction: "desc" } : { field: sort, direction: "asc" };
}

/** Builds the list envelope schema for an item schema. */
export function listEnvelope<T extends z.ZodType>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    total: z.int().min(0),
    page: z.int().min(1),
    page_size: z.int().min(1).max(MAX_PAGE_SIZE),
    next_cursor: z.string().nullable(),
  });
}

/** The list envelope type for an item type. */
export interface ListEnvelope<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  next_cursor: string | null;
}

// ---------------------------------------------------------------------------
// Row building blocks
// ---------------------------------------------------------------------------

/** `{ version }` carried by every mutation of a mutable row. */
export const VersionedSchema = z.object({ version: VersionSchema });
export type Versioned = z.infer<typeof VersionedSchema>;

/** Audited row fields present on every business table. */
export const AuditedRowSchema = z.object({
  id: IdSchema,
  company_id: IdSchema,
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
  created_by: IdSchema.nullable(),
  version: VersionSchema,
});
export type AuditedRow = z.infer<typeof AuditedRowSchema>;

/** Soft-delete fields for masters and structure. */
export const ActiveRowSchema = z.object({
  is_active: z.boolean(),
  deactivated_at: TimestampSchema.nullable(),
});
export type ActiveRow = z.infer<typeof ActiveRowSchema>;

/** Audited + soft-deletable row fields. */
export const MasterRowSchema = AuditedRowSchema.extend(ActiveRowSchema.shape);
export type MasterRow = z.infer<typeof MasterRowSchema>;

/** The shape of an Update schema: every field of the Create shape, optional and WITHOUT its create-time default. */
export type UpdateShape<T extends z.ZodRawShape> = {
  [K in keyof T]: z.ZodOptional<T[K] extends z.ZodDefault<infer Inner extends z.ZodType> ? Inner : T[K]>;
};

/**
 * Makes the Update schema for a Create schema: all fields optional plus `version`.
 * Create-time defaults are stripped first: a PATCH is a partial update, so a key the client did not send must stay untouched
 * (Zod 4 keeps applying `.default()` inside `.partial()`, which would silently reset flags and empty arrays on every partial PATCH —
 * e.g. unpublish a project and wipe its hero images when only `show_prices` is sent).
 */
export function updateOf<T extends z.ZodRawShape>(createSchema: z.ZodObject<T>) {
  const shape = {} as Record<string, z.ZodType>;
  for (const [key, field] of Object.entries(createSchema.shape as unknown as Record<string, z.ZodType>)) {
    const inner = field instanceof z.ZodDefault ? (field as z.ZodDefault<z.ZodType>).removeDefault() : field;
    shape[key] = inner.optional();
  }
  return z.strictObject(shape as UpdateShape<T>).extend({ version: VersionSchema });
}

/** One labelled money line in a price or charge breakup. */
export const MoneyBreakupLineSchema = z.object({
  label: z.string().trim().min(1).max(120),
  amount_paise: SignedPaiseSchema,
});
export type MoneyBreakupLine = z.infer<typeof MoneyBreakupLineSchema>;

/** Postal address. */
export const AddressSchema = z.object({
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).optional().nullable(),
  locality: z.string().trim().max(120).optional().nullable(),
  city: z.string().trim().min(1).max(80),
  state: z.string().trim().min(1).max(80),
  pincode: PincodeSchema,
});
export type Address = z.infer<typeof AddressSchema>;

/** Minimal reference to a user for display. */
export const UserRefSchema = z.object({ id: IdSchema, name: z.string() });
export type UserRef = z.infer<typeof UserRefSchema>;

/** Minimal named reference. */
export const NamedRefSchema = z.object({ id: IdSchema, name: z.string(), code: z.string().optional() });
export type NamedRef = z.infer<typeof NamedRefSchema>;

/** Generic `{ ok: true }` acknowledgement. */
export const OkResponseSchema = z.object({ ok: z.literal(true) });
export type OkResponse = z.infer<typeof OkResponseSchema>;

/** Response to a deactivate/restore call. */
export const ActiveStateResponseSchema = z.object({ id: IdSchema, is_active: z.boolean(), version: VersionSchema });
export type ActiveStateResponse = z.infer<typeof ActiveStateResponseSchema>;

/** Where a master record is used (returned alongside IN_USE). */
export const UsageResponseSchema = z.object({
  usage_count: z.int().min(0),
  used_by: z.array(z.object({ entity_type: z.string(), count: z.int().min(0) })),
});
export type UsageResponse = z.infer<typeof UsageResponseSchema>;

/** Short-lived signed download link. */
export const SignedLinkSchema = z.object({ download_url: UrlSchema, expires_at: TimestampSchema });
export type SignedLink = z.infer<typeof SignedLinkSchema>;

/** Date range query (inclusive). */
export const DateRangeSchema = z
  .object({ from: DateStringSchema, to: DateStringSchema })
  .refine((r) => r.from <= r.to, { message: "from must be on or before to", path: ["to"] });
export type DateRange = z.infer<typeof DateRangeSchema>;

/** Non-empty list of ids (≤ 500), used for multi-select bulk actions. */
export const IdListSchema = z.array(IdSchema).min(1).max(500);
export type IdList = z.infer<typeof IdListSchema>;
