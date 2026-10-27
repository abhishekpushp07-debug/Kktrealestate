/**
 * Printable documents (SPEC §11 receipts / demand letters, §14 allotment letter and customer statement of account): data assembly on top
 * of the money module's exported functions and rendering with the branded PDF generator. Every loader is scope-checked (404 outside scope).
 */
import { and, asc, eq, sql } from "drizzle-orm";
import type { AllotmentLetterData, CustomerStatementResponse, DemandLetterData, ReceiptData } from "@kkt/contracts";
import { agreementRevisions, payments, projects, type Executor } from "@kkt/db";
import { amountInWords, formatDateLabel } from "@kkt/domain";
import type { StaffContext } from "../../../lib/scope.js";
import {
  formatAddress,
  ledgerRows,
  demandLetterData,
  receiptData,
  PAYMENT_SELECT,
  loadBookingRelated,
  loadBookingSelect,
  paymentJoins,
  scheduleRows,
  toAgreementRevisionRow,
  toLedgerRow,
  toOtherChargeRow,
  toPaymentRow,
  type PaymentSelect,
} from "../../money/index.js";
import { letterheadFor, today as todayDate } from "../common.js";
import { toChequeRow } from "./moneyReports.js";
import { BrandedPdf, pdfDate, pdfMoney, type PdfLetterhead } from "./pdf.js";

type User = StaffContext;

/** A rendered document. */
export interface RenderedPdf {
  bytes: Buffer;
  filename: string;
}

function fileSafe(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, "-");
}

function bucketLabel(bucket: "CASH" | "ACCOUNT" | null, other: string | null): string {
  if (other) return `Other charge – ${other}`;
  return bucket === "ACCOUNT" ? "Flat value – Account bucket" : "Flat value – Cash bucket";
}

// ---------------------------------------------------------------------------
// Receipt
// ---------------------------------------------------------------------------

/** Receipt PDF (SPEC §11): letterhead, amount in words, "subject to realisation of the cheque" while PENDING, CANCELLED watermark when reversed/bounced. */
export async function receiptPdf(db: Executor, user: User, paymentId: string): Promise<RenderedPdf> {
  const r: ReceiptData = await receiptData(db, user, paymentId);
  const lh = await letterheadFor(db, user.companyId);
  const cancelled = r.is_cancelled || r.status === "REVERSED" || r.status === "BOUNCED";
  const pdf = new BrandedPdf({
    letterhead: lh,
    title: "Payment Receipt",
    reference: `Receipt ${r.receipt_number} · ${formatDateLabel(r.payment_date)}`,
    watermark: cancelled ? "CANCELLED" : null,
  });
  pdf.kv([
    {
      title: "Received from",
      rows: [
        ["Customer", r.customer_name],
        ["Address", r.customer_address ?? "—"],
        ["Booking", r.booking_number],
      ],
    },
    {
      title: "Property",
      rows: [
        ["Project", r.project_name],
        ["Block", r.block_name],
        ["Unit", r.flat_number],
      ],
    },
    {
      title: "Payment",
      rows: [
        ["Receipt no.", r.receipt_number],
        ["Date", pdfDate(r.payment_date)],
        ["Mode", r.mode_name],
        ["Towards", bucketLabel(r.bucket, r.other_charge_name)],
        ["Status", r.status],
      ],
    },
    {
      title: "Instrument & bank",
      rows: [
        ["Instrument no.", r.instrument?.number ?? "—"],
        ["Instrument date", r.instrument?.date ? pdfDate(r.instrument.date) : "—"],
        ["Drawn on", r.instrument?.bank_name ?? "—"],
        ["Credited to", r.bank_account_label ?? "Cash"],
        ["Received by", r.received_by_name ?? "—"],
      ],
    },
  ]);
  pdf.amountBox("Amount received", r.amount_paise);
  pdf.amountInWords(r.amount_paise);
  if (r.subject_to_realisation)
    pdf.paragraph(
      "This receipt is subject to realisation of the cheque / instrument. The amount is credited to your account only once the instrument clears.",
      { italic: true, size: 9 },
    );
  if (r.status === "REVERSED")
    pdf.paragraph(
      "This receipt has been CANCELLED (payment reversed). It is retained for record only and does not evidence any payment.",
      { color: "#B00020", size: 9 },
    );
  if (r.status === "BOUNCED")
    pdf.paragraph("This receipt has been CANCELLED: the instrument was returned unpaid.", {
      color: "#B00020",
      size: 9,
    });
  if (r.remarks) pdf.paragraph(`Remarks: ${r.remarks}`, { size: 9 });
  pdf.spacer(6);
  pdf.signature(r.company.name, r.company.signatory_name, r.company.signatory_title);
  pdf.note(
    "This is a computer-generated receipt and is valid without a physical signature. Cheque / DD payments are credited only once the instrument clears.",
  );
  return { bytes: await pdf.finish(), filename: `receipt-${fileSafe(r.receipt_number)}.pdf` };
}

