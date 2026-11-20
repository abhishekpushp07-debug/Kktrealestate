import { Link } from "react-router-dom";
import { AlertTriangle, RotateCw } from "lucide-react";
import { inrShort } from "@/lib/format";
import { cn } from "@/lib/utils";

export const rs = (rupees) => inrShort(rupees || 0);

/** A clickable figure: always opens the filtered list whose total equals it (drill.to). */
export function Num({ n, money, children, className, testId }) {
  const label = children ?? (money ? rs(n?.amount) : (n?.count ?? 0));
  if (!n?.drill?.to) return <span className={className}>{label}</span>;
  return (
    <Link
      to={n.drill.to}
      className={cn("tnum rounded-sm hover:underline focus-visible:underline", className)}
      data-testid={testId}
    >
      {label}
    </Link>
  );
}

/** Says what's missing and the next step — never a bare ₹0 / 0. */
export function Empty({ text, to, action, testId }) {
  return (
    <div className="py-4 text-sm text-txt-secondary" data-testid={testId}>
      {text}
      {to && (
        <>
          {" · "}
          <Link to={to} className="font-semibold text-gold hover:underline">
            {action}
          </Link>
        </>
      )}
    </div>
  );
}

export function Row({ label, children, testId }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm" data-testid={testId}>
      <span className="text-txt-secondary">{label}</span>
      <span className="font-semibold text-ink-950">{children}</span>
    </div>
  );
}

/** Widget frame: title, per-widget skeleton, isolated "Couldn't load — Retry". */
export function WidgetCard({ id, title, sub, state, loading, onRetry, className, children }) {
  return (
    <section
      className={cn(
        "min-w-0 rounded-[18px] border border-warm-200 bg-white p-4 shadow-warm md:p-5",
        className,
      )}
      data-testid={`widget-${id}`}
      aria-busy={loading || undefined}
    >
      <header className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="e-caps">{title}</h2>
        {sub && <span className="text-xs text-txt-muted">{sub}</span>}
      </header>
      {loading ? (
        <div className="space-y-2" data-testid={`widget-${id}-skeleton`}>
          <div className="skel h-8 w-1/2" />
          <div className="skel h-4 w-full" />
          <div className="skel h-4 w-3/4" />
        </div>
      ) : state && !state.ok ? (
        <div
          className="flex items-center gap-2 py-4 text-sm text-brick"
          data-testid={`widget-${id}-error`}
        >
          <AlertTriangle className="h-4 w-4" /> Couldn&apos;t load
          <button
            type="button"
            onClick={onRetry}
            className="ml-1 inline-flex items-center gap-1 font-semibold text-ink-950 underline"
            data-testid={`widget-${id}-retry`}
          >
            <RotateCw className="h-3.5 w-3.5" /> Retry
          </button>
        </div>
      ) : (
        children
      )}
    </section>
  );
}
