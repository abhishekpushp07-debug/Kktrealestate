/**
 * Service-request SLA and receivables ageing.
 */
import { assertDateString, diffDays } from "./dates.js";
import { toEpochMs } from "./ist.js";

/** Ticket priority. */
export type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

/** Hours allowed per priority, e.g. {LOW:72, MEDIUM:48, HIGH:24, URGENT:8}. */
export type SlaHours = Readonly<Record<Priority, number>>;

/** Default SLA hours from company settings. */
export const DEFAULT_SLA_HOURS: SlaHours = { LOW: 72, MEDIUM: 48, HIGH: 24, URGENT: 8 };

/** SLA deadline (RFC 3339 UTC) = created instant + the priority's hours. */
export function slaDueAt(
  createdAtISO: string | Date,
  priority: Priority,
  slaHours: SlaHours = DEFAULT_SLA_HOURS,
): string {
  const hours = slaHours[priority];
  if (!Number.isFinite(hours) || hours < 0) {
    throw new Error(`Invalid SLA hours for ${priority}: ${String(hours)}`);
  }
  return new Date(toEpochMs(createdAtISO) + hours * 3_600_000).toISOString();
}

/** Whether an SLA deadline has passed at `now` and the ticket is still open. */
export function isSlaBreached(dueAtISO: string | Date, now: string | Date, resolved: boolean): boolean {
  return !resolved && toEpochMs(now) > toEpochMs(dueAtISO);
}

/** Ageing bucket of a due date. */
export type AgeingBucket = "NOT_DUE" | "D0_30" | "D31_60" | "D61_90" | "D90_PLUS";

/** Buckets a demand by how many days past its due date it is as of today. */
export function ageingBucket(dueDate: string, today: string): AgeingBucket {
  assertDateString(dueDate, "dueDate");
  assertDateString(today, "today");
  const overdueDays = diffDays(today, dueDate);
  if (overdueDays < 0) {
    return "NOT_DUE";
  }
  if (overdueDays <= 30) {
    return "D0_30";
  }
  if (overdueDays <= 60) {
    return "D31_60";
  }
  if (overdueDays <= 90) {
    return "D61_90";
  }
  return "D90_PLUS";
}

/** Human label for an ageing bucket. */
export function ageingBucketLabel(bucket: AgeingBucket): string {
  switch (bucket) {
    case "NOT_DUE":
      return "Not due";
    case "D0_30":
      return "0–30 days";
    case "D31_60":
      return "31–60 days";
    case "D61_90":
      return "61–90 days";
    case "D90_PLUS":
      return "90+ days";
    default: {
      const never: never = bucket;
      throw new Error(`Unknown ageing bucket ${String(never)}`);
    }
  }
}
