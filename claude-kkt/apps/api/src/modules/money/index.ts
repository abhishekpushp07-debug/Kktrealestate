/**
 * Money module (SPEC §8 plan assignments, §10 auto-dues + integrity, §11 two-bucket ledger / payments / roznamcha, §12 booking engine).
 * Auto-registered under /api/v1 by the module loader; jobs are registered with the core registry at plugin time.
 *
 * Service surface other modules may call (construction, portal, reports, admin, seed):
 *   raiseDues(tx, booking, opts) · raiseDuesForBlock(tx, blockId, opts) · raiseDuesForAll(db, today, scope) · voidDemandsForStage(tx, blockId, stageId, reason)
 *   recomputeDemandStatuses(tx, bookingId) · appendEvent(tx, bookingId, event) · rebuild(tx, bookingId, {write}) · ledgerRows(db, bookingId)
 *   runReport(db, scope) · repair(db, scope) · nightlyIntegrity(db, companyId) · receiptData(db, user, paymentId) · demandLetterData(db, user, bookingId, demandId)
 *   applicablePlanRows(db, companyId, projectId, blockId) · previewSchedule(...) · roznamcha(db, user, from, to, projectId) · scheduleRows(booking, stages, demands)
 */
import type { FastifyInstance } from "fastify";
import { registerMoneyJobs } from "./jobs.js";
import { registerBookingRoutes } from "./routes/bookings.js";
import { registerDuesRoutes } from "./routes/dues.js";
import { registerPaymentRoutes } from "./routes/payments.js";
import { registerPlanRoutes } from "./routes/plans.js";
import { registerRoznamchaRoutes } from "./routes/roznamcha.js";

export { appendEvent, rebuild, ledgerRows, sourceEvents, events, demandAmountsFor, type AppendResult, type RebuildResult, type SummaryMismatch } from "./services/ledger.js";
export { raiseDues, raiseDuesForBlock, raiseDuesForAll, voidDemandsForStage, voidDemand, recomputeDemandStatuses, raiseOtherChargeDemand, nonVoidDemands, bookingRecipients, type RaiseOptions, type RaiseResult, type RunSummary, type DuesScope, type VoidStageResult } from "./services/dues.js";
export { runReport, repair, nightlyIntegrity, listRuns, type IntegrityScope } from "./services/integrity.js";
export { createBooking, reviseAgreement, changePlan, cancelBooking, completeBooking, addOtherCharge, demandOtherChargeLine, refreshCounts } from "./services/bookings.js";
export { postPayment, clearPayment, bouncePayment, reversePayment, receiptData, demandLetterData } from "./services/payments.js";
export { applicablePlanRows, applicableAssignments, resolveBookingPlan, buildPlanSnapshot, previewSchedule, assertPlanFitsScope, loadPlan } from "./services/plans.js";
export { roznamcha, cashInHandBefore, createContra } from "./services/roznamcha.js";
export { bookingDetail, loadBookingSelect, toBookingRows, toPaymentRow, toDemandRow, toLedgerRow, scheduleRows, loadPaymentSelect } from "./services/views.js";
export { dailyDues, nightlyIntegrityJob, overdueNotifications } from "./jobs.js";
export { Clock, lockBooking, loadBooking, loadTowerStages, snapshotInstallments, type MoneyActor, type BookingRecord } from "./common.js";

/** Fastify plugin: routes + jobs. */
export default async function moneyModule(app: FastifyInstance): Promise<void> {
  registerPlanRoutes(app);
  registerBookingRoutes(app);
  registerPaymentRoutes(app);
  registerRoznamchaRoutes(app);
  registerDuesRoutes(app);
  registerMoneyJobs(app);
}
