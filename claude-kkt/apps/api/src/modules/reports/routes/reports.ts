/** Routes: GET /reports (catalogue) and GET /reports/<key> with JSON, `format=csv` and `format=pdf` variants (SPEC §14). */
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  ActivityReportQuerySchema, ActivityReportResponseSchema, AdvancesReportQuerySchema, AdvancesReportResponseSchema, AllotmentLetterDataSchema, BankwiseReceiptsQuerySchema, BankwiseReceiptsResponseSchema,
  BookingDocumentQuerySchema, CancellationsReportQuerySchema, CancellationsReportResponseSchema, ChequesReportQuerySchema, ChequesReportResponseSchema, CollectionsReportQuerySchema, CollectionsReportResponseSchema,
  CustomerStatementResponseSchema, DemandVsCollectionQuerySchema, DemandVsCollectionResponseSchema, InventoryReportQuerySchema, InventoryReportResponseSchema, OutstandingReportQuerySchema, OutstandingReportResponseSchema,
  REPORT_KEY_LABELS, ReportCatalogResponseSchema, RoznamchaReportQuerySchema, RoznamchaResponseSchema, SalesFunnelQuerySchema, SalesFunnelResponseSchema, ScheduleResponseSchema, UpcomingDuesQuerySchema, UpcomingDuesResponseSchema,
  type ReportCatalogEntry, type ReportKey,
} from "@kkt/contracts";
import { formatDateLabel } from "@kkt/domain";
import { route } from "../../../lib/routes.js";
import { ensureProjectAccess } from "../../../lib/scope.js";
import { roznamcha } from "../../money/services/roznamcha.js";
import { letterheadFor, rangeFilters, sendPdf, sendRowsCsv, wantedFormat, type ExportQuery } from "../common.js";
import { allotmentLetterData, allotmentLetterPdf, customerStatement, customerStatementPdf } from "../services/documents.js";
import { advancesReport, bankwiseReceipts, cancellationsReport, chequesReport, collectionsReport, demandVsCollection, outstandingReport, upcomingDues } from "../services/moneyReports.js";
import { pdfDate, reportPdfStream, type PdfColumn, type ReportTableSpec } from "../services/pdf.js";
import { activityReport, inventoryReport, salesFunnel } from "../services/salesReports.js";
import { loadBookingRelated, loadBookingSelect, scheduleRows } from "../../money/services/views.js";
import { today } from "../common.js";

type Row = Record<string, unknown>;

/** Report catalogue (key → path, formats, accepted parameters). */
export const REPORT_CATALOG: readonly ReportCatalogEntry[] = [
  { key: "COLLECTIONS", label: REPORT_KEY_LABELS.COLLECTIONS, path: "/reports/collections", formats: ["csv", "pdf"], params: ["from", "to", "group_by", "project_id", "block_id", "mode_code", "category", "status"], required_params: ["from", "to"] },
  { key: "OUTSTANDING_AGEING", label: REPORT_KEY_LABELS.OUTSTANDING_AGEING, path: "/reports/outstanding-ageing", formats: ["csv", "pdf"], params: ["as_of", "group_by", "project_id", "block_id", "customer_id", "top_n"], required_params: [] },
  { key: "ADVANCES", label: REPORT_KEY_LABELS.ADVANCES, path: "/reports/advances", formats: ["csv", "pdf"], params: ["project_id", "block_id", "bucket"], required_params: [] },
  { key: "DEMAND_VS_COLLECTION", label: REPORT_KEY_LABELS.DEMAND_VS_COLLECTION, path: "/reports/demand-vs-collection", formats: ["csv", "pdf"], params: ["project_id", "block_id", "group_by"], required_params: ["project_id"] },
  { key: "UPCOMING_DUES", label: REPORT_KEY_LABELS.UPCOMING_DUES, path: "/reports/upcoming-dues", formats: ["csv", "pdf"], params: ["from", "to", "project_id", "block_id"], required_params: ["from", "to"] },
  { key: "INVENTORY", label: REPORT_KEY_LABELS.INVENTORY, path: "/reports/inventory", formats: ["csv", "pdf"], params: ["project_id", "block_id", "from", "to"], required_params: [] },
  { key: "CUSTOMER_STATEMENT", label: REPORT_KEY_LABELS.CUSTOMER_STATEMENT, path: "/reports/customer-statement", formats: ["csv", "pdf"], params: ["booking_id"], required_params: ["booking_id"] },
  { key: "PAYMENT_SCHEDULE", label: REPORT_KEY_LABELS.PAYMENT_SCHEDULE, path: "/reports/payment-schedule", formats: ["csv", "pdf"], params: ["booking_id"], required_params: ["booking_id"] },
  { key: "ALLOTMENT_LETTER", label: REPORT_KEY_LABELS.ALLOTMENT_LETTER, path: "/reports/allotment-letter", formats: ["pdf"], params: ["booking_id"], required_params: ["booking_id"] },
  { key: "CHEQUES", label: REPORT_KEY_LABELS.CHEQUES, path: "/reports/cheques", formats: ["csv", "pdf"], params: ["status", "project_id", "from", "to", "page", "page_size", "search", "sort"], required_params: [] },
  { key: "CANCELLATIONS", label: REPORT_KEY_LABELS.CANCELLATIONS, path: "/reports/cancellations", formats: ["csv", "pdf"], params: ["from", "to", "project_id"], required_params: ["from", "to"] },
  { key: "SALES_FUNNEL", label: REPORT_KEY_LABELS.SALES_FUNNEL, path: "/reports/sales-funnel", formats: ["csv", "pdf"], params: ["from", "to", "project_id", "source", "assigned_user_id"], required_params: ["from", "to"] },
  { key: "ROZNAMCHA", label: REPORT_KEY_LABELS.ROZNAMCHA, path: "/reports/roznamcha", formats: ["csv", "pdf"], params: ["from", "to", "project_id"], required_params: ["from", "to"] },
  { key: "BANKWISE_RECEIPTS", label: REPORT_KEY_LABELS.BANKWISE_RECEIPTS, path: "/reports/bankwise-receipts", formats: ["csv", "pdf"], params: ["from", "to", "bank_account_id", "project_id"], required_params: ["from", "to"] },
  { key: "ACTIVITY", label: REPORT_KEY_LABELS.ACTIVITY, path: "/reports/activity", formats: ["csv", "pdf"], params: ["kind", "from", "to", "user_id", "entity_type", "page", "page_size", "search", "sort"], required_params: [] },
];