// ---------------------------------------------------------------------------
// Demand letter
// ---------------------------------------------------------------------------

/** Demand letter PDF (SPEC §11): installment with both buckets, due date, current dues, bank details for the Account bucket. */
export async function demandLetterPdf(
  db: Executor,
  user: User,
  bookingId: string,
  demandId: string,
): Promise<RenderedPdf> {
  const d: DemandLetterData = await demandLetterData(db, user, bookingId, demandId);
  const lh = await letterheadFor(db, user.companyId);
  const pdf = new BrandedPdf({
    letterhead: lh,
    title: "Demand Letter",
    reference: `${d.demand_number} · ${formatDateLabel(d.demand_date)}`,
  });
  pdf.paragraph(`To,\n${d.customer_name}${d.customer_address ? `\n${d.customer_address}` : ""}`, { size: 9.5 });
  pdf.paragraph(
    `Subject: Payment demand for ${d.installment_name} (${d.trigger_label}) – ${d.project_name}, ${d.block_name}, Unit ${d.flat_number}, Booking ${d.booking_number}`,
    { size: 9.5 },
  );
  pdf.paragraph(
    `Dear ${d.customer_name},\n\nWith reference to your booking ${d.booking_number}, the installment "${d.installment_name}" (${d.percent}% of the agreement value) has fallen due on ${formatDateLabel(d.demand_date)} (${d.trigger_label}). You are requested to remit the amounts below on or before ${formatDateLabel(d.due_date)}.`,
    { size: 9.5 },
  );
  pdf.table(
    [
      { key: "label", header: "Installment", width: 3 },
      { key: "cash", header: "Cash bucket", money: true, width: 2 },
      { key: "account", header: "Account bucket", money: true, width: 2 },
      { key: "total", header: "Total", money: true, width: 2 },
      { key: "due", header: "Due date", width: 1.6, align: "center" },
    ],
    [
      {
        label: `${d.installment_name} (${d.percent}%)`,
        cash: d.cash_demand_paise,
        account: d.account_demand_paise,
        total: d.total_demand_paise,
        due: pdfDate(d.due_date),
      },
    ],
  );
  pdf.amountInWords(d.total_demand_paise, "Total demand in words");
  pdf.heading("Position of your account after this demand");
  pdf.kv([
    {
      rows: [
        [
          "Cash bucket due",
          d.cash_due_paise < 0 ? `${pdfMoney(-d.cash_due_paise)} (advance)` : pdfMoney(d.cash_due_paise),
        ],
        [
          "Account bucket due",
          d.account_due_paise < 0 ? `${pdfMoney(-d.account_due_paise)} (advance)` : pdfMoney(d.account_due_paise),
        ],
      ],
    },
    {
      rows: [
        ["Total due", pdfMoney(d.cash_due_paise + d.account_due_paise)],
        ["Due date", pdfDate(d.due_date)],
      ],
    },
  ]);
  if (d.bank) {
    pdf.heading("Bank details for the Account bucket (NEFT / RTGS / cheque in favour of)");
    pdf.kv([
      {
        rows: [
          ["Account name", d.bank.account_name],
          ["Bank", d.bank.bank_name],
          ["Branch", d.bank.branch ?? "—"],
        ],
      },
      {
        rows: [
          ["Account number", d.bank.account_number],
          ["IFSC", d.bank.ifsc],
        ],
      },
    ]);
  }
  pdf.paragraph(
    "Cheques / DDs are to be drawn in favour of the account above and are credited subject to realisation. Please quote your booking number in the transfer remarks. Kindly ignore this letter if the payment has already been made.",
    { size: 9 },
  );
  pdf.signature(lh.name, lh.signatoryName, lh.signatoryTitle);
  return { bytes: await pdf.finish(), filename: `demand-${fileSafe(d.demand_number)}.pdf` };
}

