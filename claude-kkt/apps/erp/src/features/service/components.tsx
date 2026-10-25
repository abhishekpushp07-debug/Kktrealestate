import { AlertTriangle, Clock3, Paperclip, UserRound } from "lucide-react";
import { type ReactNode } from "react";
import { Link } from "react-router-dom";
import { SERVICE_PRIORITY_LABELS, SERVICE_STATUS_LABELS, type ServicePriority, type ServiceRequestRow } from "@kkt/contracts";
import { Badge, StatusChip, Tooltip } from "@/components/ui";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { slaLabel, slaState } from "./sla";

/* ------------------------------------------------------------------ */
/* Chips                                                                */
/* ------------------------------------------------------------------ */

export function PriorityChip({ priority, size = "sm" }: { priority: ServicePriority; size?: "sm" | "md" }) {
  return <StatusChip status={priority} label={SERVICE_PRIORITY_LABELS[priority]} size={size} dot={priority === "URGENT" || priority === "HIGH"} data-testid={`priority-chip-${priority}`} />;
}

export function TicketStatusChip({ status, size = "sm" }: { status: ServiceRequestRow["status"]; size?: "sm" | "md" }) {
  return <StatusChip status={status} label={SERVICE_STATUS_LABELS[status]} size={size} />;
}

/** "Due in 3 h" / "Breached 2 h ago" (red) / "SLA met". */
export function SlaBadge({ ticket, now, className }: { ticket: Pick<ServiceRequestRow, "sla_due_at" | "is_sla_breached" | "status">; now?: Date; className?: string }) {
  const state = slaState(ticket, now);
  const { text, tone } = slaLabel(state);
  const Icon = tone === "danger" ? AlertTriangle : Clock3;
  const badge = (
    <Badge variant={tone} className={cn("gap-1", className)} data-testid="sla-badge" data-sla={state.kind}>
      <Icon className="size-3" aria-hidden="true" />
      {text}
    </Badge>
  );
  if (!ticket.sla_due_at) return badge;
  return (
    <Tooltip content={`SLA due ${formatDateTime(ticket.sla_due_at, { zone: true })}`}>
      <span className="inline-flex">{badge}</span>
    </Tooltip>
  );
}

/* ------------------------------------------------------------------ */
/* Ticket card (mobile list rows + kanban)                              */
/* ------------------------------------------------------------------ */

export interface TicketCardProps {
  ticket: ServiceRequestRow;
  /** Extra controls rendered at the top-right (kanban "move to" menu). */
  actions?: ReactNode;
  compact?: boolean;
  className?: string;
}

export function TicketCard({ ticket, actions, compact = false, className }: TicketCardProps) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)} data-testid={`ticket-card-${ticket.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link to={`/service-requests/${ticket.id}`} className="money text-xs font-semibold text-navy-700 hover:underline focus-ring rounded-xs" onClick={(event) => event.stopPropagation()}>
            {ticket.ticket_number}
          </Link>
          <p className={cn("line-clamp-2 font-medium text-ink", compact ? "text-sm" : "text-sm")}>{ticket.subject}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <PriorityChip priority={ticket.priority} />
          {actions}
        </div>
      </div>
      <p className="truncate text-xs text-ink-muted">
        {ticket.customer_name}
        {ticket.project_name && (
          <>
            {" · "}
            {ticket.project_name}
            {ticket.flat_number && <span className="money"> {ticket.flat_number}</span>}
          </>
        )}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {!compact && <TicketStatusChip status={ticket.status} />}
        <SlaBadge ticket={ticket} />
        <Badge variant="outline">{ticket.category_name}</Badge>
        {ticket.message_count > 0 && (
          <Badge variant="neutral" numeric>
            <Paperclip className="size-3" aria-hidden="true" /> {ticket.message_count}
          </Badge>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 text-2xs text-ink-subtle">
        <span className="inline-flex min-w-0 items-center gap-1">
          <UserRound className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{ticket.assignee_name ?? "Unassigned"}</span>
        </span>
        <span className="money shrink-0">{formatRelative(ticket.last_message_at ?? ticket.updated_at)}</span>
      </div>
    </div>
  );
}
