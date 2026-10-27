/**
 * The money of one scale-seed booking (docs/SEED.md "Production-size data"), produced by the SAME engines the live system uses — never by
 * hand-computed balances:
 *   - demands: domain `evaluateDues` against the booking's plan snapshot and its tower's stages (exactly what booking creation's catch-up,
 *     stage completion and DAILY_DUES raise), stamped with the instant the live path would have raised them;
 *   - payments: drawn against those demands (never above a bucket's raised amount, so never above its agreed amount — the bucket cap);
 *   - ledger + summary + demand statuses: the ledger service's own event builders (`events.demand` / `events.payment`, `demandAmountsFor`)
 *     fed to domain `deriveLedger` (canonical posting order) and `demandStatuses` — the same derivation `rebuild()` and the integrity
 *     report compare the stored ledger against, so a generated booking is integrity-clean by construction (and the seed then proves it
 *     by running the integrity report).
 */
import {
  addDays,
  deriveLedger,
  demandStatuses,
  emptyLedgerSummary,
  evaluateDues,
  type DemandStatusResult,
  type LedgerEvent,
  type LedgerRow,
  type LedgerSummary,
  type TowerStage,
} from "@kkt/domain";
import type { Instrument, PlanSnapshot } from "@kkt/db";
import { demandAmountsFor, events, snapshotInstallments } from "../modules/money/index.js";
import { istAt, officeInstant, type Rng } from "./scaleData.js";

/** A payment mode as the generator needs it. */
export interface ModeRef {
  id: string;
  code: string;
  isCash: boolean;
}

/** The modes a booking's payments use. */
export interface ScaleModes {
  cash: ModeRef;
  upi: ModeRef;
  neft: ModeRef;
  loan: ModeRef;
  cheque: ModeRef;
}

/** What the generator needs to know about a booking. */
export interface ScaleBookingInput {
  id: string;
  bookingDate: string;
  /** Instant the booking was created (its ON_BOOKING / catch-up demands are raised in the same transaction). */
  createdAt: Date;
  cashAgreedPaise: number;
  accountAgreedPaise: number;
  planSnapshot: PlanSnapshot;
  towerStages: readonly TowerStage[];
  /** Instant each completed stage was marked complete (stage completion raises its demands in that transaction). */
  stageCompletedAt: ReadonlyMap<string, Date>;
  today: string;
  /** "Now" for the cheque lifecycle (a cheque whose clearing date is still ahead stays PENDING). */
  now: Date;
  defaultDueDays: number;
}

/** A generated demand (number assigned later, company-wide in posting order). */
export interface ScaleDemand {
  id: string;
  seq: number;
  name: string;
  triggerType: string;
  triggerLabel: string;
  triggerStageId: string | null;
  percent: number;
  cumulativePercent: number;
  cashPaise: number;
  accountPaise: number;
  totalPaise: number;
  demandDate: string;
  dueDate: string;
  /** Business date the demand was raised (the FY of its number). */
  raisedOn: string;
  postedAt: Date;
  demandNumber: string;
}

/** A generated payment (receipt number assigned later, company-wide in posting order). */
export interface ScalePayment {
  id: string;
  bucket: "CASH" | "ACCOUNT";
  amountPaise: number;
  paymentDate: string;
  postedAt: Date;
  mode: ModeRef;
  instrument: Instrument | null;
  status: "CLEARED" | "PENDING" | "BOUNCED";
  clearedAt: Date | null;
  bouncedAt: Date | null;
  bounceReason: string | null;
  receiptNumber: string;
}

/** Bank names used on instruments. */
const BANKS = [
  "HDFC Bank",
  "State Bank of India",
  "ICICI Bank",
  "Axis Bank",
  "Punjab National Bank",
  "Bank of Baroda",
] as const;

