import type { ReservedSql, Sql } from "postgres";

/** SQLSTATE `query_canceled`: what `statement_timeout` raises. */
const QUERY_CANCELED = "57014";

/**
 * Reserves a pool connection, or gives up after `ms` (null). A reservation that arrives after the deadline is released straight away:
 * nothing was sent on it, so giving up never touches another request's statement.
 */
function reserveWithin(sql: Sql, ms: number): Promise<ReservedSql | null> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      resolve(null);
    }, ms);
    sql.reserve().then(
      (conn) => {
        if (settled) {
          conn.release();
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(conn);
      },
      (err: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

/**
 * Runs one read-only statement with a hard time budget (pool wait + execution) and returns its rows, or `null` when the budget ran out.
 *
 * The limit is enforced by PostgreSQL itself: the statement runs in its own `BEGIN READ ONLY` transaction with
 * `SET LOCAL statement_timeout`, so only this statement can be cancelled and the setting ends with the transaction. It never sends an
 * out-of-band cancel request (postgres.js `query.cancel()`): that request names a backend, not a statement, so when it arrives after the
 * query finished it kills whatever that pooled connection runs next — another request's query (docs/PERFORMANCE.md, "Reliability
 * fixes"). The messages are pipelined on one reserved connection, so the guard costs one round trip, and the connection always goes back to the
 * pool outside any transaction.
 */
export async function readWithinBudget<T>(
  sql: Sql,
  text: string,
  params: readonly unknown[],
  budgetMs: number,
): Promise<T[] | null> {
  const started = performance.now();
  const conn = await reserveWithin(sql, budgetMs);
  if (conn === null) return null;
  try {
    const left = Math.max(1, Math.floor(budgetMs - (performance.now() - started)));
    // no parameters → simple protocol, so `begin` and `set local` travel as one message; the setting is an integer we computed
    const [open, rows, close] = await Promise.allSettled([
      conn.unsafe(`begin read only; set local statement_timeout = ${left}`),
      conn.unsafe(text, params as never[], { prepare: true }),
      // ROLLBACK, not COMMIT: the transaction is read-only either way, and the SET LOCAL timeout also applies to the statement that ends
      // it — a COMMIT cancelled by that timeout leaves the transaction open and aborted
      conn.unsafe("rollback"),
    ]);
    if (open.status === "rejected" || close.status === "rejected") {
      // never hand the connection back inside a transaction (the next user would get 25P02 "current transaction is aborted")
      await conn.unsafe("rollback").catch(() => undefined);
      if (open.status === "rejected") throw open.reason;
    }
    if (rows.status === "fulfilled") return rows.value as unknown as T[];
    if ((rows.reason as { code?: string } | null)?.code === QUERY_CANCELED) return null;
    throw rows.reason;
  } finally {
    conn.release();
  }
}
