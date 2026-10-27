import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface KeyValueItem {
  label: ReactNode;
  value: ReactNode;
  /** Right-align with tabular figures (money, counts). */
  numeric?: boolean;
  /** Span all columns. */
  full?: boolean;
}

export interface KeyValueListProps {
  items: readonly KeyValueItem[];
  columns?: 1 | 2 | 3;
  /** Stacked (label above value) or inline (label left, value right). */
  layout?: "stacked" | "inline";
  /** Divider between rows (inline layout). */
  divided?: boolean;
  className?: string;
  emptyText?: string;
}

const COLUMNS = { 1: "sm:grid-cols-1", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3" } as const;

export function KeyValueList({
  items,
  columns = 2,
  layout = "stacked",
  divided = true,
  className,
  emptyText = "—",
}: KeyValueListProps) {
  return (
    <dl
      className={cn(
        "grid grid-cols-1",
        layout === "stacked" ? cn("gap-x-6 gap-y-3", COLUMNS[columns]) : "gap-0",
        className,
      )}
    >
      {items.map((item, index) => (
        <div
          key={index}
          className={cn(
            "min-w-0",
            item.full && "sm:col-span-full",
            layout === "inline" &&
              cn("flex items-baseline justify-between gap-4 py-2", divided && index > 0 && "border-t border-border"),
          )}
        >
          <dt
            className={cn(
              "label-caps",
              layout === "inline" && "shrink-0 normal-case tracking-normal text-xs font-medium",
            )}
          >
            {item.label}
          </dt>
          <dd
            className={cn(
              "mt-0.5 min-w-0 break-words text-sm text-ink",
              item.numeric && "money text-right",
              layout === "inline" && "mt-0 text-right font-medium",
            )}
          >
            {item.value === null || item.value === undefined || item.value === "" ? (
              <span className="text-ink-subtle">{emptyText}</span>
            ) : (
              item.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
