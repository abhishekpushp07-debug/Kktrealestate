import { Label as LabelPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export interface LabelProps extends ComponentProps<typeof LabelPrimitive.Root> {
  required?: boolean;
}

export function Label({ className, required, children, ...props }: LabelProps) {
  return (
    <LabelPrimitive.Root className={cn("inline-flex items-center gap-1 text-xs font-semibold text-ink-muted", className)} {...props}>
      {children}
      {required && (
        <span className="text-danger" aria-hidden="true">
          *
        </span>
      )}
    </LabelPrimitive.Root>
  );
}
