import { Link } from "react-router-dom";
import { ChevronRight, Inbox, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { inr, inrShort } from "@/lib/format";

export function PageHeader({ title, subtitle, crumbs = [], actions, testId }) {
  return (
    <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between fade-up" data-testid={testId}>
      <div className="min-w-0">
        {crumbs.length > 0 && (
          <nav className="mb-1.5 flex flex-wrap items-center gap-1 text-xs text-slate-500" aria-label="Breadcrumb">
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1">
                {c.to ? <Link to={c.to} className="hover:text-navy">{c.label}</Link> : <span className="font-medium text-navy">{c.label}</span>}
                {i < crumbs.length - 1 && <ChevronRight className="h-3 w-3" />}
              </span>
            ))}
          </nav>
        )}
        <h1 className="text-2xl font-semibold text-navy sm:text-[26px]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title = "Nothing here yet", description, actionLabel, onAction, icon: Icon = Inbox, testId }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white/60 px-6 py-14 text-center" data-testid={testId}>
      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-navy-50 text-navy-700"><Icon className="h-6 w-6" /></div>
      <h3 className="text-[15px] font-semibold text-navy">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-600">{description}</p>}
      {actionLabel && <Button onClick={onAction} className="mt-4 bg-navy hover:bg-navy-700" data-testid={testId ? `${testId}-action` : undefined}>{actionLabel}</Button>}
    </div>
  );
}

export function StatCard({ label, value, hint, icon: Icon, accent = "navy", delta, testId, className }) {
  const accents = { navy: "bg-navy text-white", gold: "gold-grad text-navy", green: "bg-emerald-600 text-white", amber: "bg-amber-500 text-white", slate: "bg-slate-600 text-white", red: "bg-red-600 text-white" };
  return (
    <div className={cn("card-elev card-hover flex items-start justify-between gap-3 p-5 fade-up", className)} data-testid={testId}>
      <div className="min-w-0">
        <p className="label-xs">{label}</p>
        <p className="mt-2 break-words text-[22px] font-bold leading-tight tabular text-navy xl:text-2xl">{value}</p>
        {delta != null && <p className={cn("mt-1 inline-flex items-center gap-1 text-xs font-semibold", delta >= 0 ? "text-emerald-700" : "text-red-700")}>{delta >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}{delta >= 0 ? "+" : ""}{delta}% vs last month</p>}
        {hint && <p className="mt-1 text-xs leading-snug text-slate-600">{hint}</p>}
      </div>
      {Icon && <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", accents[accent])}><Icon className="h-5 w-5" /></div>}
    </div>
  );
}

export function Field({ label, children, hint, error, required, className }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {label && <label className="text-xs font-semibold text-slate-600">{label}{required && <span className="text-red-600"> *</span>}</label>}
      {children}
      {hint && !error && <p className="text-xs text-slate-500">{hint}</p>}
      {error && <p className="text-xs text-red-600" role="alert">{error}</p>}
    </div>
  );
}

export function KV({ label, value, mono }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="label-xs">{label}</span>
      <span className={cn("text-sm font-semibold leading-snug text-navy", mono && "tabular")}>{value ?? "—"}</span>
    </div>
  );
}

/* Indian-grouped money; short form (₹46.7 L) with the full value on hover. */
export function Money({ value, short = false, className }) {
  if (value == null) return <span className={className}>—</span>;
  return <span className={cn("tabular whitespace-nowrap", className)} title={short ? inr(value) : undefined}>{short ? inrShort(value) : inr(value)}</span>;
}

const BADGE = {
  Available: "bg-emerald-100 text-emerald-900", Hold: "bg-amber-100 text-amber-900", Booked: "bg-navy text-white", Sold: "bg-gold text-navy", Blocked: "bg-slate-200 text-slate-800",
  Active: "bg-emerald-100 text-emerald-900", Cancelled: "bg-red-100 text-red-900", Completed: "bg-navy text-white", Pending: "bg-slate-200 text-slate-800", "In Progress": "bg-amber-100 text-amber-900",
  Open: "bg-blue-100 text-blue-900", "Partially Paid": "bg-amber-100 text-amber-900", "Partially paid": "bg-amber-100 text-amber-900", Paid: "bg-emerald-100 text-emerald-900", Overdue: "bg-red-100 text-red-900", Voided: "bg-slate-200 text-slate-700", Raised: "bg-blue-100 text-blue-900", "Not yet due": "bg-slate-200 text-slate-800",
  Cleared: "bg-emerald-100 text-emerald-900", Bounced: "bg-red-100 text-red-900", Reversed: "bg-slate-200 text-slate-800",
  Planning: "bg-slate-200 text-slate-800", "Under Construction": "bg-amber-100 text-amber-900", "Ready to Move": "bg-emerald-100 text-emerald-900", Launched: "bg-blue-100 text-blue-900",
  "KYC Submitted": "bg-amber-100 text-amber-900", "KYC Verified": "bg-emerald-100 text-emerald-900", "KYC Pending": "bg-slate-200 text-slate-800",
};
export function StatusBadge({ status, className, testId }) {
  return <span data-testid={testId} className={cn("inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold leading-5", BADGE[status] || "bg-slate-200 text-slate-800", className)}>{status}</span>;
}
