import { useState } from "react";
import { Plus, Play, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useFetch, useMasterOptions } from "@/hooks/useList";
import { useAuth } from "@/context/AuthContext";
import { fmtDate, fmtDateTime, num } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Pill } from "@/components/common/StatusChip";
import { EmptyState, Field } from "@/components/common/Bits";
import { Combobox } from "@/components/common/Combobox";

function RateCardForm({ projectId, onClose, onSaved }) {
  const { items: flatTypes } = useMasterOptions("flat-types");
  const { options: plcOptions } = useMasterOptions("plc-types", (x) => ({ value: x.id, label: x.name, sub: x.calc }));
  const [form, setForm] = useState({ name: "", effective_from: new Date().toISOString().slice(0, 10), rates: {}, plc_rules: [] });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const rates = flatTypes.filter((f) => form.rates[f.id]).map((f) => (form.rates[f.id].mode === "lump" ? { flat_type_id: f.id, lump_sum: Number(form.rates[f.id].value) } : { flat_type_id: f.id, rate_per_sqft: Number(form.rates[f.id].value) }));
    if (!rates.length) { toast.error("Enter a rate for at least one flat type"); return; }
    setBusy(true);
    try {
      await api.post(`/projects/${projectId}/rate-cards`, { name: form.name, effective_from: form.effective_from, rates, plc_rules: form.plc_rules.filter((r) => r.plc_type_id).map((r) => ({ ...r, value: Number(r.value), floor_gte: r.floor_gte ? Number(r.floor_gte) : null, facings: r.applies === "facing_in" ? String(r.facings || "").split(",").map((s) => s.trim()).filter(Boolean) : null })) });
      toast.success("Rate card created (Draft)"); onSaved(); onClose();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl" data-testid="rate-card-form">
        <SheetHeader><SheetTitle>New rate card</SheetTitle></SheetHeader>
        <div className="mt-6 space-y-4">
          <div className="grid grid-cols-2 gap-3"><Field label="Name" required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="rc-name-input" /></Field><Field label="Effective from"><Input type="date" value={form.effective_from} onChange={(e) => setForm({ ...form, effective_from: e.target.value })} /></Field></div>
          <div className="rounded-lg border p-3"><p className="mb-2 text-sm font-bold text-navy">Rates per flat type</p>
            {flatTypes.map((f) => { const r = form.rates[f.id] || { mode: "rate", value: "" }; return (
              <div key={f.id} className="mb-2 grid grid-cols-[1fr_110px_120px] items-center gap-2"><span className="text-sm">{f.name}</span>
                <Select value={r.mode} onValueChange={(v) => setForm({ ...form, rates: { ...form.rates, [f.id]: { ...r, mode: v } } })}><SelectTrigger className="h-8"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="rate">₹/sq.ft</SelectItem><SelectItem value="lump">Lump sum</SelectItem></SelectContent></Select>
                <Input type="number" className="h-8" value={r.value} onChange={(e) => setForm({ ...form, rates: { ...form.rates, [f.id]: { ...r, value: e.target.value } } })} data-testid={`rc-rate-${f.code}`} /></div>); })}
          </div>
          <div className="rounded-lg border p-3"><p className="mb-2 text-sm font-bold text-navy">PLC rules</p>
            {form.plc_rules.map((r, i) => (
              <div key={i} className="mb-2 grid grid-cols-[1fr_120px_90px_80px] items-center gap-2">
                <Combobox options={plcOptions} value={r.plc_type_id} onChange={(v) => setForm({ ...form, plc_rules: form.plc_rules.map((x, j) => j === i ? { ...x, plc_type_id: v } : x) })} placeholder="PLC type" testId={`rc-plc-${i}`} />
                <Select value={r.applies} onValueChange={(v) => setForm({ ...form, plc_rules: form.plc_rules.map((x, j) => j === i ? { ...x, applies: v } : x) })}><SelectTrigger className="h-8"><SelectValue /></SelectTrigger><SelectContent>{["all", "floors_gte", "corner", "facing_in", "top_floor"].map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent></Select>
                <Input type="number" className="h-8" placeholder="value" value={r.value} onChange={(e) => setForm({ ...form, plc_rules: form.plc_rules.map((x, j) => j === i ? { ...x, value: e.target.value } : x) })} />
                <label className="flex items-center gap-1 text-[11px]"><input type="checkbox" checked={r.per_floor} onChange={(e) => setForm({ ...form, plc_rules: form.plc_rules.map((x, j) => j === i ? { ...x, per_floor: e.target.checked } : x) })} />per floor</label>
                {r.applies === "floors_gte" && <Input className="col-span-2 h-8" placeholder="floor ≥" value={r.floor_gte || ""} onChange={(e) => setForm({ ...form, plc_rules: form.plc_rules.map((x, j) => j === i ? { ...x, floor_gte: e.target.value } : x) })} />}
                {r.applies === "facing_in" && <Input className="col-span-2 h-8" placeholder="facings e.g. N,E" value={r.facings || ""} onChange={(e) => setForm({ ...form, plc_rules: form.plc_rules.map((x, j) => j === i ? { ...x, facings: e.target.value } : x) })} />}
              </div>))}
            <Button type="button" variant="outline" size="sm" onClick={() => setForm({ ...form, plc_rules: [...form.plc_rules, { plc_type_id: null, value: "", applies: "all", per_floor: false }] })} data-testid="rc-add-plc"><Plus className="mr-1 h-3.5 w-3.5" />Add PLC rule</Button>
          </div>
          <Button onClick={submit} disabled={busy} className="w-full bg-navy hover:bg-navy-700" data-testid="rc-submit">Create draft</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function RateCardsTab({ projectId, onApplied }) {
  const { data, loading, reload } = useFetch(`/projects/${projectId}/rate-cards`);
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const act = async (rc, action) => {
    try { const r = await api.post(`/projects/${projectId}/rate-cards/${rc.id}/${action}`); toast.success(action === "apply" ? `${r.data.flats_updated} Available flats re-priced · ${r.data.untouched_non_available} on Hold/Blocked untouched` : "Rate card activated"); reload(); onApplied?.(); } catch (e) { toast.error(errMsg(e)); }
  };
  const items = data?.items || [];
  return (
    <div data-testid="rate-cards-tab">
      <div className="mb-3 flex items-center justify-between"><p className="text-sm text-slate-600">Rate cards define base rates per flat type plus PLC rules. Only one is Active; applying re-prices Available flats only.</p>{can("flat.write") && <Button size="sm" onClick={() => setOpen(true)} className="bg-navy hover:bg-navy-700" data-testid="new-rate-card-btn"><Plus className="mr-1 h-4 w-4" />New rate card</Button>}</div>
      {!loading && items.length === 0 ? <EmptyState title="No rate cards" description="Create a rate card to price inventory with PLCs." /> : (
        <div className="grid gap-3 md:grid-cols-2">
          {items.map((rc) => (
            <div key={rc.id} className="card-elev p-4" data-testid={`rate-card-${rc.id}`}>
              <div className="flex items-start justify-between"><div><p className="font-bold text-navy">{rc.name}</p><p className="text-xs text-slate-500">Effective {fmtDate(rc.effective_from)} · {rc.rates.length} rates · {rc.plc_rules.length} PLC rules</p></div><Pill tone={rc.status === "Active" ? "green" : rc.status === "Draft" ? "amber" : "slate"}>{rc.status}</Pill></div>
              {rc.applied_at && <p className="mt-2 text-xs text-slate-500">Applied {fmtDateTime(rc.applied_at)} · {num(rc.applied_count)} flats</p>}
              {can("flat.write") && <div className="mt-3 flex gap-2">
                {rc.status === "Draft" && <Button size="sm" variant="outline" onClick={() => act(rc, "activate")} data-testid={`rc-activate-${rc.id}`}><CheckCircle2 className="mr-1 h-3.5 w-3.5" />Activate</Button>}
                {rc.status === "Active" && <Button size="sm" onClick={() => act(rc, "apply")} className="bg-gold text-navy hover:bg-gold-hover" data-testid={`rc-apply-${rc.id}`}><Play className="mr-1 h-3.5 w-3.5" />Apply to Available flats</Button>}
              </div>}
            </div>
          ))}
        </div>
      )}
      {open && <RateCardForm projectId={projectId} onClose={() => setOpen(false)} onSaved={reload} />}
    </div>
  );
}

export function ParkingTab({ projectId }) {
  const { can } = useAuth();
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const { data, loading, reload } = useFetch(`/parking?project_id=${projectId}&page=${page}&page_size=100${filter === "all" ? "" : `&type=${filter}`}`);
  const [gen, setGen] = useState({ prefix: "P", start: 1, count: 10, type: "Covered", level: "", price: "" });
  const [open, setOpen] = useState(false);
  const generate = async () => {
    try { const r = await api.post("/parking/bulk-generate", { project_id: projectId, prefix: gen.prefix, start: Number(gen.start), count: Number(gen.count), type: gen.type, level: gen.level || null, price: gen.price === "" ? null : Number(gen.price) }); toast.success(`${r.data.generated} slots generated (${r.data.first}–${r.data.last})`); setOpen(false); reload(); } catch (e) { toast.error(errMsg(e)); }
  };
  const counts = data?.counts || {};
  return (
    <div data-testid="parking-tab">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex gap-2 text-xs">{["Available", "Allotted", "Blocked"].map((s) => <span key={s} className="rounded-full border bg-white px-2 py-0.5"><b className="text-navy">{counts[s] || 0}</b> {s}</span>)}</div>
        <div className="ml-auto flex gap-2">
          <Select value={filter} onValueChange={(v) => { setFilter(v); setPage(1); }}><SelectTrigger className="h-9 w-36" data-testid="parking-type-filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All types</SelectItem>{["Covered", "Open", "Stilt", "Basement"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select>
          {can("block.write") && <Button size="sm" onClick={() => setOpen(!open)} className="bg-navy hover:bg-navy-700" data-testid="parking-generate-btn"><Plus className="mr-1 h-4 w-4" />Bulk generate</Button>}
        </div>
      </div>
      {open && <div className="card-elev mb-4 grid grid-cols-2 gap-3 p-4 md:grid-cols-6" data-testid="parking-generate-form">
        <Field label="Prefix"><Input value={gen.prefix} onChange={(e) => setGen({ ...gen, prefix: e.target.value })} data-testid="parking-prefix" /></Field><Field label="Start"><Input type="number" value={gen.start} onChange={(e) => setGen({ ...gen, start: e.target.value })} /></Field>
        <Field label="Count"><Input type="number" value={gen.count} onChange={(e) => setGen({ ...gen, count: e.target.value })} data-testid="parking-count" /></Field>
        <Field label="Type"><Select value={gen.type} onValueChange={(v) => setGen({ ...gen, type: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["Covered", "Open", "Stilt", "Basement"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select></Field>
        <Field label="Level"><Input value={gen.level} onChange={(e) => setGen({ ...gen, level: e.target.value })} placeholder="B1" /></Field><Field label="Price ₹"><Input type="number" value={gen.price} onChange={(e) => setGen({ ...gen, price: e.target.value })} /></Field>
        <Button onClick={generate} className="col-span-2 bg-navy hover:bg-navy-700 md:col-span-6" data-testid="parking-generate-submit">Generate slots</Button>
      </div>}
      {loading ? null : <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8 lg:grid-cols-12" data-testid="parking-grid">
        {(data?.items || []).map((s) => <div key={s.id} title={`${s.type} · ${s.level || ""} · ₹${num(s.price)}`} className={`rounded border px-1.5 py-1.5 text-center text-[10px] font-semibold ${s.status === "Available" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : s.status === "Allotted" ? "border-navy-700 bg-navy-800 text-white" : "border-slate-300 bg-slate-100 text-slate-600"}`} data-testid={`parking-slot-${s.number}`}>{s.number}</div>)}
      </div>}
      {!loading && data?.total === 0 && <EmptyState title="No parking slots" description="Bulk-generate slots by type and level." />}
      {!loading && (data?.total || 0) > 100 && <div className="mt-3 flex items-center justify-between text-xs text-slate-500" data-testid="parking-pagination">
        <span>Showing {(page - 1) * 100 + 1}–{Math.min(page * 100, data.total)} of {data.total}</span>
        <div className="flex gap-2"><Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)} data-testid="parking-prev">Prev</Button><Button size="sm" variant="outline" disabled={page * 100 >= data.total} onClick={() => setPage(page + 1)} data-testid="parking-next">Next</Button></div>
      </div>}
    </div>
  );
}
