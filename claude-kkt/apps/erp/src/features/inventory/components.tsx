import { ArrowDown, ArrowUp, GripVertical, RotateCcw, X } from "lucide-react";
import { useCallback, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { Control, FieldValues, UseFormReturn } from "react-hook-form";
import { useSearchParams } from "react-router-dom";
import type { FlatStatus, UnitCounts } from "@kkt/contracts";
import { FLAT_STATUS_LABELS } from "@kkt/contracts";
import { Button, IconButton, Tooltip } from "@/components/ui";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* react-hook-form helpers                                              */
/* ------------------------------------------------------------------ */

/**
 * `useForm<Values, unknown, Output>` (contractResolver) types its control with the parsed output,
 * which `FormField` does not accept; the field tree only ever needs the input-values control.
 */
export function controlOf<Values extends FieldValues>(form: UseFormReturn<Values, unknown, unknown>): Control<Values> {
  return form.control as unknown as Control<Values>;
}

/* ------------------------------------------------------------------ */
/* URL-synced tab                                                       */
/* ------------------------------------------------------------------ */

/** `?tab=` kept in the URL so detail pages survive reload / back. */
export function useTabParam<T extends string>(allowed: readonly T[], fallback: T, key = "tab"): [T, (next: T) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get(key);
  const value = (allowed as readonly string[]).includes(raw ?? "") ? (raw as T) : fallback;
  const set = useCallback(
    (next: T) => {
      setParams(
        (prev) => {
          const copy = new URLSearchParams(prev);
          if (next === fallback) copy.delete(key);
          else copy.set(key, next);
          return copy;
        },
        { replace: true },
      );
    },
    [setParams, fallback, key],
  );
  return [value, set];
}

/* ------------------------------------------------------------------ */
/* Unit counts bar                                                      */
/* ------------------------------------------------------------------ */

export const STATUS_ORDER: readonly FlatStatus[] = ["AVAILABLE", "HOLD", "BOOKED", "SOLD", "BLOCKED"];

const SEGMENT_CLASS: Readonly<Record<FlatStatus, string>> = {
  AVAILABLE: "bg-status-available",
  HOLD: "bg-status-hold",
  BOOKED: "bg-status-booked",
  SOLD: "bg-status-sold",
  BLOCKED: "bg-status-blocked",
};

const DOT_CLASS = SEGMENT_CLASS;

export function statusCount(counts: UnitCounts, status: FlatStatus): number {
  switch (status) {
    case "AVAILABLE":
      return counts.available;
    case "HOLD":
      return counts.hold;
    case "BOOKED":
      return counts.booked;
    case "SOLD":
      return counts.sold;
    case "BLOCKED":
      return counts.blocked;
  }
}

export interface UnitCountsBarProps {
  counts: UnitCounts;
  /** Show the numeric legend under the bar. */
  legend?: boolean;
  size?: "sm" | "md";
  className?: string;
}

/** Stacked bar of units by status (available / hold / booked / sold / blocked) with an optional legend. */
export function UnitCountsBar({ counts, legend = true, size = "md", className }: UnitCountsBarProps) {
  const total = Math.max(
    counts.total,
    STATUS_ORDER.reduce((sum, status) => sum + statusCount(counts, status), 0),
  );
  return (
    <div className={cn("min-w-0", className)}>
      <div
        role="img"
        aria-label={STATUS_ORDER.map((status) => `${FLAT_STATUS_LABELS[status]} ${statusCount(counts, status)}`).join(
          ", ",
        )}
        className={cn("flex w-full overflow-hidden rounded-full bg-navy-50", size === "md" ? "h-2" : "h-1.5")}
      >
        {total > 0 &&
          STATUS_ORDER.map((status) => {
            const value = statusCount(counts, status);
            if (value === 0) return null;
            return (
              <span
                key={status}
                className={cn("h-full", SEGMENT_CLASS[status])}
                style={{ width: `${(value / total) * 100}%` }}
              />
            );
          })}
      </div>
      {legend && (
        <dl className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-2xs text-ink-subtle">
          {STATUS_ORDER.map((status) => (
            <div key={status} className="flex items-center gap-1">
              <dt className="sr-only">{FLAT_STATUS_LABELS[status]}</dt>
              <dd className="money inline-flex items-center gap-1">
                <span className={cn("size-1.5 rounded-full", DOT_CLASS[status])} aria-hidden="true" />
                <span className="font-semibold text-ink">{formatNumber(statusCount(counts, status))}</span>{" "}
                {FLAT_STATUS_LABELS[status].toLowerCase()}
              </dd>
            </div>
          ))}
          <div className="ml-auto money">
            <dt className="sr-only">Total</dt>
            <dd>
              <span className="font-semibold text-ink">{formatNumber(total)}</span> total
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sparkline (tiny inline SVG, no chart library)                        */
/* ------------------------------------------------------------------ */

export interface SparklineProps {
  points: readonly number[];
  width?: number;
  height?: number;
  className?: string;
  "aria-label"?: string;
}

export function Sparkline({ points, width = 120, height = 32, className, ...aria }: SparklineProps) {
  const path = useMemo(() => {
    if (points.length === 0) return { line: "", area: "" };
    const max = Math.max(1, ...points);
    const step = points.length > 1 ? width / (points.length - 1) : width;
    const coords = points.map((value, index) => [index * step, height - (value / max) * (height - 2) - 1] as const);
    const line = coords.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const area = `${line} L${width},${height} L0,${height} Z`;
    return { line, area };
  }, [points, width, height]);
  if (points.length === 0) return <span className="text-xs text-ink-subtle">No data</span>;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={cn("overflow-visible", className)}
      role="img"
      aria-label={aria["aria-label"] ?? "Trend"}
    >
      <path d={path.area} className="fill-gold/20" />
      <path
        d={path.line}
        className="fill-none stroke-gold"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Sortable id list (stage sequence editor)                             */
/* ------------------------------------------------------------------ */

export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (moved !== undefined) next.splice(Math.max(0, Math.min(next.length, to)), 0, moved);
  return next;
}

export interface SortableOption {
  id: string;
  label: string;
  description?: string;
  badge?: ReactNode;
}

export interface SortableIdListProps {
  /** Ordered ids currently selected. */
  value: readonly string[];
  onChange: (ids: string[]) => void;
  /** Every option that may appear (used for labels and the "add" picker). */
  options: readonly SortableOption[];
  /** Restore the master default order. */
  onResetToDefault?: () => void;
  disabled?: boolean;
  emptyText?: string;
  "data-testid"?: string;
}

/** Ordered list with drag (pointer events), up/down arrows and remove; items missing from `value` can be added back. */
export function SortableIdList({
  value,
  onChange,
  options,
  onResetToDefault,
  disabled = false,
  emptyText = "Nothing selected yet.",
  ...rest
}: SortableIdListProps) {
  const byId = useMemo(() => new Map(options.map((option) => [option.id, option] as const)), [options]);
  const missing = options.filter((option) => !value.includes(option.id));
  const refs = useRef(new Map<string, HTMLLIElement>());
  const [dragging, setDragging] = useState<string | null>(null);

  const indexAt = (clientY: number): number => {
    let index = -1;
    value.forEach((id, position) => {
      const node = refs.current.get(id);
      if (!node) return;
      const rect = node.getBoundingClientRect();
      if (clientY > rect.top + rect.height / 2) index = position;
    });
    return index + 1;
  };

  const onPointerDown = (id: string) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(id);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragging) return;
    const from = value.indexOf(dragging);
    let to = indexAt(event.clientY);
    if (to > from) to -= 1;
    if (from !== -1 && to !== from) onChange(moveItem(value, from, to));
  };
  const onPointerUp = () => setDragging(null);

  return (
    <div className="space-y-2" data-testid={rest["data-testid"]}>
      {value.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-ink-subtle">
          {emptyText}
        </p>
      ) : (
        <ol className="divide-y divide-border rounded-md border border-border bg-card">
          {value.map((id, index) => {
            const option = byId.get(id);
            return (
              <li
                key={id}
                ref={(node) => {
                  if (node) refs.current.set(id, node);
                  else refs.current.delete(id);
                }}
                className={cn("flex min-h-10 items-center gap-2 px-2 py-1.5", dragging === id && "bg-gold-light/60")}
              >
                <button
                  type="button"
                  aria-label={`Drag to reorder ${option?.label ?? "item"}`}
                  disabled={disabled}
                  onPointerDown={onPointerDown(id)}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                  className="hidden cursor-grab touch-none rounded-xs p-1 text-ink-subtle hover:text-navy-950 focus-ring active:cursor-grabbing sm:inline-flex"
                >
                  <GripVertical className="size-4" aria-hidden="true" />
                </button>
                <span className="money flex size-6 shrink-0 items-center justify-center rounded-full bg-navy-50 text-2xs font-bold text-navy-950">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate text-sm font-medium", option ? "text-ink" : "text-danger-fg")}>
                    {option?.label ?? "Unknown stage"}
                  </span>
                  {option?.description && (
                    <span className="block truncate text-2xs text-ink-subtle">{option.description}</span>
                  )}
                </span>
                {option?.badge}
                {!disabled && (
                  <span className="flex items-center gap-0.5">
                    <IconButton
                      icon={ArrowUp}
                      label="Move up"
                      size="xs"
                      disabled={index === 0}
                      onClick={() => onChange(moveItem(value, index, index - 1))}
                    />
                    <IconButton
                      icon={ArrowDown}
                      label="Move down"
                      size="xs"
                      disabled={index === value.length - 1}
                      onClick={() => onChange(moveItem(value, index, index + 1))}
                    />
                    <IconButton
                      icon={X}
                      label="Remove"
                      size="xs"
                      onClick={() => onChange(value.filter((item) => item !== id))}
                    />
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {!disabled && (missing.length > 0 || onResetToDefault) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {missing.map((option) => (
            <Tooltip key={option.id} content={option.description ?? "Add to sequence"}>
              <button
                type="button"
                onClick={() => onChange([...value, option.id])}
                className="rounded-full border border-dashed border-border-strong px-2.5 py-0.5 text-xs text-ink-muted hover:border-navy-950 hover:text-navy-950 focus-ring"
              >
                + {option.label}
              </button>
            </Tooltip>
          ))}
          {onResetToDefault && (
            <Button variant="ghost" size="xs" leftIcon={RotateCcw} onClick={onResetToDefault} className="ml-auto">
              Default from master
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Small presentational helpers                                         */
/* ------------------------------------------------------------------ */

export function SectionCardTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h3 className={cn("font-display text-md font-bold text-navy-950", className)}>{children}</h3>;
}

/** Inline notice (warning / info / danger). */
export function Notice({
  tone = "info",
  children,
  className,
  "data-testid": testId,
}: {
  tone?: "info" | "warning" | "danger" | "success";
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
}) {
  const classes = {
    info: "border-info/30 bg-info-bg text-info-fg",
    warning: "border-status-hold-border bg-warning-bg text-warning-fg",
    danger: "border-danger/30 bg-danger-bg text-danger-fg",
    success: "border-status-available-border bg-success-bg text-success-fg",
  }[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("rounded-md border px-3 py-2 text-sm", classes, className)}
      data-testid={testId}
    >
      {children}
    </div>
  );
}
