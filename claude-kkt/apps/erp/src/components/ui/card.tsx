import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-lg border border-border bg-card text-ink shadow-card", className)} {...props} />;
}

export interface CardHeaderProps extends HTMLAttributes<HTMLDivElement> {
  actions?: ReactNode;
}

export function CardHeader({ className, actions, children, ...props }: CardHeaderProps) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3", className)} {...props}>
      <div className="min-w-0 flex-1">{children}</div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("font-display text-md font-bold leading-6 text-navy-950", className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-xs text-ink-subtle", className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4", className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center gap-2 border-t border-border px-4 py-3", className)} {...props} />;
}