// ---------------------------------------------------------------------------
// Allotment letter
// ---------------------------------------------------------------------------

/** Allotment letter data: booking + flat snapshot + project address/RERA + parking + plan schedule. */
export async function allotmentLetterData(
  db: Executor,
  user: User,
  bookingId: string,
): Promise<AllotmentLetterData & { company: PdfLetterhead; signatory: { name: string | null; title: string | null } }> {
  const s = await loadBookingSelect(db, user, bookingId);
  const b = s.booking;
  const [rel, project, lh] = await Promise.all([
    loadBookingRelated(db, [b]),
    db
      .select({ address: projects.address, rera: projects.reraNumber, name: projects.name })
      .from(projects)
      .where(eq(projects.id, b.projectId))
      .limit(1)
      .then((r) => r[0]),
    letterheadFor(db, user.companyId),
  ]);
  const snap = b.flatSnapshot as typeof b.flatSnapshot & { floor_label?: string; flat_type_name?: string };
  const schedule = scheduleRows(b, rel.stages.get(b.blockId) ?? [], rel.demands.get(b.id) ?? [], todayDate());
  // customer address + signatory in one round trip
  const [company] = await db.execute<{
    signatory_name: string | null;
    signatory_title: string | null;
    address_current: unknown;
  }>(sqlCustomerAndSignatory(b.customerId, b.companyId));
  const addr = formatAddress((company?.address_current ?? null) as Parameters<typeof formatAddress>[0]);
  const reraLine = project?.rera ? `RERA ${project.rera}` : null;
  return {
    booking_number: b.bookingNumber,
    booking_date: b.bookingDate,
    customer_name: s.customerName,
    customer_address: addr,
    co_applicant_names: (rel.coApplicants.get(b.id) ?? []).map((c) => c.full_name),
    project_name: s.projectName,
    project_address: formatAddress(project?.address ?? null) ?? "",
    rera_number: project?.rera ?? null,
    block_name: s.blockName,
    flat_number: s.flatNumber,
    floor_label: snap.floor_label ?? String(snap.floor),
    flat_type_name: snap.flat_type_name ?? snap.flat_type_code,
    carpet_sqft: snap.carpet_sqft ?? null,
    builtup_sqft: snap.builtup_sqft ?? null,
    super_builtup_sqft: snap.super_builtup_sqft,
    parking_slot_numbers: (rel.parking.get(b.id) ?? []).map((p) => p.number),
    agreement_value_paise: b.agreementValuePaise,
    agreement_value_words: amountInWords(b.agreementValuePaise),
    plan_name: b.planSnapshot.name,
    schedule,
    signatory_name: company?.signatory_name ?? null,
    signatory_title: company?.signatory_title ?? null,
    company: { ...lh, reraLine },
    signatory: { name: company?.signatory_name ?? null, title: company?.signatory_title ?? null },
  };
}

function sqlCustomerAndSignatory(customerId: string, companyId: string) {
  return sql`select c.address_current, co.letterhead ->> 'signatory_name' as signatory_name, co.letterhead ->> 'signatory_title' as signatory_title
             from customers c cross join companies co where c.id = ${customerId}::uuid and co.id = ${companyId}::uuid`;
}

