import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/v2";
import { InventoryFilters, InventoryLegend, EMPTY_FILTERS, matchesInventoryFilters } from "@/components/common/InventoryFilters";
import { useProjectTowers } from "./useProjectTowers";

export default function Flats() {
  const { can } = useAuth();
  const privileged = can("inventory.real_status.view");
  const [sp] = useSearchParams();
  const { projects, towers, projectId, setProjectId, blockId, setBlockId } = useProjectTowers("", sp.get("tower") || "");
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [flt, setFlt] = useState({ ...EMPTY_FILTERS, category: sp.get("category") || "" });
  const [showReal, setShowReal] = useState(true);
  const load = useCallback(() => { if (!blockId) { setItems([]); return; } api.get(`/flats?block_id=${blockId}&page_size=200`).then((r) => { setItems(r.data.items); setTotal(r.data.total ?? r.data.items.length); }).catch((e) => toast.error(errMsg(e))); }, [blockId]);
  useEffect(() => { load(); }, [load]);
  const needProject = !projectId && !!blockId;
  useEffect(() => { if (needProject) api.get(`/blocks/${blockId}`).then((r) => setProjectId(r.data.project_id)).catch(() => {}); }, [needProject, blockId, setProjectId]);
  const gen = async () => { if (!window.confirm("Regenerate flats for this tower? Only allowed while every flat is Available.")) return; try { const r = await api.post(`/blocks/${blockId}/generate-flats`); toast.success(`${r.data.generated} flats generated`); load(); } catch (e) { toast.error(errMsg(e)); } };
  const rows = items.filter((f) => matchesInventoryFilters(f, flt));
  const hoursLeft = (f) => (f.hold?.expires_at ? `${Math.max(0, Math.round((new Date(f.hold.expires_at) - Date.now()) / 36e5))} h` : "");
  return (
    <div className="space-y-4" data-testid="flats-master-page">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto"><h1 className="font-display text-xl text-ink-950">Flats / inventory</h1><p className="text-xs text-txt-secondary">Generated per tower from its floor template; status, pricing and holds are managed in the Project workspace.</p></div>
        <select className="h-10 rounded-md border px-3 text-sm" value={projectId} onChange={(e) => { setProjectId(e.target.value); setBlockId(""); }} data-testid="flats-project"><option value="">Project…</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <select className="h-10 rounded-md border px-3 text-sm" value={blockId} onChange={(e) => setBlockId(e.target.value)} disabled={!projectId} data-testid="flats-tower"><option value="">Tower…</option>{towers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        {blockId && can("masters.flat.create") && <Button variant="outline" onClick={gen} data-testid="flats-generate"><RefreshCw className="mr-1 h-4 w-4" />Generate flats</Button>}
      </div>
      {blockId && <div className="card p-3"><InventoryFilters value={flt} onChange={setFlt} privileged={privileged} showReal={showReal} onToggleReal={() => setShowReal((v) => !v)} count={rows.length} /></div>}
      {blockId && <p className="text-xs text-txt-secondary" data-testid="flats-count">{total} flat(s){rows.length !== items.length ? ` · ${rows.length} shown` : ""}</p>}
      <div className="card overflow-x-auto !p-0" data-testid="flats-list">
        <table className="w-full text-sm"><thead className="bg-warm-50/60 text-left text-[11px] font-semibold uppercase text-txt-secondary"><tr><th className="px-4 py-2">Flat</th><th className="px-4 py-2">Floor</th><th className="px-4 py-2">Type</th><th className="px-4 py-2 text-right">Super built-up</th><th className="px-4 py-2 text-right">Price</th>{privileged && <th className="px-4 py-2">Category</th>}<th className="px-4 py-2">{privileged ? (showReal ? "Real status" : "Displayed") : "Status"}</th>{privileged && <th className="px-4 py-2">Displayed as</th>}<th className="px-4 py-2">Hold expiry</th></tr></thead>
          <tbody>{rows.map((f) => <tr key={f.id} className="border-t" data-testid={`flat-row-${f.flat_number}`}><td className="px-4 py-2 font-semibold text-ink-950"><a className="hover:underline" href={`/blocks/${f.block_id}?flat=${f.id}`}>{f.flat_number}</a></td><td className="px-4 py-2">{f.floor_label ?? f.floor}</td><td className="px-4 py-2">{f.flat_type_name || f.flat_type_code}</td><td className="px-4 py-2 text-right">{f.super_builtup_sqft ?? "—"}</td><td className="px-4 py-2 text-right">{f.price ? `₹${Number(f.price).toLocaleString("en-IN")}` : "—"}</td>
            {privileged && <td className="px-4 py-2 text-xs" data-testid={`flat-cat-${f.flat_number}`}>{f.allocation_category_code || "BUILDER"}{f.bookable === false ? <span className="ml-1 text-txt-muted">· not saleable</span> : null}</td>}
            <td className="px-4 py-2"><StatusPill status={privileged && !showReal && f.display_state ? f.display_state.replace("Show as ", "") : f.status} /></td>
            {privileged && <td className="px-4 py-2 text-xs" data-testid={`flat-display-${f.flat_number}`}>{f.display_state}{f.masked && <span className="ml-1 rounded bg-amber-500 px-1 text-[9px] font-bold text-white" data-testid={`flat-masked-${f.flat_number}`}>M</span>}</td>}
            <td className="px-4 py-2 text-xs text-amber-700">{hoursLeft(f)}</td></tr>)}
            {rows.length === 0 && <tr><td colSpan={9} className="px-4 py-8 text-center text-txt-secondary">{blockId ? (items.length ? "No flats match these filters." : "No flats yet — use Generate flats.") : "Pick a project and tower."}</td></tr>}</tbody></table>
      </div>
      {blockId && <div className="card p-4"><p className="label-xs mb-2">Legend</p><InventoryLegend privileged={privileged} /></div>}
    </div>
  );
}
