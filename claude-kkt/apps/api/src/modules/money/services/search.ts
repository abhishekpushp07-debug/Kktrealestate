/**
 * Payment and demand search (audit B3): GET /payments and GET /demands search their own columns AND the booking number, the customer's
 * name and the flat number. ORing ILIKE across joined tables (and a jsonb path) could use no index, so the search is done in two steps:
 *   1. the matching bookings (booking number, or the booking of a matching flat) and customers (full name) are resolved first, each through
 *      its own trigram index, scoped to the company and bounded (SEARCH_REF_BOUND ids per kind);
 *   2. the list filters its own rows by `booking_id = ANY(ids) OR customer_id = ANY(ids) OR <own trigram columns> ILIKE …` — every branch
 *      an index (booking / customer FK indexes, receipt / instrument / demand number / installment trigram indexes), so the planner can
 *      answer with a BitmapOr instead of scanning payments × joins.
 * When a kind matches more than the bound (a very short, very common term), that kind falls back to a semi-join subquery: same results,
 * just not the fast path. Results are exactly those of the old joined OR.
 */
import { and, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { bookings, customers, flats, type Executor } from "@kkt/db";
import { escapeLike } from "../../../lib/list.js";

/** At most this many booking / customer ids are inlined per search; above it the semi-join form is used for that kind. */
export const SEARCH_REF_BOUND = 1000;

/** Bookings and customers whose number / name / flat matches a search term (null = more than the bound: use the subquery form). */
export interface SearchRefs {
  pattern: string;
  bookingIds: string[] | null;
  customerIds: string[] | null;
}

/** Step 1: resolves the matching bookings (by number or flat number) and customers (by name) of the company through their trigram indexes. */
export async function resolveSearchRefs(
  db: Executor,
  companyId: string,
  term: string | undefined,
  bound = SEARCH_REF_BOUND,
): Promise<SearchRefs | null> {
  const t = term?.trim();
  if (!t) return null;
  const pattern = `%${escapeLike(t)}%`;
  const [byNumber, byFlat, byName] = await Promise.all([
    db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.companyId, companyId), ilike(bookings.bookingNumber, pattern)))
      .limit(bound + 1),
    db
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.companyId, companyId),
          inArray(
            bookings.flatId,
            db
              .select({ id: flats.id })
              .from(flats)
              .where(and(eq(flats.companyId, companyId), ilike(flats.flatNumber, pattern))),
          ),
        ),
      )
      .limit(bound + 1),
    db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.companyId, companyId), ilike(customers.fullName, pattern)))
      .limit(bound + 1),
  ]);
  const bookingIds = [...new Set([...byNumber, ...byFlat].map((r) => r.id))];
  return {
    pattern,
    bookingIds: byNumber.length > bound || byFlat.length > bound || bookingIds.length > bound ? null : bookingIds,
    customerIds: byName.length > bound ? null : byName.map((r) => r.id),
  };
}

/** `col = ANY(ids)` with the ids as one array parameter (an index condition), or FALSE for an empty list. */
function anyOf(col: AnyPgColumn, ids: readonly string[]): SQL {
  return ids.length === 0 ? sql`false` : sql`${col} = any(${`{${ids.join(",")}}`}::uuid[])`;
}

/**
 * Step 2: the search condition on a list's own rows — `bookingCol` / `customerCol` against the resolved ids (or the semi-join fallback)
 * OR any of `ownColumns` ILIKE the term. Undefined without a term.
 */
export function searchWhere(
  refs: SearchRefs | null,
  companyId: string,
  cols: { booking: AnyPgColumn; customer: AnyPgColumn; own: readonly (AnyPgColumn | SQL)[] },
): SQL | undefined {
  if (!refs) return undefined;
  const p = refs.pattern;
  const bookingCond =
    refs.bookingIds !== null
      ? anyOf(cols.booking, refs.bookingIds)
      : sql`${cols.booking} in (select b.id from bookings b left join flats f on f.id = b.flat_id where b.company_id = ${companyId}::uuid and (b.booking_number ilike ${p} or f.flat_number ilike ${p}))`;
  const customerCond =
    refs.customerIds !== null
      ? anyOf(cols.customer, refs.customerIds)
      : sql`${cols.customer} in (select c.id from customers c where c.company_id = ${companyId}::uuid and c.full_name ilike ${p})`;
  return or(...cols.own.map((c) => ilike(c as AnyPgColumn, p)), bookingCond, customerCond);
}
