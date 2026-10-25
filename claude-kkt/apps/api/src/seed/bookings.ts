/**
 * Step 7 — the ten bookings of docs/SEED.md, each through the real booking/payment/construction endpoints:
 * #1 the ₹1 Cr worked example (SPEC §11) built by completing GGV block P stage by stage and posting the ten payments in order,
 * #2 pending cheque, #3 bounced cheque + NEFT, #4 reversal, #5 agreement revision, #6 cancellation, #7 Flexi (20 days old),
 * #8 GGV P3 fully paid except possession, #9 GGV Q2 account advance by loan disbursement, #10 co-applicant + parking + shared documents.
 */
import { CRORE, LAKH, placeholderPdf, SeedError, wholeLakhs, type SeedContext } from "./context.js";
import { addStagePhotos, completeStage } from "./construction.js";
import { STAGES, type StageName } from "./masters.js";

type Bucket = { agreed_paise: number; order_raised_paise: number; paid_paise: number; due_paise: number };
export interface BookingDetail {
  id: string; version: number; status: string; booking_number: string; flat_id: string;
  summary: { cash: Bucket; account: Bucket; total_due_paise: number; total_paid_paise: number; other_charges_due_paise: number; raised_percent: number; pending_cheques_paise: number };
  other_charges: { id: string; name: string; code: string; total_paise: number; demand_number: string | null; paid_paise: number; due_paise: number }[];
}
interface PostPaymentResponse { payment: { id: string; version: number; receipt_number: string; status: string }; summary: { cash_due_paise: number; account_due_paise: number; total_due_paise: number; other_charges_due_paise: number } }

export async function getBooking(ctx: SeedContext, id: string): Promise<BookingDetail> {
  return ctx.get<BookingDetail>(`/api/v1/bookings/${id}`);
}

interface PayInput {
  bucket?: "CASH" | "ACCOUNT";
  otherChargeId?: string;
  amount: number;
  date: string;
  mode: "CASH" | "CHEQUE" | "NEFT_RTGS" | "UPI" | "DD" | "LOAN_DISBURSEMENT";
  instrument?: { number: string; date?: string; bank_name?: string };
  bank?: "HDFC" | "SBI";
  remarks?: string;
}

/** Posts one payment as the Accounts user (Idempotency-Key required by the API). */
export async function pay(ctx: SeedContext, bookingId: string, p: PayInput): Promise<PostPaymentResponse> {
  const body: Record<string, unknown> = { booking_id: bookingId, amount_paise: p.amount, payment_date: p.date, payment_mode_id: ctx.ids[`mode:${p.mode}`] };
  if (p.otherChargeId) { body["against"] = "OTHER_CHARGE"; body["other_charge_id"] = p.otherChargeId; }
  else { body["against"] = "FLAT_VALUE"; body["bucket"] = p.bucket; }
  if (p.mode !== "CASH") {
    body["bank_account_id"] = ctx.ids[`bank:${p.bank ?? "HDFC"}`];
    body["instrument"] = p.instrument ?? { number: `${p.mode === "UPI" ? "UPI" : "UTR"}${p.date.replace(/-/g, "")}${Math.floor(Math.random() * 9000 + 1000)}` };
  }
  if (p.remarks) body["remarks"] = p.remarks;
  const r = await ctx.post<PostPaymentResponse>("/api/v1/payments", body, "accounts");
  ctx.counts["payments"] = (ctx.counts["payments"] ?? 0) + 1;
  return r;
}

interface CreateInput {
  n: number; project: string; block: string; flat: string; customerPhone: string; bookingDate: string; plan: "STD" | "DP" | "FLEXI" | "VILLA";
  cash?: number; account?: number; coApplicants?: string[]; parking?: string[]; otherCharges?: { code: string; amount: number; gst: number; demandAt: "ON_BOOKING" | "ON_POSSESSION" | "MANUAL" }[]; remarks?: string; acceptance?: "IN_PERSON" | "SIGNED_COPY" | "PORTAL";
}