/** Allotment letter PDF (SPEC §14). */
export async function allotmentLetterPdf(db: Executor, user: User, bookingId: string): Promise<RenderedPdf> {
  const d = await allotmentLetterData(db, user, bookingId);
  const pdf = new BrandedPdf({
    letterhead: d.company,
    title: "Allotment Letter",
    reference: `${d.booking_number} · ${formatDateLabel(d.booking_date)}`,
  });
  pdf.paragraph(
    `To,\n${d.customer_name}${d.co_applicant_names.length ? ` (with ${d.co_applicant_names.join(", ")})` : ""}${d.customer_address ? `\n${d.customer_address}` : ""}`,
    { size: 9.5 },
  );
  pdf.paragraph(`Subject: Allotment of Unit ${d.flat_number}, ${d.block_name}, ${d.project_name}`, { size: 9.5 });
  pdf.paragraph(
    `Dear ${d.customer_name},\n\nWe are pleased to confirm the allotment of the unit described below against your booking ${d.booking_number} dated ${formatDateLabel(d.booking_date)}, for a total agreement value of ${pdfMoney(d.agreement_value_paise)} (${d.agreement_value_words}), payable as per the payment plan "${d.plan_name}" accepted by you.`,
    { size: 9.5 },
  );
  pdf.kv([
    {
      title: "Unit",
      rows: [
        ["Project", d.project_name],
        ["Address", d.project_address || "—"],
        ["RERA", d.rera_number ?? "—"],
        ["Block", d.block_name],
        ["Unit", d.flat_number],
        ["Floor", d.floor_label],
        ["Type", d.flat_type_name],
      ],
    },
    {
      title: "Areas & parking",
      rows: [
        ["Carpet area", d.carpet_sqft !== null ? `${d.carpet_sqft} sq ft` : "—"],
        ["Built-up area", d.builtup_sqft !== null ? `${d.builtup_sqft} sq ft` : "—"],
        ["Super built-up", `${d.super_builtup_sqft} sq ft`],
        ["Parking", d.parking_slot_numbers.length ? d.parking_slot_numbers.join(", ") : "—"],
        ["Agreement value", pdfMoney(d.agreement_value_paise)],
      ],
    },
  ]);
  pdf.amountInWords(d.agreement_value_paise, "Agreement value in words");
  pdf.heading(`Payment schedule – ${d.plan_name}`);
  pdf.table(
    [
      { key: "seq", header: "#", width: 0.5, align: "center" },
      { key: "name", header: "Installment", width: 2.4 },
      { key: "trigger_label", header: "Trigger", width: 2.2 },
      { key: "percent", header: "%", width: 0.8, align: "right", render: (r) => String(r["percent"]) },
      {
        key: "expected_date",
        header: "Expected",
        width: 1.5,
        align: "center",
        render: (r) => pdfDate(r["expected_date"] as string | null),
      },
      { key: "cash_paise", header: "Cash", money: true, width: 1.8 },
      { key: "account_paise", header: "Account", money: true, width: 1.8 },
      { key: "total_paise", header: "Total", money: true, width: 1.8 },
    ],
    d.schedule as unknown as Record<string, unknown>[],
    {
      totals: {
        name: "Total",
        percent: "100",
        cash_paise: d.schedule.reduce((s, r) => s + r.cash_paise, 0),
        account_paise: d.schedule.reduce((s, r) => s + r.account_paise, 0),
        total_paise: d.schedule.reduce((s, r) => s + r.total_paise, 0),
      },
    },
  );
  pdf.paragraph(
    "This allotment is subject to the terms of the booking application and the agreement for sale. Installments fall due as the linked construction stages are completed or on the dates stated above; demand letters will be issued accordingly.",
    { size: 9 },
  );
  pdf.signature(d.company.name, d.signatory.name, d.signatory.title);
  return { bytes: await pdf.finish(), filename: `allotment-${fileSafe(d.booking_number)}.pdf` };
}

// ---------------------------------------------------------------------------
// Customer statement of account
// ---------------------------------------------------------------------------