/** Domain evaluateDues for the booking as of today, stamped with the instant the live system would have raised each demand. */
export function planDemands(rng: Rng, b: ScaleBookingInput): ScaleDemand[] {
  const due = evaluateDues({
    booking: {
      bookingDate: b.bookingDate,
      cashAgreedPaise: b.cashAgreedPaise,
      accountAgreedPaise: b.accountAgreedPaise,
      planSnapshot: { installments: snapshotInstallments(b.planSnapshot) },
    },
    towerStages: b.towerStages,
    existingDemands: [],
    today: b.today,
    defaultDueDays: b.defaultDueDays,
  });
  let catchUp = 0;
  const out = due.map((d) => {
    let postedAt: Date;
    let raisedOn: string;
    if (d.triggerType === "ON_BOOKING" || d.triggerDate <= b.bookingDate) {
      // raised by the booking's own catch-up, inside the booking transaction (Clock: strictly increasing instants)
      catchUp += 1;
      postedAt = new Date(b.createdAt.getTime() + catchUp);
      raisedOn = b.bookingDate;
    } else if (d.triggerStageId && b.stageCompletedAt.has(d.triggerStageId)) {
      // raised by stage completion (construction service → raiseDuesForBlock) in the completing transaction
      postedAt = new Date(b.stageCompletedAt.get(d.triggerStageId)!.getTime() + 1 + rng.int(0, 900));
      raisedOn = d.triggerDate;
    } else {
      // time-based trigger: the nightly DAILY_DUES run (02:00 IST) of the trigger date
      postedAt = istAt(d.triggerDate, 2, 0, rng.int(0, 59), rng.int(0, 999));
      raisedOn = d.triggerDate;
    }
    return {
      id: rng.uuid(),
      seq: d.seq,
      name: d.name,
      triggerType: d.triggerType,
      triggerLabel: d.triggerLabel,
      triggerStageId: d.triggerStageId,
      percent: Number(d.percent),
      cumulativePercent: Number(d.cumulativePercent),
      cashPaise: d.cashPaise,
      accountPaise: d.accountPaise,
      totalPaise: d.totalPaise,
      demandDate: d.triggerDate,
      dueDate: d.dueDate,
      raisedOn,
      postedAt,
      demandNumber: "",
    };
  });
  return out.sort((x, y) => x.postedAt.getTime() - y.postedAt.getTime() || x.seq - y.seq);
}

function instrumentFor(rng: Rng, mode: ModeRef, date: string): Instrument | null {
  switch (mode.code) {
    case "CASH":
      return null;
    case "UPI":
      return { number: String(rng.int(100_000, 999_999)) + String(rng.int(100_000, 999_999)) };
    case "NEFT_RTGS":
      return { number: `UTR${rng.int(10_000_000, 99_999_999)}${rng.int(1000, 9999)}`, bank_name: rng.pick(BANKS) };
    case "LOAN_DISBURSEMENT":
      return { number: `LN${rng.int(1_000_000, 9_999_999)}`, bank_name: rng.pick(BANKS), date };
    default:
      return { number: String(rng.int(100_000, 999_999)), date, bank_name: rng.pick(BANKS), branch: "Patna" };
  }
}

/** Rounds paise down to whole rupees (receipts are in whole rupees). */
function rupees(paise: number): number {
  return Math.floor(paise / 100) * 100;
}

/**
 * Payments against the raised demands, in posting order: most demands due a month ago are paid (in one or two tranches per bucket, the
 * Account bucket by NEFT / loan disbursement / cheque, the Cash bucket in cash or UPI), recent ones less often, some only in part. A
 * bucket never receives more than its demands raised. Cheques clear three days later (PENDING while that is still ahead; one in fifty
 * bounces and is paid again by NEFT a few days later).
 */
