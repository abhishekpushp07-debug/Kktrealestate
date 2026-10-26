import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ArrowUpRight, Check, Download, Pencil, Plus, Upload, X } from "lucide-react";
import api, { errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { invalidateCatalogues, useCatalogues } from "@/hooks/useCatalogues";
import { Card, EmptyState, Skeleton } from "@/components/v2";
import { cn } from "@/lib/utils";

const SIMPLE = ["salutation", "gender", "residency", "occupation", "income_band", "customer_segment", "relation", "lead_source", "lost_reason", "budget_band", "facing", "floor_preference", "bhk_preference", "state", "city", "locality", "bank", "designation", "broker_channel", "communication_type", "communication_outcome", "visit_outcome", "cancellation_reason", "service_category", "document_type", "nationality", "company_type"];
const STRUCTURED = [["flat-types", "Flat types"], ["block-types", "Block types"], ["construction-stages", "Construction stages"], ["payment-plans", "Payment plan templates"], ["floor-plan-templates", "Floor plan templates"], ["charge-types", "Charge types"], ["payment-modes", "Payment modes"], ["bank-accounts", "Bank accounts"], ["document-types", "Document types"], ["plc-types", "PLC types"], ["amenities", "Amenities"], ["spec-categories", "Specifications"]];
const title = (t) => t.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export default function Catalogues() {
  const { can } = useAuth();
  const { catalogues, loading } = useCatalogues();
  const [type, setType] = useState("lead_source");
  const [items, setItems] = useState(null);
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState("");
  const [edit, setEdit] = useState(null);
  const write = can("masters.catalogue.create");
  const load = (t) => api.get(`/catalogues/${t}?include_inactive=true`).then((r) => setItems(r.data.items)).catch((e) => toast.error(errMsg(e)));
  useMemo(() => { setItems(null); load(type); }, [type]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (fn, msg) => { try { await fn(); await invalidateCatalogues(); await load(type); msg && toast.success(msg); } catch (e) { toast.error(errMsg(e)); } };
  const parents = catalogues?.types?.[type === "city" ? "state" : type === "locality" ? "city" : ""] || [];
  const list = (items || []).filter((i) => !q || i.label.toLowerCase().includes(q.toLowerCase()));
  const move = (i, d) => { const ids = list.map((x) => x.id); const [x] = ids.splice(i, 1); ids.splice(i + d, 0, x); act(() => api.post(`/catalogues/${type}/reorder`, { ids })); };
  return (
    <div className="space-y-6" data-testid="catalogues-page">
      <header><p className="label">Settings</p><h1 className="mt-1 font-display text-4xl text-ink-950">Catalogues</h1><p className="mt-2 max-w-2xl text-sm text-txt-secondary">Every dropdown in the ERP is fed from here. Structured masters (flat types, stages, plan templates…) open their own editors; project-specific stage order and plan assignments live inside each project.</p></header>
      <div className="grid min-w-0 gap-6 xl:grid-cols-[280px_1fr]">
        <aside className="min-w-0 space-y-4">
          <Card className="!p-3"><p className="label px-2 pb-2">Dropdown values</p><ul className="max-h-[50vh] space-y-0.5 overflow-y-auto">{SIMPLE.map((t) => <li key={t}><button onClick={() => setType(t)} className={cn("flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm", type === t ? "bg-ink-950 text-warm-50" : "hover:bg-warm-100")} data-testid={`cat-type-${t}`}>{title(t)}<span className={cn("text-xs", type === t ? "text-warm-200/60" : "text-txt-muted")}>{catalogues?.types?.[t]?.length ?? ""}</span></button></li>)}</ul></Card>
          <Card className="!p-3"><p className="label px-2 pb-2">Structured masters</p><ul className="space-y-0.5">{STRUCTURED.map(([k, l]) => <li key={k}><Link to={`/master/${k}`} className="flex items-center justify-between rounded-lg px-3 py-2 text-sm hover:bg-warm-100" data-testid={`cat-master-${k}`}>{l}<ArrowUpRight className="h-3.5 w-3.5 text-txt-muted" /></Link></li>)}</ul></Card>
        </aside>
        <Card className="min-w-0 !p-0">
          <div className="flex flex-wrap items-center gap-3 border-b border-warm-100 px-6 py-4"><h2 className="font-display text-xl">{title(type)}</h2><input className="input ml-auto max-w-xs" placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="cat-filter" /><a href={`${api.defaults.baseURL}/catalogues/${type}/export.csv`} className="btn btn-ghost btn-sm" data-testid="cat-export"><Download className="h-3.5 w-3.5" />CSV</a>{write && <label className="btn btn-ghost btn-sm cursor-pointer"><Upload className="h-3.5 w-3.5" />Import<input type="file" accept=".csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; const fd = new FormData(); fd.append("file", f); act(() => api.post(`/catalogues/${type}/import`, fd), "Imported"); e.target.value = ""; }} data-testid="cat-import" /></label>}</div>
          {write && <form onSubmit={(e) => { e.preventDefault(); if (!draft.trim()) return; act(() => api.post(`/catalogues/${type}/items`, { label: draft.trim() }), `Added "${draft.trim()}"`); setDraft(""); }} className="flex gap-2 border-b border-warm-100 px-6 py-3"><input className="input" placeholder={`Add a new ${title(type).toLowerCase()}…`} value={draft} onChange={(e) => setDraft(e.target.value)} data-testid="cat-add-input" /><button className="btn btn-primary" data-testid="cat-add-btn"><Plus className="h-4 w-4" />Add</button></form>}
          {loading || !items ? <div className="space-y-2 p-6">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-10" />)}</div> : list.length === 0 ? <div className="p-6"><EmptyState title="No values" description="Add the first value above." /></div> : (
            <ul className="divide-y divide-warm-100" data-testid="cat-items">{list.map((it, i) => (
              <li key={it.id} className={cn("flex items-center gap-3 px-6 py-2.5", !it.is_active && "opacity-50")}>
                <span className="w-6 text-right font-display text-xs text-txt-muted">{i + 1}</span>
                {edit?.id === it.id ? <><input autoFocus className="input h-9 flex-1" value={edit.label} onChange={(e) => setEdit({ ...edit, label: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") act(() => api.patch(`/catalogues/${type}/items/${it.id}`, { label: edit.label, version: it.version }), "Saved").then(() => setEdit(null)); if (e.key === "Escape") setEdit(null); }} data-testid={`cat-edit-input`} /><button onClick={() => act(() => api.patch(`/catalogues/${type}/items/${it.id}`, { label: edit.label, version: it.version }), "Saved").then(() => setEdit(null))} className="text-sage"><Check className="h-4 w-4" /></button><button onClick={() => setEdit(null)} className="text-txt-muted"><X className="h-4 w-4" /></button></>
                  : <><span className="flex-1 text-sm font-medium">{it.label}{it.parent_id && <span className="ml-2 text-xs text-txt-muted">{parents.find((p) => p.id === it.parent_id)?.label}</span>}</span><span className="hidden text-xs text-txt-muted md:inline">{it.code}</span>{it.is_system && <span className="pill bg-warm-100 text-txt-muted">system</span>}
                    {write && <><button onClick={() => move(i, -1)} disabled={i === 0} className="text-txt-muted hover:text-ink-950 disabled:opacity-20" aria-label="Move up">↑</button><button onClick={() => move(i, 1)} disabled={i === list.length - 1} className="text-txt-muted hover:text-ink-950 disabled:opacity-20" aria-label="Move down">↓</button><button onClick={() => setEdit({ id: it.id, label: it.label })} className="text-txt-muted hover:text-ink-950" aria-label="Edit" data-testid={`cat-edit-${it.code}`}><Pencil className="h-4 w-4" /></button><button onClick={() => act(() => api.patch(`/catalogues/${type}/items/${it.id}`, { is_active: !it.is_active, version: it.version }), it.is_active ? "Deactivated" : "Activated")} className={cn("pill border", it.is_active ? "border-warm-200 text-txt-secondary hover:border-brick hover:text-brick" : "border-sage/30 bg-sage-50 text-sage")} data-testid={`cat-toggle-${it.code}`}>{it.is_active ? "Deactivate" : "Activate"}</button></>}</>}
              </li>))}</ul>
          )}
        </Card>
      </div>
    </div>
  );
}
