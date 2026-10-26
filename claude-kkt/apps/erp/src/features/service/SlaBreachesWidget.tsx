import { AlertTriangle, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { PriorityChip, SlaBadge } from "./components";
import { useSlaBreaches } from "./api";

/** Red strip on the tickets page listing open tickets that are past their SLA; collapses when there are none. */
export function SlaBreachesWidget({ enabled = true, className }: { enabled?: boolean; className?: string }) {
  const breaches = useSlaBreaches(enabled);
  const [expanded, setExpanded] = useState(false);
  const rows = breaches.data ?? [];
  if (breaches.isError || rows.length === 0) return null;
  const shown = expanded ? rows : rows.slice(0, 3);

  return (
    <section
      role="status"
      aria-label="SLA breaches"
      className={cn("mb-4 rounded-lg border border-danger/30 bg-danger-bg/60 p-3", className)}
      data-testid="sla-breaches-widget"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold text-danger-fg">
          <AlertTriangle className="size-4" aria-hidden="true" />
          {rows.length === 1 ? "1 ticket has breached its SLA" : `${rows.length} tickets have breached their SLA`}
        </h2>
        <Button asChild size="xs" variant="ghost" className="text-danger-fg hover:bg-danger-bg">
          <Link to="/service-requests?sla_breached=true&view=list">
            Show in list <ChevronRight aria-hidden="true" />
          </Link>
        </Button>
      </div>
      <ul className="mt-2 divide-y divide-danger/15">
        {shown.map((ticket) => (
          <li key={ticket.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-sm">
            <Link
              to={`/service-requests/${ticket.id}`}
              className="money font-semibold text-navy-800 hover:underline focus-ring rounded-xs"
            >
              {ticket.ticket_number}
            </Link>
            <span className="min-w-0 flex-1 truncate text-ink">{ticket.subject}</span>
            <span className="hidden truncate text-xs text-ink-muted sm:inline">{ticket.customer_name}</span>
            <PriorityChip priority={ticket.priority} />
            <SlaBadge ticket={ticket} />
          </li>
        ))}
      </ul>
      {rows.length > 3 && (
        <Button
          size="xs"
          variant="link"
          className="mt-1 text-danger-fg"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          {expanded ? "Show fewer" : `Show all ${rows.length}`}
        </Button>
      )}
    </section>
  );
}