export function planPayments(
  rng: Rng,
  b: ScaleBookingInput,
  demands: readonly ScaleDemand[],
  modes: ScaleModes,
): ScalePayment[] {
  const out: ScalePayment[] = [];
  const todayMs = Date.parse(`${b.today}T00:00:00Z`);
  const add = (bucket: "CASH" | "ACCOUNT", amount: number, date: string, notBefore: Date, mode: ModeRef): void => {
    let postedAt = officeInstant(rng, date);
    if (postedAt.getTime() <= notBefore.getTime())
      postedAt = new Date(notBefore.getTime() + rng.int(60_000, 3_600_000));
    if (postedAt.getTime() > b.now.getTime()) return;
    const base = {
      id: rng.uuid(),
      bucket,
      amountPaise: amount,
      paymentDate: date,
      postedAt,
      mode,
      instrument: instrumentFor(rng, mode, date),
      receiptNumber: "",
    };
    if (mode.code !== "CHEQUE") {
      out.push({ ...base, status: "CLEARED", clearedAt: postedAt, bouncedAt: null, bounceReason: null });
      return;
    }
    const clearAt = istAt(addDays(date, 3), 11, rng.int(0, 59), rng.int(0, 59));
    if (clearAt.getTime() > b.now.getTime()) {
      out.push({ ...base, status: "PENDING", clearedAt: null, bouncedAt: null, bounceReason: null });
      return;
    }
    if (rng.chance(0.02)) {
      out.push({ ...base, status: "BOUNCED", clearedAt: null, bouncedAt: clearAt, bounceReason: "Insufficient funds" });
      const again = addDays(date, 6);
      if (again <= b.today) add(bucket, amount, again, clearAt, modes.neft);
      return;
    }
    out.push({ ...base, status: "CLEARED", clearedAt: clearAt, bouncedAt: null, bounceReason: null });
  };
  for (const d of demands) {
    const dueMs = Date.parse(`${d.dueDate}T00:00:00Z`);
    const ageDays = (todayMs - dueMs) / 86_400_000;
    const pPay = ageDays > 30 ? 0.94 : ageDays > 0 ? 0.6 : 0.25;
    if (!rng.chance(pPay)) continue;
    const share = rng.chance(0.08) ? 0.5 : 1;
    for (const bucket of ["ACCOUNT", "CASH"] as const) {
      const raised = bucket === "ACCOUNT" ? d.accountPaise : d.cashPaise;
      const amount = rupees(raised * share);
      if (amount <= 0) continue;
      const parts = amount >= 2_00_000_00 && rng.chance(0.55) ? 2 : 1;
      const first = parts === 2 ? rupees(amount * (0.35 + rng.next() * 0.3)) : amount;
      const tranches = parts === 2 ? [first, amount - first] : [amount];
      let date = addDays(d.raisedOn, rng.int(0, 25));
      for (const part of tranches) {
        if (date > b.today) break;
        const mode =
          bucket === "ACCOUNT"
            ? rng.weighted([
                [modes.neft, 55],
                [modes.loan, 30],
                [modes.cheque, 15],
              ] as const)
            : rng.weighted([
                [modes.cash, 85],
                [modes.upi, 15],
              ] as const);
        add(bucket, part, date, d.postedAt, mode);
        date = addDays(date, rng.int(3, 20));
      }
    }
  }
  return out.sort((x, y) => x.postedAt.getTime() - y.postedAt.getTime());
}

/** The stored money of a booking, derived by the ledger engine from its demands and payments. */
export interface ScaleBookingBooks {
  rows: LedgerRow[];
  summary: LedgerSummary;
  /** Per demand (same order as the input demands in posting order): status and money applied. */
  demandStatus: DemandStatusResult[];
  raisedPercent: number;
  lastPaymentAt: Date | null;
  pendingChequesPaise: number;
}

/**
 * Ledger rows, booking summary and demand statuses of a booking — the same derivation as `rebuild()` (ledger service `events.*` builders,
 * `demandAmountsFor`, domain `deriveLedger`) and `recomputeDemandStatuses()` (domain `demandStatuses`). Demand and receipt numbers must be
 * assigned first (they are part of the rows).
 */
export function bookBooks(
  b: Pick<ScaleBookingInput, "cashAgreedPaise" | "accountAgreedPaise">,
  demands: readonly ScaleDemand[],
  payments: readonly ScalePayment[],
): ScaleBookingBooks {
  const agreed = { cash_agreed_paise: b.cashAgreedPaise, account_agreed_paise: b.accountAgreedPaise };
  const evts: LedgerEvent[] = [];
  for (const d of demands) {
    const amounts = demandAmountsFor(d, agreed);
    if (amounts.cashPaise !== d.cashPaise || amounts.accountPaise !== d.accountPaise)
      throw new Error(`scale seed: demand ${d.seq} amounts differ between the dues engine and the ledger service`);
    evts.push(events.demand({ ...d, installmentName: d.name }, amounts));
  }
  let lastPaymentAt: Date | null = null;
  let pendingChequesPaise = 0;
  for (const p of payments) {
    if (p.status === "PENDING") pendingChequesPaise += p.amountPaise;
    if (p.status !== "CLEARED" || !p.clearedAt) continue;
    evts.push(events.payment({ ...p, modeCode: p.mode.code }, p.clearedAt));
    if (!lastPaymentAt || p.clearedAt.getTime() > lastPaymentAt.getTime()) lastPaymentAt = p.clearedAt;
  }
  const derived = deriveLedger(
    evts,
    emptyLedgerSummary({ cashAgreedPaise: b.cashAgreedPaise, accountAgreedPaise: b.accountAgreedPaise }),
  );
  const demandStatus = demandStatuses(
    demands.map((d) => ({ id: d.id, cashPaise: d.cashPaise, accountPaise: d.accountPaise })),
    Math.max(0, derived.summary.cashPaidPaise),
    Math.max(0, derived.summary.accountPaidPaise),
  );
  const raisedPercent = Math.round(demands.reduce((s, d) => s + d.percent * 100, 0)) / 100;
  return {
    rows: derived.rows,
    summary: derived.summary,
    demandStatus,
    raisedPercent,
    lastPaymentAt,
    pendingChequesPaise,
  };
}
