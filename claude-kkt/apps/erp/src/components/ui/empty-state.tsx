import { Inbox, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  /** Compact variant for table bodies and cards. */
  compact?: boolean;
}

export function EmptyState({ icon: Icon = Inbox, title, description, action, className, compact = false }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center", compact ? "px-4 py-8" : "px-4 py-14", className)}>
      <span className={cn("mb-3 flex items-center justify-center rounded-full bg-navy-50 text-navy-700", compact ? "size-10" : "size-14")}>
        <Icon className={compact ? "size-5" : "size-7"} aria-hidden="true" />
      </span>
      <h3 className={cn("font-display font-bold text-navy-950", compact ? "text-sm" : "text-lg")}>{title}</h3>
      {description && <p className={cn("mt-1 max-w-sm text-ink-subtle", compact ? "text-xs" : "text-sm")}>{description}</p>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}
