import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Kbd({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-border-strong bg-surface px-1 font-mono text-[10px] font-medium text-ink-muted shadow-[inset_0_-1px_0_var(--color-border-strong)]",
        className,
      )}
      {...props}
    />
  );
}
