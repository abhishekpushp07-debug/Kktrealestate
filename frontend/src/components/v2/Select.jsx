import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Plus, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import api, { errMsg } from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { invalidateCatalogues, useCatalogues } from "@/hooks/useCatalogues";

const RECENT_KEY = "kkt_recent_choices";
const recent = (key) => JSON.parse(localStorage.getItem(RECENT_KEY) || "{}")[key] || [];
const remember = (key, v) => { const all = JSON.parse(localStorage.getItem(RECENT_KEY) || "{}"); all[key] = [v, ...(all[key] || []).filter((x) => x !== v)].slice(0, 5); localStorage.setItem(RECENT_KEY, JSON.stringify(all)); };

// Searchable combobox. `options` = [{value,label,sub}] or `type` = catalogue type (bound to the bundle; "+ Add new" when permitted).
export function Select({ options: optionsProp, type, parentId, value, onChange, placeholder = "Select…", testId, disabled, className, multiple = false, allowAdd = true, recentKey, clearable = true }) {
  const { opts } = useCatalogues();
  const { can } = useAuth();
  const options = useMemo(() => optionsProp || (type ? opts(type, parentId) : []), [optionsProp, type, parentId, opts]);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const [adding, setAdding] = useState(false);
  const box = useRef(null), inp = useRef(null);
  const rk = recentKey || type;
  const selected = multiple ? options.filter((o) => (value || []).includes(o.value)) : options.find((o) => o.value === value);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s ? options.filter((o) => `${o.label} ${o.sub || ""}`.toLowerCase().includes(s)) : options;
    if (s || !rk) return list;
    const rec = recent(rk);
    return [...rec.map((v) => list.find((o) => o.value === v)).filter(Boolean), ...list.filter((o) => !rec.includes(o.value))];
  }, [options, q, rk]);
  useEffect(() => { if (!open) return; const h = (e) => { if (!box.current?.contains(e.target)) setOpen(false); }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, [open]);
  useEffect(() => { if (open) { setQ(""); setHi(0); setTimeout(() => inp.current?.focus(), 10); } }, [open]);
  const pick = (o) => { if (rk) remember(rk, o.value); if (multiple) { const cur = value || []; onChange(cur.includes(o.value) ? cur.filter((v) => v !== o.value) : [...cur, o.value]); } else { onChange(o.value, o); setOpen(false); } };
  const canAdd = allowAdd && type && can("masters.catalogue.create") && q.trim() && !options.some((o) => o.label.toLowerCase() === q.trim().toLowerCase());
  const add = async () => {
    setAdding(true);
    try { const r = await api.post(`/catalogues/${type}/items`, { label: q.trim(), parent_id: parentId || null }); await invalidateCatalogues(); toast.success(`Added "${r.data.label}"`); pick({ value: r.data.id, label: r.data.label }); }
    catch (e) { toast.error(errMsg(e)); } finally { setAdding(false); }
  };
  const key = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, filtered.length - 1 + (canAdd ? 1 : 0))); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (hi < filtered.length) pick(filtered[hi]); else if (canAdd) add(); }
    else if (e.key === "Escape") setOpen(false);
  };
  return (
    <div ref={box} className={cn("relative", className)} data-testid={testId}>
      <button type="button" disabled={disabled} onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} className={cn("input flex items-center justify-between gap-2 text-left", disabled && "opacity-60", open && "border-gold ring-[3px] ring-gold/20")} data-testid={testId ? `${testId}-trigger` : undefined}>
        <span className={cn("flex-1 truncate", !(multiple ? selected.length : selected) && "text-txt-muted")}>
          {multiple ? (selected.length ? selected.map((s) => s.label).join(", ") : placeholder) : (selected?.label || placeholder)}
        </span>
        {clearable && !multiple && selected && !disabled ? <X className="h-4 w-4 text-txt-muted hover:text-ink-950" onClick={(e) => { e.stopPropagation(); onChange(null, null); }} /> : <ChevronDown className={cn("h-4 w-4 text-txt-muted transition-transform", open && "rotate-180")} />}
      </button>
      {open && (
        <div className="absolute z-50 mt-1.5 w-full min-w-[240px] overflow-hidden rounded-xl border border-warm-200 bg-white shadow-warm-lg" role="listbox">
          <div className="flex items-center gap-2 border-b border-warm-100 px-3"><Search className="h-4 w-4 text-txt-muted" /><input ref={inp} value={q} onChange={(e) => { setQ(e.target.value); setHi(0); }} onKeyDown={key} placeholder="Type to search…" className="h-10 flex-1 bg-transparent text-sm outline-none" data-testid={testId ? `${testId}-search` : undefined} /></div>
          <ul className="max-h-64 overflow-y-auto p-1.5">
            {filtered.length === 0 && !canAdd && <li className="px-3 py-6 text-center text-sm text-txt-muted">No matches</li>}
            {filtered.map((o, i) => {
              const on = multiple ? (value || []).includes(o.value) : o.value === value;
              return <li key={o.value} role="option" aria-selected={on} onMouseEnter={() => setHi(i)} onClick={() => pick(o)} className={cn("flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm", i === hi && "bg-warm-100", on && "font-semibold")} data-testid={testId ? `${testId}-opt-${o.value}` : undefined} aria-label={o.label}><span className="min-w-0 truncate">{o.label}{o.sub && <span className="ml-2 text-xs text-txt-muted" aria-hidden="true">{o.sub}</span>}</span>{on && <Check className="h-4 w-4 text-gold" />}</li>;
            })}
            {canAdd && <li onClick={add} onMouseEnter={() => setHi(filtered.length)} className={cn("mt-1 flex cursor-pointer items-center gap-2 rounded-lg border-t border-warm-100 px-3 py-2.5 text-sm font-semibold text-ink-950", hi === filtered.length && "bg-warm-100")} data-testid={testId ? `${testId}-add` : undefined}><Plus className="h-4 w-4 text-gold" />{adding ? "Adding…" : `Add "${q.trim()}"`}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
