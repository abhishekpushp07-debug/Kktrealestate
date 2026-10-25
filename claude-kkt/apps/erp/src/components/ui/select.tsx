import { Check, ChevronDown, X } from "lucide-react";
import { Select as SelectPrimitive } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SelectOption<V extends string = string> {
  value: V;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

export interface SelectProps<V extends string = string> {
  value: V | null | undefined;
  onValueChange: (value: V | null) => void;
  options: readonly SelectOption<V>[];
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  /** Adds a clear action when a value is selected. */
  allowClear?: boolean;
  size?: "sm" | "md";
  className?: string;
  id?: string;
  name?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "data-testid"?: string;
}

const CLEAR = "__clear__";

/** Single-choice dropdown (Radix Select) for short option lists. Use Combobox for searchable lists. */
export function Select<V extends string = string>({
  value,
  onValueChange,
  options,
  placeholder = "Select…",
  disabled,
  invalid,
  allowClear = false,
  size = "md",
  className,
  id,
  name,
  ...aria
}: SelectProps<V>) {
  const selected = options.find((option) => option.value === value);
  return (
    <SelectPrimitive.Root
      value={value ?? ""}
      onValueChange={(next) => onValueChange(next === CLEAR || next === "" ? null : (next as V))}
      disabled={disabled}
      name={name}
    >
      <SelectPrimitive.Trigger
        id={id}
        aria-invalid={invalid || undefined}
        className={cn(
          "group flex w-full min-w-0 items-center justify-between gap-2 rounded-md border border-border-strong bg-card px-3 text-left text-sm text-ink transition-colors hover:border-navy-300 focus-ring focus-visible:border-gold disabled:cursor-not-allowed disabled:bg-surface disabled:text-ink-subtle data-[placeholder]:text-ink-subtle aria-invalid:border-danger",
          size === "md" ? "h-11 sm:h-9" : "h-11 text-xs sm:h-8",
          className,
        )}
        {...aria}
      >
        <span className="truncate">
          <SelectPrimitive.Value placeholder={placeholder}>{selected?.label}</SelectPrimitive.Value>
        </span>
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="z-50 max-h-[min(20rem,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-border bg-card shadow-pop animate-slide-down"
        >
          <SelectPrimitive.Viewport className="p-1">
            {allowClear && value && (
              <SelectPrimitive.Item
                value={CLEAR}
                className="flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-ink-subtle outline-none data-[highlighted]:bg-navy-50 data-[highlighted]:text-navy-950"
              >
                <X className="size-3.5" aria-hidden="true" />
                <SelectPrimitive.ItemText>Clear selection</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            )}
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className="relative flex cursor-pointer select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm text-ink outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-navy-50 data-[highlighted]:text-navy-950 data-[state=checked]:font-medium"
              >
                <div className="min-w-0">
                  <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                  {option.description && <div className="text-xs text-ink-subtle">{option.description}</div>}
                </div>
                <SelectPrimitive.ItemIndicator className="absolute right-2 inline-flex items-center">
                  <Check className="size-4 text-navy-950" aria-hidden="true" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
            {options.length === 0 && <div className="px-2 py-3 text-center text-xs text-ink-subtle">No options</div>}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
