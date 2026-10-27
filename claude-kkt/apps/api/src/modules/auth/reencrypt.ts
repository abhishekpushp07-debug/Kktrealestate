/**
 * Key rotation for field encryption (job REENCRYPT_FIELDS): walks every encrypted column in id order and rewrites ciphertexts that were
 * written with an older key id under the active one (the first entry of FIELD_ENCRYPTION_KEYS). Business data and `version` do not
 * change, so nobody's edit form conflicts. Rows that cannot be decrypted (their key is no longer configured, or tampered) are counted and
 * left untouched. Safe to re-run: a finished pass leaves nothing to do.
 *
 * Runbook (docs/SECURITY.md): add the new key in front (`FIELD_ENCRYPTION_KEYS=k2:<new>,k1:<old>`), deploy, run this job, check
 * `remaining == 0`, then drop the old key at the next deploy.
 *
 * Heavy-queue job (contract C8): it checks its abort signal between batches and saves a checkpoint after each one (pass, table, last id,
 * counts), so a deploy or the time budget interrupts it promptly and the next attempt resumes where it stopped.
 */
import { sql } from "drizzle-orm";
import type { Executor } from "@kkt/db";
import { registerJob } from "../../jobs/index.js";
import { activeFieldKeyId, activeHashKeyId, decryptField, keyedHash, reencryptField } from "../../lib/crypto.js";
import { config } from "../../config.js";

/** One table with encrypted text columns (and optionally one encrypted key inside a jsonb column). */
interface EncryptedTarget {
  table: string;
  columns: readonly string[];
  jsonb?: { column: string; key: string };
}

/** Every encrypted value in the schema: PAN/Aadhaar (customers, co-applicants), bank account numbers (customers, company bank accounts), MFA secrets. */
export const ENCRYPTED_TARGETS: readonly EncryptedTarget[] = [
  { table: "customers", columns: ["pan_enc", "aadhaar_enc"], jsonb: { column: "bank", key: "account_enc" } },
  { table: "co_applicants", columns: ["pan_enc", "aadhaar_enc"] },
  { table: "bank_accounts", columns: ["account_number_enc"] },
  { table: "users", columns: ["mfa_secret_enc", "mfa_pending_secret_enc"] },
];

/** Resume point of REENCRYPT_FIELDS: which pass, which target table, the last id done and the counts so far. */
export interface ReencryptCheckpoint extends Record<string, unknown> {
  pass: "encrypt" | "rehash";
  table: string;
  last_id: string;
  updated: Record<string, number>;
  failed: Record<string, number>;
  rehashed: Record<string, number>;
}

/** Batch progress hooks of a long pass (the job's signal and checkpoint). */
export interface ReencryptProgress {
  signal?: AbortSignal | undefined;
  checkpoint?: Record<string, unknown> | null | undefined;
  saveCheckpoint?: ((cp: ReencryptCheckpoint) => Promise<void>) | undefined;
}

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

function isReencryptCheckpoint(cp: unknown): cp is ReencryptCheckpoint {
  if (typeof cp !== "object" || cp === null) return false;
  const c = cp as Record<string, unknown>;
  return (
    (c["pass"] === "encrypt" || c["pass"] === "rehash") &&
    typeof c["table"] === "string" &&
    typeof c["last_id"] === "string" &&
    /^[0-9a-f-]{36}$/i.test(c["last_id"]) &&
    typeof c["updated"] === "object" &&
    typeof c["failed"] === "object" &&
    typeof c["rehashed"] === "object"
  );
}

/**
 * Where a target's walk starts: after the checkpoint's last id for the checkpoint's table, from the beginning for later tables, and
 * `null` (skip) for tables the checkpointed attempt had already finished.
 */
function startOf(
  targets: readonly { table: string }[],
  table: string,
  pass: ReencryptCheckpoint["pass"],
  cp: ReencryptCheckpoint | null,
): string | null {
  if (!cp) return NIL_UUID;
  if (cp.pass !== pass) return pass === "encrypt" && cp.pass === "rehash" ? null : NIL_UUID;
  const at = targets.findIndex((t) => t.table === cp.table);
  const me = targets.findIndex((t) => t.table === table);
  if (at < 0) return NIL_UUID;
  if (me < at) return null;
  return me === at ? cp.last_id : NIL_UUID;
}

/** Outcome of a pass. */
export interface ReencryptResult extends Record<string, unknown> {
  active_kid: string;
  updated: Record<string, number>;
  failed: Record<string, number>;
  /** Values still not under the active key after the pass (0 when every row could be decrypted). */
  remaining: number;
  /** Keyed-hash pass (HASH_KEYS rotation): the active hash key and the rows whose hashes were recomputed under it, per table. */
  hash_kid: string;
  rehashed: Record<string, number>;
}

/**
 * Keyed hashes derived from an encrypted identifier (duplicate detection): `<hash column>` = keyedHash(canonical plaintext of
 * `<enc column>`). After a HASH_KEYS rotation the pass recomputes them under the active key; lookups try every ring key meanwhile.
 */
