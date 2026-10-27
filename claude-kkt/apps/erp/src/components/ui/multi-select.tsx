import { Command } from "cmdk";
import { Check, ChevronsUpDown, Search, X } from "lucide-react";
import { Popover } from "radix-ui";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { useFieldAria } from "./field-context";

export interface MultiSelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
  keywords?: readonly string[];
}

export interface MultiSelectProps {
  value: readonly string[];
  onValueChange: (values: string[]) => void;
  options: readonly MultiSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  invalid?: boolean;
  /** Chips shown in the trigger before collapsing to "+N" (default 3). */
  maxChips?: number;
  size?: "sm" | "md";
  className?: string;
  id?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "data-testid"?: string;
}

/** Multi-choice searchable list with chips, select-all and clear. */
export function MultiSelect({
  value,
  onValueChange,
  options,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No matches",
  disabled,
  invalid,
  maxChips = 3,
  size = "md",
  className,
  id,
  ...aria
}: MultiSelectProps) {
  const fieldAria = useFieldAria(id, { invalid, "aria-describedby": aria["aria-describedby"] });
  const [open, setOpen] = useState(false);
  const selectedSet = useMemo(() => new Set(value), [value]);
  const byKey = useMemo(
    () => new Map(options.map((option) => [option.value.toLowerCase(), option] as const)),
    [options],
  );
  const chips = options.filter((option) => selectedSet.has(option.value));
  const overflow = chips.length - maxChips;

  const toggle = (key: string) => {
    const option = byKey.get(key.toLowerCase());
    if (!option || option.disabled) return;
    if (selectedSet.has(option.value)) onValueChange(value.filter((item) => item !== option.value));
    else onValueChange([...value, option.value]);
  };

  const remove = (item: string) => onValueChange(value.filter((entry) => entry !== item));
  const selectAll = () => onValueChange(options.filter((option) => !option.disabled).map((option) => option.value));
  const clear = () => onValueChange([]);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          id={id}
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "flex w-full min-w-0 items-center justify-between gap-2 rounded-md border border-border-input bg-card px-2 text-left text-sm transition-colors hover:border-navy-400 focus-ring focus-visible:border-gold disabled:cursor-not-allowed disabled:bg-surface aria-invalid:border-danger",
            size === "md" ? "min-h-12 py-1 sm:min-h-9" : "min-h-12 py-0.5 text-xs sm:min-h-8",
            className,
          )}
          {...aria}
          {...fieldAria}
        >
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            {chips.length === 0 && <span className="px-1 text-ink-subtle">{placeholder}</span>}
            {chips.slice(0, maxChips).map((option) => (
              <span
                key={option.value}
                className="inline-flex max-w-full items-center gap-1 rounded-sm border border-navy-100 bg-navy-50 px-1.5 py-0.5 text-xs font-medium text-navy-950"
              >
                <span className="truncate">{option.label}</span>
                {!disabled && (
                  <span
                    role="button"
                    tabIndex={-1}
                    aria-label={`Remove ${option.label}`}
                    className="rounded-full hover:bg-navy-100"
                    onClick={(event) => {
                      event.stopPropagation();
                      remove(option.value);
                    }}
                  >
                    <X className="size-3" aria-hidden="true" />
                  </span>
                )}
              </span>
            ))}
            {overflow > 0 && <span className="px-1 text-xs text-ink-subtle">+{overflow} more</span>}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          onOpenAutoFocus={(event) => event.preventDefault()}
          className="z-50 w-[var(--radix-popover-trigger-width)] min-w-56 overflow-hidden rounded-md border border-border bg-card p-0 shadow-pop animate-slide-down"
        >
          <Command loop label={aria["aria-label"] ?? "Options"}>
            <div className="flex items-center gap-2 border-b border-border px-2.5">
              <Search className="size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
              <Command.Input
                autoFocus
                placeholder={searchPlaceholder}
                className="h-9 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-ink-subtle"
              />
            </div>
            <Command.List className="max-h-60 overflow-y-auto p-1 scrollbar-thin">
              <Command.Empty className="px-2 py-4 text-center text-xs text-ink-subtle">{emptyText}</Command.Empty>
              {options.map((option) => {
                const checked = selectedSet.has(option.value);
                return (
                  <Command.Item
                    key={option.value}
                    value={option.value}
                    keywords={[option.label, ...(option.keywords ?? [])]}
                    disabled={option.disabled}
                    onSelect={toggle}
                    className="flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-ink data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-[selected=true]:bg-navy-50"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded-xs border",
                        checked ? "border-navy-950 bg-navy-950 text-white" : "border-border-input bg-card",
                      )}
                    >
                      {checked && <Check className="size-3" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{option.label}</span>
                      {option.description && (
                        <span className="block truncate text-xs text-ink-subtle">{option.description}</span>
                      )}
                    </span>
                  </Command.Item>
                );
              })}
            </Command.List>
            <div className="flex items-center justify-between border-t border-border px-2 py-1.5 text-xs">
              <span className="text-ink-subtle">{value.length} selected</span>
              <span className="flex gap-3">
                <button
                  type="button"
                  className="font-medium text-navy-800 hover:underline focus-ring rounded-xs"
                  onClick={selectAll}
                >
                  Select all
                </button>
                <button
                  type="button"
                  className="font-medium text-ink-subtle hover:underline focus-ring rounded-xs"
                  onClick={clear}
                >
                  Clear
                </button>
              </span>
            </div>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
