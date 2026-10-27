// Postgres enums. Every value array comes from @kkt/contracts so the database
// and the wire contract can never disagree.
import { pgEnum } from "drizzle-orm/pg-core";
import {
  ACTOR_TYPES,
  BOOKING_STATUSES,
  CHARGE_DEMAND_ATS,
  CONTRA_TYPES,
  DEMAND_STATUSES,
  DOCUMENT_ENTITY_TYPES,
  EXPORT_STATUSES,
  FLAT_STATUSES,
  GENDERS,
  JOB_RUN_STATUSES,
  KYC_STATUSES,
  LEAD_SOURCES,
  LEAD_STAGES,
  LEDGER_EVENTS,
  NOTIFICATION_RECIPIENT_TYPES,
  PARKING_STATUSES,
  PARKING_TYPES,
  PAYMENT_AGAINSTS,
  PAYMENT_BUCKETS,
  PAYMENT_STATUSES,
  PLAN_ACCEPTANCE_MODES,
  PLAN_TYPES,
  PLC_APPLIES_TOS,
  PLC_CALC_MODES,
  POST_STATUSES,
  PROJECT_STATUSES,
  PROJECT_TYPES,
  RATE_CARD_STATUSES,
  SERVICE_PRIORITIES,
  SERVICE_STATUSES,
  STAGE_STATUSES,
  TRIGGER_TYPES,
  USER_TYPES,
  VISIT_SOURCES,
  VISIT_STATUSES,
} from "@kkt/contracts";

// Identity / platform
export const userTypeEnum = pgEnum("user_type", USER_TYPES);
export const actorTypeEnum = pgEnum("actor_type", ACTOR_TYPES);
export const jobRunStatusEnum = pgEnum("job_run_status", JOB_RUN_STATUSES);
export const exportStatusEnum = pgEnum("export_status", EXPORT_STATUSES);

// Masters
export const planTypeEnum = pgEnum("plan_type", PLAN_TYPES);
export const triggerTypeEnum = pgEnum("trigger_type", TRIGGER_TYPES);
export const chargeDemandAtEnum = pgEnum("charge_demand_at", CHARGE_DEMAND_ATS);
export const plcCalcModeEnum = pgEnum("plc_calc_mode", PLC_CALC_MODES);
export const plcAppliesToEnum = pgEnum("plc_applies_to", PLC_APPLIES_TOS);
export const servicePriorityEnum = pgEnum("service_priority", SERVICE_PRIORITIES);

// Inventory
export const projectTypeEnum = pgEnum("project_type", PROJECT_TYPES);
export const projectStatusEnum = pgEnum("project_status", PROJECT_STATUSES);
export const stageStatusEnum = pgEnum("stage_status", STAGE_STATUSES);
export const flatStatusEnum = pgEnum("flat_status", FLAT_STATUSES);
export const parkingTypeEnum = pgEnum("parking_type", PARKING_TYPES);
export const parkingStatusEnum = pgEnum("parking_status", PARKING_STATUSES);
export const rateCardStatusEnum = pgEnum("rate_card_status", RATE_CARD_STATUSES);

// Customers
export const genderEnum = pgEnum("gender", GENDERS);
export const kycStatusEnum = pgEnum("kyc_status", KYC_STATUSES);

// Leads & visits
export const leadSourceEnum = pgEnum("lead_source", LEAD_SOURCES);
export const leadStageEnum = pgEnum("lead_stage", LEAD_STAGES);
export const visitStatusEnum = pgEnum("visit_status", VISIT_STATUSES);
export const visitSourceEnum = pgEnum("visit_source", VISIT_SOURCES);

// Bookings & money
export const bookingStatusEnum = pgEnum("booking_status", BOOKING_STATUSES);
export const planAcceptanceModeEnum = pgEnum("plan_acceptance_mode", PLAN_ACCEPTANCE_MODES);
export const demandStatusEnum = pgEnum("demand_status", DEMAND_STATUSES);
export const paymentAgainstEnum = pgEnum("payment_against", PAYMENT_AGAINSTS);
export const paymentBucketEnum = pgEnum("payment_bucket", PAYMENT_BUCKETS);
export const paymentStatusEnum = pgEnum("payment_status", PAYMENT_STATUSES);
export const ledgerEventEnum = pgEnum("ledger_event", LEDGER_EVENTS);
export const contraTypeEnum = pgEnum("contra_type", CONTRA_TYPES);

// Documents, service, notifications, CMS
export const documentEntityTypeEnum = pgEnum("document_entity_type", DOCUMENT_ENTITY_TYPES);
export const serviceStatusEnum = pgEnum("service_status", SERVICE_STATUSES);
export const notificationRecipientTypeEnum = pgEnum("notification_recipient_type", NOTIFICATION_RECIPIENT_TYPES);
export const postStatusEnum = pgEnum("post_status", POST_STATUSES);