/** Statement of account JSON (SPEC §14): agreement + revisions, schedule, full ledger, other charges, pending cheques, summary. */
export async function customerStatement(
  db: Executor,
  user: User,
  bookingId: string,
): Promise<CustomerStatementResponse> {
  const s = await loadBookingSelect(db, user, bookingId);
  const b = s.booking;
  const [rel, revs, ledger, pending, cust] = await Promise.all([
    loadBookingRelated(db, [b]),
    db
      .select()
      .from(agreementRevisions)
      .where(eq(agreementRevisions.bookingId, b.id))
      .orderBy(asc(agreementRevisions.revisedAt)),
    ledgerRows(db, b.id),
    paymentJoins(db.select(PAYMENT_SELECT).from(payments).$dynamic())
      .where(and(eq(payments.bookingId, b.id), eq(payments.status, "PENDING")))
      .orderBy(asc(payments.paymentDate)) as unknown as Promise<PaymentSelect[]>,
    db.execute<{ address_current: unknown }>(
      sql`select address_current from customers where id = ${b.customerId}::uuid`,
    ),
  ]);
  const today = todayDate();
  const snap = b.flatSnapshot as typeof b.flatSnapshot & { flat_type_name?: string };
  const charges = (rel.charges.get(b.id) ?? []).map(toOtherChargeRow);
  const pendingRows = pending.map((p) => toChequeRow(toPaymentRow(p), today));
  const cashDue = b.cashOrderRaisedPaise - b.cashPaidPaise;
  const accountDue = b.accountOrderRaisedPaise - b.accountPaidPaise;
  return {
    generated_at: new Date().toISOString(),
    booking: {
      booking_id: b.id,
      booking_number: b.bookingNumber,
      booking_date: b.bookingDate,
      status: b.status,
      customer_name: s.customerName,
      customer_code: s.customerCode,
      customer_address: formatAddress((cust[0]?.address_current ?? null) as Parameters<typeof formatAddress>[0]),
      co_applicant_names: (rel.coApplicants.get(b.id) ?? []).map((c) => c.full_name),
      project_name: s.projectName,
      block_name: s.blockName,
      flat_number: s.flatNumber,
      flat_type_name: snap.flat_type_name ?? snap.flat_type_code,
      super_builtup_sqft: snap.super_builtup_sqft,
      plan_name: b.planSnapshot.name,
      agreement_value_paise: b.agreementValuePaise,
      cash_agreed_paise: b.cashAgreedPaise,
      account_agreed_paise: b.accountAgreedPaise,
    },
    revisions: revs.map(toAgreementRevisionRow),
    schedule: scheduleRows(b, rel.stages.get(b.blockId) ?? [], rel.demands.get(b.id) ?? [], today),
    ledger: ledger.map(toLedgerRow),
    other_charges: charges,
    pending_cheques: pendingRows,
    summary: {
      cash_order_raised_paise: b.cashOrderRaisedPaise,
      account_order_raised_paise: b.accountOrderRaisedPaise,
      cash_paid_paise: b.cashPaidPaise,
      account_paid_paise: b.accountPaidPaise,
      cash_due_paise: cashDue,
      account_due_paise: accountDue,
      total_due_paise: cashDue + accountDue,
      other_charges_due_paise: b.otherChargesDemandedPaise - b.otherChargesPaidPaise,
      pending_cheques_paise: pendingRows.reduce((t, p) => t + p.amount_paise, 0),
    },
  };
}

function dueText(v: number): string {
  return v < 0 ? `${pdfMoney(-v)} (advance)` : pdfMoney(v);
}

