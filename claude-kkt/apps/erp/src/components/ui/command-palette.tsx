import { Command } from "cmdk";
import { Clock, CornerDownLeft, Search, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cn, readStorage, useDebouncedValue, useOnChange, writeStorage } from "@/lib/utils";
import { Kbd } from "./kbd";
import { Spinner } from "./spinner";

export interface CommandItem {
  id: string;
  label: string;
  /** Secondary text (code, phone, project). */
  description?: string;
  /** Navigation target; `onSelect` is called either way. */
  href?: string;
  icon?: LucideIcon;
  keywords?: readonly string[];
  /** Group label when the item comes from search results. */
  group?: string;
}

export interface CommandGroupDef {
  id: string;
  label: string;
  items: readonly CommandItem[];
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Static groups (navigation, actions). Filtered client-side. */
  groups: readonly CommandGroupDef[];
  /** Async search across projects/flats/customers/bookings; results are shown as returned. */
  onSearch?: (query: string) => Promise<readonly CommandItem[]>;
  onSelect: (item: CommandItem) => void;
  placeholder?: string;
  /** localStorage key for recent items. */
  recentKey?: string;
  maxRecent?: number;
}

const DEFAULT_RECENT_KEY = "kkt.erp.recent";

function matches(item: CommandItem, query: string): boolean {
  if (!query) return true;
  const haystack = [item.label, item.description ?? "", ...(item.keywords ?? [])].join(" ").toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}

/** Toggles `open` on Ctrl/⌘+K. */
export function useCommandPaletteHotkey(toggle: () => void): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle]);
}

const NO_SEARCH: { query: string; items: readonly CommandItem[] } = { query: "", items: [] };

/** Ctrl/⌘+K palette (cmdk): recents, static groups and async search results. */
export function CommandPalette({
  open,
  onOpenChange,
  groups,
  onSearch,
  onSelect,
  placeholder = "Search projects, flats, customers, bookings…",
  recentKey = DEFAULT_RECENT_KEY,
  maxRecent = 8,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  // Results of the last finished search, tagged with the query they answer; `loading` is derived from the tag.
  const [search, setSearch] = useState<{ query: string; items: readonly CommandItem[] }>(NO_SEARCH);
  const [recent, setRecent] = useState<CommandItem[]>(() => readStorage<CommandItem[]>(recentKey, []));
  const debounced = useDebouncedValue(query.trim(), 250);
  const searching = Boolean(onSearch && open && debounced.length >= 2);
  const results = searching ? search.items : NO_SEARCH.items;
  const loading = searching && search.query !== debounced;

  useOnChange(open, (isOpen) => {
    if (isOpen) return;
    setQuery("");
    setSearch(NO_SEARCH);
  });

  useEffect(() => {
    if (!onSearch || !open || debounced.length < 2) return;
    let cancelled = false;
    onSearch(debounced)
      .then((items) => {
        if (!cancelled) setSearch({ query: debounced, items });
      })
      .catch(() => {
        if (!cancelled) setSearch({ query: debounced, items: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [onSearch, debounced, open]);

  const select = useCallback(
    (item: CommandItem) => {
      const { icon: _icon, ...storable } = item;
      const next = [storable, ...recent.filter((entry) => entry.id !== item.id)].slice(0, maxRecent);
      setRecent(next);
      writeStorage(recentKey, next);
      onOpenChange(false);
      onSelect(item);
    },
    [recent, maxRecent, recentKey, onOpenChange, onSelect],
  );

  const filteredGroups = useMemo(
    () =>
      groups
        .map((group) => ({ ...group, items: group.items.filter((item) => matches(item, query)) }))
        .filter((group) => group.items.length > 0),
    [groups, query],
  );
  const filteredRecent = useMemo(() => recent.filter((item) => matches(item, query)), [recent, query]);
  const resultGroups = useMemo(() => {
    const map = new Map<string, CommandItem[]>();
    for (const item of results) {
      const key = item.group ?? "Results";
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return [...map.entries()];
  }, [results]);
  const nothing = !loading && filteredGroups.length === 0 && filteredRecent.length === 0 && results.length === 0;

  const renderItem = (item: CommandItem, prefix: string) => {
    const Icon = item.icon;
    return (
      <Command.Item
        key={`${prefix}-${item.id}`}
        value={`${prefix}-${item.id}`}
        onSelect={() => select(item)}
        className="group flex cursor-pointer select-none items-center gap-2.5 rounded-sm px-2 py-2 text-sm text-ink data-[selected=true]:bg-navy-50 data-[selected=true]:text-navy-950"
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded-sm bg-surface text-ink-subtle group-data-[selected=true]:bg-card group-data-[selected=true]:text-navy-950">
          {Icon ? (
            <Icon className="size-3.5" aria-hidden="true" />
          ) : prefix === "recent" ? (
            <Clock className="size-3.5" aria-hidden="true" />
          ) : (
            <Search className="size-3.5" aria-hidden="true" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{item.label}</span>
          {item.description && <span className="block truncate text-xs text-ink-subtle">{item.description}</span>}
        </span>
        <CornerDownLeft
          className="size-3.5 shrink-0 text-ink-subtle opacity-0 group-data-[selected=true]:opacity-100"
          aria-hidden="true"
        />
      </Command.Item>
    );
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Command palette"
      shouldFilter={false}
      loop
      overlayClassName="fixed inset-0 z-[70] bg-navy-950/55 data-[state=open]:animate-fade-in"
      contentClassName="fixed left-1/2 top-[12vh] z-[70] w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-lg border border-border bg-card shadow-pop outline-none data-[state=open]:animate-slide-down"
    >
      <div className="flex items-center gap-2 border-b border-border px-3">
        <Search className="size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
        <Command.Input
          autoFocus
          value={query}
          onValueChange={setQuery}
          placeholder={placeholder}
          className="h-12 w-full min-w-0 bg-transparent text-base outline-none placeholder:text-ink-subtle"
        />
        {loading ? <Spinner size="xs" /> : <Kbd className="hidden sm:inline-flex">Esc</Kbd>}
      </div>
      <Command.List className="max-h-[min(60vh,24rem)] overflow-y-auto p-2 scrollbar-thin">
        {nothing && (
          <Command.Empty className="px-2 py-8 text-center text-sm text-ink-subtle">
            {debounced.length >= 2 ? "No matches" : "Type to search, or pick a page below"}
          </Command.Empty>
        )}
        {filteredRecent.length > 0 && (
          <Command.Group heading="Recent" className={groupClass}>
            {filteredRecent.map((item) => renderItem(item, "recent"))}
          </Command.Group>
        )}
        {resultGroups.map(([label, items]) => (
          <Command.Group key={label} heading={label} className={groupClass}>
            {items.map((item) => renderItem(item, "result"))}
          </Command.Group>
        ))}
        {filteredGroups.map((group) => (
          <Command.Group key={group.id} heading={group.label} className={groupClass}>
            {group.items.map((item) => renderItem(item, group.id))}
          </Command.Group>
        ))}
      </Command.List>
      <div className="flex items-center justify-between border-t border-border bg-surface/60 px-3 py-1.5 text-2xs text-ink-subtle">
        <span className="flex items-center gap-1">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> navigate · <Kbd>↵</Kbd> open
        </span>
        <span className="hidden sm:inline">KKT ERP</span>
      </div>
    </Command.Dialog>
  );
}

const groupClass = cn(
  "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:label-caps",
);
