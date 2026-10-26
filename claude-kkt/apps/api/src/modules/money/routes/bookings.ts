/** Routes: /booking-drafts, /bookings and its sub-resources (SPEC §12, §11 ledger, §10 schedule). */
import { and, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  AgreementRevisionCreateSchema,
  BookingCancelSchema,
  BookingCompleteSchema,
  BookingCreateSchema,
  BookingDetailResponseSchema,
  BookingDraftListResponseSchema,
  BookingDraftRowSchema,
  BookingDraftUpsertSchema,
  BookingFilterSchema,
  BookingListResponseSchema,
  BookingPlanChangeSchema,
  BookingUpdateSchema,
  DemandLetterDataSchema,
  DemandListResponseSchema,
  IdSchema,
  LedgerResponseSchema,
  ListQuerySchema,
  OtherChargeAddSchema,
  OtherChargeDemandLineSchema,
  PaymentListResponseSchema,
  ScheduleResponseSchema,
  type BookingDraftRow,
  type BookingRow,
} from "@kkt/contracts";
import {
  bookingDrafts,
  bookings,
  customers,
  demands,
  flats,
  ledgerEntries,
  payments,
  projects,
  type Executor,
} from "@kkt/db";
import { sendCsv } from "../../../lib/csv.js";
import { ApiError } from "../../../lib/errors.js";
import { listPaging, paginate } from "../../../lib/list.js";
import { route } from "../../../lib/routes.js";
import { ensureProjectAccess, scopeFilter } from "../../../lib/scope.js";
import { assertVersion, expectedVersion, withOptionalVersion } from "../../../lib/version.js";
import { actorOf } from "../common.js";
import {
  addOtherCharge,
  cancelBooking,
  changePlan,
  completeBooking,
  createBooking,
  demandOtherChargeLine,
  reviseAgreement,
  updateBooking,
} from "../services/bookings.js";
import { nonVoidDemands } from "../services/dues.js";
import { demandLetterData } from "../services/payments.js";
import {
  BOOKING_SELECT,
  DEMAND_SELECT,
  PAYMENT_SELECT,
  bookingDetail,
  bookingJoins,
  demandJoins,
  loadBookingSelect,
  loadBookingSummary,
  paymentJoins,
  scheduleRows,
  toBookingRows,
  toCompactBookingRows,
  toDemandRow,
  toLedgerRow,
  toPaymentRow,
  type BookingSelect,
  type DemandSelect,
  type PaymentSelect,
} from "../services/views.js";
import type { LedgerEntryRecord } from "../services/ledger.js";
import { loadTowerStages } from "../common.js";

const idParams = z.object({ id: IdSchema });

const BOOKING_CSV = [
  "booking_number",
  "project_name",
  "block_name",
  "flat_number",
  "customer_name",
  "customer_phone",
  "booking_date",
  "status",
  "agreement_value_paise",
  "cash_agreed_paise",
  "account_agreed_paise",
  "raised_percent",
  "cash_order_raised_paise",
  "account_order_raised_paise",
  "cash_paid_paise",
  "account_paid_paise",
  "cash_due_paise",
  "account_due_paise",
  "total_due_paise",
  "other_charges_due_paise",
  "pending_cheques_paise",
];

function bookingCsvValue(r: BookingRow, key: string): unknown {
  switch (key) {
    case "raised_percent":
      return r.summary.raised_percent;
    case "cash_order_raised_paise":
      return r.summary.cash.order_raised_paise;
    case "account_order_raised_paise":
      return r.summary.account.order_raised_paise;
    case "cash_paid_paise":
      return r.summary.cash.paid_paise;
    case "account_paid_paise":
      return r.summary.account.paid_paise;
    case "cash_due_paise":
      return r.summary.cash.due_paise;
    case "account_due_paise":
      return r.summary.account.due_paise;
    case "total_due_paise":
      return r.summary.total_due_paise;
    case "other_charges_due_paise":
      return r.summary.other_charges_due_paise;
    case "pending_cheques_paise":
      return r.summary.pending_cheques_paise;
    default:
      return (r as unknown as Record<string, unknown>)[key];
  }
}

