import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Skeleton } from "./skeleton";

export interface StatDelta {
  /** Display text ("+12.5%", "₹4.2 L"). */
  value: string;
  direction: "up" | "down" | "flat";
  /** Whether "up" is good (collections) or bad (overdue). Default good. */
  positiveIsGood?: boolean;
  label?: string;
}

export interface StatCardProps {
  label: ReactNode;
  value: ReactNode;
  /** Small text under the value ("vs last month"). */
  hint?: ReactNode;
  delta?: StatDelta;
  icon?: LucideIcon;
  /** Sparkline (or any chart) rendered at the bottom right. */
  sparkline?: ReactNode;
  loading?: boolean;
  tone?: "default" | "navy" | "gold";
  className?: string;
  onClick?: () => void;
  "data-testid"?: string;
}

export function StatCard({ label, value, hint, delta, icon: Icon, sparkline, loading = false, tone = "default", className, onClick, ...rest }: StatCardProps) {
  const good = delta ? (delta.direction === "flat" ? null : (delta.direction === "up") === (delta.positiveIsGood ?? true)) : null;
  const DeltaIcon = delta?.direction === "up" ? ArrowUpRight : delta?.direction === "down" ? ArrowDownRight : Minus;
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper
      type={onClick ? "button" : undefined}
      onClick={onClick}
      data-testid={rest["data-testid"]}
      className={cn(
        "relative flex min-w-0 flex-col gap-2 overflow-hidden rounded-lg border p-4 text-left shadow-card",
        tone === "default" && "border-border bg-card",
        tone === "navy" && "border-navy-800 bg-navy-950 text-white",
        tone === "gold" && "border-gold-border bg-gold-light",
        onClick && "transition-colors hover:border-navy-300 focus-ring",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className={cn("label-caps", tone === "navy" && "text-navy-200")}>{label}</span>
        {Icon && (
          <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md", tone === "navy" ? "bg-navy-800 text-gold" : "bg-navy-50 text-navy-700")}>
            <Icon className="size-4" aria-hidden="true" />
          </span>
        )}
      </div>
      {loading ? (
        <Skeleton className={cn("h-7 w-32", tone === "navy" && "opacity-20")} />
      ) : (
        <div className={cn("money font-display text-2xl font-extrabold leading-8 tracking-tight", tone === "navy" ? "text-white" : "text-navy-950")}>{value}</div>
      )}
      {(delta || hint) && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {delta && (
            <span
              className={cn(
                "money inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold",
                tone !== "navy" && good === null && "bg-surface text-ink-muted",
                tone !== "navy" && good === true && "bg-success-bg text-success-fg",
                tone !== "navy" && good === false && "bg-danger-bg text-danger-fg",
                // on the navy card the chip is navy-800 with light text (≥ 4.5:1)
                tone === "navy" && "bg-navy-800",
                tone === "navy" && good === null && "text-navy-100",
                tone === "navy" && good === true && "text-[#6ee7b7]",
                tone === "navy" && good === false && "text-[#fca5a5]",
              )}
            >
              <DeltaIcon className="size-3" aria-hidden="true" />
              {delta.value}
              {delta.label && <span className="sr-only"> {delta.label}</span>}
            </span>
          )}
          {(hint ?? delta?.label) && <span className={cn(tone === "navy" ? "text-navy-200" : "text-ink-subtle")}>{hint ?? delta?.label}</span>}
        </div>
      )}
      {sparkline && <div className="pointer-events-none absolute bottom-2 right-3 h-10 w-24 opacity-90">{sparkline}</div>}
    </Wrapper>
  );
}
