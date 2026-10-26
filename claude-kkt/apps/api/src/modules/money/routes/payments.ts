/** Routes: /payments (post, list, cheques in hand, clear, bounce, reverse, receipt) and /demands (SPEC §11). */
import { and, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ChequeListResponseSchema,
  DemandFilterSchema,
  DemandListResponseSchema,
  IdSchema,
  PaymentBounceSchema,
  PaymentClearSchema,
  PaymentCreateSchema,
  PaymentFilterSchema,
  PaymentListResponseSchema,
  PaymentPostResponseSchema,
  PaymentReverseSchema,
  PaymentRowSchema,
  ReceiptDataSchema,
  type ChequeRow,
  type DemandRow,
  type PaymentRow,
} from "@kkt/contracts";
import { bookings, customers, demands, flats, payments, projects } from "@kkt/db";
import { diffDays } from "@kkt/domain";
import { sendCsv } from "../../../lib/csv.js";
import { listPaging, paginate } from "../../../lib/list.js";
import { route } from "../../../lib/routes.js";
import { ensureProjectAccess, scopeFilter } from "../../../lib/scope.js";
import { expectedVersion, withOptionalVersion } from "../../../lib/version.js";
import { actorOf, loadBooking, todayDate } from "../common.js";
import { bouncePayment, clearPayment, postPayment, receiptData, reversePayment } from "../services/payments.js";
import {
  DEMAND_SELECT,
  PAYMENT_SELECT,
  demandJoins,
  loadPaymentSelect,
  paymentJoins,
  toDemandRow,
  toPaymentRow,
  type DemandSelect,
  type PaymentSelect,
} from "../services/views.js";

const idParams = z.object({ id: IdSchema });
const PAYMENT_CSV = [
  "receipt_number",
  "payment_date",
  "booking_number",
  "customer_name",
  "project_name",
  "flat_number",
  "against",
  "bucket",
  "other_charge_name",
  "amount_paise",
  "mode_code",
  "status",
  "bank_account_label",
  "received_by_name",
  "remarks",
];
const DEMAND_CSV = [
  "demand_number",
  "demand_date",
  "due_date",
  "booking_number",
  "customer_name",
  "project_name",
  "block_name",
  "flat_number",
  "installment_seq",
  "installment_name",
  "trigger_label",
  "percent",
  "cash_demand_paise",
  "account_demand_paise",
  "total_demand_paise",
  "paid_paise",
  "status",
  "days_overdue",
];

function instrumentDate(p: PaymentRow): string | null {
  return p.instrument?.date ?? null;
}

function toChequeRow(p: PaymentRow, today: string): ChequeRow {
  return {
    id: p.id,
    receipt_number: p.receipt_number,
    booking_number: p.booking_number,
    customer_name: p.customer_name,
    project_name: p.project_name,
    flat_number: p.flat_number,
    amount_paise: p.amount_paise,
    payment_date: p.payment_date,
    mode_code: p.mode_code,
    instrument: p.instrument,
    bank_account_label: p.bank_account_label,
    status: p.status,
    bounce_reason: p.bounce_reason,
    version: p.version,
    instrument_date: instrumentDate(p),
    days_in_hand: Math.max(0, diffDays(today, p.payment_date)), // today − receipt date
  };
}

