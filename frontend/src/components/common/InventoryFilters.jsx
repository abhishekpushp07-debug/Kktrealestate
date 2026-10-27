import { useEffect, useState } from "react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { StatusChip } from "./StatusChip";

export const DISPLAY_STATES = ["Show as Available", "Show as Sold", "Show as Hold", "Hidden"];
export const REAL_STATES = ["Available", "Hold", "Blocked", "Booked", "Sold", "Not for sale"];
export const EMPTY_FILTERS = { category: "", status: "", display: "", expiring: false, blocked: false };

export function useAllocationCategories() {
  const [cats, setCats] = useState([]);
  useEffect(() => { api.get("/master/allocation-categories").then((r) => setCats(r.data.items || [])).catch(() => {}); }, []);
  return cats;
}

const H48 = 48 * 36e5;
export function matchesInventoryFilters(f, flt) {
  if (flt.category && (f.allocation_category_code || "BUILDER") !== flt.category) return false;
  if (flt.status && (f.inventory_state || f.status) !== flt.status) return false;
  if (flt.display && f.display_state !== flt.display) return false;
  if (flt.expiring && !(f.status === "Hold" && f.hold?.expires_at && new Date(f.hold.expires_at) - Date.now() <= H48)) return false;
  if (flt.blocked && f.status !== "Blocked") return false;
  return true;
}

const Sel = ({ value, onChange, testId, children }) => <select className="input !h-8 !w-auto !py-0 text-xs" value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId}>{children}</select>;
const Chk = ({ checked, onChange, testId, children }) => <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />{children}</label>;

export function InventoryFilters({ value, onChange, privileged, showReal, onToggleReal, count }) {
  const cats = useAllocationCategories();
  const set = (k) => (v) => onChange({ ...value, [k]: v });
  const active = Object.values(value).some((v) => v);
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="inventory-filters">
      <Sel value={value.category} onChange={set("category")} testId="inv-filter-category"><option value="">All categories</option>{cats.map((c) => <option key={c.id} value={c.code}>{c.name}</option>)}</Sel>
      <Sel value={value.status} onChange={set("status")} testId="inv-filter-status"><option value="">{privileged ? "Any real status" : "Any status"}</option>{(privileged ? REAL_STATES : ["Available", "Hold", "Sold"]).map((s) => <option key={s}>{s}</option>)}</Sel>
      {privileged && <Sel value={value.display} onChange={set("display")} testId="inv-filter-display"><option value="">Any display status</option>{DISPLAY_STATES.map((s) => <option key={s}>{s}</option>)}</Sel>}
      <Chk checked={value.expiring} onChange={set("expiring")} testId="inv-filter-expiring">Hold expiring &lt; 48 h</Chk>
      {privileged && <Chk checked={value.blocked} onChange={set("blocked")} testId="inv-filter-blocked">Blocked</Chk>}
      {privileged && <button type="button" onClick={onToggleReal} className={`rounded-full border px-3 py-1 text-xs font-semibold ${showReal ? "border-ink-950 bg-ink-950 text-white" : "bg-white"}`} data-testid="inv-toggle-real" title="Colour tiles by the real inventory state or by what customers see">{showReal ? "Showing: real status" : "Showing: displayed status"}</button>}
      {active && <button type="button" onClick={() => onChange(EMPTY_FILTERS)} className="text-xs text-txt-secondary underline" data-testid="inv-filter-clear">clear filters</button>}
      {count != null && <span className="ml-auto text-[11px] text-txt-muted" data-testid="inv-filter-count">{count} unit(s) match</span>}
    </div>
  );
}

export function InventoryLegend({ privileged }) {
  const cats = useAllocationCategories();
  return (
    <div className="space-y-2" data-testid="inventory-legend">
      <div className="flex flex-wrap gap-1.5">{["Available", "Hold", "Booked", "Sold", "Blocked"].map((s) => <StatusChip key={s} status={s} />)}</div>
      {privileged && <>
        <div className="flex flex-wrap gap-1.5 text-[11px]">{cats.filter((c) => c.code !== "BUILDER").map((c) => <span key={c.id} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5" style={{ borderColor: c.color || "#999" }}><b className="rounded bg-ink-950/70 px-1 text-[9px] text-white">{c.code[0]}</b>{c.name}</span>)}</div>
        <p className="text-[11px] text-txt-secondary"><b className="rounded bg-amber-500 px-1 text-[9px] text-white">M</b> masked — displayed status differs from the real one (only you can see this).</p>
      </>}
    </div>
  );
}

export function useAuthPrivileged() {
  const { can } = useAuth();
  return can("inventory.real_status.view");
}
