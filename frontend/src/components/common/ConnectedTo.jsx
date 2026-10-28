import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, Share2 } from "lucide-react";
import { useFetch } from "@/hooks/useList";
import { Card, Skeleton, StatusPill } from "@/components/v2";
import { cn } from "@/lib/utils";

const TITLE = { project: "Project", tower: "Tower", towers: "Towers", flat: "Flat", flats: "Flats", customer: "Customer(s)", customers: "Customers", booking: "Booking", bookings: "Bookings", stage_plan: "Stage plan", stage_plans: "Stage plans",
  payment_plan: "Payment plan", payment_plans: "Payment plans", demand: "Demand", demands: "Demands", payment: "Payment", payments: "Payments", document: "Document", documents: "Documents" };

function Section({ name, s, open, onToggle }) {
  return (
    <div className="border-t border-warm-100 py-2" data-testid={`connected-${name}`}>
      <button onClick={onToggle} className="flex w-full items-center gap-2 text-left text-sm" aria-expanded={open} data-testid={`connected-toggle-${name}`}>
        {open ? <ChevronDown className="h-3.5 w-3.5 text-txt-muted" /> : <ChevronRight className="h-3.5 w-3.5 text-txt-muted" />}
        <span className="font-semibold">{TITLE[name] || name}</span>
        <span className="rounded-full bg-ink-100 px-2 text-[11px] font-semibold text-ink-950" data-testid={`connected-count-${name}`}>{s.total}</span>
        {s.masked && <span className="text-[11px] text-amber-700">display status</span>}
      </button>
      {open && (
        <ul className="mt-1.5 space-y-1 pl-6" data-testid={`connected-list-${name}`}>
          {s.items.map((it) => (
            <li key={it.id} className="flex items-center justify-between gap-2 text-sm">
              <Link to={it.to} className="truncate text-ink-950 hover:text-gold" data-testid={`connected-link-${it.kind}-${it.id}`}>{it.label}</Link>
              {it.status && <StatusPill status={it.status} className="!text-[10px]" />}
            </li>))}
          {(s.truncated || s.items.length === 0) && <li className="text-xs text-txt-muted">{s.to ? <Link to={s.to} className="hover:text-ink-950">Open all {s.total} →</Link> : s.items.length === 0 ? "None" : `+ ${s.total - s.items.length} more`}</li>}
        </ul>)}
    </div>
  );
}

/** "Connected to" — relationship map of a record from GET /graph/{entity}/{id}; permission-shaped on the server. */
export function ConnectedTo({ entity, id, className, defaultOpen = ["customer", "flat", "tower", "project", "booking", "payment_plan", "stage_plan"] }) {
  const { data, loading, error } = useFetch(id ? `/graph/${entity}/${id}` : null);
  const [open, setOpen] = useState(() => Object.fromEntries(defaultOpen.map((k) => [k, true])));
  if (error) return null;
  return (
    <Card className={cn("!p-4", className)} testId={`connected-to-${entity}`}>
      <div className="flex items-center gap-2"><Share2 className="h-4 w-4 text-gold" /><h3 className="font-display text-lg">Connected to</h3></div>
      {loading || !data ? <Skeleton className="mt-3 h-24 rounded-xl" /> : (
        <div className="mt-2">
          {Object.entries(data.sections).map(([name, s]) => <Section key={name} name={name} s={s} open={!!open[name]} onToggle={() => setOpen((o) => ({ ...o, [name]: !o[name] }))} />)}
          {Object.keys(data.sections).length === 0 && <p className="text-sm text-txt-muted">Nothing linked that you can view.</p>}
        </div>)}
    </Card>
  );
}