/** Creates a booking as the Sales user: agreement = the flat's engine price unless a cash/account split is given. */
export async function createBooking(ctx: SeedContext, input: CreateInput): Promise<BookingDetail> {
  const flat = ctx.flat(input.project, input.block, input.flat);
  const price = flat.price_paise;
  const account = input.account ?? wholeLakhs(Math.round(price * 0.4));
  const cash = input.cash ?? price - account;
  if (cash + account !== price && input.cash === undefined) throw new SeedError(`split mismatch for ${input.flat}`);
  const acceptance = input.acceptance ?? "IN_PERSON";
  let acceptanceDocumentId: string | null = null;
  if (acceptance === "SIGNED_COPY") {
    // the signed payment-plan acceptance is uploaded against the customer before the booking exists
    acceptanceDocumentId = await ctx.uploadDocument(
      { entity_type: "CUSTOMER", entity_id: ctx.customer(input.customerPhone).id, title: `Signed payment plan acceptance – ${input.flat}`, document_type_id: ctx.ids["docType:PLAN_ACCEPTANCE"] },
      { name: `plan-acceptance-${input.flat.toLowerCase()}.pdf`, data: await placeholderPdf(`Payment plan acceptance – ${input.flat}`, [`${ctx.customer(input.customerPhone).name} accepts the ${input.plan === "VILLA" ? "Villa CLP" : "Standard CLP"} schedule for ${input.flat}.`, `Signed on ${input.bookingDate}.`]), type: "application/pdf" },
    );
  }
  const body = {
    flat_id: flat.id, customer_id: ctx.customer(input.customerPhone).id, booking_date: input.bookingDate,
    agreement_value_paise: cash + account, cash_agreed_paise: cash, account_agreed_paise: account,
    payment_plan_id: ctx.ids[`plan:${input.plan}`], plan_acceptance_mode: acceptance, plan_accepted_on: input.bookingDate, plan_acceptance_document_id: acceptanceDocumentId,
    co_applicant_ids: (input.coApplicants ?? []).map((phone) => ctx.customer(phone).id),
    parking_slot_ids: (input.parking ?? []).map((n) => { const id = ctx.project(input.project).parking.get(n); if (!id) throw new SeedError(`parking slot ${n} missing`); return id; }),
    other_charges: (input.otherCharges ?? []).map((c) => ({ charge_type_id: ctx.ids[`charge:${c.code}`], amount_paise: c.amount, gst_percent: c.gst, demand_at: c.demandAt })),
    sales_user_id: ctx.staffUser("sales@sgb.in").id, remarks: input.remarks ?? null,
  };
  const b = await ctx.post<BookingDetail>("/api/v1/bookings", body, "sales");
  ctx.bookings[input.n] = { id: b.id, number: b.booking_number, flat: `${input.project}/${input.block}/${input.flat}`, customerPhone: input.customerPhone, version: b.version };
  return b;
}

