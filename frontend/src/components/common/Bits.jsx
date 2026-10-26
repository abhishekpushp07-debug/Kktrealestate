import { Link } from "react-router-dom";
import { ChevronRight, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { inr, inrShort } from "@/lib/format";
import { EmptyState as V2Empty, StatTile, StatusPill, Field as V2Field } from "@/components/v2";

/* Phase E1: these legacy helpers now render the v2 kit so every page shares one token set. */

export function PageHeader({ title, subtitle, crumbs = [], actions, testId }) {
  return (
    <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between fade-up" data-testid={testId}>
      <div className="min-w-0">
        {crumbs.length > 0 && (
          <nav className="mb-1.5 flex flex-wrap items-center gap-1 text-xs text-txt-secondary" aria-label="Breadcrumb">
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1">
                {c.to ? <Link to={c.to} className="rounded hover:text-ink-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold">{c.label}</Link> : <span className="font-medium text-ink-950" aria-current="page">{c.label}</span>}
                {i < crumbs.length - 1 && <ChevronRight className="h-3 w-3" aria-hidden="true" />}
              </span>
            ))}
          </nav>
        )}
        <h1 className="font-display text-4xl text-ink-950">{title}</h1>
        {subtitle && <p className="mt-2 text-sm text-txt-secondary">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, description, actionLabel, onAction, icon = Inbox, testId }) {
  return <V2Empty icon={icon} title={title} description={description} testId={testId}
    action={actionLabel ? <button type="button" onClick={onAction} className="btn btn-primary" data-testid={testId ? `${testId}-action` : undefined}>{actionLabel}</button> : undefined} />;
}

const TONE = { gold: "gold", green: "sage", emerald: "sage", amber: "amber", red: "brick" };
export function StatCard({ label, value, hint, icon, accent, delta, testId }) {
  const h = delta != null ? `${delta >= 0 ? "+" : ""}${delta}% vs last month${hint ? ` · ${hint}` : ""}` : hint;
  return <StatTile label={label} value={typeof value === "number" ? String(value) : value} hint={h} icon={icon} iconTone={TONE[accent]} tone={accent === "red" ? "brick" : undefined} testId={testId} />;
}

export function Field(props) {
  return <V2Field {...props} />;
}

export function KV({ label, value, mono }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="label-xs">{label}</span>
      <span className={cn("text-sm font-semibold leading-snug text-ink-950", mono && "tabular")}>{value ?? "—"}</span>
    </div>
  );
}

/* Indian-grouped money; short form (₹46.7 L) with the full value on hover. */
export function Money({ value, short = false, className }) {
  if (value == null) return <span className={className}>—</span>;
  return <span className={cn("tabular whitespace-nowrap", className)} title={short ? inr(value) : undefined}>{short ? inrShort(value) : inr(value)}</span>;
}

export function StatusBadge({ status, className, testId }) {
  return <StatusPill status={status} className={className} testId={testId} />;
}
