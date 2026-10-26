/**
 * Key rotation for field encryption (job REENCRYPT_FIELDS): walks every encrypted column in id order and rewrites ciphertexts that were
 * written with an older key id under the active one (the first entry of FIELD_ENCRYPTION_KEYS). Business data and `version` do not
 * change, so nobody's edit form conflicts. Rows that cannot be decrypted (their key is no longer configured, or tampered) are counted and
 * left untouched. Safe to re-run: a finished pass leaves nothing to do.
 *
 * Runbook (docs/SECURITY.md): add the new key in front (`FIELD_ENCRYPTION_KEYS=k2:<new>,k1:<old>`), deploy, run this job, check
 * `remaining == 0`, then drop the old key at the next deploy.
 */
import { sql } from "drizzle-orm";
import type { Executor } from "@kkt/db";
import { registerJob } from "../../jobs/index.js";
import { activeFieldKeyId, reencryptField } from "../../lib/crypto.js";

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

/** Outcome of a pass. */
export interface ReencryptResult extends Record<string, unknown> {
  active_kid: string;
  updated: Record<string, number>;
  failed: Record<string, number>;
  /** Values still not under the active key after the pass (0 when every row could be decrypted). */
  remaining: number;
}

const ident = (name: string) => sql.raw(`"${name.replace(/"/g, "")}"`);

/** SQL condition: some encrypted value of the row was written under another key id. */
function staleCondition(t: EncryptedTarget, kid: string) {
  const parts = t.columns.map((c) => sql`(${ident(c)} is not null and split_part(${ident(c)}, '.', 1) <> ${kid})`);
  if (t.jsonb) parts.push(sql`(${ident(t.jsonb.column)} ->> ${t.jsonb.key} is not null and split_part(${ident(t.jsonb.column)} ->> ${t.jsonb.key}, '.', 1) <> ${kid})`);
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
    const rows = await db.execute<{ n: number | string }>(sql`select count(*)::int as n from ${ident(t.table)} where ${staleCondition(t, kid)}`);
    n += Number(rows[0]?.n ?? 0);
  }
  return n;
}

/** Re-encrypts every stale ciphertext in batches of `batchSize` rows (one short transaction per batch). */
export async function reencryptFields(db: Executor & { transaction: <T>(fn: (tx: Executor) => Promise<T>) => Promise<T> }, opts: { batchSize?: number } = {}): Promise<ReencryptResult> {
  const kid = activeFieldKeyId();
  const batchSize = Math.min(Math.max(opts.batchSize ?? 200, 1), 5000);
  const updated: Record<string, number> = {};
  const failed: Record<string, number> = {};
  for (const t of ENCRYPTED_TARGETS) {
    updated[t.table] = 0;
    failed[t.table] = 0;
    let lastId = "00000000-0000-0000-0000-000000000000";
    const selected = [sql`id::text as id`, ...t.columns.map((c) => sql`${ident(c)} as ${ident(c)}`)];
    if (t.jsonb) selected.push(sql`${ident(t.jsonb.column)} as ${ident(t.jsonb.column)}`);
    for (;;) {
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
              if (doc && typeof value === "string") sets.push(sql`${ident(t.jsonb.column)} = ${JSON.stringify({ ...doc, [t.jsonb.key]: reencryptField(value) })}::jsonb`);
            }
            // Compare-and-set: a value a user changed after the batch was read is left alone (never overwritten with the old secret).
            const guards = t.columns.map((c) => sql`${ident(c)} is not distinct from ${(row[c] as string | null) ?? null}`);
            if (t.jsonb) guards.push(sql`${ident(t.jsonb.column)} ->> ${t.jsonb.key} is not distinct from ${jsonKey(row[t.jsonb.column], t.jsonb.key)}`);
            const done = await tx.execute(sql`update ${ident(t.table)} set ${sql.join(sets, sql`, `)} where id = ${row.id}::uuid and ${sql.join(guards, sql` and `)} returning id`);
            if (done.length > 0) updated[t.table]! += 1;
          } catch {
            failed[t.table]! += 1; // key not configured or tampered: left as is and reported
          }
        }
      });
      if (rows.length < batchSize) break;
    }
  }
  return { active_kid: kid, updated, failed, remaining: await countStaleCiphertexts(db) };
}

/** Registers the REENCRYPT_FIELDS job (run on demand after adding a new active key; payload `{ batch_size? }`). */
export function registerReencryptJob(): void {
  registerJob("REENCRYPT_FIELDS", async ({ db, data }) => reencryptFields(db, { batchSize: typeof data["batch_size"] === "number" ? data["batch_size"] : undefined }));
}