/** Path of a report key (used by the presets validation and the catalogue). */
export function reportPath(key: ReportKey): string {
  return REPORT_CATALOG.find((r) => r.key === key)?.path ?? `/reports/${key.toLowerCase().replace(/_/g, "-")}`;
}

const money = (key: string, header: string, width = 1.6): PdfColumn<Row> => ({ key, header, money: true, width });
const col = (key: string, header: string, width = 1.5, align?: "left" | "right" | "center"): PdfColumn<Row> => ({ key, header, width, ...(align ? { align } : {}) });
const dateCol = (key: string, header: string, width = 1.3): PdfColumn<Row> => ({ key, header, width, align: "center", render: (r) => pdfDate(r[key] as string | null) });

/**
 * Either sends csv/pdf for a tabular report or returns undefined so the handler replies with JSON. CSV streams every row (capped by
 * lib/list CSV_EXPORT_MAX_ROWS for paged reports); the PDF is streamed to the client and cut at PDF_MAX_ROWS with a visible note.
 */
async function exportTable(reply: FastifyReply, fmt: "csv" | "pdf" | "json", filename: string, keys: readonly string[], rows: readonly Row[], pdf: () => Promise<ReportTableSpec<Row>> | ReportTableSpec<Row>, db: FastifyInstance["db"], companyId: string): Promise<FastifyReply | undefined> {
  if (fmt === "csv") return sendRowsCsv(reply, `${filename}.csv`, keys, rows);
  if (fmt === "pdf") {
    const [letterhead, spec] = await Promise.all([letterheadFor(db, companyId), Promise.resolve(pdf())]);
    return sendPdf(reply, `${filename}.pdf`, reportPdfStream(letterhead, spec));
  }
  return undefined;
}

function range(q: { from: string; to: string }): string {
  return `${formatDateLabel(q.from)} – ${formatDateLabel(q.to)}`;
}