/** SPEC §11 table: payment, then expected cash / account / total due after it (paise). */
export const WORKED_EXAMPLE: { stage: StageName | null; bucket: "CASH" | "ACCOUNT"; amount: number; cash: number; account: number; total: number }[] = [
  { stage: null, bucket: "ACCOUNT", amount: 4 * LAKH, cash: 6 * LAKH, account: 0, total: 6 * LAKH },
  { stage: "Excavation", bucket: "CASH", amount: 8 * LAKH, cash: 1 * LAKH, account: 2 * LAKH, total: 3 * LAKH },
  { stage: "Foundation", bucket: "ACCOUNT", amount: 12 * LAKH, cash: 7 * LAKH, account: -6 * LAKH, total: 1 * LAKH },
  { stage: "Plinth", bucket: "CASH", amount: 5 * LAKH, cash: 5 * LAKH, account: -4 * LAKH, total: 1 * LAKH },
  { stage: "1st Slab", bucket: "CASH", amount: 10 * LAKH, cash: 1 * LAKH, account: 0, total: 1 * LAKH },
  { stage: "Top Slab", bucket: "ACCOUNT", amount: 15 * LAKH, cash: 7 * LAKH, account: -11 * LAKH, total: -4 * LAKH },
  { stage: "Brickwork", bucket: "CASH", amount: 7 * LAKH, cash: 6 * LAKH, account: -7 * LAKH, total: -1 * LAKH },
  { stage: "Plastering", bucket: "CASH", amount: 20 * LAKH, cash: -5 * LAKH, account: -1 * LAKH, total: -6 * LAKH },
  { stage: "Flooring", bucket: "ACCOUNT", amount: 9 * LAKH, cash: 1 * LAKH, account: -6 * LAKH, total: -5 * LAKH },
  { stage: "Possession/Handover", bucket: "CASH", amount: 10 * LAKH, cash: 0, account: 0, total: 0 },
];

/** Completion date of GGV block P stage `i` (0-based master order): D-145 … D-28, nine days apart. */
export function blockPStageDate(ctx: SeedContext, i: number): string {
  return ctx.D(145 - 9 * i);
}

async function workedExample(ctx: SeedContext): Promise<void> {
  const ggv = ctx.project("GGV");
  const blockP = ggv.blocks["P"]!;
  const flat = ctx.flat("GGV", "P", "P1");
  if (flat.price_paise !== CRORE) throw new SeedError(`P1 must be priced ₹1 Cr by the rate card, got ${flat.price_paise}`);
  let b = await createBooking(ctx, {
    n: 1, project: "GGV", block: "P", flat: "P1", customerPhone: "9876543210", bookingDate: ctx.D(150), plan: "VILLA", cash: 60 * LAKH, account: 40 * LAKH, acceptance: "SIGNED_COPY",
    otherCharges: [{ code: "REGISTRY", amount: 250_000_00, gst: 0, demandAt: "ON_POSSESSION" }, { code: "MAINTENANCE", amount: 60_000_00, gst: 18, demandAt: "ON_POSSESSION" }],
    remarks: "Worked example of SPEC §11 – premium villa P1",
  });
  if (b.summary.total_due_paise !== 10 * LAKH) throw new SeedError(`worked example: booking demand should be ₹10 L, got ${b.summary.total_due_paise}`);

  // every P stage in master order; the ten payments land two days after the stage they follow
  let payIndex = 0;
  const payAfter = async (stage: StageName | null, date: string): Promise<void> => {
    const row = WORKED_EXAMPLE[payIndex]!;
    if (row.stage !== stage) throw new SeedError(`worked example out of order at ${String(stage)}`);
    const r = await pay(ctx, b.id, { bucket: row.bucket, amount: row.amount, date, mode: row.bucket === "CASH" ? "CASH" : payIndex === 5 ? "LOAN_DISBURSEMENT" : "NEFT_RTGS", bank: "SBI", instrument: row.bucket === "CASH" ? undefined : { number: `${payIndex === 5 ? "LOAN" : "UTR"}SGB${String(payIndex + 1).padStart(3, "0")}` }, remarks: `${row.stage ?? "Booking"} installment` });
    const s = r.summary;
    if (s.cash_due_paise !== row.cash || s.account_due_paise !== row.account || s.total_due_paise !== row.total) {
      throw new SeedError(`worked example row #${payIndex + 1} mismatch: got cash ${s.cash_due_paise} / account ${s.account_due_paise} / total ${s.total_due_paise}, expected ${row.cash} / ${row.account} / ${row.total}`);
    }
    payIndex += 1;
  };
  await payAfter(null, ctx.D(148));
  for (const [i, name] of STAGES.entries()) {
    const date = blockPStageDate(ctx, i);
    await completeStage(ctx, blockP.id, name, date, {}, i === STAGES.length - 1 ? "Keys ready for handover" : undefined);
    const row = WORKED_EXAMPLE[payIndex];
    if (row && row.stage === name) await payAfter(name, ctx.D(145 - 9 * i - 2));
  }
  if (payIndex !== WORKED_EXAMPLE.length) throw new SeedError("worked example: not every payment was posted");
  b = await getBooking(ctx, b.id);
  if (b.summary.total_due_paise !== 0 || b.summary.raised_percent !== 100) throw new SeedError("worked example: final due must be 0 at 100 % raised");
  // other charges demanded on possession → paid → handover
  for (const line of b.other_charges) {
    if (!line.demand_number) throw new SeedError(`${line.name} should have been demanded on possession`);
    await pay(ctx, b.id, { otherChargeId: line.id, amount: line.total_paise, date: ctx.D(24), mode: line.code === "REGISTRY" ? "NEFT_RTGS" : "UPI", bank: "SBI", remarks: `${line.name} paid` });
  }
  b = await getBooking(ctx, b.id);
  await ctx.post(`/api/v1/bookings/${b.id}/complete`, { version: b.version, completed_on: ctx.D(20), completion_notes: "Registry done; keys handed over to Mr Sinha" }, "admin", { idempotent: false });
  ctx.bookings[1]!.version = (await getBooking(ctx, b.id)).version;
}

