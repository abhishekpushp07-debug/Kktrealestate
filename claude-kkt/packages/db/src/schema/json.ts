// TypeScript shapes for jsonb columns. These mirror the Zod schemas in
// @kkt/contracts (which validate on the wire); the database stores them whole.
import type {
  ChargeDemandAt,
  PaymentBucket,
  PlanType,
  ServicePriority,
  TriggerType,
} from "@kkt/contracts";

export interface Address {
  line1: string;
  line2?: string | null;
  locality?: string | null;
  city: string;
  state: string;
  pincode: string;
}

export interface Letterhead {
  tagline?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  signatory_name?: string | null;
  signatory_title?: string | null;
}

export interface NumberingScope {
  prefix: string;
  format?: string;
}

export interface Numbering {
  customer: NumberingScope;
  booking: NumberingScope;
  demand: NumberingScope;
  receipt: NumberingScope;
  ticket: NumberingScope;
  visit: NumberingScope;
}

export interface CompanySettings {
  demand_due_days: number;
  default_gst_percent: number;
  round_robin_enabled: boolean;
  force_mfa_for_admins: boolean;
  sla_hours: Record<ServicePriority, number>;
  booking_hold_hours: number;
}

export interface FlatTypeRoom {
  room_type_id: string;
  room_type_name: string;
  label: string;
  length_ft: number;
  width_ft: number;
  sqft: number;
}

export interface FlatTypeArea {
  area_type_id: string;
  area_type_code: string;
  area_type_name: string;
  sqft: number;
}

export interface FloorPlanPosition {
  position: number;
  flat_type_id: string;
  facing?: string | null;
  is_corner: boolean;
}

export interface FloorPlanRange {
  from_floor: number;
  to_floor: number;
  floor_plan_template_id: string;
}

export interface Landmark {
  name: string;
  distance_km: number;
}

export interface Approval {
  name: string;
  number?: string | null;
  issued_on?: string | null;
  status: string;
}

export interface UnitCounts {
  available: number;
  hold: number;
  blocked: number;
  booked: number;
  sold: number;
  total: number;
}

export interface Faq {
  q: string;
  a: string;
}

export interface Seo {
  title?: string | null;
  description?: string | null;
  og_image_document_id?: string | null;
}

export interface PriceBreakupLine {
  label: string;
  amount_paise: number;
}

export interface BankDetails {
  bank_name: string;
  ifsc: string;
  holder_name: string;
  account_enc: string;
  account_last4: string;
}

export interface Nominee {
  name: string;
  relation: string;
  phone?: string | null;
  dob?: string | null;
}

export type Utm = Record<string, string>;

export interface RescheduledFrom {
  visit_date: string;
  slot_start: string;
}

export interface FlatSnapshot {
  flat_number: string;
  floor: number;
  flat_type_id: string;
  flat_type_code: string;
  facing?: string | null;
  carpet_sqft: number;
  builtup_sqft: number;
  super_builtup_sqft: number;
  price_paise: number;
  price_breakup: PriceBreakupLine[];
  rooms: FlatTypeRoom[];
  areas: FlatTypeArea[];
}

export interface PlanSnapshotInstallment {
  seq: number;
  name: string;
  percent: number;
  trigger_type: TriggerType;
  trigger_days?: number | null;
  trigger_stage_id?: string | null;
  trigger_stage_name?: string | null;
  trigger_date?: string | null;
  due_days: number;
}

export interface PlanSnapshot {
  plan_id: string;
  name: string;
  code: string;
  plan_type: PlanType;
  grace_days: number;
  installments: PlanSnapshotInstallment[];
}

export interface Cancellation {
  at: string;
  by: string | null;
  by_name: string;
  reason: string;
  deduction_paise: number;
  refund_paise: number;
}

export interface AgreementValues {
  agreement_value_paise: number;
  cash_agreed_paise: number;
  account_agreed_paise: number;
}

export interface Instrument {
  number?: string | null;
  date?: string | null;
  bank_name?: string | null;
  branch?: string | null;
}

export interface DocumentVariants {
  thumb_key?: string | null;
  medium_key?: string | null;
  width?: number | null;
  height?: number | null;
}

export interface Brand {
  name: string;
  tagline?: string | null;
  logo_document_id?: string | null;
  favicon_document_id?: string | null;
}

export interface Contacts {
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
}

export interface TrustStat {
  label: string;
  value: string;
}

export interface Analytics {
  ga_id?: string | null;
}

/** Generic JSON object for payloads whose shape is owned by the caller. */
export type JsonObject = Record<string, unknown>;

/** Re-exported for jsonb columns typed by bucket. */
export type { ChargeDemandAt, PaymentBucket };
