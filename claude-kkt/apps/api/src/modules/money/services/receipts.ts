/**
 * Receipt numbering as the LAST statement of a payment posting (audit C2/C5: "each payment holds the company-wide receipt sequence lock
 * from numbering until COMMIT"). Receipt numbers are gapless per financial year, so the sequence row (`sequences`, scope `receipt`) stays
 * locked from the increment until the transaction ends. postPayment therefore does all of its reads and every write that does not carry
 * the number first, and then runs ONE statement that
 *   1. increments the sequence (INSERT … ON CONFLICT DO UPDATE … RETURNING value — the same row nextSequence uses),
 *   2. formats the number in SQL exactly like domain formatNumber (prefix, FY label, `{seq:w}` zero padding that never truncates),
 *   3. inserts every row that carries the number — the payment, its ledger row, its audit row and its notifications —
 * and COMMIT follows immediately: the sequence lock is held for one statement instead of the whole posting. A failure anywhere rolls the
 * increment back with everything else, so numbers stay gapless.
 */
import { getTableColumns, sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { sequences, type Executor } from "@kkt/db";
import { DEFAULT_NUMBER_PATTERN, financialYear, formatNumber } from "@kkt/domain";
import type { NumberingCompany, NumberingScope } from "../../../lib/numbering.js";

/** Placeholder for the receipt number inside text values (labels, titles); the statement substitutes the allocated number. */
export const RECEIPT_TOKEN = "{{receipt_number}}";

const TOKEN = /\{(prefix|fy|seq)(?::(\d+))?\}/g;
const FALLBACK_PREFIX: Record<NumberingScope, string> = {
  customer: "CUST-",
  booking: "BK-",
  demand: "DM-",
  receipt: "RCPT/",
  ticket: "SR-",
  visit: "SV-",
};

/**
 * SQL text expression of a document number for the sequence value `seq` — the same rendering as domain formatNumber(prefix, fy, seq,
 * pattern) (which also validates the pattern: it throws for a pattern without `{seq}`).
 */
export function numberSql(seq: SQL, prefix: string, fyLabel: string, pattern = DEFAULT_NUMBER_PATTERN): SQL {
  formatNumber(prefix, fyLabel, 1, pattern); // same validation as the JS formatter
  const parts: SQL[] = [];
  let last = 0;
  for (const m of pattern.matchAll(TOKEN)) {
    const literal = pattern.slice(last, m.index);
    if (literal) parts.push(sql`${literal}::text`);
    const width = m[2] ? Number(m[2]) : 0;
    switch (m[1]) {
      case "prefix":
        parts.push(sql`${prefix}::text`);
        break;
      case "fy":
        parts.push(sql`${fyLabel}::text`);
        break;
      default:
        parts.push(
          width > 0
            ? sql`(case when length((${seq})::text) >= ${width}::int then (${seq})::text else lpad((${seq})::text, ${width}::int, '0') end)`
            : sql`(${seq})::text`,
        );
    }
    last = (m.index ?? 0) + m[0].length;
  }
  const tail = pattern.slice(last);
  if (tail) parts.push(sql`${tail}::text`);
  return sql.join(parts, sql` || `);
}

/** One table's rows for {@link insertSelect}: plain values (by drizzle key) plus per-row SQL overrides over the `num` source. */
export interface RowsFor<T extends PgTable> {
  table: T;
  rows: readonly Record<string, unknown>[];
  /** Column key → SQL expression (may reference `num.receipt`), applied to every row. */
  computed?: (row: Record<string, unknown>) => Record<string, SQL>;
}

/**
 * `INSERT INTO <table> (<cols>) SELECT <row 1> FROM num UNION ALL SELECT <row 2> FROM num …` — every plain value bound through its
 * column's own encoder and cast to the column's SQL type (so jsonb, timestamps, enums and bigint paise round-trip exactly as drizzle's
 * own insert would write them); computed columns take their SQL expression instead. Columns whose value is undefined in the first row
 * keep their defaults.
 */
export function insertSelect<T extends PgTable>(spec: RowsFor<T>): SQL | null {
  if (spec.rows.length === 0) return null;
  const columns = getTableColumns(spec.table) as Record<string, PgColumn>;
  const first = spec.rows[0]!;
  const firstComputed = spec.computed?.(first) ?? {};
  const keys = Object.keys(columns).filter((k) => first[k] !== undefined || firstComputed[k] !== undefined);
  const selects = spec.rows.map((row) => {
    const computed = spec.computed?.(row) ?? {};
    const exprs = keys.map((k) => {
      const c = computed[k];
      if (c) return c;
      const col = columns[k]!;
      const v = row[k];
      if (v === null || v === undefined) return sql`null::${sql.raw(col.getSQLType())}`;
      return sql`${sql.param(v, col)}::${sql.raw(col.getSQLType())}`;
    });
    return sql`select ${sql.join(exprs, sql`, `)} from num`;
  });
  const cols = sql.join(
    keys.map((k) => sql.identifier(columns[k]!.name)),
    sql`, `,
  );
  return sql`insert into ${spec.table} (${cols}) ${sql.join(selects, sql` union all `)}`;
}

/**
 * Allocates the next number of `scope` for the FY of `businessDate` and writes every row that carries it, in ONE statement (see the
 * module comment). Returns the allocated number.
 */
export async function insertWithNumber(
  tx: Executor,
  company: NumberingCompany,
  scope: NumberingScope,
  businessDate: string,
  inserts: readonly RowsFor<PgTable>[],
): Promise<string> {
  const fy = financialYear(businessDate, company.fyStartMonth);
  const cfg = company.numbering[scope] ?? { prefix: FALLBACK_PREFIX[scope] };
  const formatted = numberSql(
    sql`seq.value`,
    cfg.prefix ?? FALLBACK_PREFIX[scope],
    fy.label,
    cfg.format ?? DEFAULT_NUMBER_PATTERN,
  );
  const ctes: SQL[] = [
    sql`seq as (
      insert into ${sequences} (company_id, scope, fy, value) values (${company.id}::uuid, ${scope}, ${fy.label}, 1)
      on conflict (company_id, scope, fy) do update set value = ${sequences}.value + 1
      returning value)`,
    sql`num as (select ${formatted} as receipt from seq)`,
  ];
  inserts.forEach((spec, i) => {
    const ins = insertSelect(spec);
    if (ins) ctes.push(sql`${sql.raw(`w${i}`)} as (${ins})`);
  });
  const rows = await tx.execute<{ receipt: string }>(sql`with ${sql.join(ctes, sql`, `)} select receipt from num`);
  const receipt = rows[0]?.receipt;
  if (!receipt) throw new Error("receipt numbering statement returned no number");
  return receipt;
}

/** Substitutes the allocated number for {@link RECEIPT_TOKEN} in a text value (SQL side). */
export function withNumber(text: string): SQL {
  return sql`replace(${text}::text, ${RECEIPT_TOKEN}::text, num.receipt)`;
}

/** The allocated number itself (SQL side). */
export const NUMBER: SQL = sql`num.receipt`;
