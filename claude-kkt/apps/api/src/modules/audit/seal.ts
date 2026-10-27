/**
 * Tamper evidence for the audit log (audit D): job AUDIT_SEAL chains new `audit_logs` rows into `audit_seals`, one chain per company.
 * Each seal covers the next run of the company's rows in (created_at, id) order and stores
 *
 *   hash = SHA-256( prev_hash ‖ "\n" ‖ digest(row 1) ‖ "\n" ‖ … ‖ digest(row n) )
 *
 * where digest(row) is the SHA-256 of the row's canonical text (every column; jsonb in PostgreSQL's canonical text form; created_at with
 * microseconds in UTC), computed by PostgreSQL so the job and the verifier read the exact same bytes. A changed, removed or back-dated
 * inserted row — or a removed seal — breaks the chain from that point on; GET /admin/audit/verify recomputes it and names the first
 * mismatch. Both tables are append-only (triggers) and the application role cannot UPDATE/DELETE them (0002_privileges.sql); the seal
 * hashes can additionally be shipped off-site (e.g. the backup manifest) for WORM-style evidence.
 *
 * Rows younger than the lag (default 10 minutes) — and rows not older than the start of the oldest transaction still open — are left for
 * the next run: a transaction that wrote an audit row at T may commit after a later row, and sealing past it would leave it outside every
 * seal.
 */
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { AuditVerifyResponse } from "@kkt/contracts";
import type { DB, Executor } from "@kkt/db";

/** Seconds a row must be old before it is sealed (in-flight transactions commit well within this). */
export const AUDIT_SEAL_LAG_SECONDS = 600;
/** Rows per seal (one seal = one hash over this many row digests). */
export const AUDIT_SEAL_BATCH = 5_000;
/** Seals one run may write per company (a backlog is worked off over several runs). */
const MAX_SEALS_PER_RUN = 200;

/** Canonical text of an audit row (aliased `a`), every column, NULLs spelled out. */
const ROW_TEXT = sql.raw(`concat_ws('|',
  a.id::text, a.company_id::text, a.actor_type::text, coalesce(a.actor_id::text, '∅'), coalesce(a.actor_name, '∅'), a.action,
  a.entity_type, coalesce(a.entity_id::text, '∅'), coalesce(a.before::text, '∅'), coalesce(a.after::text, '∅'),
  coalesce(a.ip, '∅'), coalesce(a.request_id, '∅'),
  to_char(a.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))`);
const ROW_DIGEST = sql`encode(sha256(convert_to(${ROW_TEXT}, 'UTF8')), 'hex')`;

/**
 * Start of the oldest transaction still open in this database (another client session), or +infinity. An audit row's created_at is its
 * transaction's start, so a transaction open longer than the lag (a long job, a bulk import) can still commit rows dated before rows that
 * are already old enough: sealing past its start would leave those rows outside every seal, and verify would then report the seal's row
 * count as tampered (a false alarm). Sessions of other roles show no xact_start to a non-superuser, which is fine: audit rows are written
 * by the application role, whose sessions are visible.
 */
const OLDEST_OPEN_TRANSACTION = sql.raw(`coalesce((select min(s.xact_start) from pg_stat_activity s
      where s.datname = current_database() and s.pid <> pg_backend_pid() and s.backend_type = 'client backend'
        and s.xact_start is not null), 'infinity'::timestamptz)`);

/** Chain step: SHA-256 hex of the previous hash and the row digests. */
export function chainHash(prevHash: string | null, digests: readonly string[]): string {
  const h = createHash("sha256").update(prevHash ?? "genesis");
  for (const d of digests) h.update("\n").update(d);
  return h.digest("hex");
}

type SealRow = {
  id: number;
  company_id: string;
  first_audit_id: string;
  last_audit_id: string;
  row_count: number;
  prev_hash: string | null;
  hash: string;
  sealed_at: Date | string;
};

type DigestRow = {
  id: string;
  digest: string;
};

/** The latest seal of a company (null before the first). */
async function lastSeal(db: Executor, companyId: string): Promise<SealRow | null> {
  const rows = await db.execute<SealRow>(
    sql`select * from audit_seals where company_id = ${companyId}::uuid order by id desc limit 1`,
  );
  return rows[0] ?? null;
}

/** Digests of the company's rows after `afterId` (by (created_at, id)), older than the lag, at most `limit`. */
async function nextDigests(
  db: Executor,
  companyId: string,
  afterId: string | null,
  lagSeconds: number,
  limit: number,
): Promise<DigestRow[]> {
  const after = afterId
    ? sql`and (a.created_at, a.id) > (select b.created_at, b.id from audit_logs b where b.id = ${afterId}::uuid)`
    : sql``;
  return db.execute<DigestRow>(sql`
    select a.id::text as id, ${ROW_DIGEST} as digest from audit_logs a
    where a.company_id = ${companyId}::uuid ${after}
      and a.created_at < now() - make_interval(secs => ${lagSeconds})
      and a.created_at < ${OLDEST_OPEN_TRANSACTION}
    order by a.created_at, a.id limit ${limit}`);
}

/** Result of one AUDIT_SEAL run. */
export interface SealResult extends Record<string, unknown> {
  companies: number;
  seals_written: number;
  rows_sealed: number;
}

/**
 * AUDIT_SEAL: for every company, seals the rows written since its last seal (older than `lagSeconds`) in batches of AUDIT_SEAL_BATCH.
 * Each seal is written in its own short transaction under a per-company advisory lock, so parallel runs never fork a chain.
 */
