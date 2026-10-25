import type { FastifyInstance } from "fastify";
import { registerServiceJobs } from "./jobs.js";
import { noticeRoutes } from "./notices.js";
import { ticketRoutes } from "./tickets.js";

// Service functions other modules call (portal, dashboards, seed, jobs).
export {
  createTicket,
  createTicketForCustomer,
  listTicketsForCustomer,
  ticketForCustomer,
  addCustomerMessage,
  reopenByCustomer,
  rateByCustomer,
  addStaffMessage,
  assignTicket,
  changeStatus,
  updateTicket,
  loadTicket,
  requireStaffTicket,
  requireCustomerTicket,
  loadMessages,
  ticketDetail,
  customerTicketDetail,
  toTicketRow,
  toCustomerTicketRow,
  canReopen,
  canRate,
  assertTransition,
  slaHoursOf,
  STATUS_TRANSITIONS,
  TERMINAL_STATUSES,
  TICKET_ENTITY,
  type CreateTicketInput,
  type CustomerTicketFilter,
  type TicketJoined,
  type TicketWriteContext,
  type WriteMeta,
} from "./ticketService.js";
export { noticesForCustomer, notifyNoticePublished, notifyDueNotices, liveNotices, isLive, toNoticeRow, NOTICE_ENTITY, type DbNotice } from "./notices.js";
export { slaBreachCheck, registerServiceJobs, SLA_BREACH_JOB } from "./jobs.js";

/** Service module: tickets (SLA, internal notes, reopen window, rating), notices for buyers and the hourly SLA breach job. */
export default async function serviceModule(app: FastifyInstance): Promise<void> {
  ticketRoutes(app);
  noticeRoutes(app);
  registerServiceJobs();
}
