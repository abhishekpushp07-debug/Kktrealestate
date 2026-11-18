import { useMemo, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** REQ-260: Elite multi-select — Select all, search, "N selected" chip, clear. */
export function MultiSelect({ label, options = [], value = [], onChange, testId, max }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const sel = useMemo(() => new Set(value), [value]);
  const shown = options.filter(
    (o) => !q || String(o.label).toLowerCase().includes(q.toLowerCase()),
  );
  const toggle = (v) => onChange(sel.has(v) ? value.filter((x) => x !== v) : [...value, v]);
  const allOn = shown.length > 0 && shown.every((o) => sel.has(String(o.value)));
  const first = options.find((o) => sel.has(String(o.value)));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`r3-fbtn ${value.length ? "on" : ""}`}
          data-testid={testId}
        >
          <span className="r3-flab">{label}</span>
          <span className="truncate">
            {value.length === 0
              ? "All"
              : value.length === 1
                ? first?.label || "1 selected"
                : `${value.length} selected`}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start" data-testid={`${testId}-menu`}>
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Search className="h-4 w-4 text-txt-muted" />
          <input
            className="w-full bg-transparent text-sm outline-none"
            placeholder={`Search ${label.toLowerCase()}`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            data-testid={`${testId}-search`}
          />
        </div>
        <div className="flex items-center justify-between px-3 py-2 text-xs">
          {max ? (
            <span className="text-txt-muted">Up to {max} levels, in the order you pick</span>
          ) : (
            <button
              type="button"
              className="font-semibold text-[var(--accent)]"
              onClick={() =>
                onChange(
                  allOn
                    ? value.filter((v) => !shown.some((o) => String(o.value) === v))
                    : [...new Set([...value, ...shown.map((o) => String(o.value))])],
                )
              }
              data-testid={`${testId}-all`}
            >
              {allOn ? "Unselect all" : "Select all"}
            </button>
          )}
          {value.length > 0 && (
            <button
              type="button"
              className="text-txt-muted"
              onClick={() => onChange([])}
              data-testid={`${testId}-clear`}
            >
              Clear
            </button>
          )}
        </div>
        <div className="max-h-64 overflow-y-auto pb-1">
          {shown.length === 0 && (
            <p className="px-3 py-3 text-sm text-txt-muted">Nothing matches</p>
          )}
          {shown.map((o) => {
            const on = sel.has(String(o.value));
            return (
              <button
                type="button"
                key={o.value}
                onClick={() => toggle(String(o.value))}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-[var(--surface-2,rgba(127,127,127,.08))]"
                data-testid={`${testId}-opt-${o.value}`}
              >
                <span className={`r3-check ${on ? "on" : ""}`}>
                  {on &&
                    (max ? (
                      <b className="text-[10px]" data-testid={`${testId}-order-${o.value}`}>
                        {value.indexOf(String(o.value)) + 1}
                      </b>
                    ) : (
                      <Check className="h-3 w-3" />
                    ))}
                </span>
                <span className="truncate">{o.label}</span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function Chips({ items, onRemove, testId }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5" data-testid={testId}>
      {items.map((c) => (
        <span key={c.id} className="r3-chip">
          {c.label}
          <button
            type="button"
            onClick={() => onRemove(c)}
            aria-label={`Remove ${c.label}`}
            data-testid={`chip-x-${c.id}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
    </div>
  );
}
