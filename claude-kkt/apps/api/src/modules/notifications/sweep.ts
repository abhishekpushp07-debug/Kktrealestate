/**
 * NOTIFICATION_SWEEP (SPEC §13 "a startup sweep removes notifications pointing at deleted entities"): applies the retraction rule —
 * unread notifications are deleted, read ones are marked withdrawn — to every bell whose entity no longer exists, was soft-deleted
 * (documents), erased (customers) or voided (demands), and to customer bells of erased customers. Works in batches so a large backlog
 * never holds long locks. Enqueued once per deploy at worker boot; safe to run any time (idempotent).
 */
import { sql, type SQL } from "drizzle-orm";
import type { Executor } from "@kkt/db";

/** Rows handled per statement. */
export const SWEEP_BATCH = 5_000;

/** Notification entity_type → table holding the entity and the condition under which it is still "live". */
export const SWEEP_TARGETS: Readonly<Record<string, { table: string; live?: string }>> = {
  document: { table: "documents", live: "t.is_deleted = false" },
  customer: { table: "customers", live: "t.erased_at is null" },
  demand: { table: "demands", live: "t.status <> 'VOID'" },
  service_request: { table: "service_requests" },
  booking: { table: "bookings" },
  booking_other_charge: { table: "booking_other_charges" },
  payment: { table: "payments" },
  block_stage: { table: "block_stages" },
  site_visit: { table: "site_visits" },
  enquiry: { table: "enquiries" },
  lead: { table: "leads" },
  flat: { table: "flats" },
  notice: { table: "notices" },
  brochure_download: { table: "brochure_downloads" },
  integrity_run: { table: "integrity_runs" },
  job_run: { table: "job_runs" },
  export: { table: "exports" },
};

/** Counts of one sweep. */
export interface SweepResult {
  deleted: number;
  withdrawn: number;
  by_entity: Record<string, { deleted: number; withdrawn: number }>;
}

/** Applies the retraction rule to the first `batch` notifications matching `stale`; returns how many it looked at. */
async function retractBatch(db: Executor, stale: SQL, batch: number): Promise<{ seen: number; deleted: number; withdrawn: number }> {
  const rows = await db.execute<{ seen: number; deleted: number; withdrawn: number }>(sql`
    with stale as (
      select n.id, n.is_read from notifications n
      where (n.is_read = false or n.is_withdrawn = false) and ${stale}
      limit ${batch}
    ),
    del as (delete from notifications d using stale s where d.id = s.id and s.is_read = false returning d.id),
    upd as (update notifications u set is_withdrawn = true from stale s where u.id = s.id and s.is_read = true returning u.id)
    select (select count(*) from stale)::int as seen, (select count(*) from del)::int as deleted, (select count(*) from upd)::int as withdrawn`);
  const r = rows[0];
  return { seen: Number(r?.seen ?? 0), deleted: Number(r?.deleted ?? 0), withdrawn: Number(r?.withdrawn ?? 0) };
}

/** Runs the sweep over every known entity type plus customer bells of erased customers. */
export async function sweepNotifications(db: Executor, batch = SWEEP_BATCH): Promise<SweepResult> {
  const out: SweepResult = { deleted: 0, withdrawn: 0, by_entity: {} };
  const run = async (label: string, stale: SQL) => {
    let seen = batch;
    const acc = { deleted: 0, withdrawn: 0 };
    while (seen >= batch) {
      const r = await retractBatch(db, stale, batch);
      seen = r.seen;
      acc.deleted += r.deleted;
      acc.withdrawn += r.withdrawn;
    }
    if (acc.deleted + acc.withdrawn > 0) out.by_entity[label] = acc;
    out.deleted += acc.deleted;
    out.withdrawn += acc.withdrawn;
  };
  for (const [entityType, target] of Object.entries(SWEEP_TARGETS)) {
    const live = target.live ? sql.raw(` and ${target.live}`) : sql``;
    await run(entityType, sql`n.entity_type = ${entityType} and n.entity_id is not null and not exists (select 1 from ${sql.identifier(target.table)} t where t.id = n.entity_id${live})`);
  }
  await run("recipient:customer", sql`n.recipient_type = 'CUSTOMER' and not exists (select 1 from customers c where c.id = n.recipient_id and c.erased_at is null)`);
  return out;
}
