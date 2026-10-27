import { Command } from "cmdk";
import { Check, ChevronsUpDown, Plus, Search, X } from "lucide-react";
import { Popover } from "radix-ui";
import { useEffect, useMemo, useState } from "react";
import { cn, useDebouncedValue } from "@/lib/utils";
import { Spinner } from "./spinner";
import { useFieldAria } from "./field-context";

export interface ComboboxOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
  /** Extra search terms (phone, code…). */
  keywords?: readonly string[];
}

export interface ComboboxProps {
  value: string | null | undefined;
  onValueChange: (value: string | null, option: ComboboxOption | null) => void;
  /** Static options (filtered client-side) — or the latest page when `onSearch` is set. */
  options?: readonly ComboboxOption[];
  /** Async lookup; called (debounced) with the typed query. Disables client-side filtering. */
  onSearch?: (query: string) => Promise<readonly ComboboxOption[]>;
  /** Label for the current value when it is not among `options` (async lists). */
  selectedLabel?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  invalid?: boolean;
  allowClear?: boolean;
  /** Shows a "Create “query”" affordance when nothing matches. */
  onCreate?: (query: string) => void | Promise<void>;
  createLabel?: (query: string) => string;
  size?: "sm" | "md";
  className?: string;
  id?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "data-testid"?: string;
}

/** Searchable single-select (cmdk inside a Popover) with async options and a create-new affordance. */
export function Combobox({
  value,
  onValueChange,
  options = [],
  onSearch,
  selectedLabel,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No matches",
  disabled,
  invalid,
  allowClear = false,
  onCreate,
  createLabel = (query) => `Create “${query}”`,
  size = "md",
  className,
  id,
  ...aria
}: ComboboxProps) {
  const fieldAria = useFieldAria(id, { invalid, "aria-describedby": aria["aria-describedby"] });
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<readonly ComboboxOption[]>([]);
  // The query the remote results belong to; `loading` is derived from it instead of being toggled inside the effect.
  const [settledQuery, setSettledQuery] = useState<string | null>(null);
  // Options seen in earlier remote pages or picked, so the trigger keeps its label when the current page no longer has it.
  const [known, setKnown] = useState<ReadonlyMap<string, ComboboxOption>>(() => new Map());
  const [creating, setCreating] = useState(false);
  const debouncedQuery = useDebouncedValue(query, 250);

  const list = onSearch ? remote : options;
  const loading = Boolean(onSearch && open && settledQuery !== debouncedQuery);
  const remember = (seen: readonly ComboboxOption[]) =>
    setKnown((previous) => {
      const next = new Map(previous);
      for (const option of seen) next.set(option.value, option);
      return next;
    });

  useEffect(() => {
    if (!onSearch || !open) return;
    let current = true; // a newer query (or closing) supersedes this request
    onSearch(debouncedQuery)
      .then((result) => {
        if (!current) return;
        setRemote(result);
        remember(result);
      })
      .catch(() => {
        if (current) setRemote([]);
      })
      .finally(() => {
        if (current) setSettledQuery(debouncedQuery);
      });
    return () => {
      current = false;
    };
  }, [onSearch, debouncedQuery, open]);

  const selected = useMemo(() => {
    if (!value) return null;
    return list.find((option) => option.value === value) ?? known.get(value) ?? null;
  }, [list, value, known]);
  const displayLabel = selected?.label ?? selectedLabel;

  const byKey = useMemo(() => new Map(list.map((option) => [option.value.toLowerCase(), option] as const)), [list]);
  const trimmedQuery = query.trim();
  const exactExists = list.some((option) => option.label.toLowerCase() === trimmedQuery.toLowerCase());
  const showCreate = Boolean(onCreate && trimmedQuery && !exactExists);

  const pick = (key: string) => {
    const option = byKey.get(key.toLowerCase());
    if (!option || option.disabled) return;
    remember([option]);
    onValueChange(option.value, option);
    setOpen(false);
    setQuery("");
  };

  const create = async () => {
    if (!onCreate) return;
    setCreating(true);
    try {
      await onCreate(trimmedQuery);
      setOpen(false);
      setQuery("");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <div className={cn("relative w-full min-w-0", className)}>
        <Popover.Trigger asChild>
          <button
            type="button"
            id={id}
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={cn(
              "flex w-full min-w-0 items-center justify-between gap-2 rounded-md border border-border-input bg-card px-3 text-left text-sm transition-colors hover:border-navy-400 focus-ring focus-visible:border-gold disabled:cursor-not-allowed disabled:bg-surface disabled:text-ink-subtle aria-invalid:border-danger",
              size === "md" ? "h-12 sm:h-9" : "h-12 text-xs sm:h-8",
              allowClear && value && "pr-14",
            )}
            {...aria}
            {...fieldAria}
          >
            <span className={cn("truncate", !displayLabel && "text-ink-subtle")}>{displayLabel ?? placeholder}</span>
            <ChevronsUpDown className="size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
          </button>
        </Popover.Trigger>
        {allowClear && value && !disabled && (
          <button
            type="button"
            aria-label="Clear selection"
            className="absolute right-7 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-ink-subtle hover:bg-navy-50 hover:text-navy-950 focus-ring"
            onClick={() => onValueChange(null, null)}
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          onOpenAutoFocus={(event) => event.preventDefault()}
          className="z-50 w-[var(--radix-popover-trigger-width)] min-w-56 overflow-hidden rounded-md border border-border bg-card p-0 shadow-pop animate-slide-down"
        >
          <Command shouldFilter={!onSearch} loop label={aria["aria-label"] ?? "Options"}>
            <div className="flex items-center gap-2 border-b border-border px-2.5">
              <Search className="size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
              <Command.Input
                autoFocus
                value={query}
                onValueChange={setQuery}
                placeholder={searchPlaceholder}
                className="h-9 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-ink-subtle"
              />
              {loading && <Spinner size="xs" />}
            </div>
            <Command.List className="max-h-64 overflow-y-auto p-1 scrollbar-thin">
              {!loading && (
                <Command.Empty className="px-2 py-4 text-center text-xs text-ink-subtle">{emptyText}</Command.Empty>
              )}
              {list.map((option) => (
                <Command.Item
                  key={option.value}
                  value={option.value}
                  keywords={[option.label, ...(option.keywords ?? [])]}
                  disabled={option.disabled}
                  onSelect={pick}
                  className="flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-ink data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-[selected=true]:bg-navy-50 data-[selected=true]:text-navy-950"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{option.label}</span>
                    {option.description && (
                      <span className="block truncate text-xs text-ink-subtle">{option.description}</span>
                    )}
                  </span>
                  {option.value === value && <Check className="size-4 shrink-0 text-navy-950" aria-hidden="true" />}
                </Command.Item>
              ))}
              {showCreate && (
                <Command.Item
                  value={`__create__${trimmedQuery}`}
                  forceMount
                  onSelect={() => void create()}
                  className="mt-1 flex cursor-pointer select-none items-center gap-2 rounded-sm border-t border-border px-2 py-2 text-sm font-medium text-navy-800 data-[selected=true]:bg-gold-light"
                >
                  {creating ? <Spinner size="xs" /> : <Plus className="size-4" aria-hidden="true" />}
                  {createLabel(trimmedQuery)}
                </Command.Item>
              )}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
