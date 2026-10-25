import type { FastifyInstance } from "fastify";
import { customerRoutes } from "./customers.js";
import { enquiryRoutes } from "./enquiries.js";
import { leadRoutes } from "./leads.js";
import { portalAccessRoutes } from "./portalAccess.js";

// Service functions other modules call (public website, visits/brochure, bookings, seed).
export {
  createCustomer,
  updateCustomer,
  getCustomerRow,
  loadCustomerSelect,
  assertNoDuplicate,
  activeBookingCount,
  portalAccessView,
  portalLoginUrl,
  canonicalPhone,
  panColumns,
  aadhaarColumns,
  type CustomerWriteContext,
  type WriteMeta,
} from "./customerService.js";
export {
  findOpenLeadByPhone,
  createOrTouchLead,
  recordLeadActivity,
  revertLeadStage,
  setLeadStage,
  createEnquiry,
  nextLeadNumber,
  nextRoundRobinUser,
  roundRobinKey,
  getLeadRow,
  loadLeadSelect,
  markLeadsRead,
  toDbUtm,
  OPEN_STAGES,
  type CreateOrTouchLeadInput,
  type CreateEnquiryInput,
  type StageChangeOptions,
  type DbLead,
} from "./leadService.js";
export { markEnquiriesRead, enquiryRow } from "./enquiries.js";

/** CRM module: customers (KYC, co-applicants, 360, portal access), leads pipeline and the website enquiries inbox. */
export default async function crmModule(app: FastifyInstance): Promise<void> {
  customerRoutes(app);
  portalAccessRoutes(app);
  leadRoutes(app);
  enquiryRoutes(app);
}
