import type { ServiceRequestRow, ServiceStatus } from "@kkt/contracts";

/** Statuses after which the SLA clock no longer runs. */
export const SLA_STOPPED_STATUSES: readonly ServiceStatus[] = ["RESOLVED", "CLOSED"];

export type SlaState =
  | { kind: "none" }
  | { kind: "stopped"; breached: boolean }
  | { kind: "breached"; overdueMs: number }
  | { kind: "due"; remainingMs: number; urgent: boolean };

/** Under two hours left counts as urgent. */
export const SLA_URGENT_MS = 2 * 60 * 60 * 1000;

/** Derives the SLA display state of a ticket at `now`. */
export function slaState(
  ticket: Pick<ServiceRequestRow, "sla_due_at" | "is_sla_breached" | "status">,
  now: Date = new Date(),
): SlaState {
  if (SLA_STOPPED_STATUSES.includes(ticket.status)) return { kind: "stopped", breached: ticket.is_sla_breached };
  if (!ticket.sla_due_at) return { kind: "none" };
  const due = Date.parse(ticket.sla_due_at);
  if (Number.isNaN(due)) return { kind: "none" };
  const remaining = due - now.getTime();
  if (ticket.is_sla_breached || remaining < 0) return { kind: "breached", overdueMs: Math.max(0, -remaining) };
  return { kind: "due", remainingMs: remaining, urgent: remaining <= SLA_URGENT_MS };
}

/** "3 d 4 h", "2 h 15 m", "40 m", "< 1 m". */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(Math.max(0, ms) / 60_000);
  if (totalMinutes < 1) return "< 1 m";
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return hours > 0 ? `${days} d ${hours} h` : `${days} d`;
  if (hours > 0) return minutes > 0 ? `${hours} h ${minutes} m` : `${hours} h`;
  return `${minutes} m`;
}

/** Short label + tone for the SLA badge. */
export function slaLabel(state: SlaState): { text: string; tone: "danger" | "warning" | "success" | "neutral" } {
  switch (state.kind) {
    case "none":
      return { text: "No SLA", tone: "neutral" };
    case "stopped":
      return state.breached ? { text: "SLA missed", tone: "danger" } : { text: "SLA met", tone: "success" };
    case "breached":
      return { text: `Breached ${formatDuration(state.overdueMs)} ago`, tone: "danger" };
    case "due":
      return { text: `Due in ${formatDuration(state.remainingMs)}`, tone: state.urgent ? "warning" : "neutral" };
  }
}

/** Forward transitions offered as buttons for each status (reopen is listed last). */
export const STATUS_TRANSITIONS: Readonly<
  Record<ServiceStatus, readonly { to: ServiceStatus; label: string; variant: "primary" | "gold" | "outline" }[]>
> = {
  NEW: [{ to: "IN_PROGRESS", label: "Start work", variant: "primary" }],
  IN_PROGRESS: [
    { to: "AWAITING_CUSTOMER", label: "Await customer", variant: "gold" },
    { to: "RESOLVED", label: "Resolve", variant: "primary" },
  ],
  AWAITING_CUSTOMER: [
    { to: "IN_PROGRESS", label: "Resume", variant: "primary" },
    { to: "RESOLVED", label: "Resolve", variant: "outline" },
  ],
  RESOLVED: [
    { to: "CLOSED", label: "Close", variant: "primary" },
    { to: "IN_PROGRESS", label: "Reopen", variant: "outline" },
  ],
  CLOSED: [{ to: "IN_PROGRESS", label: "Reopen", variant: "outline" }],
};
