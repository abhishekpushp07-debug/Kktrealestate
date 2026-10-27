import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const badgeVariants = cva(
  "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-2xs font-semibold leading-4 tracking-wide",
  {
    variants: {
      variant: {
        neutral: "border-border bg-surface text-ink-muted",
        navy: "border-navy-800 bg-navy-900 text-white",
        gold: "border-gold-border bg-gold-light text-gold-text",
        success: "border-status-available-border bg-success-bg text-success-fg",
        warning: "border-status-hold-border bg-warning-bg text-warning-fg",
        danger: "border-danger/30 bg-danger-bg text-danger-fg",
        info: "border-info/30 bg-info-bg text-info-fg",
        outline: "border-border-strong bg-transparent text-ink",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {
  /** Numeric badges use tabular figures. */
  numeric?: boolean;
}

export function Badge({ className, variant, numeric, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), numeric && "money", className)} {...props} />;
}
