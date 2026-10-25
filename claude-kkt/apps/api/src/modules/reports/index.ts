/**
 * Reports module (SPEC §14 reports, dashboards, branded PDFs; §11 receipt / demand-letter formatting). Auto-registered under /api/v1.
 *
 * Service surface other modules may call (portal PDFs, admin, seed):
 *   receiptPdf(db, user, paymentId) · demandLetterPdf(db, user, bookingId, demandId) · allotmentLetterPdf(db, user, bookingId) · customerStatementPdf(db, user, bookingId)
 *   customerStatement(db, user, bookingId) · allotmentLetterData(db, user, bookingId) · letterheadFor(db, companyId) · BrandedPdf / reportPdf (generic branded A4 generator)
 *   collectionsReport · outstandingReport · advancesReport · demandVsCollection · upcomingDues · chequesReport · cancellationsReport · bankwiseReceipts
 *   inventoryReport · projectInventory · salesFunnel · activityReport · dashboardFor(db, redis, user, query) · dashboardRoleFor(user)
 */
import type { FastifyInstance } from "fastify";
import { registerDashboardRoutes } from "./routes/dashboard.js";
import { registerDocumentRoutes } from "./routes/documents.js";
import { registerPresetRoutes } from "./routes/presets.js";
import { registerReportRoutes } from "./routes/reports.js";

export { receiptPdf, demandLetterPdf, allotmentLetterPdf, allotmentLetterData, customerStatement, customerStatementPdf, type RenderedPdf } from "./services/documents.js";
export { BrandedPdf, reportPdf, reportPdfStream, buildReportPdf, pdfTruncationNote, PDF_MAX_ROWS, pdfMoney, pdfDate, pdfDateTimeIST, PDF_CURRENCY_PREFIX, type PdfLetterhead, type PdfColumn, type PdfOptions, type ReportTableSpec } from "./services/pdf.js";
export { collectionsReport, outstandingReport, advancesReport, demandVsCollection, upcomingDues, chequesReport, cancellationsReport, bankwiseReceipts, clearedTotal, pendingChequesTotal, toChequeRow, STAGE_FORECAST_DAYS } from "./services/moneyReports.js";
export { inventoryReport, projectInventory, salesFunnel, activityReport } from "./services/salesReports.js";
export { dashboardFor, dashboardRoleFor, dashboardCacheKey, DASHBOARD_TTL_SECONDS } from "./services/dashboards.js";
export { letterheadFor, wantedFormat, sendPdf } from "./common.js";
export { REPORT_CATALOG, reportPath } from "./routes/reports.js";

/** Fastify plugin: report, document, preset and dashboard routes. */
export default async function reportsModule(app: FastifyInstance): Promise<void> {
  registerReportRoutes(app);
  registerDocumentRoutes(app);
  registerPresetRoutes(app);
  registerDashboardRoutes(app);
}
