import { Switch as SwitchPrimitive } from "radix-ui";
import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SwitchProps extends ComponentProps<typeof SwitchPrimitive.Root> {
  label?: ReactNode;
  description?: ReactNode;
  size?: "sm" | "md";
}

export function Switch({ className, label, description, id, size = "md", ...props }: SwitchProps) {
  const generated = useId();
  const inputId = id ?? generated;
  const control = (
    <SwitchPrimitive.Root
      id={inputId}
      className={cn(
        "peer relative inline-flex shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent bg-border-input transition-colors focus-ring data-[state=checked]:bg-navy-950 disabled:cursor-not-allowed disabled:opacity-50",
        size === "md" ? "h-5 w-9" : "h-4 w-7",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block rounded-full bg-white shadow transition-transform data-[state=unchecked]:translate-x-0",
          size === "md" ? "size-4 data-[state=checked]:translate-x-4" : "size-3 data-[state=checked]:translate-x-3",
        )}
      />
    </SwitchPrimitive.Root>
  );
  if (!label) return control;
  return (
    <div className="flex items-start gap-2.5">
      {control}
      <label
        htmlFor={inputId}
        className="cursor-pointer select-none text-sm text-ink peer-disabled:cursor-not-allowed peer-disabled:opacity-60"
      >
        <span className="font-medium">{label}</span>
        {description && <span className="block text-xs text-ink-subtle">{description}</span>}
      </label>
    </div>
  );
}
