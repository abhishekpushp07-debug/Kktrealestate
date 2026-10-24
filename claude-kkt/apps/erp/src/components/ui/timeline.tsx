import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

export type TimelineTone = "neutral" | "navy" | "gold" | "success" | "warning" | "danger" | "info";

export interface TimelineItem {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  /** RFC 3339 timestamp. */
  at?: string | null;
  actor?: string | null;
  icon?: LucideIcon;
  tone?: TimelineTone;
  /** Extra content (attachments, diff table). */
  children?: ReactNode;
}

const TONES: Readonly<Record<TimelineTone, string>> = {
  neutral: "bg-surface text-ink-muted ring-border",
  navy: "bg-navy-950 text-gold ring-navy-800",
  gold: "bg-gold-light text-gold-text ring-gold-border",
  success: "bg-success-bg text-success-fg ring-status-available-border",
  warning: "bg-warning-bg text-warning-fg ring-status-hold-border",
  danger: "bg-danger-bg text-danger-fg ring-danger/30",
  info: "bg-info-bg text-info-fg ring-info/30",
};

export interface TimelineProps {
  items: readonly TimelineItem[];
  className?: string;
  /** Show absolute IST timestamps instead of "5 min ago". */
  absolute?: boolean;
}

export function Timeline({ items, className, absolute = false }: TimelineProps) {
  return (
    <ol className={cn("relative space-y-0", className)}>
      {items.map((item, index) => {
        const Icon = item.icon;
        const last = index === items.length - 1;
        return (
          <li key={item.id} className="relative flex gap-3 pb-5 last:pb-0">
            {!last && <span className="absolute left-3.5 top-7 h-[calc(100%-1rem)] w-px bg-border" aria-hidden="true" />}
            <span className={cn("relative z-10 mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ring-1", TONES[item.tone ?? "neutral"])}>
              {Icon ? <Icon className="size-3.5" aria-hidden="true" /> : <span className="size-2 rounded-full bg-current" aria-hidden="true" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p className="text-sm font-medium text-ink">{item.title}</p>
                {item.at && (
                  <time dateTime={item.at} title={formatDateTime(item.at, { zone: true })} className="money text-2xs text-ink-subtle">
                    {absolute ? formatDateTime(item.at) : formatRelative(item.at)}
                  </time>
                )}
              </div>
              {(item.description || item.actor) && (
                <p className="mt-0.5 text-xs text-ink-subtle">
                  {item.description}
                  {item.actor && <span className="ml-1 font-medium text-ink-muted">· {item.actor}</span>}
                </p>
              )}
              {item.children && <div className="mt-2">{item.children}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
