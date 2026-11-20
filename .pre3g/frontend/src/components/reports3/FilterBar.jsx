import { useMemo, useState } from "react";
import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fmtDate } from "@/lib/format";
import { DateInput } from "@/components/common/DateInput";
import { MultiSelect, Chips } from "@/components/reports3/MultiSelect";
import { DATE_PRESETS, presetRange, setParam, splitList, todayIso } from "@/lib/reportsV3";

/** Cascade (REQ-261): a child list only offers options under the chosen parents. */
function cascaded(f, options, sp, byKey) {
  const opts = options[f.key] || [];
  if (!f.parent) return opts;
  const chosen = splitList(sp.get(f.parent));
  if (chosen.length) return opts.filter((o) => chosen.includes(String(o.parent)));
  const grand = byKey[f.parent]?.parent && splitList(sp.get(byKey[f.parent].parent));
  if (grand?.length) {
    const ok = new Set(
      (options[f.parent] || [])
        .filter((o) => grand.includes(String(o.parent)))
        .map((o) => String(o.value)),
    );
    return opts.filter((o) => ok.has(String(o.parent)));
  }
  return opts;
}

function DateRange({ f, sp, set, defaults }) {
  const [open, setOpen] = useState(false);
  const dflt = f.key === "period" && defaults?._default_period ? defaults : null;
  const from = sp.get(`${f.key}_from`) || (dflt ? dflt.period_from : "");
  const to = sp.get(`${f.key}_to`) || (dflt ? dflt.period_to : "");
  const preset =
    sp.get(`${f.key}_preset`) || (dflt ? dflt._default_period : from || to ? "custom" : "");
  const label = preset
    ? preset === "custom"
      ? `${fmtDate(from) || "…"} – ${fmtDate(to) || "…"}`
      : Object.fromEntries(DATE_PRESETS)[preset]
    : "Any date";
  const pick = (p) => {
    let n = setParam(sp, `${f.key}_preset`, p);
    const r = presetRange(p);
    if (r) n = setParam(setParam(n, `${f.key}_from`, r.from), `${f.key}_to`, r.to);
    if (!p) n = setParam(setParam(n, `${f.key}_from`, ""), `${f.key}_to`, "");
    set(n);
    if (p !== "custom") setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`r3-fbtn ${preset ? "on" : ""}`}
          data-testid={`rf-${f.key}-preset`}
        >
          <span className="r3-flab">{f.label}</span>
          <span className="truncate">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="start" data-testid={`rf-${f.key}-menu`}>
        <div className="grid grid-cols-2 gap-1">
          {!dflt && (
            <button
              type="button"
              className={`r3-opt ${!preset ? "on" : ""}`}
              onClick={() => pick("")}
              data-testid={`rf-${f.key}-any`}
            >
              Any date
            </button>
          )}
          {DATE_PRESETS.map(([k, l]) => (
            <button
              type="button"
              key={k}
              className={`r3-opt ${preset === k ? "on" : ""}`}
              onClick={() => pick(k)}
              data-testid={`rf-${f.key}-${k}`}
            >
              {l}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <div className="mt-2 grid gap-2">
            <DateInput
              value={from}
              max={to || undefined}
              onChange={(e) => set(setParam(sp, `${f.key}_from`, e.target.value))}
              data-testid={`rf-${f.key}-from`}
            />
            <DateInput
              value={to}
              min={from || undefined}
              onChange={(e) => set(setParam(sp, `${f.key}_to`, e.target.value))}
              data-testid={`rf-${f.key}-to`}
            />
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function Choice({ f, sp, set }) {
  const [open, setOpen] = useState(false);
  const cur = sp.get(f.key) || f.options[0][0];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`r3-fbtn ${sp.get(f.key) ? "on" : ""}`}
          data-testid={`rf-${f.key}`}
        >
          <span className="r3-flab">{f.label}</span>
          <span className="truncate">{Object.fromEntries(f.options)[cur]}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1" align="start">
        {f.options.map(([v, l]) => (
          <button
            type="button"
            key={v}
            className={`r3-opt w-full ${cur === v ? "on" : ""}`}
            onClick={() => {
              set(setParam(sp, f.key, v === f.options[0][0] ? "" : v));
              setOpen(false);
            }}
            data-testid={`rf-${f.key}-opt-${v}`}
          >
            {l}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function NumBox({ value, onChange, placeholder, testId, prefix }) {
  return (
    <label className="r3-num">
      {prefix && <span>{prefix}</span>}
      <input
        inputMode="numeric"
        value={value || ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))}
        data-testid={testId}
      />
    </label>
  );
}

/** REQ-261: drop child picks (tower/floor/flat) whose parent is no longer chosen. */
function pruneWith(meta, options) {
  const kids = (k) => meta.filters.filter((f) => f.parent === k);
  const prune = (sp, key) => {
    let n = sp;
    for (const c of kids(key)) {
      const parents = splitList(n.get(key));
      const ok = new Set(
        (options[c.key] || [])
          .filter((o) => !parents.length || parents.includes(String(o.parent)))
          .map((o) => String(o.value)),
      );
      const cur = splitList(n.get(c.key));
      const keep = cur.filter((v) => ok.has(v));
      if (keep.length !== cur.length) n = setParam(n, c.key, keep);
      n = prune(n, c.key);
    }
    return n;
  };
  return prune;
}

/** REQ-260…264: one filter bar for every report — multi-selects, cascades, dates, value filters, chips. */
export function FilterBar({ meta, options, sp, set, defaults }) {
  const [open, setOpen] = useState(false);
  const byKey = useMemo(() => Object.fromEntries(meta.filters.map((f) => [f.key, f])), [meta]);
  const prune = useMemo(() => pruneWith(meta, options), [meta, options]);
  const chips = [];
  for (const f of meta.filters) {
    if (f.kind !== "multi") continue;
    const lab = Object.fromEntries((options[f.key] || []).map((o) => [String(o.value), o.label]));
    for (const v of splitList(sp.get(f.key)))
      chips.push({ id: `${f.key}-${v}`, key: f.key, v, label: `${f.label}: ${lab[v] || v}` });
  }
  const removeChip = (c) =>
    set(
      setParam(
        sp,
        c.key,
        splitList(sp.get(c.key)).filter((x) => x !== c.v),
      ),
    );
  const keep = ["cols", "group", "sort", "dir"];
  const any = [...sp.keys()].some((k) => !keep.includes(k));
  const clear = () => {
    const n = new URLSearchParams();
    keep.forEach((k) => sp.get(k) && n.set(k, sp.get(k)));
    set(n);
  };
  const active = [...sp.keys()].filter((k) => !keep.includes(k) && !/_preset$/.test(k)).length;
  return (
    <div className="space-y-3" data-testid="report-filter-bar">
      <button
        type="button"
        className={`r3-fbtn r3-filters-toggle ${active ? "on" : ""}`}
        onClick={() => setOpen(!open)}
        data-testid="rf-toggle"
      >
        <SlidersHorizontal className="h-3.5 w-3.5" /> Filters{active ? ` · ${active}` : ""}
      </button>
      <div className={`r3-filters flex flex-wrap items-center gap-2 ${open ? "" : "closed"}`}>
        {meta.date_mode === "as_of" && (
          <div className="flex items-center gap-2">
            <span className="r3-flab">As of</span>
            <DateInput
              value={sp.get("as_of") || todayIso()}
              max={todayIso()}
              required
              onChange={(e) =>
                set(setParam(sp, "as_of", e.target.value === todayIso() ? "" : e.target.value))
              }
              className="w-40"
              data-testid="rf-as-of"
            />
          </div>
        )}
        {meta.filters.map((f) => {
          if (f.kind === "multi")
            return (
              <MultiSelect
                key={f.key}
                label={f.label}
                options={cascaded(f, options, sp, byKey)}
                value={splitList(sp.get(f.key))}
                onChange={(v) => set(prune(setParam(sp, f.key, v), f.key))}
                testId={`rf-${f.key}`}
              />
            );
          if (f.kind === "date_range")
            return <DateRange key={f.key} f={f} sp={sp} set={set} defaults={defaults} />;
          if (f.kind === "choice") return <Choice key={f.key} f={f} sp={sp} set={set} />;
          if (f.kind === "range")
            return (
              <div key={f.key} className="flex items-center gap-1.5">
                <span className="r3-flab">{f.label}</span>
                <NumBox
                  prefix={f.type === "money" ? "₹" : null}
                  value={sp.get(`${f.key}_min`)}
                  placeholder="from"
                  onChange={(v) => set(setParam(sp, `${f.key}_min`, v))}
                  testId={`rf-${f.key}-min`}
                />
                <span className="text-txt-muted">–</span>
                <NumBox
                  prefix={f.type === "money" ? "₹" : null}
                  value={sp.get(`${f.key}_max`)}
                  placeholder="to"
                  onChange={(v) => set(setParam(sp, `${f.key}_max`, v))}
                  testId={`rf-${f.key}-max`}
                />
              </div>
            );
          if (f.kind === "min")
            return (
              <div key={f.key} className="flex items-center gap-1.5">
                <span className="r3-flab">{f.label}</span>
                <NumBox
                  value={sp.get(f.key)}
                  placeholder="0"
                  onChange={(v) => set(setParam(sp, f.key, v))}
                  testId={`rf-${f.key}`}
                />
              </div>
            );
          if (f.kind === "bool" || f.kind === "only")
            return (
              <button
                key={f.key}
                type="button"
                className={`r3-fbtn ${sp.get(f.key) ? "on" : ""}`}
                onClick={() => set(setParam(sp, f.key, !sp.get(f.key)))}
                data-testid={`rf-${f.key}`}
              >
                {f.label}
              </button>
            );
          return null;
        })}
        {any && (
          <button type="button" className="r3-fbtn" onClick={clear} data-testid="rf-clear-all">
            <RotateCcw className="h-3.5 w-3.5" /> Clear filters
          </button>
        )}
      </div>
      <Chips items={chips} onRemove={removeChip} testId="rf-chips" />
    </div>
  );
}