export function registerPaymentRoutes(app: FastifyInstance): void {
  route(app, {
    method: "POST",
    url: "/payments",
    permission: "payment.post",
    idempotent: "required",
    schema: {
      body: PaymentCreateSchema,
      response: { 201: PaymentPostResponseSchema },
      summary: "Post a payment (Idempotency-Key required; bucket cap is the only block)",
    },
    handler: async (req, reply) => {
      const user = req.user!;
      const key = req.headers["idempotency-key"];
      const result = await postPayment(
        app.db,
        user,
        req.body,
        actorOf(req),
        Array.isArray(key) ? (key[0] ?? null) : (key ?? null),
      );
      // the key was found on an existing payment (the plugin's replay record was lost): same receipt, nothing created
      if (result.replayed) reply.header("Idempotent-Replayed", "true");
      const payment = toPaymentRow(await loadPaymentSelect(app.db, user, result.paymentId));
      const b = await loadBooking(app.db, user.companyId, req.body.booking_id);
      return reply.code(201).send({
        payment,
        ledger_seq: result.ledgerSeq,
        receipt_url: `/api/v1/payments/${payment.id}/receipt`,
        summary: {
          cash_due_paise: b.cashOrderRaisedPaise - b.cashPaidPaise,
          account_due_paise: b.accountOrderRaisedPaise - b.accountPaidPaise,
          total_due_paise: b.cashOrderRaisedPaise - b.cashPaidPaise + b.accountOrderRaisedPaise - b.accountPaidPaise,
          other_charges_due_paise: b.otherChargesDemandedPaise - b.otherChargesPaidPaise,
        },
      });
    },
  });

  async function listPayments(
    req: { user?: unknown; query: z.infer<typeof PaymentFilterSchema> },
    forceStatus?: "PENDING",
  ) {
    const user = req.user as NonNullable<typeof req.user> & {
      companyId: string;
      allProjects: boolean;
      projectIds: string[];
    };
    const q = req.query;
    if (q.project_id) ensureProjectAccess(user, q.project_id);
    const where: (SQL | undefined)[] = [eq(payments.companyId, user.companyId), scopeFilter(user, payments.projectId)];
    if (q.booking_id) where.push(eq(payments.bookingId, q.booking_id));
    if (q.project_id) where.push(eq(payments.projectId, q.project_id));
    if (q.block_id) where.push(eq(payments.blockId, q.block_id));
    if (q.customer_id) where.push(eq(payments.customerId, q.customer_id));
    const status = forceStatus ?? (q.pending_only ? "PENDING" : q.status);
    if (status) where.push(eq(payments.status, status));
    if (q.against) where.push(eq(payments.against, q.against));
    if (q.bucket) where.push(eq(payments.bucket, q.bucket));
    if (q.mode_code) where.push(eq(payments.modeCode, q.mode_code));
    if (q.bank_account_id) where.push(eq(payments.bankAccountId, q.bank_account_id));
    if (q.from) where.push(gte(payments.paymentDate, q.from));
    if (q.to) where.push(lte(payments.paymentDate, q.to));
    // the instrument date lives inside the jsonb; selecting the same expression lets paginate() read the keyset cursor value back
    const instrumentDateCol = sql<string>`(${payments.instrument} ->> 'date')`;
    const result = await paginate<PaymentSelect>(app.dbReplica, {
      table: payments,
      select: { ...PAYMENT_SELECT, instrumentDate: instrumentDateCol },
      join: paymentJoins,
      where: and(...where.filter((w): w is SQL => w !== undefined)),
      search: {
        columns: [
          payments.receiptNumber,
          bookings.bookingNumber,
          customers.fullName,
          flats.flatNumber,
          sql`(${payments.instrument} ->> 'number')`,
        ],
        term: q.search,
      },
      sort: {
        allowed: {
          payment_date: payments.paymentDate,
          receipt_number: payments.receiptNumber,
          amount_paise: payments.amountPaise,
          posted_at: payments.postedAt,
          status: payments.status,
          customer_name: customers.fullName,
          instrument_date: instrumentDateCol as unknown as typeof payments.paymentDate,
        },
        default: status === "PENDING" ? "instrument_date" : "-payment_date",
        requested: q.sort,
      },
      ...listPaging(q),
    });
    return { ...result, items: result.items.map(toPaymentRow) };
  }

  route(app, {
    method: "GET",
    url: "/payments",
    permission: "payment.read",
    schema: {
      querystring: PaymentFilterSchema,
      response: { 200: PaymentListResponseSchema },
      summary: "List payments (filters booking/project/status/mode/date range; csv)",
    },
    handler: async (req, reply) => {
      const result = await listPayments(req);
      if (req.query.format === "csv")
        return sendCsv(
          reply,
          "payments.csv",
          PAYMENT_CSV.map((k) => ({ key: k, header: k })),
          result.items as unknown as Record<string, unknown>[],
        );
      return result;
    },
  });

  route(app, {
    method: "GET",
    url: "/payments/cheques",
    permission: "payment.read",
    schema: {
      querystring: PaymentFilterSchema,
      response: { 200: ChequeListResponseSchema },
      summary: "Cheques in hand (PENDING, by instrument date) or bounced (status=BOUNCED)",
    },
    handler: async (req, reply) => {
      const result = await listPayments(req, req.query.status === "BOUNCED" ? undefined : "PENDING");
      const today = todayDate();
      const items = result.items.map((p) => toChequeRow(p, today));
      if (req.query.format === "csv")
        return sendCsv(
          reply,
          "cheques.csv",
          [
            "receipt_number",
            "instrument_date",
            "payment_date",
            "booking_number",
            "customer_name",
            "amount_paise",
            "mode_code",
            "bank_account_label",
            "status",
            "days_in_hand",
          ].map((k) => ({ key: k, header: k })),
          items as unknown as Record<string, unknown>[],
        );
      return { ...result, items };
    },
  });

  route(app, {
    method: "GET",
    url: "/payments/:id",
    permission: "payment.read",
    schema: { params: idParams, response: { 200: PaymentRowSchema }, summary: "One payment" },
    handler: async (req) => toPaymentRow(await loadPaymentSelect(app.dbReplica, req.user!, req.params.id)),
  });

  route(app, {
    method: "POST",
    url: "/payments/:id/clear",
    permission: "payment.clear",
    schema: {
      params: idParams,
      body: withOptionalVersion(PaymentClearSchema),
      response: { 200: PaymentRowSchema },
      summary: "Clear a pending cheque/DD (bucket cap re-checked at clearing)",
    },
    handler: async (req) => {
      await clearPayment(
        app.db,
        req.user!,
        req.params.id,
        { ...req.body, version: expectedVersion(req, req.body) },
        actorOf(req),
      );
      return toPaymentRow(await loadPaymentSelect(app.db, req.user!, req.params.id));
    },
  });

  route(app, {
    method: "POST",
    url: "/payments/:id/bounce",
    permission: "payment.clear",
    schema: {
      params: idParams,
      body: withOptionalVersion(PaymentBounceSchema),
      response: { 200: PaymentRowSchema },
      summary: "Bounce a pending cheque/DD with reason (never counts; Accounts notified)",
    },
    handler: async (req) => {
      await bouncePayment(
        app.db,
        req.user!,
        req.params.id,
        { ...req.body, version: expectedVersion(req, req.body) },
        actorOf(req),
      );
      return toPaymentRow(await loadPaymentSelect(app.db, req.user!, req.params.id));
    },
  });

  route(app, {
    method: "POST",
    url: "/payments/:id/reverse",
    permission: "payment.reverse",
    schema: {
      params: idParams,
      body: withOptionalVersion(PaymentReverseSchema),
      response: { 200: PaymentRowSchema },
      summary: "Reverse a cleared payment (negative REVERSAL row; receipt cancelled)",
    },
    handler: async (req) => {
      await reversePayment(
        app.db,
        req.user!,
        req.params.id,
        { ...req.body, version: expectedVersion(req, req.body) },
        actorOf(req),
      );
      return toPaymentRow(await loadPaymentSelect(app.db, req.user!, req.params.id));
    },
  });

  route(app, {
    method: "GET",
    url: "/payments/:id/receipt",
    permission: "receipt.print",
    schema: {
      params: idParams,
      response: { 200: ReceiptDataSchema },
      summary: "Receipt data for the PDF (letterhead, amount in words, realisation / cancelled flags)",
    },
    handler: async (req) => receiptData(app.dbReplica, req.user!, req.params.id),
  });

  route(app, {
    method: "GET",
    url: "/demands",
    permission: "payment.read",
    schema: {
      querystring: DemandFilterSchema,
      response: { 200: DemandListResponseSchema },
      summary: "List demands (filters booking/project/block/customer/status/overdue/date range; csv)",
    },
    handler: async (req, reply) => {
      const user = req.user!;
      const q = req.query;
      if (q.project_id) ensureProjectAccess(user, q.project_id);
      const today = todayDate();
      const where: (SQL | undefined)[] = [eq(demands.companyId, user.companyId), scopeFilter(user, demands.projectId)];
      if (!q.include_inactive) where.push(sql`${demands.status} <> 'VOID'`);
      if (q.booking_id) where.push(eq(demands.bookingId, q.booking_id));
      if (q.project_id) where.push(eq(demands.projectId, q.project_id));
      if (q.block_id) where.push(eq(demands.blockId, q.block_id));
      if (q.customer_id) where.push(eq(demands.customerId, q.customer_id));
      if (q.status) where.push(eq(demands.status, q.status));
      if (q.overdue_only)
        where.push(sql`${demands.status} in ('OPEN', 'PARTIALLY_PAID') and ${demands.dueDate} < ${today}::date`);
      if (q.from) where.push(gte(demands.demandDate, q.from));
      if (q.to) where.push(lte(demands.demandDate, q.to));
      const result = await paginate<DemandSelect>(app.dbReplica, {
        table: demands,
        select: DEMAND_SELECT,
        join: demandJoins,
        where: and(...where.filter((w): w is SQL => w !== undefined)),
        search: {
          columns: [
            demands.demandNumber,
            bookings.bookingNumber,
            customers.fullName,
            flats.flatNumber,
            demands.installmentName,
          ],
          term: q.search,
        },
        sort: {
          allowed: {
            due_date: demands.dueDate,
            demand_date: demands.demandDate,
            demand_number: demands.demandNumber,
            posted_at: demands.postedAt,
            status: demands.status,
            total_demand_paise: demands.totalDemandPaise,
            customer_name: customers.fullName,
            project_name: projects.name,
          },
          default: "-posted_at",
          requested: q.sort,
        },
        ...listPaging(q),
      });
      const items: DemandRow[] = result.items.map((r) => toDemandRow(r, today));
      if (q.format === "csv")
        return sendCsv(
          reply,
          "demands.csv",
          DEMAND_CSV.map((k) => ({ key: k, header: k })),
          items as unknown as Record<string, unknown>[],
        );
      return { ...result, items };
    },
  });
}
