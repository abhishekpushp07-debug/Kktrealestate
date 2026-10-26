/**
 * LEDGER_REBUILD (admin job; also the last step of the demo seed): brings every stored booking ledger into the canonical posting order
 * (domain sortLedgerEvents) — the migration path for ledgers written by the older business-date order, which the row-level integrity
 * finding (e) would otherwise report as SUMMARY_MISMATCH once per booking.
 *
 * Bookings are processed in id order in batches; each booking is rebuilt in its own retrying transaction under the booking lock, and a
 * ledger is rewritten ONLY when it differs from the canonical rebuild (`rebuild(…, { write: "if-changed" })`), so running the job again
 * is a no-op. Every rewritten booking gets a `booking.ledger_rebuilt` audit row. The result lists the bookings whose row ORDER changed
 * (a different event/source at some position, or a different row count) separately from those where only figures changed.
 */
import { and, asc, eq, gt, type SQL } from "drizzle-orm";
import { bookings, type DB } from "@kkt/db";
import { writeAudit } from "../../../lib/audit.js";
import { moneyTransaction, SYSTEM_MONEY_ACTOR, type MoneyActor } from "../common.js";
import { rebuild } from "./ledger.js";

/** Bookings per batch (one id-ordered page; each booking is still its own transaction). */
export const LEDGER_REBUILD_BATCH = 200;
/** At most this many bookings are listed per category in the result (the counts are always complete). */
export const LEDGER_REBUILD_LIST_LIMIT = 500;

/** One booking whose stored ledger differed from the canonical rebuild. */
export interface LedgerRebuildChange {
  booking_id: string;
  booking_number: string;
  /** 1-based position of the first differing row. */
  first_position: number;
  /** Compared fields that differed (event, refId, row, amountPaise, …; first 20 differences). */
  fields: string[];
}

/** Result of rebuildAllLedgers (stored in job_runs.result). */
export interface LedgerRebuildResult {
  dry_run: boolean;
  batches: number;
  bookings_checked: number;
  /** Ledgers rewritten (0 on a dry run). */
  bookings_rebuilt: number;
  order_changed_count: number;
  figures_changed_count: number;
  /** Bookings whose row ORDER changed (event or source at some position, or the row count). */
  order_changed: LedgerRebuildChange[];
  /** Bookings where only amounts/running balances or the summary columns differed. */
  figures_changed: LedgerRebuildChange[];
}

/** Options of rebuildAllLedgers. */
export interface LedgerRebuildOptions {
  companyId?: string | undefined;
  /** Report what would change without writing. */
  dryRun?: boolean;
  batchSize?: number;
  actor?: MoneyActor;
}

const ORDER_FIELDS = new Set(["event", "refId", "row"]);

/** Rebuilds every booking ledger (of one company, or all) in canonical order; see the module comment. */
export async function rebuildAllLedgers(db: DB, opts: LedgerRebuildOptions = {}): Promise<LedgerRebuildResult> {
  const batchSize = Math.max(1, Math.min(opts.batchSize ?? LEDGER_REBUILD_BATCH, 5_000));
  const actor = opts.actor ?? SYSTEM_MONEY_ACTOR;
  const out: LedgerRebuildResult = {
    dry_run: Boolean(opts.dryRun),
    batches: 0,
    bookings_checked: 0,
    bookings_rebuilt: 0,
    order_changed_count: 0,
    figures_changed_count: 0,
    order_changed: [],
    figures_changed: [],
  };
  let after: string | null = null;
  for (;;) {
    const where: SQL[] = [];
    if (opts.companyId) where.push(eq(bookings.companyId, opts.companyId));
    if (after) where.push(gt(bookings.id, after));
    const page: { id: string; bookingNumber: string; companyId: string }[] = await db
      .select({ id: bookings.id, bookingNumber: bookings.bookingNumber, companyId: bookings.companyId })
      .from(bookings)
      .where(where.length ? and(...where) : undefined)
      .orderBy(asc(bookings.id))
      .limit(batchSize);
    if (page.length === 0) break;
    out.batches += 1;
    for (const b of page) {
      out.bookings_checked += 1;
      const r = await moneyTransaction(db, async (tx) => {
        const rb = await rebuild(tx, b.id, { write: opts.dryRun ? false : "if-changed" });
        const changed = rb.mismatches.length > 0 || rb.rowMismatches.length > 0;
        if (rb.written) {
          await writeAudit(tx, {
            companyId: b.companyId,
            actor,
            action: "booking.ledger_rebuilt",
            entityType: "booking",
            entityId: b.id,
            before: { ledger_rows: rb.stored["ledger_rows"] ?? 0 },
            after: {
              ledger_rows: rb.recomputed["ledger_rows"] ?? 0,
              order_changed: rb.rowMismatches.some((d) => ORDER_FIELDS.has(d.field)),
              first_position: rb.rowMismatches[0]?.position ?? null,
              summary_fields: rb.mismatches.map((m) => m.field),
            },
            ip: actor.ip ?? null,
            requestId: actor.requestId ?? null,
          });
        }
        return { changed, written: rb.written, rowMismatches: rb.rowMismatches, mismatches: rb.mismatches };
      });
      if (!r.changed) continue;
      if (r.written) out.bookings_rebuilt += 1;
      const change: LedgerRebuildChange = {
        booking_id: b.id,
        booking_number: b.bookingNumber,
        first_position: r.rowMismatches[0]?.position ?? 0,
        fields: [...new Set([...r.rowMismatches.map((d) => d.field), ...r.mismatches.map((m) => m.field)])],
      };
      if (r.rowMismatches.some((d) => ORDER_FIELDS.has(d.field))) {
        out.order_changed_count += 1;
        if (out.order_changed.length < LEDGER_REBUILD_LIST_LIMIT) out.order_changed.push(change);
      } else {
        out.figures_changed_count += 1;
        if (out.figures_changed.length < LEDGER_REBUILD_LIST_LIMIT) out.figures_changed.push(change);
      }
    }
    after = page[page.length - 1]!.id;
    if (page.length < batchSize) break;
  }
  return out;
}