export async function seedBookings(ctx: SeedContext): Promise<void> {
  ctx.log("bookings: #1 worked example (block P stage by stage), then #2–#10 scenarios");
  await workedExample(ctx);
  ctx.counts["stage_photos"] = (ctx.counts["stage_photos"] ?? 0) + (await addStagePhotos(ctx, "GGV", "P"));

  // #2 Priya Verma – SGH A-301, Standard CLP, partially paid, one pending cheque of ₹5 L
  let b = await createBooking(ctx, { n: 2, project: "SGH", block: "A", flat: "A-301", customerPhone: "9876543211", bookingDate: ctx.D(130), plan: "STD", otherCharges: [{ code: "LEGAL", amount: 25_000_00, gst: 18, demandAt: "ON_BOOKING" }], remarks: "Referred by Dr. Verma's colleague" });
  await pay(ctx, b.id, { bucket: "ACCOUNT", amount: 15 * LAKH, date: ctx.D(100), mode: "NEFT_RTGS", instrument: { number: "UTRN25100012" }, remarks: "HDFC home loan – first tranche" });
  await pay(ctx, b.id, { bucket: "CASH", amount: 8 * LAKH, date: ctx.D(60), mode: "UPI", instrument: { number: "UPI425600987" } });
  const legal = (await getBooking(ctx, b.id)).other_charges.find((c) => c.code === "LEGAL")!;
  await pay(ctx, b.id, { otherChargeId: legal.id, amount: legal.total_paise, date: ctx.D(60), mode: "UPI", instrument: { number: "UPI425600988" } });
  const pendingCheque = await pay(ctx, b.id, { bucket: "CASH", amount: 5 * LAKH, date: ctx.D(3), mode: "CHEQUE", instrument: { number: "000451", date: ctx.D(3), bank_name: "State Bank of India" }, remarks: "Post-dated cheque – present after the 10th" });
  if (pendingCheque.payment.status !== "PENDING") throw new SeedError("#2 cheque should be PENDING");

  // #3 Amit Kumar – SGH A-402, bounced cheque (never counted) then NEFT
  b = await createBooking(ctx, { n: 3, project: "SGH", block: "A", flat: "A-402", customerPhone: "9876543212", bookingDate: ctx.D(120), plan: "STD" });
  const bounced = await pay(ctx, b.id, { bucket: "CASH", amount: 6 * LAKH, date: ctx.D(90), mode: "CHEQUE", instrument: { number: "118822", date: ctx.D(90), bank_name: "ICICI Bank" } });
  await ctx.post(`/api/v1/payments/${bounced.payment.id}/bounce`, { version: bounced.payment.version, reason: "Insufficient funds – returned by ICICI Bank" }, "accounts", { idempotent: false });
  await pay(ctx, b.id, { bucket: "CASH", amount: 6 * LAKH, date: ctx.D(80), mode: "UPI", instrument: { number: "UPI425600990" }, remarks: "Replacement for bounced cheque 118822" });
  await pay(ctx, b.id, { bucket: "ACCOUNT", amount: 12 * LAKH, date: ctx.D(50), mode: "NEFT_RTGS", instrument: { number: "UTRN25100077" }, remarks: "SBI home loan – disbursement 1" });

  // #4 Sunita Devi – SGH A-104, Down Payment 10:85:5 booked > 30 days ago; a wrong UPI receipt reversed with reason
  b = await createBooking(ctx, { n: 4, project: "SGH", block: "A", flat: "A-104", customerPhone: "9876543213", bookingDate: ctx.D(45), plan: "DP" });
  const wrong = await pay(ctx, b.id, { bucket: "ACCOUNT", amount: 5 * LAKH, date: ctx.D(40), mode: "UPI", instrument: { number: "UPI425601001" }, remarks: "Booking amount" });
  await ctx.post(`/api/v1/payments/${wrong.payment.id}/reverse`, { version: wrong.payment.version, reason: "Posted to the Account bucket by mistake – customer paid from own funds" }, "accounts", { idempotent: false });
  await pay(ctx, b.id, { bucket: "CASH", amount: 5 * LAKH, date: ctx.D(40), mode: "UPI", instrument: { number: "UPI425601002" }, remarks: "Booking amount (re-posted to Cash)" });
  await pay(ctx, b.id, { bucket: "ACCOUNT", amount: 30 * LAKH, date: ctx.D(20), mode: "LOAN_DISBURSEMENT", instrument: { number: "PNBHL2025-00311" }, remarks: "PNB housing loan – first disbursement" });

  // #5 Vikram Singh – SGH B-201, agreement revision (account 45 L → 55 L, cash reduced) with reason
  {
    const flat = ctx.flat("SGH", "B", "B-201");
    b = await createBooking(ctx, { n: 5, project: "SGH", block: "B", flat: "B-201", customerPhone: "9876543214", bookingDate: ctx.D(90), plan: "STD", account: 45 * LAKH, cash: flat.price_paise - 45 * LAKH });
    await pay(ctx, b.id, { bucket: "ACCOUNT", amount: 5 * LAKH, date: ctx.D(80), mode: "NEFT_RTGS", instrument: { number: "UTRN25100150" } });
    b = await getBooking(ctx, b.id);
    await ctx.post(`/api/v1/bookings/${b.id}/agreement-revisions`, { version: b.version, agreement_value_paise: flat.price_paise, cash_agreed_paise: flat.price_paise - 55 * LAKH, account_agreed_paise: 55 * LAKH, reason: "Axis Bank sanctioned a higher home loan; cash component reduced accordingly" }, "admin");
    await pay(ctx, b.id, { bucket: "CASH", amount: 4 * LAKH, date: ctx.D(60), mode: "UPI", instrument: { number: "UPI425601202" } });
  }

  // #6 Neha Gupta – SGH B-303, cancelled with ₹1,00,000 deduction and refund of the rest
  b = await createBooking(ctx, { n: 6, project: "SGH", block: "B", flat: "B-303", customerPhone: "9876543215", bookingDate: ctx.D(80), plan: "STD" });
  await pay(ctx, b.id, { bucket: "CASH", amount: 3 * LAKH, date: ctx.D(78), mode: "UPI", instrument: { number: "UPI425601303" }, remarks: "Booking amount" });
  b = await getBooking(ctx, b.id);
  await ctx.post(`/api/v1/bookings/${b.id}/cancel`, { version: b.version, reason: "Customer relocating abroad; requested cancellation in writing", deduction_paise: 1 * LAKH, refund_paise: 2 * LAKH, cancel_date: ctx.D(30) }, "admin", { idempotent: false });

  // #7 Manoj Prasad – SGH C-502, Flexi booked 20 days ago: only the 10 % booking installment is due
  b = await createBooking(ctx, { n: 7, project: "SGH", block: "C", flat: "C-502", customerPhone: "9876543216", bookingDate: ctx.D(20), plan: "FLEXI", acceptance: "PORTAL" });
  if (b.summary.raised_percent !== 10) throw new SeedError(`#7 Flexi should have 10 % raised, got ${b.summary.raised_percent}`);
  await pay(ctx, b.id, { bucket: "CASH", amount: 2 * LAKH, date: ctx.D(18), mode: "UPI", instrument: { number: "UPI425601404" }, remarks: "Part of booking amount" });

  // #8 Anjali Sharma – GGV P3: block complete → every installment raised at creation (catch-up); paid except possession; charges demanded on possession
  b = await createBooking(ctx, {
    n: 8, project: "GGV", block: "P", flat: "P3", customerPhone: "9876543217", bookingDate: ctx.D(100), plan: "VILLA", cash: 60 * LAKH, account: 40 * LAKH, acceptance: "SIGNED_COPY",
    otherCharges: [{ code: "REGISTRY", amount: 250_000_00, gst: 0, demandAt: "ON_POSSESSION" }, { code: "MAINTENANCE", amount: 60_000_00, gst: 18, demandAt: "ON_POSSESSION" }],
  });
  if (b.summary.raised_percent !== 100) throw new SeedError(`#8 should have 100 % raised, got ${b.summary.raised_percent}`);
  await pay(ctx, b.id, { bucket: "ACCOUNT", amount: 20 * LAKH, date: ctx.D(95), mode: "LOAN_DISBURSEMENT", instrument: { number: "HDFCHL2025-4412" }, bank: "SBI" });
  await pay(ctx, b.id, { bucket: "CASH", amount: 11 * LAKH, date: ctx.D(95), mode: "UPI", instrument: { number: "UPI425601505" }, bank: "SBI" });
  const chq = await pay(ctx, b.id, { bucket: "CASH", amount: 20 * LAKH, date: ctx.D(60), mode: "CHEQUE", instrument: { number: "552210", date: ctx.D(60), bank_name: "HDFC Bank" }, bank: "SBI" });
  await ctx.post(`/api/v1/payments/${chq.payment.id}/clear`, { version: chq.payment.version }, "accounts", { idempotent: false });
  await pay(ctx, b.id, { bucket: "ACCOUNT", amount: 14 * LAKH, date: ctx.D(30), mode: "LOAN_DISBURSEMENT", instrument: { number: "HDFCHL2025-4413" }, bank: "SBI" });
  await pay(ctx, b.id, { bucket: "CASH", amount: 20 * LAKH, date: ctx.D(21), mode: "NEFT_RTGS", instrument: { number: "UTRN25100333" }, bank: "SBI" });
  b = await getBooking(ctx, b.id);
  if (b.summary.cash.paid_paise !== 51 * LAKH || b.summary.account.paid_paise !== 34 * LAKH) throw new SeedError("#8 should be paid 85 % per bucket");
  if (!b.other_charges.every((c) => c.demand_number)) throw new SeedError("#8 possession charges should be demanded");

  // #9 Rakesh Yadav – GGV Q2 (through Plastering → 75 % raised); loan disbursement beyond what is raised = Account advance
  b = await createBooking(ctx, { n: 9, project: "GGV", block: "Q", flat: "Q2", customerPhone: "9876543218", bookingDate: ctx.D(120), plan: "VILLA", cash: ctx.flat("GGV", "Q", "Q2").price_paise - 40 * LAKH, account: 40 * LAKH });
  if (b.summary.raised_percent !== 75) throw new SeedError(`#9 should have 75 % raised, got ${b.summary.raised_percent}`);
  await pay(ctx, b.id, { bucket: "ACCOUNT", amount: 36 * LAKH, date: ctx.D(110), mode: "LOAN_DISBURSEMENT", instrument: { number: "SBIHL2025-0901" }, bank: "SBI", remarks: "SBI loan disbursed in one go" });
  await pay(ctx, b.id, { bucket: "CASH", amount: 20 * LAKH, date: ctx.D(100), mode: "NEFT_RTGS", instrument: { number: "UTRN25100444" }, bank: "SBI" });
  b = await getBooking(ctx, b.id);
  if (b.summary.account.due_paise >= 0) throw new SeedError("#9 should show an Account advance");

  // #10 Pooja Mishra – SGH A-803 with co-applicant Sanjay Jha, parking B1-07, on-booking charges and two shared documents
  b = await createBooking(ctx, {
    n: 10, project: "SGH", block: "A", flat: "A-803", customerPhone: "9876543219", bookingDate: ctx.D(40), plan: "STD", coApplicants: ["9876543220"], parking: ["B1-07"],
    otherCharges: [{ code: "PARKING", amount: 3 * LAKH, gst: 5, demandAt: "ON_BOOKING" }, { code: "CLUB", amount: 1 * LAKH, gst: 18, demandAt: "ON_BOOKING" }, { code: "LEGAL", amount: 25_000_00, gst: 18, demandAt: "ON_BOOKING" }],
  });
  await pay(ctx, b.id, { bucket: "CASH", amount: 5 * LAKH, date: ctx.D(38), mode: "UPI", instrument: { number: "UPI425601606" } });
  await pay(ctx, b.id, { bucket: "ACCOUNT", amount: 10 * LAKH, date: ctx.D(25), mode: "NEFT_RTGS", instrument: { number: "UTRN25100555" } });
  const parkingLine = (await getBooking(ctx, b.id)).other_charges.find((c) => c.code === "PARKING")!;
  await pay(ctx, b.id, { otherChargeId: parkingLine.id, amount: parkingLine.total_paise, date: ctx.D(25), mode: "NEFT_RTGS", instrument: { number: "UTRN25100556" } });
  for (const [code, title, lines] of [
    ["AGREEMENT", "Agreement for sale – A-803", ["Agreement for sale between Shree Ganesh Builders Pvt Ltd and Ms Pooja Mishra (co-applicant Mr Sanjay Jha).", "Flat A-803, Tower A, Shree Ganesh Heights, Bailey Road, Patna.", "Payment plan: Standard CLP. Parking: B1-07."]],
    ["ALLOTMENT", "Allotment letter – A-803", ["Dear Ms Mishra,", "We are pleased to allot Flat A-803 (2BHK-B, 8th floor) in Tower A of Shree Ganesh Heights.", "Kindly adhere to the construction-linked payment schedule enclosed."]],
  ] as const) {
    await ctx.uploadDocument({ entity_type: "BOOKING", entity_id: b.id, title, document_type_id: ctx.ids[`docType:${code}`], shared_with_customer: true }, { name: `${code.toLowerCase()}-a-803.pdf`, data: await placeholderPdf(title, lines), type: "application/pdf" });
  }

  // one contra entry: evening cash deposit to HDFC
  await ctx.post("/api/v1/roznamcha/contra", { entry_date: ctx.D(12), type: "DEPOSIT", amount_paise: 2 * LAKH, bank_account_id: ctx.ids["bank:HDFC"], remarks: "Cash deposited at HDFC Boring Road" }, "accounts");

  for (const n of Object.keys(ctx.bookings)) ctx.bookings[Number(n)]!.version = (await getBooking(ctx, ctx.bookings[Number(n)]!.id)).version;
}