export const HASHED_TARGETS: readonly { table: string; pairs: readonly { enc: string; hash: string }[] }[] = [
  {
    table: "customers",
    pairs: [
      { enc: "pan_enc", hash: "pan_hash" },
      { enc: "aadhaar_enc", hash: "aadhaar_hash" },
    ],
  },
  { table: "co_applicants", pairs: [{ enc: "pan_enc", hash: "pan_hash" }] },
];

/**
 * Recomputes every keyed hash under the active HASH_KEYS key (rows in id order, batches, compare-and-set on the old hash so a concurrent
 * edit is never overwritten). Skipped when the ring has a single key and `force` is not set (every hash was written under it).
 */
export async function rehashIdentifiers(
  db: Executor & { transaction: <T>(fn: (tx: Executor) => Promise<T>) => Promise<T> },
  opts: {
    batchSize?: number;
    force?: boolean;
    progress?: ReencryptProgress;
    carry?: { updated: Record<string, number>; failed: Record<string, number> };
  } = {},
): Promise<Record<string, number>> {
  const cp = isReencryptCheckpoint(opts.progress?.checkpoint) ? opts.progress.checkpoint : null;
  const out: Record<string, number> = cp?.pass === "rehash" ? { ...cp.rehashed } : {};
  if (config.HASH_KEY_RING.length < 2 && !opts.force) return out;
  const batchSize = Math.min(Math.max(opts.batchSize ?? 200, 1), 5000);
  for (const t of HASHED_TARGETS) {
    const start = startOf(HASHED_TARGETS, t.table, "rehash", cp);
    if (start === null) continue;
    out[t.table] ??= 0;
    let lastId = start;
    const cols = t.pairs.flatMap((p) => [
      sql`${ident(p.enc)} as ${ident(p.enc)}`,
      sql`${ident(p.hash)} as ${ident(p.hash)}`,
    ]);
    const anyEnc = sql.join(
      t.pairs.map((p) => sql`${ident(p.enc)} is not null`),
      sql` or `,
    );
    for (;;) {
      opts.progress?.signal?.throwIfAborted();
      const rows = await db.execute<Record<string, unknown> & { id: string }>(sql`
        select id::text as id, ${sql.join(cols, sql`, `)} from ${ident(t.table)}
        where id > ${lastId}::uuid and (${anyEnc}) order by id limit ${batchSize}`);
      if (rows.length === 0) break;
      lastId = rows[rows.length - 1]!.id;
      await db.transaction(async (tx) => {
        for (const row of rows) {
          const sets = [];
          const guards = [];
          for (const p of t.pairs) {
            let plain: string | null;
            try {
              plain = decryptField(row[p.enc] as string | null);
            } catch {
              plain = null; // its field key is gone: left for the field-key pass to report
            }
            if (!plain) continue;
            const fresh = keyedHash(plain);
            if (fresh === row[p.hash]) continue;
            sets.push(sql`${ident(p.hash)} = ${fresh}`);
            guards.push(sql`${ident(p.hash)} is not distinct from ${(row[p.hash] as string | null) ?? null}`);
            guards.push(sql`${ident(p.enc)} is not distinct from ${(row[p.enc] as string | null) ?? null}`);
          }
          if (sets.length === 0) continue;
          const done = await tx.execute(
            sql`update ${ident(t.table)} set ${sql.join(sets, sql`, `)} where id = ${row.id}::uuid and ${sql.join(guards, sql` and `)} returning id`,
          );
          if (done.length > 0) out[t.table]! += 1;
        }
      });
      if (rows.length < batchSize) break;
      await opts.progress?.saveCheckpoint?.({
        pass: "rehash",
        table: t.table,
        last_id: lastId,
        updated: opts.carry?.updated ?? {},
        failed: opts.carry?.failed ?? {},
        rehashed: out,
      });
    }
  }
  return out;
}

const ident = (name: string) => sql.raw(`"${name.replace(/"/g, "")}"`);

/** SQL condition: some encrypted value of the row was written under another key id. */
function staleCondition(t: EncryptedTarget, kid: string) {
  const parts = t.columns.map((c) => sql`(${ident(c)} is not null and split_part(${ident(c)}, '.', 1) <> ${kid})`);
  if (t.jsonb)
    parts.push(
      sql`(${ident(t.jsonb.column)} ->> ${t.jsonb.key} is not null and split_part(${ident(t.jsonb.column)} ->> ${t.jsonb.key}, '.', 1) <> ${kid})`,
    );
  return sql.join(parts, sql` or `);
}

/** The string value of `key` inside a jsonb document read from the database (null when absent). */
function jsonKey(doc: unknown, key: string): string | null {
  if (!doc || typeof doc !== "object") return null;
  const v = (doc as Record<string, unknown>)[key];
  return typeof v === "string" ? v : v === null || v === undefined ? null : JSON.stringify(v);
}