const LEDGER_CSV = [
  "seq",
  "entry_date",
  "event",
  "label",
  "bucket",
  "amount_paise",
  "cash_paid_cum_paise",
  "account_paid_cum_paise",
  "cash_order_raised_paise",
  "account_order_raised_paise",
  "cash_due_paise",
  "account_due_paise",
  "total_due_paise",
  "other_charges_due_paise",
  "ref_number",
  "note",
];

async function draftRows(
  db: Executor,
  rows: readonly (typeof bookingDrafts.$inferSelect)[],
): Promise<BookingDraftRow[]> {
  const payloads = rows.map((r) => r.payload as Record<string, unknown>);
  const ids = (key: string) => [
    ...new Set(payloads.map((p) => p[key]).filter((v): v is string => typeof v === "string")),
  ];
  const [flatIds, projectIds, customerIds] = [ids("flat_id"), ids("project_id"), ids("customer_id")];
  const [f, p, c] = await Promise.all([
    flatIds.length
      ? db.select({ id: flats.id, n: flats.flatNumber }).from(flats).where(inArray(flats.id, flatIds))
      : [],
    projectIds.length
      ? db.select({ id: projects.id, n: projects.name }).from(projects).where(inArray(projects.id, projectIds))
      : [],
    customerIds.length
      ? db.select({ id: customers.id, n: customers.fullName }).from(customers).where(inArray(customers.id, customerIds))
      : [],
  ]);
  const fm = new Map(f.map((x) => [x.id, x.n])),
    pm = new Map(p.map((x) => [x.id, x.n])),
    cm = new Map(c.map((x) => [x.id, x.n]));
  return rows.map((r, i) => {
    const pl = payloads[i]!;
    return {
      id: r.id,
      user_id: r.userId,
      step: r.step,
      payload: pl,
      flat_number: fm.get(String(pl["flat_id"])) ?? null,
      project_name: pm.get(String(pl["project_id"])) ?? null,
      customer_name: cm.get(String(pl["customer_id"])) ?? null,
      updated_at: r.updatedAt.toISOString(),
      version: r.version,
    };
  });
}

