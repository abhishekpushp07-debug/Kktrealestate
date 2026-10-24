import { RadioGroup as RadioPrimitive } from "radix-ui";
import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface RadioOption<V extends string = string> {
  value: V;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

export interface RadioGroupProps<V extends string = string>
  extends Omit<ComponentProps<typeof RadioPrimitive.Root>, "value" | "onValueChange" | "defaultValue"> {
  value?: V | null;
  defaultValue?: V;
  onValueChange?: (value: V) => void;
  options: readonly RadioOption<V>[];
  /** Lay the options out horizontally (wraps on phones). */
  inline?: boolean;
  /** Card-style options with a border. */
  cards?: boolean;
}

export function RadioGroup<V extends string = string>({
  className,
  value,
  defaultValue,
  onValueChange,
  options,
  inline = false,
  cards = false,
  ...props
}: RadioGroupProps<V>) {
  const groupId = useId();
  return (
    <RadioPrimitive.Root
      className={cn("flex gap-2", inline ? "flex-row flex-wrap gap-x-5" : "flex-col", className)}
      value={value ?? undefined}
      defaultValue={defaultValue}
      onValueChange={(next) => onValueChange?.(next as V)}
      {...props}
    >
      {options.map((option) => {
        const id = `${groupId}-${option.value}`;
        return (
          <label
            key={option.value}
            htmlFor={id}
            className={cn(
              "flex cursor-pointer items-start gap-2 text-sm",
              cards && "rounded-md border border-border bg-card px-3 py-2 transition-colors hover:border-navy-300 has-[[data-state=checked]]:border-navy-950 has-[[data-state=checked]]:bg-navy-50",
              option.disabled && "cursor-not-allowed opacity-60",
            )}
          >
            <RadioPrimitive.Item
              id={id}
              value={option.value}
              disabled={option.disabled}
              className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-border-strong bg-card focus-ring data-[state=checked]:border-navy-950"
            >
              <RadioPrimitive.Indicator className="size-2 rounded-full bg-navy-950" />
            </RadioPrimitive.Item>
            <span>
              <span className="font-medium text-ink">{option.label}</span>
              {option.description && <span className="block text-xs text-ink-subtle">{option.description}</span>}
            </span>
          </label>
        );
      })}
    </RadioPrimitive.Root>
  );
}