/** Counts the values not yet under the active key. */
export async function countStaleCiphertexts(db: Executor): Promise<number> {
  const kid = activeFieldKeyId();
  let n = 0;
  for (const t of ENCRYPTED_TARGETS) {
    const rows = await db.execute<{ n: number | string }>(
      sql`select count(*)::int as n from ${ident(t.table)} where ${staleCondition(t, kid)}`,
    );
    n += Number(rows[0]?.n ?? 0);
  }
  return n;
}

/** Re-encrypts every stale ciphertext in batches of `batchSize` rows (one short transaction per batch). */
export async function reencryptFields(
  db: Executor & { transaction: <T>(fn: (tx: Executor) => Promise<T>) => Promise<T> },
  opts: { batchSize?: number; rehash?: boolean } & ReencryptProgress = {},
): Promise<ReencryptResult> {
  const kid = activeFieldKeyId();
  const batchSize = Math.min(Math.max(opts.batchSize ?? 200, 1), 5000);
  const cp = isReencryptCheckpoint(opts.checkpoint) ? opts.checkpoint : null;
  const updated: Record<string, number> = cp ? { ...cp.updated } : {};
  const failed: Record<string, number> = cp ? { ...cp.failed } : {};
  for (const t of ENCRYPTED_TARGETS) {
    const start = startOf(ENCRYPTED_TARGETS, t.table, "encrypt", cp);
    if (start === null) continue;
    updated[t.table] ??= 0;
    failed[t.table] ??= 0;
    let lastId = start;
    const selected = [sql`id::text as id`, ...t.columns.map((c) => sql`${ident(c)} as ${ident(c)}`)];
    if (t.jsonb) selected.push(sql`${ident(t.jsonb.column)} as ${ident(t.jsonb.column)}`);
    for (;;) {
      opts.signal?.throwIfAborted();
      const rows = await db.execute<Record<string, unknown> & { id: string }>(sql`
        select ${sql.join(selected, sql`, `)} from ${ident(t.table)}
        where id > ${lastId}::uuid and (${staleCondition(t, kid)}) order by id limit ${batchSize}`);
      if (rows.length === 0) break;
      lastId = rows[rows.length - 1]!.id;
      await db.transaction(async (tx) => {
        for (const row of rows) {
          try {
            const sets = t.columns.map((c) => sql`${ident(c)} = ${reencryptField(row[c] as string | null)}`);
            if (t.jsonb) {
              const doc = row[t.jsonb.column] as Record<string, unknown> | null;
              const value = doc ? doc[t.jsonb.key] : null;
              if (doc && typeof value === "string")
                sets.push(
                  sql`${ident(t.jsonb.column)} = ${JSON.stringify({ ...doc, [t.jsonb.key]: reencryptField(value) })}::jsonb`,
                );
            }
            // Compare-and-set: a value a user changed after the batch was read is left alone (never overwritten with the old secret).
            const guards = t.columns.map(
              (c) => sql`${ident(c)} is not distinct from ${(row[c] as string | null) ?? null}`,
            );
            if (t.jsonb)
              guards.push(
                sql`${ident(t.jsonb.column)} ->> ${t.jsonb.key} is not distinct from ${jsonKey(row[t.jsonb.column], t.jsonb.key)}`,
              );
            const done = await tx.execute(
              sql`update ${ident(t.table)} set ${sql.join(sets, sql`, `)} where id = ${row.id}::uuid and ${sql.join(guards, sql` and `)} returning id`,
            );
            if (done.length > 0) updated[t.table]! += 1;
          } catch {
            failed[t.table]! += 1; // key not configured or tampered: left as is and reported
          }
        }
      });
      if (rows.length < batchSize) break;
      await opts.saveCheckpoint?.({ pass: "encrypt", table: t.table, last_id: lastId, updated, failed, rehashed: {} });
    }
  }
  const remaining = await countStaleCiphertexts(db);
  const rehashed = await rehashIdentifiers(db, {
    batchSize,
    force: opts.rehash === true,
    progress: { signal: opts.signal, checkpoint: cp, saveCheckpoint: opts.saveCheckpoint },
    carry: { updated, failed },
  });
  return { active_kid: kid, updated, failed, remaining, hash_kid: activeHashKeyId(), rehashed };
}

/**
 * Registers the REENCRYPT_FIELDS job (run on demand after adding a new active field-encryption or hash key; payload
 * `{ batch_size?, rehash? }` — `rehash: true` recomputes keyed hashes even with a single hash key).
 */
export function registerReencryptJob(): void {
  registerJob("REENCRYPT_FIELDS", async ({ db, data, signal, checkpoint, saveCheckpoint }) =>
    reencryptFields(db, {
      batchSize: typeof data["batch_size"] === "number" ? data["batch_size"] : undefined,
      rehash: data["rehash"] === true,
      signal,
      checkpoint,
      saveCheckpoint,
    }),
  );
}
