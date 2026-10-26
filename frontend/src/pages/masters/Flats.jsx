import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/v2";
import { useProjectTowers } from "./useProjectTowers";

export default function Flats() {
  const { can } = useAuth();
  const [sp] = useSearchParams();
  const { projects, towers, projectId, setProjectId, blockId, setBlockId } = useProjectTowers("", sp.get("tower") || "");
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const load = () => { if (!blockId) { setItems([]); return; } api.get(`/flats?block_id=${blockId}&page_size=200`).then((r) => { setItems(r.data.items); setTotal(r.data.total ?? r.data.items.length); }).catch((e) => toast.error(errMsg(e))); };
  useEffect(() => { load(); }, [blockId]); // eslint-disable-line
  useEffect(() => { if (!projectId && blockId) api.get(`/blocks/${blockId}`).then((r) => setProjectId(r.data.project_id)).catch(() => {}); }, [blockId]); // eslint-disable-line
  const gen = async () => { if (!window.confirm("Regenerate flats for this tower? Only allowed while every flat is Available.")) return; try { const r = await api.post(`/blocks/${blockId}/generate-flats`); toast.success(`${r.data.generated} flats generated`); load(); } catch (e) { toast.error(errMsg(e)); } };
  return (
    <div className="space-y-4" data-testid="flats-master-page">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto"><h1 className="font-display text-xl text-ink-950">Flats / inventory</h1><p className="text-xs text-txt-secondary">Generated per tower from its floor template; status, pricing and holds are managed in the Project workspace.</p></div>
        <select className="h-10 rounded-md border px-3 text-sm" value={projectId} onChange={(e) => { setProjectId(e.target.value); setBlockId(""); }} data-testid="flats-project"><option value="">Project…</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <select className="h-10 rounded-md border px-3 text-sm" value={blockId} onChange={(e) => setBlockId(e.target.value)} disabled={!projectId} data-testid="flats-tower"><option value="">Tower…</option>{towers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        {blockId && can("masters.flat.create") && <Button variant="outline" onClick={gen} data-testid="flats-generate"><RefreshCw className="mr-1 h-4 w-4" />Generate flats</Button>}
      </div>
      {blockId && <p className="text-xs text-txt-secondary" data-testid="flats-count">{total} flat(s)</p>}
      <div className="card overflow-x-auto !p-0" data-testid="flats-list">
        <table className="w-full text-sm"><thead className="bg-warm-50/60 text-left text-[11px] font-semibold uppercase text-txt-secondary"><tr><th className="px-4 py-2">Flat</th><th className="px-4 py-2">Floor</th><th className="px-4 py-2">Type</th><th className="px-4 py-2 text-right">Super built-up</th><th className="px-4 py-2 text-right">Price</th><th className="px-4 py-2">Status</th></tr></thead>
          <tbody>{items.map((f) => <tr key={f.id} className="border-t" data-testid={`flat-row-${f.flat_number}`}><td className="px-4 py-2 font-semibold text-ink-950">{f.flat_number}</td><td className="px-4 py-2">{f.floor_label ?? f.floor}</td><td className="px-4 py-2">{f.flat_type_name || f.flat_type_code}</td><td className="px-4 py-2 text-right">{f.super_builtup_sqft ?? "—"}</td><td className="px-4 py-2 text-right">{f.price ? `₹${Number(f.price).toLocaleString("en-IN")}` : "—"}</td><td className="px-4 py-2"><StatusPill status={f.status} /></td></tr>)}
            {items.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-txt-secondary">{blockId ? "No flats yet — use Generate flats." : "Pick a project and tower."}</td></tr>}</tbody></table>
      </div>
    </div>
  );
}