export function registerBookingRoutes(app: FastifyInstance): void {
  // ---- wizard drafts -------------------------------------------------------
  route(app, {
    method: "GET",
    url: "/booking-drafts",
    permission: "booking.create",
    schema: { response: { 200: BookingDraftListResponseSchema }, summary: "My saved wizard drafts (Resume booking)" },
    handler: async (req) => {
      const rows = await app.db
        .select()
        .from(bookingDrafts)
        .where(and(eq(bookingDrafts.userId, req.user!.id), eq(bookingDrafts.companyId, req.user!.companyId)))
        .orderBy(desc(bookingDrafts.updatedAt))
        .limit(20);
      return { items: await draftRows(app.db, rows) };
    },
  });
  route(app, {
    method: "PUT",
    url: "/booking-drafts",
    permission: "booking.create",
    schema: {
      body: BookingDraftUpsertSchema,
      response: { 200: BookingDraftRowSchema },
      summary: "Autosave a wizard draft (upsert by id)",
    },
    handler: async (req) => {
      const user = req.user!;
      const body = req.body;
      const payload = body.payload as Record<string, unknown>;
      // Upsert by the client-generated id: a retried autosave updates the same row instead of creating a duplicate. The update
      // only applies to the caller's own draft (another user's id → 404, nothing changes).
      const id = body.id ?? randomUUID();
      const [row] = await app.db
        .insert(bookingDrafts)
        .values({ id, companyId: user.companyId, userId: user.id, payload, step: body.step })
        .onConflictDoUpdate({
          target: bookingDrafts.id,
          set: { payload, step: body.step, updatedAt: new Date(), version: sql`${bookingDrafts.version} + 1` },
          setWhere: and(eq(bookingDrafts.userId, user.id), eq(bookingDrafts.companyId, user.companyId)),
        })
        .returning();
      if (!row) throw ApiError.notFound("Draft");
      return (await draftRows(app.db, [row]))[0]!;
    },
  });
  route(app, {
    method: "DELETE",
    url: "/booking-drafts/:id",
    permission: "booking.create",
    schema: { params: idParams, response: { 204: z.null() }, summary: "Discard a wizard draft" },
    handler: async (req, reply) => {
      const expected = expectedVersion(req, null);
      await app.db.transaction(async (tx) => {
        const [draft] = await tx
          .select({ id: bookingDrafts.id, version: bookingDrafts.version })
          .from(bookingDrafts)
          .where(and(eq(bookingDrafts.id, req.params.id), eq(bookingDrafts.userId, req.user!.id)))
          .for("update")
          .limit(1);
        if (!draft) throw ApiError.notFound("Draft");
        await assertVersion(tx, bookingDrafts, draft.id, draft.version, expected, "booking_draft");
        await tx.delete(bookingDrafts).where(eq(bookingDrafts.id, draft.id));
      });
      return reply.code(204).send();
    },
  });

  // ---- bookings ------------------------------------------------------------
  route(app, {
    method: "GET",
    url: "/bookings",
    permission: "booking.read",
    schema: {
      querystring: BookingFilterSchema,
      response: { 200: BookingListResponseSchema },
      summary: "List bookings (scope, filters, search, csv)",
    },
    handler: async (req, reply) => {
      const user = req.user!;
      const q = req.query;
      if (q.project_id) ensureProjectAccess(user, q.project_id);
      const where: (SQL | undefined)[] = [
        eq(bookings.companyId, user.companyId),
        scopeFilter(user, bookings.projectId),
      ];
      if (q.project_id) where.push(eq(bookings.projectId, q.project_id));
      if (q.block_id) where.push(eq(bookings.blockId, q.block_id));
      if (q.customer_id)
        where.push(
          sql`(${bookings.customerId} = ${q.customer_id}::uuid or exists (select 1 from booking_co_applicants ca where ca.booking_id = ${bookings.id} and ca.customer_id = ${q.customer_id}::uuid))`,
        );
      if (q.status) where.push(eq(bookings.status, q.status));
      if (q.payment_plan_id) where.push(eq(bookings.paymentPlanId, q.payment_plan_id));
      if (q.sales_user_id) where.push(eq(bookings.salesUserId, q.sales_user_id));
      if (q.from) where.push(gte(bookings.bookingDate, q.from));
      if (q.to) where.push(lte(bookings.bookingDate, q.to));
      if (q.has_due === true)
        where.push(
          sql`(${bookings.cashOrderRaisedPaise} - ${bookings.cashPaidPaise} + ${bookings.accountOrderRaisedPaise} - ${bookings.accountPaidPaise}) > 0`,
        );
      if (q.has_advance === true)
        where.push(
          sql`(${bookings.cashOrderRaisedPaise} - ${bookings.cashPaidPaise} < 0 or ${bookings.accountOrderRaisedPaise} - ${bookings.accountPaidPaise} < 0)`,
        );
      const result = await paginate<BookingSelect>(app.dbReplica, {
        table: bookings,
        select: BOOKING_SELECT,
        join: bookingJoins,
        where: and(...where.filter((w): w is SQL => w !== undefined)),
        search: {
          columns: [bookings.bookingNumber, customers.fullName, flats.flatNumber, customers.phone],
          term: q.search,
        },
        sort: {
          allowed: {
            booking_date: bookings.bookingDate,
            booking_number: bookings.bookingNumber,
            created_at: bookings.createdAt,
            status: bookings.status,
            customer_name: customers.fullName,
            agreement_value_paise: bookings.agreementValuePaise,
          },
          default: "-booking_date",
          requested: q.sort,
        },
        ...listPaging(q),
      });
      if (q.format === "csv") {
        const full = await toBookingRows(app.dbReplica, result.items);
        return sendCsv<BookingRow>(
          reply,
          "bookings.csv",
          BOOKING_CSV.map((k) => ({ key: k, header: k, value: (r: BookingRow) => bookingCsvValue(r, k) })),
          full,
        );
      }
      // compact rows by default (≈ 1 KB each: no snapshots, schedule or related lists); view=full for every field
      const items =
        q.view === "full"
          ? await toBookingRows(app.dbReplica, result.items)
          : await toCompactBookingRows(app.dbReplica, result.items);
      return { ...result, items };
    },
  });

  route(app, {
    method: "POST",
    url: "/bookings",
    permission: "booking.create",
    idempotent: true,
    schema: {
      body: BookingCreateSchema,
      response: { 201: BookingDetailResponseSchema },
      summary: "Create a booking (atomic flat lock, snapshots, parking, other charges, dues catch-up)",
    },
    handler: async (req, reply) => {
      const id = await createBooking(app.db, req.user!, req.body, actorOf(req));
      return reply.code(201).send(await bookingDetail(app.db, await loadBookingSelect(app.db, req.user!, id)));
    },
  });

  route(app, {
    method: "GET",
    url: "/bookings/:id",
    permission: "booking.read",
    schema: {
      params: idParams,
      response: { 200: BookingDetailResponseSchema },
      summary: "Booking detail (summary, other charges, schedule, revisions)",
    },
    handler: async (req) =>
      bookingDetail(app.dbReplica, await loadBookingSelect(app.dbReplica, req.user!, req.params.id)),
  });

  route(app, {
    method: "PATCH",
    url: "/bookings/:id",
    permission: "booking.create",
    schema: {
      params: idParams,
      body: withOptionalVersion(BookingUpdateSchema),
      response: { 200: BookingDetailResponseSchema },
      summary: "Update remarks / sales user / broker / co-applicants",
    },
    handler: async (req) => {
      const version = expectedVersion(req, req.body);
      await updateBooking(app.db, req.user!, req.params.id, { ...req.body, version }, actorOf(req));
      return bookingDetail(app.db, await loadBookingSelect(app.db, req.user!, req.params.id));
    },
  });

  route(app, {
    method: "GET",
    url: "/bookings/:id/ledger",
    permission: "booking.read",
    schema: {
      params: idParams,
      querystring: ListQuerySchema,
      response: { 200: LedgerResponseSchema },
      summary: "Two-bucket ledger: rows with running balances (paged, seq ascending) + current summary (csv)",
    },
    handler: async (req, reply) => {
      const s = await loadBookingSelect(app.dbReplica, req.user!, req.params.id);
      const q = req.query;
      // the summary statement runs alongside the page (not for CSV, which has no summary)
      const summary = q.format === "csv" ? null : loadBookingSummary(app.dbReplica, s.booking);
      summary?.catch(() => undefined); // handled when awaited below; never an unhandled rejection if the page query fails first
      const result = await paginate<LedgerEntryRecord>(app.dbReplica, {
        table: ledgerEntries,
        where: eq(ledgerEntries.bookingId, s.booking.id),
        search: { columns: [ledgerEntries.label, ledgerEntries.refNumber], term: q.search },
        sort: {
          allowed: { seq: ledgerEntries.seq, entry_date: ledgerEntries.entryDate },
          default: "seq",
          requested: q.sort,
        },
        ...listPaging(q),
      });
      const rows = result.items.map(toLedgerRow);
      if (q.format === "csv")
        return sendCsv(
          reply,
          `ledger-${s.booking.bookingNumber.replace(/\//g, "-")}.csv`,
          LEDGER_CSV.map((k) => ({ key: k, header: k })),
          rows as unknown as Record<string, unknown>[],
        );
      return { ...result, items: rows, summary: await summary! };
    },
  });

  route(app, {
    method: "GET",
    url: "/bookings/:id/schedule",
    permission: "booking.read",
    schema: {
      params: idParams,
      response: { 200: ScheduleResponseSchema },
      summary: "Installment schedule with raised demands merged",
    },
    handler: async (req) => {
      const s = await loadBookingSelect(app.dbReplica, req.user!, req.params.id);
      return {
        booking_id: s.booking.id,
        rows: scheduleRows(
          s.booking,
          await loadTowerStages(app.dbReplica, s.booking.blockId),
          await nonVoidDemands(app.dbReplica, s.booking.id),
        ),
      };
    },
  });

  route(app, {
    method: "GET",
    url: "/bookings/:id/demands",
    permission: "booking.read",
    schema: {
      params: idParams,
      querystring: ListQuerySchema,
      response: { 200: DemandListResponseSchema },
      summary: "Demands of a booking (paged; void ones included with include_inactive)",
    },
    handler: async (req) => {
      const s = await loadBookingSelect(app.dbReplica, req.user!, req.params.id);
      const q = req.query;
      const result = await paginate<DemandSelect>(app.dbReplica, {
        table: demands,
        select: DEMAND_SELECT,
        join: demandJoins,
        where: and(
          eq(demands.bookingId, s.booking.id),
          q.include_inactive ? undefined : sql`${demands.status} <> 'VOID'`,
        ),
        search: { columns: [demands.demandNumber, demands.installmentName], term: q.search },
        sort: {
          allowed: {
            posted_at: demands.postedAt,
            due_date: demands.dueDate,
            demand_date: demands.demandDate,
            installment_seq: demands.installmentSeq,
            status: demands.status,
          },
          default: "posted_at",
          requested: q.sort,
        },
        ...listPaging(q),
      });
      return { ...result, items: result.items.map((r) => toDemandRow(r)) };
    },
  });

  route(app, {
    method: "GET",
    url: "/bookings/:id/payments",
    permission: "booking.read",
    schema: {
      params: idParams,
      querystring: ListQuerySchema,
      response: { 200: PaymentListResponseSchema },
      summary: "Payments of a booking (all statuses; paged, newest first)",
    },
    handler: async (req) => {
      const s = await loadBookingSelect(app.dbReplica, req.user!, req.params.id);
      const q = req.query;
      const result = await paginate<PaymentSelect>(app.dbReplica, {
        table: payments,
        select: PAYMENT_SELECT,
        join: paymentJoins,
        where: eq(payments.bookingId, s.booking.id),
        search: { columns: [payments.receiptNumber, sql`(${payments.instrument} ->> 'number')`], term: q.search },
        sort: {
          allowed: {
            payment_date: payments.paymentDate,
            posted_at: payments.postedAt,
            receipt_number: payments.receiptNumber,
            amount_paise: payments.amountPaise,
            status: payments.status,
          },
          default: "-posted_at",
          requested: q.sort,
        },
        ...listPaging(q),
      });
      return { ...result, items: result.items.map(toPaymentRow) };
    },
  });

  route(app, {
    method: "POST",
    url: "/bookings/:id/agreement-revisions",
    permission: "agreement.edit",
    idempotent: true,
    schema: {
      params: idParams,
      body: withOptionalVersion(AgreementRevisionCreateSchema),
      response: { 201: BookingDetailResponseSchema },
      summary: "Revise cash/account agreed values (≥ paid per bucket; telescoping recompute; AGREEMENT_CHANGE row)",
    },
    handler: async (req, reply) => {
      const version = expectedVersion(req, req.body);
      await reviseAgreement(app.db, req.user!, req.params.id, { ...req.body, version }, actorOf(req));
      return reply
        .code(201)
        .send(await bookingDetail(app.db, await loadBookingSelect(app.db, req.user!, req.params.id)));
    },
  });

  route(app, {
    method: "POST",
    url: "/bookings/:id/plan-change",
    permission: "agreement.edit",
    schema: {
      params: idParams,
      body: withOptionalVersion(BookingPlanChangeSchema),
      response: { 200: BookingDetailResponseSchema },
      summary: "Change the payment plan (only while no installment demand is paid)",
    },
    handler: async (req) => {
      await changePlan(
        app.db,
        req.user!,
        req.params.id,
        { ...req.body, version: expectedVersion(req, req.body) },
        actorOf(req),
      );
      return bookingDetail(app.db, await loadBookingSelect(app.db, req.user!, req.params.id));
    },
  });

  route(app, {
    method: "POST",
    url: "/bookings/:id/cancel",
    permission: "booking.cancel",
    schema: {
      params: idParams,
      body: withOptionalVersion(BookingCancelSchema),
      response: { 200: BookingDetailResponseSchema },
      summary: "Cancel a booking (refund ≤ paid; flat and parking freed; ledger closed)",
    },
    handler: async (req) => {
      await cancelBooking(
        app.db,
        req.user!,
        req.params.id,
        { ...req.body, version: expectedVersion(req, req.body) },
        actorOf(req),
      );
      return bookingDetail(app.db, await loadBookingSelect(app.db, req.user!, req.params.id));
    },
  });

  route(app, {
    method: "POST",
    url: "/bookings/:id/complete",
    permission: "booking.complete",
    schema: {
      params: idParams,
      body: withOptionalVersion(BookingCompleteSchema),
      response: { 200: BookingDetailResponseSchema },
      summary: "Handover: possession complete, dues ≤ 0, no pending cheques → COMPLETED, flat SOLD",
    },
    handler: async (req) => {
      await completeBooking(
        app.db,
        req.user!,
        req.params.id,
        { ...req.body, version: expectedVersion(req, req.body) },
        actorOf(req),
      );
      return bookingDetail(app.db, await loadBookingSelect(app.db, req.user!, req.params.id));
    },
  });

  route(app, {
    method: "POST",
    url: "/bookings/:id/other-charges",
    permission: "booking.create",
    idempotent: true,
    schema: {
      params: idParams,
      body: withOptionalVersion(OtherChargeAddSchema),
      response: { 201: BookingDetailResponseSchema },
      summary: "Add an other-charge line to a booking",
    },
    handler: async (req, reply) => {
      await addOtherCharge(
        app.db,
        req.user!,
        req.params.id,
        { ...req.body, version: expectedVersion(req, req.body) },
        actorOf(req),
      );
      return reply
        .code(201)
        .send(await bookingDetail(app.db, await loadBookingSelect(app.db, req.user!, req.params.id)));
    },
  });

  route(app, {
    method: "POST",
    url: "/bookings/:id/other-charges/:lineId/demand",
    permission: "payment.post",
    schema: {
      params: z.object({ id: IdSchema, lineId: IdSchema }),
      body: withOptionalVersion(OtherChargeDemandLineSchema),
      response: { 200: BookingDetailResponseSchema },
      summary: "Raise a manual other-charge demand now",
    },
    handler: async (req) => {
      await demandOtherChargeLine(
        app.db,
        req.user!,
        req.params.id,
        req.params.lineId,
        { ...req.body, version: expectedVersion(req, req.body) },
        actorOf(req),
      );
      return bookingDetail(app.db, await loadBookingSelect(app.db, req.user!, req.params.id));
    },
  });

  route(app, {
    method: "GET",
    url: "/bookings/:id/demands/:demandId/letter",
    permission: "receipt.print",
    schema: {
      params: z.object({ id: IdSchema, demandId: IdSchema }),
      response: { 200: DemandLetterDataSchema },
      summary: "Demand letter data (both buckets, due date, bank details for the Account bucket)",
    },
    handler: async (req) => {
      const user = req.user!;
      if (!user.permissions.has("booking.read"))
        throw ApiError.forbidden("Missing permission booking.read", { permission: "booking.read" });
      return demandLetterData(app.dbReplica, user, req.params.id, req.params.demandId);
    },
  });
}
