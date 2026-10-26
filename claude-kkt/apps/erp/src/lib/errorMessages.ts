/**
 * Plain-language messages for API error codes and FORBIDDEN `details.reason` values (docs/API-CONVENTIONS.md "Error registry").
 * Pure: the ApiClientError wrapper and every toast / form / dialog go through `describeError` in lib/api.ts, which calls this.
 * A code this table does not know falls back to the server's own message (the registry tolerates new codes).
 */

export interface ErrorFacts {
  status: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
  retryAfterSeconds?: number;
}

/** 403 FORBIDDEN `details.reason` → what the user can do about it. */
export const FORBIDDEN_REASON_MESSAGES: Readonly<Record<string, string>> = {
  SELF_CHANGE:
    "You can't change your own role, project access, active state or password from here. Use Change password for your own password, or ask another administrator.",
  PERMISSION_ESCALATION: "You can't grant permissions your own role doesn't have.",
  SCOPE_ESCALATION:
    "Your project access doesn't cover this account. Only an administrator with access to all of its projects can manage it.",
  SUPER_ADMIN_TARGET: "Only a Super Admin can create, change or assign the Super Admin role.",
  SYSTEM_ROLE_SUPER_ADMIN_ONLY: "Only a Super Admin can edit a built-in system role.",
  TARGET_OUTRANKS_CALLER: "This account has permissions your role doesn't have, so you can't reset, unlock or edit it.",
  KYC_MAKER_CHECKER: "KYC must be verified or rejected by someone other than the person who submitted it.",
  KYC_VERIFIED_LOCKED: "Only an administrator (Settings permission) can change a verified KYC.",
};

const MISSING_KYC_LABELS: Readonly<Record<string, string>> = {
  pan: "PAN",
  aadhaar: "Aadhaar",
  kyc_document: "a KYC document (PAN / Aadhaar copy)",
};

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function retryText(seconds: number | undefined, fallback: string): string {
  return seconds ? `Try again in ${seconds}s.` : fallback;
}

/** Missing KYC items (422 KYC_INCOMPLETE details.missing) as readable labels. */
export function kycMissingLabels(details: Record<string, unknown> | undefined): string[] {
  return list(details?.missing).map((key) => MISSING_KYC_LABELS[key] ?? key.replace(/_/g, " "));
}

/** 409 PLAN_STAGES_MISSING details (missing_stages / stranded_bookings, money track) as readable lines. */
export function planStageProblems(details: Record<string, unknown> | undefined): {
  missing: string[];
  stranded: string[];
} {
  const rows = (value: unknown): Record<string, unknown>[] =>
    Array.isArray(value)
      ? value.filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
      : [];
  const missing = rows(details?.missing_stages).map((row) => {
    const stage = typeof row.name === "string" ? row.name : "a stage";
    const where = [
      typeof row.plan_name === "string" ? `plan ${row.plan_name}` : null,
      typeof row.block_name === "string" ? `tower ${row.block_name}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return `${stage}${where ? ` (${where})` : ""}`;
  });
  const stranded = rows(details?.stranded_bookings).map((row) => {
    const booking = typeof row.booking_number === "string" ? row.booking_number : "a booking";
    const installment =
      typeof row.installment_name === "string"
        ? `${String(row.installment_seq ?? "?")}. ${row.installment_name}`
        : "an installment";
    const stage = typeof row.stage_name === "string" ? ` waits on “${row.stage_name}”` : " waits on possession";
    return `${booking}: ${installment}${stage}`;
  });
  return { missing: [...new Set(missing)], stranded };
}

function preview(items: string[], max = 4): string {
  return items.length > max ? `${items.slice(0, max).join("; ")}; and ${items.length - max} more` : items.join("; ");
}

/** Returns a user-facing sentence for a known code, or null to let the caller use the server's message. */
export function messageForError(error: ErrorFacts): string | null {
  const { code, details } = error;
  switch (code) {
    case "NETWORK_ERROR":
      return "Cannot reach the server. Check your connection and try again.";
    case "VERSION_CONFLICT":
      return "Someone else changed this record. Reload to see the latest version.";
    case "VERSION_REQUIRED":
      return "This change was sent without the record's version. Reload the page and try again.";
    case "LOCK_TIMEOUT":
    case "CONFLICT_RETRY":
      return "The record is busy with another change. Try again in a moment.";
    case "SERVICE_UNAVAILABLE":
      return `The server is busy or a dependency is down. ${retryText(error.retryAfterSeconds, "Try again shortly.")}`;
    case "RATE_LIMITED":
      return error.retryAfterSeconds
        ? `Too many attempts. Try again in ${error.retryAfterSeconds}s.`
        : "Too many attempts. Try again in a moment.";
    case "LOCKED":
      return error.message || "Account temporarily locked. Try again in 15 minutes.";
    case "FORBIDDEN": {
      const reason = typeof details?.reason === "string" ? details.reason : null;
      if (reason && FORBIDDEN_REASON_MESSAGES[reason]) {
        const missing = list(details?.missing);
        return missing.length && reason === "PERMISSION_ESCALATION"
          ? `${FORBIDDEN_REASON_MESSAGES[reason]} Missing: ${missing.join(", ")}.`
          : FORBIDDEN_REASON_MESSAGES[reason];
      }
      return "You don't have permission to do that.";
    }
    case "SUPER_ADMIN_ONLY":
      return "Only a Super Admin can do this.";
    case "NOT_FOUND":
      return "That record could not be found.";
    case "GONE": {
      const replacement = typeof details?.replacement === "string" ? ` Use ${details.replacement} instead.` : "";
      return `${error.message || "This feature has been retired."}${replacement} Please update the app.`;
    }
    case "KYC_INCOMPLETE": {
      const missing = kycMissingLabels(details);
      return missing.length ? `KYC can't be submitted yet. Missing: ${missing.join(", ")}.` : error.message;
    }
    case "KYC_TRANSITION_INVALID":
      return details?.reason === "UNCHANGED_SINCE_REJECTION"
        ? "Correct the customer's details or upload a new KYC document before resubmitting a rejected KYC."
        : error.message || "That KYC status change isn't allowed from the current status.";
    case "PLAN_STAGES_MISSING": {
      const { missing, stranded } = planStageProblems(details);
      const parts = [
        missing.length ? `Payment plans would lose stages they wait on: ${preview(missing)}.` : error.message,
      ];
      if (stranded.length) parts.push(`Booked installments would be stranded: ${preview(stranded)}.`);
      parts.push("Keep those stages in the tower, or change the plan first.");
      return parts.join(" ");
    }
    case "HANDOVER_BLOCKED":
      return error.message || "The booking cannot be handed over yet.";
    case "HAS_ACTIVE_BOOKING":
      return "This customer has an active booking. Cancel or complete it before erasing their personal data.";
    case "BOOKING_COMPLETED":
      return "This booking is completed (handed over). Only an administrator (Settings permission) can reverse its payments, which reopens the booking.";
    case "JOB_ALREADY_RUNNING":
      return error.message || "This job is already queued or running.";
    case "EXPORT_NOT_READY":
      return "The file isn't ready yet. Wait for the status to show Done.";
    case "CASH_INSUFFICIENT":
      return error.message || "Not enough cash in hand for this entry.";
    case "UNSUPPORTED_MEDIA_TYPE":
      return error.message || "That file type isn't allowed. Upload a PDF, JPG, PNG or WebP.";
    case "LINK_EXPIRED":
      return "This link has expired.";
    default:
      return null;
  }
}
