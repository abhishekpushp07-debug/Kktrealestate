/**
 * What happens when a job fails for the last time (audit H "failed jobs are silent"): every company's Super Admins get a JOB_FAILED
 * bell pointing at the run, and ERROR_WEBHOOK_URL (when configured) receives a JSON POST. Both are best effort: an alert that cannot be
 * delivered is logged, never thrown over the job's own error.
 */
import { eq } from "drizzle-orm";
import { companies, type DB } from "@kkt/db";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { notifyRole } from "../modules/notifications/service.js";

/** One final job failure. */
export interface JobFailure {
  jobName: string;
  runId: string;
  error: string;
  attempt: number;
  maxAttempts: number;
  /** Company of a tenant job (payload `company_id`): only its Super Admins are told. Null/absent for system-wide jobs (every company). */
  companyId?: string | null;
}

/** Role whose members are told about failed jobs (SPEC §1: Super Admin owns integrity tools and jobs). */
export const JOB_FAILURE_ROLES = ["Super Admin"] as const;

/** Body POSTed to ERROR_WEBHOOK_URL. */
export function webhookPayload(f: JobFailure, now = new Date()): Record<string, unknown> {
  return {
    event: "job.failed",
    job_name: f.jobName,
    run_id: f.runId,
    error: f.error,
    attempts: f.attempt,
    max_attempts: f.maxAttempts,
    company_id: f.companyId ?? null,
    app_version: config.APP_VERSION,
    service: config.OTEL_SERVICE_NAME,
    occurred_at: now.toISOString(),
  };
}

/** POSTs a JSON event to ERROR_WEBHOOK_URL (5 s timeout); false when unset or undeliverable. */
export async function postErrorWebhook(
  body: Record<string, unknown>,
  url: string | undefined = config.ERROR_WEBHOOK_URL,
): Promise<boolean> {
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": `kkt-api/${config.APP_VERSION}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) logger.warn({ status: res.status }, "error webhook answered with a non-2xx status");
    return res.ok;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "error webhook could not be delivered");
    return false;
  }
}

/** Notifies the Super Admins (of the job's company for a tenant job, else of every company) and calls the error webhook. */
export async function alertJobFailure(db: DB, f: JobFailure): Promise<{ notified: number; webhook: boolean }> {
  let notified = 0;
  const title = `Job ${f.jobName} failed`;
  const body = `Attempt ${f.attempt} of ${f.maxAttempts}: ${f.error}`.slice(0, 1000);
  const targets = f.companyId
    ? db.select({ id: companies.id }).from(companies).where(eq(companies.id, f.companyId))
    : db.select({ id: companies.id }).from(companies);
  for (const c of await targets) {
    notified += await notifyRole(db, c.id, JOB_FAILURE_ROLES, {
      type: "JOB_FAILED",
      title,
      body,
      entityType: "job_run",
      entityId: f.runId,
      link: "/admin/jobs",
    });
  }
  const webhook = await postErrorWebhook(webhookPayload(f));
  return { notified, webhook };
}
