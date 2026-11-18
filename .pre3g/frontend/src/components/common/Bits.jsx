import { Link } from "react-router-dom";
import { ChevronRight, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { inr, inrShort } from "@/lib/format";
import { EmptyState as V2Empty, Field as V2Field } from "@/components/v2";
import { Button } from "@/components/ui/button";

/* Phase E1: these legacy helpers now render the v2 kit so every page shares one token set. */

export function PageHeader({ title, subtitle, crumbs = [], actions, testId }) {
  return (
    <div
      className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between fade-up"
      data-testid={testId}
    >
      <div className="min-w-0">
        {false && crumbs.length > 0 && (
          <nav
            className="mb-1.5 flex flex-wrap items-center gap-1 text-xs text-txt-secondary"
            aria-label="Breadcrumb"
          >
            {crumbs.map((c, i) => (
              <span key={c.to || c.label || c} className="flex items-center gap-1">
                {c.to ? (
                  <Link
                    to={c.to}
                    className="rounded hover:text-ink-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                  >
                    {c.label}
                  </Link>
                ) : (
                  <span className="font-medium text-ink-950" aria-current="page">
                    {c.label}
                  </span>
                )}
                {i < crumbs.length - 1 && <ChevronRight className="h-3 w-3" aria-hidden="true" />}
              </span>
            ))}
          </nav>
        )}
        <h1 className="e-title" data-testid="page-title">
          {typeof title === "string" ? `${title.toLowerCase()}.` : title}
        </h1>
        {subtitle && <p className="e-sub">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, description, actionLabel, onAction, icon = Inbox, testId }) {
  return (
    <V2Empty
      icon={icon}
      title={title}
      description={description}
      testId={testId}
      action={
        actionLabel ? (
          <Button
            type="button"
            onClick={onAction}
            variant="primary"
            data-testid={testId ? `${testId}-action` : undefined}
          >
            {actionLabel}
          </Button>
        ) : undefined
      }
    />
  );
}

export function Field(props) {
  return <V2Field {...props} />;
}

export function KV({ label, value, mono }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="label-xs">{label}</span>
      <span className={cn("text-sm font-semibold leading-snug text-ink-950", mono && "tabular")}>
        {value ?? "—"}
      </span>
    </div>
  );
}

/* Indian-grouped money; short form (₹46.7 L) with the full value on hover. */
export function Money({ value, short = false, className }) {
  if (value == null) return <span className={className}>—</span>;
  return (
    <span
      className={cn("tabular whitespace-nowrap", className)}
      title={short ? inr(value) : undefined}
    >
      {short ? inrShort(value) : inr(value)}
    </span>
  );
}
