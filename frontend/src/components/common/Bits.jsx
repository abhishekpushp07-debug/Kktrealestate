import { Link } from "react-router-dom";
import { ChevronRight, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function PageHeader({ title, subtitle, crumbs = [], actions, testId }) {
  return (
    <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between fade-up" data-testid={testId}>
      <div>
        {crumbs.length > 0 && (
          <nav className="mb-1 flex items-center gap-1 text-xs text-slate-500">
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1">
                {c.to ? <Link to={c.to} className="hover:text-navy">{c.label}</Link> : <span>{c.label}</span>}
                {i < crumbs.length - 1 && <ChevronRight className="h-3 w-3" />}
              </span>
            ))}
          </nav>
        )}
        <h1 className="text-2xl font-extrabold text-navy sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title = "Nothing here yet", description, actionLabel, onAction, icon: Icon = Inbox, testId }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white/60 px-6 py-14 text-center" data-testid={testId}>
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-navy-50 text-navy-700"><Icon className="h-6 w-6" /></div>
      <h3 className="text-base font-bold text-navy">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {actionLabel && <Button onClick={onAction} className="mt-4 bg-navy hover:bg-navy-700" data-testid={testId ? `${testId}-action` : undefined}>{actionLabel}</Button>}
    </div>
  );
}

export function StatCard({ label, value, hint, icon: Icon, accent = "navy", testId, className }) {
  const accents = { navy: "bg-navy text-white", gold: "bg-gold text-navy", green: "bg-emerald-500 text-white", amber: "bg-amber-500 text-white", slate: "bg-slate-500 text-white" };
  return (
    <div className={cn("card-elev flex items-start justify-between p-5 fade-up", className)} data-testid={testId}>
      <div>
        <p className="label-xs">{label}</p>
        <p className="mt-2 text-2xl font-extrabold tabular text-navy sm:text-3xl">{value}</p>
        {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      </div>
      {Icon && <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg", accents[accent])}><Icon className="h-5 w-5" /></div>}
    </div>
  );
}

export function Field({ label, children, hint, error, required, className }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {label && <label className="text-xs font-semibold text-slate-600">{label}{required && <span className="text-red-500"> *</span>}</label>}
      {children}
      {hint && !error && <p className="text-[11px] text-slate-400">{hint}</p>}
      {error && <p className="text-[11px] text-red-600">{error}</p>}
    </div>
  );
}

export function KV({ label, value, mono }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="label-xs">{label}</span>
      <span className={cn("text-sm font-semibold text-navy", mono && "tabular")}>{value ?? "—"}</span>
    </div>
  );
}