export async function sealAuditLog(
  db: DB,
  opts: { lagSeconds?: number; batchSize?: number } = {},
): Promise<SealResult> {
  const lag = Math.max(0, opts.lagSeconds ?? AUDIT_SEAL_LAG_SECONDS);
  const batch = Math.min(Math.max(opts.batchSize ?? AUDIT_SEAL_BATCH, 1), 50_000);
  const companies = await db.execute<{ id: string }>(sql`select id::text as id from companies order by created_at, id`);
  let seals = 0;
  let rows = 0;
  for (const { id: companyId } of companies) {
    for (let i = 0; i < MAX_SEALS_PER_RUN; i++) {
      const sealed = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`audit-seal:${companyId}`}))`);
        const prev = await lastSeal(tx, companyId);
        const digests = await nextDigests(tx, companyId, prev?.last_audit_id ?? null, lag, batch);
        if (digests.length === 0) return 0;
        const hash = chainHash(
          prev?.hash ?? null,
          digests.map((d) => d.digest),
        );
        await tx.execute(sql`
          insert into audit_seals (company_id, first_audit_id, last_audit_id, row_count, prev_hash, hash)
          values (${companyId}::uuid, ${digests[0]!.id}::uuid, ${digests[digests.length - 1]!.id}::uuid, ${digests.length},
                  ${prev?.hash ?? null}, ${hash})`);
        return digests.length;
      });
      if (sealed === 0) break;
      seals += 1;
      rows += sealed;
      if (sealed < batch) break;
    }
  }
  return { companies: companies.length, seals_written: seals, rows_sealed: rows };
}

/**
 * Recomputes a company's chain from its first seal and reports the first mismatch (seal k covers every row after seal k-1's last row up
 * to its own last row, so a row inserted anywhere in between changes the count): a seal whose `prev_hash` is not the previous seal's
 * hash (a seal removed or forged), a boundary row that no longer exists, a row count that differs (a row removed or back-dated in), or a
 * hash that differs (a row changed). Also counts the rows not sealed yet.
 */
export async function verifyAuditChain(db: Executor, companyId: string): Promise<AuditVerifyResponse> {
  const seals = await db.execute<SealRow>(
    sql`select * from audit_seals where company_id = ${companyId}::uuid order by id`,
  );
  let prevHash: string | null = null;
  let prevLast: string | null = null;
  let rowsChecked = 0;
  let sealsChecked = 0;
  let firstMismatch: AuditVerifyResponse["first_mismatch"] = null;
  for (const seal of seals) {
    const at = new Date(seal.sealed_at).toISOString();
    const fail = (
      reason: NonNullable<AuditVerifyResponse["first_mismatch"]>["reason"],
      extra: Record<string, unknown> = {},
    ) => ({
      seal_id: Number(seal.id),
      sealed_at: at,
      first_audit_id: seal.first_audit_id,
      last_audit_id: seal.last_audit_id,
      reason,
      ...extra,
    });
    if ((seal.prev_hash ?? null) !== prevHash) {
      firstMismatch = fail("CHAIN_BROKEN", { expected: prevHash, actual: seal.prev_hash ?? null });
      break;
    }
    const bounds = await db.execute<{ id: string }>(
      sql`select id::text as id from audit_logs where id in (${seal.first_audit_id}::uuid, ${seal.last_audit_id}::uuid)`,
    );
    if (bounds.length < (seal.first_audit_id === seal.last_audit_id ? 1 : 2)) {
      firstMismatch = fail("BOUNDARY_MISSING");
      break;
    }
    const digests = await db.execute<DigestRow>(sql`
      select a.id::text as id, ${ROW_DIGEST} as digest from audit_logs a
      where a.company_id = ${companyId}::uuid
        and (a.created_at, a.id) <= (select b.created_at, b.id from audit_logs b where b.id = ${seal.last_audit_id}::uuid)
        ${prevLast ? sql`and (a.created_at, a.id) > (select b.created_at, b.id from audit_logs b where b.id = ${prevLast}::uuid)` : sql``}
      order by a.created_at, a.id`);
    if (digests.length !== Number(seal.row_count)) {
      firstMismatch = fail("ROW_COUNT", { expected: Number(seal.row_count), actual: digests.length });
      break;
    }
    const hash = chainHash(
      prevHash,
      digests.map((d) => d.digest),
    );
    if (hash !== seal.hash) {
      firstMismatch = fail("HASH_MISMATCH", { expected: seal.hash, actual: hash });
      break;
    }
    rowsChecked += digests.length;
    sealsChecked += 1;
    prevHash = seal.hash;
    prevLast = seal.last_audit_id;
  }
  const [unsealed] = await db.execute<{ n: number | string }>(sql`
    select count(*)::int as n from audit_logs a where a.company_id = ${companyId}::uuid
      ${prevLast && !firstMismatch ? sql`and (a.created_at, a.id) > (select b.created_at, b.id from audit_logs b where b.id = ${prevLast}::uuid)` : sql``}`);
  const last = seals[seals.length - 1];
  return {
    ok: firstMismatch === null,
    company_id: companyId,
    seals_checked: sealsChecked,
    rows_checked: rowsChecked,
    unsealed_rows: firstMismatch ? null : Number(unsealed?.n ?? 0),
    last_sealed_at: last ? new Date(last.sealed_at).toISOString() : null,
    first_mismatch: firstMismatch,
    verified_at: new Date().toISOString(),
  };
}
