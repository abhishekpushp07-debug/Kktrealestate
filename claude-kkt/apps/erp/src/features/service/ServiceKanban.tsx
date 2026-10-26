import { ArrowRightLeft, MoreHorizontal } from "lucide-react";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { SERVICE_STATUSES, SERVICE_STATUS_LABELS, type ServiceKanbanResponse, type ServiceRequestRow, type ServiceStatus } from "@kkt/contracts";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, IconButton } from "@/components/ui";
import { cn } from "@/lib/utils";
import { TicketCard } from "./components";

export interface ServiceKanbanProps {
  columns: ServiceKanbanResponse["columns"];
  canWrite: boolean;
  onMove: (ticket: ServiceRequestRow, status: ServiceStatus) => void;
  loading?: boolean;
}

const STATUS_ACCENT: Readonly<Record<ServiceStatus, string>> = {
  NEW: "border-t-info",
  IN_PROGRESS: "border-t-status-hold",
  AWAITING_CUSTOMER: "border-t-gold",
  RESOLVED: "border-t-success",
  CLOSED: "border-t-status-blocked",
};

/** Status columns with ticket cards; cards open the ticket, the kebab offers "Move to". */
export function ServiceKanban({ columns, canWrite, onMove, loading = false }: ServiceKanbanProps) {
  const navigate = useNavigate();
  const byStatus = useMemo(() => {
    const map = new Map<ServiceStatus, { count: number; tickets: ServiceRequestRow[] }>();
    for (const status of SERVICE_STATUSES) map.set(status, { count: 0, tickets: [] });
    for (const column of columns) map.set(column.status, { count: column.count, tickets: column.tickets });
    return map;
  }, [columns]);

  return (
    <div className={cn("relative", loading && "opacity-70 transition-opacity")} data-testid="service-kanban">
      <div className="flex gap-3 overflow-x-auto pb-3 scrollbar-thin" style={{ scrollSnapType: "x proximity" }}>
        {SERVICE_STATUSES.map((status) => {
          const column = byStatus.get(status) ?? { count: 0, tickets: [] };
          return (
            <section
              key={status}
              aria-label={`${SERVICE_STATUS_LABELS[status]} (${column.count})`}
              className={cn("flex w-[17rem] shrink-0 flex-col rounded-lg border border-border border-t-4 bg-surface/70", STATUS_ACCENT[status])}
              style={{ scrollSnapAlign: "start" }}
              data-testid={`service-column-${status}`}
            >
              <header className="flex items-center justify-between gap-2 px-3 py-2">
                <h3 className="truncate text-xs font-bold uppercase tracking-wide text-navy-950">{SERVICE_STATUS_LABELS[status]}</h3>
                <span className="money rounded-full bg-card px-2 text-2xs font-semibold text-ink-muted shadow-card">{column.count}</span>
              </header>
              <div className="flex max-h-[calc(100dvh-22rem)] min-h-24 flex-col gap-2 overflow-y-auto px-2 pb-2 scrollbar-thin">
                {column.tickets.length === 0 && <p className="rounded-md border border-dashed border-border px-2 py-4 text-center text-2xs text-ink-subtle">No tickets</p>}
                {column.tickets.map((ticket) => (
                  <article
                    key={ticket.id}
                    // pointer users can tap anywhere on the card; keyboard users reach the ticket through its number link (no nested controls in a role=button)
                    onClick={(event) => {
                      if ((event.target as HTMLElement).closest("a,button,[role=menuitem]")) return;
                      navigate(`/service-requests/${ticket.id}`);
                    }}
                    className="cursor-pointer rounded-md border border-border bg-card p-2.5 shadow-card transition-colors hover:border-navy-300 focus-ring"
                  >
                    <TicketCard
                      ticket={ticket}
                      compact
                      actions={
                        canWrite ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <IconButton icon={MoreHorizontal} label={`Actions for ${ticket.ticket_number}`} size="xs" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuLabel>Move to</DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              {SERVICE_STATUSES.filter((target) => target !== status).map((target) => (
                                <DropdownMenuItem key={target} onSelect={() => onMove(ticket, target)}>
                                  <ArrowRightLeft /> {SERVICE_STATUS_LABELS[target]}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : undefined
                      }
                    />
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