/** Statement of account PDF. */
export async function customerStatementPdf(db: Executor, user: User, bookingId: string): Promise<RenderedPdf> {
  const st = await customerStatement(db, user, bookingId);
  const lh = await letterheadFor(db, user.companyId);
  const b = st.booking;
  const pdf = new BrandedPdf({
    letterhead: lh,
    title: "Statement of Account",
    reference: `${b.booking_number} · as on ${formatDateLabel(todayDate())}`,
    landscape: true,
  });
  pdf.kv([
    {
      title: "Customer",
      rows: [
        ["Name", b.customer_name],
        ["Code", b.customer_code],
        ["Address", b.customer_address ?? "—"],
        ["Co-applicants", b.co_applicant_names.length ? b.co_applicant_names.join(", ") : "—"],
      ],
    },
    {
      title: "Booking",
      rows: [
        ["Booking", `${b.booking_number} (${b.status})`],
        ["Date", pdfDate(b.booking_date)],
        [
          "Unit",
          `${b.project_name} · ${b.block_name} · ${b.flat_number} (${b.flat_type_name}, ${b.super_builtup_sqft} sq ft)`,
        ],
        ["Plan", b.plan_name],
      ],
    },
    {
      title: "Agreement",
      rows: [
        ["Agreement value", pdfMoney(b.agreement_value_paise)],
        ["Cash agreed", pdfMoney(b.cash_agreed_paise)],
        ["Account agreed", pdfMoney(b.account_agreed_paise)],
      ],
    },
    {
      title: "Position",
      rows: [
        [
          "Cash raised / paid",
          `${pdfMoney(st.summary.cash_order_raised_paise)} / ${pdfMoney(st.summary.cash_paid_paise)}`,
        ],
        [
          "Account raised / paid",
          `${pdfMoney(st.summary.account_order_raised_paise)} / ${pdfMoney(st.summary.account_paid_paise)}`,
        ],
        ["Cash due", dueText(st.summary.cash_due_paise)],
        ["Account due", dueText(st.summary.account_due_paise)],
        ["Total due", dueText(st.summary.total_due_paise)],
        ["Other charges due", pdfMoney(st.summary.other_charges_due_paise)],
        ["Cheques in hand", pdfMoney(st.summary.pending_cheques_paise)],
      ],
    },
  ]);
  pdf.amountInWords(
    Math.abs(st.summary.total_due_paise),
    st.summary.total_due_paise < 0 ? "Net advance in words" : "Total due in words",
  );
  if (st.revisions.length > 0) {
    pdf.heading("Agreement revisions");
    pdf.table(
      [
        { key: "revised_at", header: "Date", width: 1.4, render: (r) => pdfDate(String(r["revised_at"]).slice(0, 10)) },
        { key: "revised_by_name", header: "By", width: 1.5 },
        { key: "reason", header: "Reason", width: 3 },
        {
          key: "before_cash",
          header: "Cash before",
          money: true,
          width: 1.5,
          render: (r) => pdfMoney((r["before"] as { cash_agreed_paise: number }).cash_agreed_paise),
        },
        {
          key: "after_cash",
          header: "Cash after",
          money: true,
          width: 1.5,
          render: (r) => pdfMoney((r["after"] as { cash_agreed_paise: number }).cash_agreed_paise),
        },
        {
          key: "before_account",
          header: "Account before",
          money: true,
          width: 1.5,
          render: (r) => pdfMoney((r["before"] as { account_agreed_paise: number }).account_agreed_paise),
        },
        {
          key: "after_account",
          header: "Account after",
          money: true,
          width: 1.5,
          render: (r) => pdfMoney((r["after"] as { account_agreed_paise: number }).account_agreed_paise),
        },
      ],
      st.revisions as unknown as Record<string, unknown>[],
    );
  }
  pdf.heading(`Payment schedule – ${b.plan_name}`);
  pdf.table(
    [
      { key: "seq", header: "#", width: 0.5, align: "center" },
      { key: "name", header: "Installment", width: 2.2 },
      { key: "trigger_label", header: "Trigger", width: 2 },
      { key: "status", header: "Status", width: 1.3 },
      { key: "demand_number", header: "Demand", width: 1.4 },
      {
        key: "due_date",
        header: "Due",
        width: 1.3,
        align: "center",
        render: (r) => pdfDate(r["due_date"] as string | null),
      },
      { key: "cash_paise", header: "Cash", money: true, width: 1.6 },
      { key: "account_paise", header: "Account", money: true, width: 1.6 },
      { key: "total_paise", header: "Total", money: true, width: 1.6 },
      { key: "paid_paise", header: "Paid", money: true, width: 1.6 },
    ],
    st.schedule as unknown as Record<string, unknown>[],
  );
  pdf.heading("Ledger");
  pdf.table(
    [
      { key: "seq", header: "#", width: 0.5, align: "center" },
      { key: "entry_date", header: "Date", width: 1.3, render: (r) => pdfDate(r["entry_date"] as string) },
      { key: "event", header: "Event", width: 1.6 },
      { key: "label", header: "Particulars", width: 2.6 },
      { key: "bucket", header: "Bucket", width: 0.9 },
      { key: "amount_paise", header: "Amount", money: true, width: 1.5 },
      { key: "cash_paid_cum_paise", header: "Cash paid", money: true, width: 1.5 },
      { key: "account_paid_cum_paise", header: "Account paid", money: true, width: 1.5 },
      {
        key: "cash_due_paise",
        header: "Cash due",
        width: 1.5,
        align: "right",
        render: (r) => dueText(r["cash_due_paise"] as number),
      },
      {
        key: "account_due_paise",
        header: "Account due",
        width: 1.5,
        align: "right",
        render: (r) => dueText(r["account_due_paise"] as number),
      },
      {
        key: "total_due_paise",
        header: "Total due",
        width: 1.5,
        align: "right",
        render: (r) => dueText(r["total_due_paise"] as number),
      },
      { key: "ref_number", header: "Ref", width: 1.4 },
    ],
    st.ledger as unknown as Record<string, unknown>[],
    { fontSize: 7.5 },
  );
  if (st.other_charges.length > 0) {
    pdf.heading("Other charges");
    pdf.table(
      [
        { key: "name", header: "Charge", width: 2.5 },
        { key: "amount_paise", header: "Amount", money: true, width: 1.5 },
        { key: "gst_paise", header: "GST", money: true, width: 1.2 },
        { key: "total_paise", header: "Total", money: true, width: 1.5 },
        { key: "demand_number", header: "Demand", width: 1.4 },
        {
          key: "due_date",
          header: "Due",
          width: 1.2,
          align: "center",
          render: (r) => pdfDate(r["due_date"] as string | null),
        },
        { key: "paid_paise", header: "Paid", money: true, width: 1.5 },
        { key: "due_paise", header: "Due", money: true, width: 1.5 },
      ],
      st.other_charges as unknown as Record<string, unknown>[],
      {
        totals: {
          name: "Total",
          total_paise: st.other_charges.reduce((s, c) => s + c.total_paise, 0),
          paid_paise: st.other_charges.reduce((s, c) => s + c.paid_paise, 0),
          due_paise: st.other_charges.reduce((s, c) => s + c.due_paise, 0),
        },
      },
    );
  }
  if (st.pending_cheques.length > 0) {
    pdf.heading("Cheques in hand (subject to realisation; not yet credited)");
    pdf.table(
      [
        { key: "receipt_number", header: "Receipt", width: 1.6 },
        { key: "payment_date", header: "Received", width: 1.3, render: (r) => pdfDate(r["payment_date"] as string) },
        {
          key: "instrument_date",
          header: "Instrument date",
          width: 1.4,
          render: (r) => pdfDate(r["instrument_date"] as string | null),
        },
        {
          key: "instrument",
          header: "Instrument",
          width: 2,
          render: (r) => {
            const i = r["instrument"] as { number: string; bank_name: string | null } | null;
            return i ? `${i.number}${i.bank_name ? ` · ${i.bank_name}` : ""}` : "—";
          },
        },
        { key: "mode_code", header: "Mode", width: 1.2 },
        { key: "amount_paise", header: "Amount", money: true, width: 1.6 },
      ],
      st.pending_cheques as unknown as Record<string, unknown>[],
      { totals: { receipt_number: "Total", amount_paise: st.summary.pending_cheques_paise } },
    );
  }
  pdf.note(
    "Dues shown as (advance) are amounts received ahead of the demands raised. Only cleared payments are credited; cheques in hand are listed separately.",
  );
  return { bytes: await pdf.finish(), filename: `statement-${fileSafe(b.booking_number)}.pdf` };
}
