import { Check, Minus } from "lucide-react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface CheckboxProps extends Omit<ComponentProps<typeof CheckboxPrimitive.Root>, "children"> {
  label?: ReactNode;
  description?: ReactNode;
}

export function Checkbox({ className, label, description, id, checked, ...props }: CheckboxProps) {
  const generated = useId();
  const inputId = id ?? generated;
  const box = (
    <CheckboxPrimitive.Root
      id={inputId}
      checked={checked}
      className={cn(
        "peer flex size-4 shrink-0 items-center justify-center rounded-xs border border-border-strong bg-card transition-colors focus-ring data-[state=checked]:border-navy-950 data-[state=checked]:bg-navy-950 data-[state=indeterminate]:border-navy-950 data-[state=indeterminate]:bg-navy-950 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="text-white">
        {checked === "indeterminate" ? <Minus className="size-3" strokeWidth={3} /> : <Check className="size-3" strokeWidth={3} />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
  if (!label) return box;
  return (
    <div className="flex items-start gap-2">
      <span className="flex h-5 items-center">{box}</span>
      <label htmlFor={inputId} className="cursor-pointer select-none text-sm text-ink peer-disabled:cursor-not-allowed peer-disabled:opacity-60">
        <span className="font-medium">{label}</span>
        {description && <span className="block text-xs text-ink-subtle">{description}</span>}
      </label>
    </div>
  );
}
