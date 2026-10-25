import { Tabs as Primitive } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export const Tabs = Primitive.Root;

export interface TabsListProps extends ComponentProps<typeof Primitive.List> {
  /** underline (default, page-level) or pills (segmented control). */
  variant?: "underline" | "pills";
}

export function TabsList({ className, variant = "underline", ...props }: TabsListProps) {
  return (
    <Primitive.List
      className={cn(
        "flex max-w-full items-center gap-1 overflow-x-auto scrollbar-thin",
        variant === "underline" ? "border-b border-border" : "w-fit rounded-md bg-navy-50 p-1",
        className,
      )}
      data-variant={variant}
      {...props}
    />
  );
}

export interface TabsTriggerProps extends ComponentProps<typeof Primitive.Trigger> {
  count?: number;
  icon?: ReactNode;
}

export function TabsTrigger({ className, children, count, icon, ...props }: TabsTriggerProps) {
  return (
    <Primitive.Trigger
      className={cn(
        "group inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap px-3 text-sm font-medium text-ink-muted lg:h-9 transition-colors hover:text-navy-950 focus-ring disabled:pointer-events-none disabled:opacity-50",
        // underline variant
        "[[data-variant=underline]_&]:-mb-px [[data-variant=underline]_&]:border-b-2 [[data-variant=underline]_&]:border-transparent [[data-variant=underline]_&]:rounded-none [[data-variant=underline]_&]:data-[state=active]:border-gold [[data-variant=underline]_&]:data-[state=active]:text-navy-950",
        // pills variant
        "[[data-variant=pills]_&]:h-9 lg:[[data-variant=pills]_&]:h-7 [[data-variant=pills]_&]:rounded-sm [[data-variant=pills]_&]:data-[state=active]:bg-card [[data-variant=pills]_&]:data-[state=active]:text-navy-950 [[data-variant=pills]_&]:data-[state=active]:shadow-card",
        className,
      )}
      {...props}
    >
      {icon}
      {children}
      {count !== undefined && (
        <span className="money rounded-full bg-navy-50 px-1.5 text-2xs font-semibold text-ink-muted group-data-[state=active]:bg-gold-light group-data-[state=active]:text-gold-text">
          {count}
        </span>
      )}
    </Primitive.Trigger>
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof Primitive.Content>) {
  return <Primitive.Content className={cn("mt-4 outline-none", className)} {...props} />;
}