export function registerReportRoutes(app: FastifyInstance): void {
  route(app, {
    method: "GET", url: "/reports", permission: "report.view",
    schema: { response: { 200: ReportCatalogResponseSchema }, summary: "Report catalogue: keys, paths, formats and accepted parameters" },
    handler: async () => ({ reports: REPORT_CATALOG }),
  });

  route(app, {
    method: "GET", url: "/reports/collections", permission: "report.view",
    schema: { querystring: CollectionsReportQuerySchema, response: { 200: CollectionsReportResponseSchema }, summary: "Collections by day/week/month (mode, category, status, project/block; GST on charges)" },
    handler: async (req, reply) => {
      const user = req.user!;
      const r = await collectionsReport(app.dbReplica, user, req.query);
      const rows = r.rows.map((x) => ({ ...x, by_mode: x.by_mode.map((m) => `${m.mode_code} ${m.amount_paise}`).join("; ") }));
      const sent = await exportTable(reply, wantedFormat(req.query), "collections", ["period", "period_start", "cash_paise", "account_paise", "other_paise", "gst_paise", "total_paise", "count", "by_mode"], rows, () => ({
        title: "Collections report", subtitle: `${range(req.query)} · ${req.query.status}`, filters: [...rangeFilters(req.query), ["Grouping", req.query.group_by], ["Status", req.query.status], ...(req.query.category ? [["Category", req.query.category] as const] : []), ...(req.query.mode_code ? [["Mode", req.query.mode_code] as const] : [])],
        columns: [col("period", "Period", 2), money("cash_paise", "Cash"), money("account_paise", "Account"), money("other_paise", "Other charges"), money("gst_paise", "GST"), money("total_paise", "Total"), col("count", "Receipts", 0.9, "right")],
        rows, totals: { period: "Total", ...r.totals },
      }), app.dbReplica, user.companyId);
      return sent ?? r;
    },
  });

  route(app, {
    method: "GET", url: "/reports/outstanding-ageing", permission: "report.view",
    schema: { querystring: OutstandingReportQuerySchema, response: { 200: OutstandingReportResponseSchema }, summary: "Outstanding & ageing per project / block / customer (buckets by demand due date) with top overdue customers" },
    handler: async (req, reply) => {
      const user = req.user!;
      const r = await outstandingReport(app.dbReplica, user, req.query);
      const rows = r.rows.map((x) => ({ key_id: x.key_id, label: x.label, bookings: x.bookings, cash_due_paise: x.cash_due_paise, account_due_paise: x.account_due_paise, total_due_paise: x.total_due_paise, ...x.ageing }));
      const sent = await exportTable(reply, wantedFormat(req.query), "outstanding-ageing", ["label", "bookings", "cash_due_paise", "account_due_paise", "total_due_paise", "NOT_DUE", "D0_30", "D31_60", "D61_90", "D90_PLUS"], rows, () => ({
        title: "Outstanding & ageing", subtitle: `As on ${formatDateLabel(r.as_of)} · by ${req.query.group_by.toLowerCase()}`, landscape: true,
        columns: [col("label", req.query.group_by === "CUSTOMER" ? "Customer" : req.query.group_by === "BLOCK" ? "Block" : "Project", 2.6), col("bookings", "Bookings", 0.9, "right"), money("cash_due_paise", "Cash due"), money("account_due_paise", "Account due"), money("total_due_paise", "Total due", 1.8), money("NOT_DUE", "Not due", 1.4), money("D0_30", "0–30", 1.4), money("D31_60", "31–60", 1.4), money("D61_90", "61–90", 1.4), money("D90_PLUS", "90+", 1.4)],
        rows, totals: { label: "Total", bookings: r.totals.bookings, cash_due_paise: r.totals.cash_due_paise, account_due_paise: r.totals.account_due_paise, total_due_paise: r.totals.total_due_paise, ...r.totals.ageing },
        sections: [{ heading: `Top ${req.query.top_n} overdue customers`, columns: [col("customer_name", "Customer", 2.2), col("customer_phone", "Phone", 1.3), col("booking_number", "Booking", 1.5), col("project_name", "Project", 1.8), col("flat_number", "Unit", 1), money("overdue_paise", "Overdue"), dateCol("oldest_due_date", "Oldest due"), col("days_overdue", "Days", 0.8, "right"), col("bucket", "Bucket", 1)], rows: r.top_overdue as unknown as Row[] }],
      }), app.dbReplica, user.companyId);
      return sent ?? r;
    },
  });

  route(app, {
    method: "GET", url: "/reports/advances", permission: "report.view",
    schema: { querystring: AdvancesReportQuerySchema, response: { 200: AdvancesReportResponseSchema }, summary: "Advances: bookings with money received ahead of the raised demands (per bucket)" },
    handler: async (req, reply) => {
      const user = req.user!;
      const r = await advancesReport(app.dbReplica, user, req.query);
      const keys = ["booking_number", "customer_name", "project_name", "block_name", "flat_number", "cash_advance_paise", "account_advance_paise", "total_advance_paise", "next_installment_name"];
      const sent = await exportTable(reply, wantedFormat(req.query), "advances", keys, r.rows as unknown as Row[], () => ({
        title: "Advances report", subtitle: req.query.bucket ? `${req.query.bucket} bucket` : "Both buckets", filters: rangeFilters(req.query),
        columns: [col("booking_number", "Booking", 1.5), col("customer_name", "Customer", 2), col("project_name", "Project", 1.7), col("block_name", "Block", 1), col("flat_number", "Unit", 0.9), money("cash_advance_paise", "Cash advance"), money("account_advance_paise", "Account advance"), money("total_advance_paise", "Total"), col("next_installment_name", "Next installment", 1.6)],
        rows: r.rows as unknown as Row[], totals: { booking_number: "Total", cash_advance_paise: r.totals.cash_advance_paise, account_advance_paise: r.totals.account_advance_paise, total_advance_paise: r.totals.total_advance_paise },
      }), app.dbReplica, user.companyId);
      return sent ?? r;
    },
  });

  route(app, {
    method: "GET", url: "/reports/demand-vs-collection", permission: "report.view",
    schema: { querystring: DemandVsCollectionQuerySchema, response: { 200: DemandVsCollectionResponseSchema }, summary: "Demand vs collection by installment or stage, per tower of a project" },
    handler: async (req, reply) => {
      const user = req.user!;
      const r = await demandVsCollection(app.dbReplica, user, req.query);
      const keys = ["block_name", "label", "trigger_type", "demands_count", "demanded_paise", "collected_paise", "outstanding_paise", "collection_percent"];
      const sent = await exportTable(reply, wantedFormat(req.query), "demand-vs-collection", keys, r.rows as unknown as Row[], () => ({
        title: "Demand vs collection", subtitle: `By ${req.query.group_by.toLowerCase()}`, filters: rangeFilters(req.query),
        columns: [col("block_name", "Block", 1.4), col("label", req.query.group_by === "STAGE" ? "Stage" : "Installment", 2.2), col("trigger_type", "Trigger", 1.4), col("demands_count", "Demands", 0.9, "right"), money("demanded_paise", "Demanded", 1.8), money("collected_paise", "Collected", 1.8), money("outstanding_paise", "Outstanding", 1.8), col("collection_percent", "Collected %", 1, "right")],
        rows: r.rows as unknown as Row[], totals: { block_name: "Total", ...r.totals },
      }), app.dbReplica, user.companyId);
      return sent ?? r;
    },
  });

  route(app, {
    method: "GET", url: "/reports/upcoming-dues", permission: "report.view",
    schema: { querystring: UpcomingDuesQuerySchema, response: { 200: UpcomingDuesResponseSchema }, summary: "Upcoming dues forecast: time-triggered installments in the range plus stage-linked estimates for stages in progress" },
    handler: async (req, reply) => {
      const user = req.user!;
      const r = await upcomingDues(app.dbReplica, user, req.query);
      const keys = ["expected_date", "booking_number", "customer_name", "project_name", "block_name", "flat_number", "installment_seq", "installment_name", "trigger_label", "is_estimate", "cash_paise", "account_paise", "total_paise"];
      const sent = await exportTable(reply, wantedFormat(req.query), "upcoming-dues", keys, r.rows as unknown as Row[], () => ({
        title: "Upcoming dues forecast", subtitle: range(req.query), filters: rangeFilters(req.query), landscape: true,
        columns: [dateCol("expected_date", "Expected"), col("booking_number", "Booking", 1.4), col("customer_name", "Customer", 1.9), col("project_name", "Project", 1.5), col("block_name", "Block", 0.9), col("flat_number", "Unit", 0.9), col("installment_name", "Installment", 1.6), col("trigger_label", "Trigger", 1.6), { key: "is_estimate", header: "Estimate", width: 0.9, align: "center", render: (x) => (x["is_estimate"] ? "Yes" : "No") }, money("cash_paise", "Cash"), money("account_paise", "Account"), money("total_paise", "Total")],
        rows: r.rows as unknown as Row[], totals: { expected_date: "Total", cash_paise: r.totals.cash_paise, account_paise: r.totals.account_paise, total_paise: r.totals.total_paise },
        sections: [{ heading: "By month", columns: [col("month", "Month", 2), money("total_paise", "Total", 2), col("count", "Installments", 1, "right")], rows: r.by_month as unknown as Row[] }],
      }), app.dbReplica, user.companyId);
      return sent ?? r;
    },
  });

  route(app, {
    method: "GET", url: "/reports/inventory", permission: "report.view",
    schema: { querystring: InventoryReportQuerySchema, response: { 200: InventoryReportResponseSchema }, summary: "Inventory: availability by type/floor/block, sold vs available value, sales velocity, realised rate vs rate card" },
    handler: async (req, reply) => {
      const user = req.user!;
      const r = await inventoryReport(app.dbReplica, user, req.query);
      const countCols = [col("label", "Label", 2.4), col("available", "Available", 0.9, "right"), col("hold", "Hold", 0.8, "right"), col("blocked", "Blocked", 0.8, "right"), col("booked", "Booked", 0.8, "right"), col("sold", "Sold", 0.8, "right"), col("total", "Total", 0.8, "right"), money("available_value_paise", "Available value", 1.8), money("sold_value_paise", "Sold value", 1.8)];
      const keys = ["label", "available", "hold", "blocked", "booked", "sold", "total", "available_value_paise", "sold_value_paise"];
      const csvRows = [...r.by_type.map((x) => ({ group: "type", ...x })), ...r.by_block.map((x) => ({ group: "block", ...x })), ...r.by_floor.map((x) => ({ group: "floor", ...x })), { group: "total", ...r.totals }];
      const sent = await exportTable(reply, wantedFormat(req.query), "inventory", ["group", ...keys], csvRows as unknown as Row[], () => ({
        title: "Inventory report", subtitle: "Availability, value, velocity, realised rate", filters: rangeFilters(req.query), landscape: true,
        columns: countCols, rows: r.by_type as unknown as Row[], totals: { ...r.totals, label: "Total" },
        sections: [
          { heading: "By block", columns: countCols, rows: r.by_block as unknown as Row[] },
          { heading: "By floor", columns: countCols, rows: r.by_floor as unknown as Row[] },
          { heading: "Sales velocity (bookings per month)", columns: [col("month", "Month", 1.5), col("bookings", "Bookings", 1, "right"), col("cancellations", "Cancellations", 1, "right"), money("value_paise", "Booked value", 2)], rows: r.velocity as unknown as Row[] },
          { heading: "Realised rate vs rate card (per sq ft)", columns: [col("flat_type_name", "Flat type", 2), money("rate_card_rate_paise", "Rate card"), money("realised_rate_paise", "Realised"), col("bookings", "Bookings", 1, "right")], rows: r.realised_rate as unknown as Row[] },
        ],
      }), app.dbReplica, user.companyId);
      return sent ?? r;
    },
  });

  route(app, {
    method: "GET", url: "/reports/customer-statement", permission: "report.view",
    schema: { querystring: BookingDocumentQuerySchema, response: { 200: CustomerStatementResponseSchema }, summary: "Customer statement of account (agreement, revisions, schedule, full ledger, other charges, pending cheques)" },
    handler: async (req, reply) => {
      const user = req.user!;
      const fmt = wantedFormat(req.query);
      if (fmt === "pdf") {
        const pdf = await customerStatementPdf(app.dbReplica, user, req.query.booking_id);
        return sendPdf(reply, pdf.filename, pdf.bytes);
      }
      const st = await customerStatement(app.dbReplica, user, req.query.booking_id);
      if (fmt === "csv") return sendRowsCsv(reply, `statement-${st.booking.booking_number.replace(/\//g, "-")}.csv`, ["seq", "entry_date", "event", "label", "bucket", "amount_paise", "cash_paid_cum_paise", "account_paid_cum_paise", "cash_order_raised_paise", "account_order_raised_paise", "cash_due_paise", "account_due_paise", "total_due_paise", "other_charges_due_paise", "ref_number"], st.ledger as unknown as Row[]);
      return st;
    },
  });

  route(app, {
    method: "GET", url: "/reports/payment-schedule", permission: "report.view",
    schema: { querystring: BookingDocumentQuerySchema, response: { 200: ScheduleResponseSchema }, summary: "Payment schedule of a booking (installments with status, expected dates and amounts)" },
    handler: async (req, reply) => {
      const user = req.user!;
      const s = await loadBookingSelect(app.dbReplica, user, req.query.booking_id);
      const rel = await loadBookingRelated(app.dbReplica, [s.booking]);
      const rows = scheduleRows(s.booking, rel.stages.get(s.booking.blockId) ?? [], rel.demands.get(s.booking.id) ?? [], today());
      const keys = ["seq", "name", "percent", "cumulative_percent", "trigger_label", "expected_date", "status", "demand_number", "due_date", "cash_paise", "account_paise", "total_paise", "paid_paise"];
      const sent = await exportTable(reply, wantedFormat(req.query), `schedule-${s.booking.bookingNumber.replace(/\//g, "-")}`, keys, rows as unknown as Row[], () => ({
        title: "Payment schedule", subtitle: `${s.booking.bookingNumber} · ${s.customerName} · ${s.projectName} ${s.flatNumber}`,
        columns: [col("seq", "#", 0.5, "center"), col("name", "Installment", 2), col("trigger_label", "Trigger", 2), col("percent", "%", 0.7, "right"), dateCol("expected_date", "Expected"), col("status", "Status", 1.3), col("demand_number", "Demand", 1.4), money("cash_paise", "Cash"), money("account_paise", "Account"), money("total_paise", "Total"), money("paid_paise", "Paid")],
        rows: rows as unknown as Row[], totals: { name: "Total", cash_paise: rows.reduce((t, x) => t + x.cash_paise, 0), account_paise: rows.reduce((t, x) => t + x.account_paise, 0), total_paise: rows.reduce((t, x) => t + x.total_paise, 0), paid_paise: rows.reduce((t, x) => t + x.paid_paise, 0) },
      }), app.dbReplica, user.companyId);
      return sent ?? { booking_id: s.booking.id, rows };
    },
  });

  route(app, {
    method: "GET", url: "/reports/allotment-letter", permission: "report.view",
    schema: { querystring: BookingDocumentQuerySchema, response: { 200: AllotmentLetterDataSchema }, summary: "Allotment letter data (JSON) or the branded PDF (format=pdf)" },
    handler: async (req, reply) => {
      const user = req.user!;
      if (wantedFormat(req.query) === "pdf") {
        const pdf = await allotmentLetterPdf(app.dbReplica, user, req.query.booking_id);
        return sendPdf(reply, pdf.filename, pdf.bytes);
      }
      const { company: _c, signatory: _s, ...data } = await allotmentLetterData(app.dbReplica, user, req.query.booking_id);
      return data;
    },
  });

  route(app, {
    method: "GET", url: "/reports/cheques", permission: "report.view",
    schema: { querystring: ChequesReportQuerySchema, response: { 200: ChequesReportResponseSchema }, summary: "Cheques in hand (PENDING) or bounced, paged, with totals" },
    handler: async (req, reply) => {
      const user = req.user!;
      const r = await chequesReport(app.dbReplica, user, req.query);
      const rows = r.items.map((c) => ({ ...c, instrument_number: c.instrument?.number ?? null, instrument_bank: c.instrument?.bank_name ?? null }));
      const keys = ["receipt_number", "instrument_date", "payment_date", "booking_number", "customer_name", "project_name", "flat_number", "amount_paise", "mode_code", "instrument_number", "instrument_bank", "bank_account_label", "status", "bounce_reason", "days_in_hand"];
      const sent = await exportTable(reply, wantedFormat(req.query), `cheques-${req.query.status.toLowerCase()}`, keys, rows as unknown as Row[], () => ({
        title: req.query.status === "PENDING" ? "Cheques in hand" : "Bounced cheques", subtitle: `${r.totals.count} instruments`, filters: rangeFilters(req.query), landscape: true,
        columns: [col("receipt_number", "Receipt", 1.4), dateCol("instrument_date", "Instrument date"), dateCol("payment_date", "Received"), col("booking_number", "Booking", 1.4), col("customer_name", "Customer", 1.9), col("project_name", "Project", 1.5), col("flat_number", "Unit", 0.9), col("instrument_number", "Instrument", 1.3), col("instrument_bank", "Drawn on", 1.3), money("amount_paise", "Amount"), col("days_in_hand", "Days", 0.7, "right"), ...(req.query.status === "BOUNCED" ? [col("bounce_reason", "Reason", 1.8)] : [])],
        rows: rows as unknown as Row[], totals: { receipt_number: `Total (${r.totals.count})`, amount_paise: r.totals.amount_paise },
      }), app.dbReplica, user.companyId);
      return sent ?? r;
    },
  });

  route(app, {
    method: "GET", url: "/reports/cancellations", permission: "report.view",
    schema: { querystring: CancellationsReportQuerySchema, response: { 200: CancellationsReportResponseSchema }, summary: "Cancellations & refunds in a date range" },
    handler: async (req, reply) => {
      const user = req.user!;
      const r = await cancellationsReport(app.dbReplica, user, req.query);
      const keys = ["booking_number", "customer_name", "project_name", "flat_number", "booking_date", "cancelled_at", "cancelled_by_name", "reason", "paid_paise", "deduction_paise", "refund_paise"];
      const sent = await exportTable(reply, wantedFormat(req.query), "cancellations", keys, r.rows as unknown as Row[], () => ({
        title: "Cancellations & refunds", subtitle: range(req.query), filters: rangeFilters(req.query),
        columns: [col("booking_number", "Booking", 1.4), col("customer_name", "Customer", 1.9), col("project_name", "Project", 1.5), col("flat_number", "Unit", 0.8), dateCol("booking_date", "Booked"), { key: "cancelled_at", header: "Cancelled", width: 1.3, align: "center", render: (x) => pdfDate(String(x["cancelled_at"]).slice(0, 10)) }, col("reason", "Reason", 2), money("paid_paise", "Paid"), money("deduction_paise", "Deduction"), money("refund_paise", "Refund")],
        rows: r.rows as unknown as Row[], totals: { booking_number: `Total (${r.totals.count})`, paid_paise: r.totals.paid_paise, deduction_paise: r.totals.deduction_paise, refund_paise: r.totals.refund_paise },
      }), app.dbReplica, user.companyId);
      return sent ?? r;
    },
  });

  route(app, {
    method: "GET", url: "/reports/sales-funnel", permission: "report.view",
    schema: { querystring: SalesFunnelQuerySchema, response: { 200: SalesFunnelResponseSchema }, summary: "Sales & leads funnel: by source/stage, response time, bookings per salesperson, website enquiries, brochure downloads, site visits" },
    handler: async (req, reply) => {
      const user = req.user!;
      const r = await salesFunnel(app.dbReplica, user, req.query);
      const csvRows = [
        ...r.by_stage.map((s) => ({ section: "stage", label: s.stage, count: s.count })),
        ...r.by_source.map((s) => ({ section: "source", label: s.source, count: s.leads, converted: s.converted, conversion_percent: s.conversion_percent })),
        ...r.by_salesperson.map((s) => ({ section: "salesperson", label: s.user_name, count: s.leads, visits: s.visits, bookings: s.bookings, booking_value_paise: s.booking_value_paise, avg_first_response_hours: s.avg_first_response_hours })),
        { section: "website", label: "enquiries", count: r.website.enquiries }, { section: "website", label: "brochure_downloads", count: r.website.brochure_downloads }, { section: "website", label: "site_visits_booked", count: r.website.site_visits_booked },
      ];
      const sent = await exportTable(reply, wantedFormat(req.query), "sales-funnel", ["section", "label", "count", "converted", "conversion_percent", "visits", "bookings", "booking_value_paise", "avg_first_response_hours"], csvRows as unknown as Row[], () => ({
        title: "Sales & leads funnel", subtitle: range(req.query), filters: [...rangeFilters(req.query), ...(req.query.source ? [["Source", req.query.source] as const] : [])],
        columns: [col("stage", "Stage", 3), col("count", "Leads", 1, "right")], rows: r.by_stage as unknown as Row[], totals: { stage: "Total leads", count: r.totals.leads },
        sections: [
          { heading: "By source", columns: [col("source", "Source", 2), col("leads", "Leads", 1, "right"), col("converted", "Converted", 1, "right"), col("conversion_percent", "Conversion %", 1, "right")], rows: r.by_source as unknown as Row[] },
          { heading: "By salesperson", columns: [col("user_name", "Salesperson", 2), col("leads", "Leads", 0.8, "right"), col("visits", "Visits", 0.8, "right"), col("bookings", "Bookings", 0.8, "right"), money("booking_value_paise", "Booked value", 1.8), col("avg_first_response_hours", "Avg first response (h)", 1.4, "right")], rows: r.by_salesperson as unknown as Row[] },
          { heading: "Website", columns: [col("metric", "Metric", 3), col("value", "Value", 1, "right")], rows: [{ metric: "Enquiries", value: r.website.enquiries }, { metric: "Brochure downloads", value: r.website.brochure_downloads }, { metric: "Site visits booked", value: r.website.site_visits_booked }, ...r.website.site_visits_by_status.map((s) => ({ metric: `Site visits – ${s.status}`, value: s.count })), { metric: "Average first response (hours)", value: r.avg_response_hours ?? "—" }] },
        ],
      }), app.dbReplica, user.companyId);
      return sent ?? r;
    },
  });

  route(app, {
    method: "GET", url: "/reports/roznamcha", permission: "report.view",
    schema: { querystring: RoznamchaReportQuerySchema, response: { 200: RoznamchaResponseSchema }, summary: "Roznamcha (day book) for a date range: opening cash, receipts by mode/category/project, contra, closing cash" },
    handler: async (req, reply) => {
      const user = req.user!;
      if (req.query.project_id) ensureProjectAccess(user, req.query.project_id);
      const r = await roznamcha(app.dbReplica, user, req.query.from, req.query.to, req.query.project_id);
      const keys = ["payment_date", "receipt_number", "customer_name", "booking_number", "project_name", "flat_number", "mode_code", "category", "instrument_number", "bank_account_label", "amount_paise"];
      const sent = await exportTable(reply, wantedFormat(req.query), "roznamcha", keys, r.receipts as unknown as Row[], () => ({
        title: "Roznamcha (day book)", subtitle: range(req.query), landscape: true,
        filters: [...rangeFilters(req.query), ["Opening cash in hand", String(r.opening_cash_paise)], ["Closing cash in hand", String(r.closing_cash_paise)]],
        columns: [dateCol("payment_date", "Date"), col("receipt_number", "Receipt", 1.4), col("customer_name", "Customer", 1.9), col("booking_number", "Booking", 1.4), col("project_name", "Project", 1.5), col("flat_number", "Unit", 0.8), col("mode_code", "Mode", 1.1), col("category", "Category", 1), col("instrument_number", "Instrument", 1.2), col("bank_account_label", "Bank", 1.4), money("amount_paise", "Amount")],
        rows: r.receipts as unknown as Row[], totals: { payment_date: `Total (${r.totals.receipts_count})`, amount_paise: r.totals.receipts_paise },
        sections: [
          { heading: "Cash in hand", columns: [col("label", "Item", 3), money("amount_paise", "Amount", 2)], rows: [{ label: "Opening cash in hand", amount_paise: r.opening_cash_paise }, { label: "Cash received", amount_paise: r.cash_received_paise }, { label: "Cash deposited to bank", amount_paise: -r.cash_deposited_paise }, { label: "Cash withdrawn from bank", amount_paise: r.cash_withdrawn_paise }, { label: "Closing cash in hand", amount_paise: r.closing_cash_paise }, { label: "Cheques in hand (pending)", amount_paise: r.totals.pending_cheques_paise }] },
          { heading: "By mode", columns: [col("mode_name", "Mode", 2), col("count", "Receipts", 1, "right"), money("amount_paise", "Amount", 2)], rows: r.by_mode as unknown as Row[] },
          { heading: "By category", columns: [col("category", "Category", 2), col("count", "Receipts", 1, "right"), money("amount_paise", "Amount", 2)], rows: r.by_category as unknown as Row[] },
          { heading: "By project", columns: [col("project_name", "Project", 2), col("count", "Receipts", 1, "right"), money("amount_paise", "Amount", 2)], rows: r.by_project as unknown as Row[] },
          { heading: "Contra entries", columns: [dateCol("entry_date", "Date"), col("type", "Type", 1.2), col("bank_account_label", "Bank", 2), col("remarks", "Remarks", 2), money("amount_paise", "Amount", 1.6)], rows: r.contra_entries as unknown as Row[] },
        ],
      }), app.dbReplica, user.companyId);
      return sent ?? r;
    },
  });

  route(app, {
    method: "GET", url: "/reports/bankwise-receipts", permission: "report.view",
    schema: { querystring: BankwiseReceiptsQuerySchema, response: { 200: BankwiseReceiptsResponseSchema }, summary: "Bank-wise receipts (cleared) with a per-mode split" },
    handler: async (req, reply) => {
      const user = req.user!;
      const r = await bankwiseReceipts(app.dbReplica, user, req.query);
      const rows = r.rows.map((x) => ({ ...x, by_mode: x.by_mode.map((m) => `${m.mode_code} ${m.amount_paise} (${m.count})`).join("; ") }));
      const sent = await exportTable(reply, wantedFormat(req.query), "bankwise-receipts", ["bank_account_label", "count", "amount_paise", "by_mode"], rows as unknown as Row[], () => ({
        title: "Bank-wise receipts", subtitle: range(req.query), filters: rangeFilters(req.query),
        columns: [col("bank_account_label", "Bank account", 2.5), col("count", "Receipts", 1, "right"), money("amount_paise", "Amount", 1.8), col("by_mode", "By mode", 3)],
        rows: rows as unknown as Row[], totals: { bank_account_label: `Total (${r.totals.count})`, amount_paise: r.totals.amount_paise },
      }), app.dbReplica, user.companyId);
      return sent ?? r;
    },
  });

  // Company-wide audit actions and staff login attempts (emails, IPs) are audit data, not project data: `audit.view` (Accounts / Super Admin),
  // never the project-scoped `report.view`, which would let a Project Admin read every other project's activity.
  route(app, {
    method: "GET", url: "/reports/activity", permission: "audit.view",
    schema: { querystring: ActivityReportQuerySchema, response: { 200: ActivityReportResponseSchema }, summary: "Activity: audit summary (kind=AUDIT), logins (LOGIN) or failed logins (FAILED_LOGIN), paged (audit.view)" },
    handler: async (req, reply) => {
      const user = req.user!;
      const r = await activityReport(app.dbReplica, user, req.query);
      const keys = ["at", "kind", "actor_type", "actor_name", "identifier", "action", "entity_type", "entity_id", "ip", "reason"];
      const sent = await exportTable(reply, wantedFormat(req.query), `activity-${req.query.kind.toLowerCase()}`, keys, r.items as unknown as Row[], () => ({
        title: `Activity – ${req.query.kind.replace(/_/g, " ").toLowerCase()}`, subtitle: `${r.total} events`, landscape: true,
        columns: [{ key: "at", header: "At (IST)", width: 1.6, render: (x) => pdfDate(String(x["at"]).slice(0, 10)) + " " + String(x["at"]).slice(11, 16) }, col("actor_type", "Actor type", 1), col("actor_name", "Actor", 1.6), col("identifier", "Identifier", 1.8), col("action", "Action", 1.8), col("entity_type", "Entity", 1.3), col("ip", "IP", 1.2), col("reason", "Reason", 1.8)],
        rows: r.items as unknown as Row[],
      }), app.dbReplica, user.companyId);
      return sent ?? r;
    },
  });
}
