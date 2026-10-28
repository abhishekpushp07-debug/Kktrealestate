import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ChevronRight, Building2, Layers, Plus, CheckCircle2, AlertTriangle } from "lucide-react";
import { useFetch } from "@/hooks/useList";
import { useAuth } from "@/context/AuthContext";
import { Card, Skeleton, StatusPill } from "@/components/v2";
import { ContextActions } from "@/components/common/ContextActions";
import { TowerNode } from "@/components/structure/TowerNode";
import { AddFloorsSheet, AddFlatSheet } from "@/components/structure/StructureSheets";
import { cn } from "@/lib/utils";
import { ConnectedTo } from "@/components/common/ConnectedTo";
import { QuickAddButton, useQuickCreate } from "@/components/common/QuickCreate";

function Checklist({ r, towers, onFix }) {
  const items = [...r.project_checks.map((c) => ({ ...c, scope: "Project" })), ...towers.flatMap((t) => t.checks.map((c) => ({ ...c, scope: t.name, block_id: t.id })))];
  return (
    <Card testId="structure-readiness">
      <div className="flex items-center justify-between"><h3 className="font-display text-lg">Setup readiness</h3>
        <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold", r.ready ? "bg-sage/15 text-sage" : "bg-amber2/15 text-amber-700")} data-testid="readiness-badge">
          {r.ready ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}{r.ready ? "Ready to sell" : `${r.open_items} open item${r.open_items === 1 ? "" : "s"}`}</span></div>
      {items.length === 0 ? <p className="mt-3 text-sm text-txt-muted" data-testid="readiness-all-done">Towers, floors, flats, stage plans, payment plans and pricing are all in place.</p> : (
        <ul className="mt-3 divide-y divide-warm-100" data-testid="readiness-list">{items.map((c) => (
          <li key={`${c.scope}-${c.code}`} className="flex items-center justify-between gap-3 py-2 text-sm" data-testid={`readiness-${c.code}`}>
            <span><span className="label-xs mr-2 text-txt-muted">{c.scope}</span>{c.label}</span>
            {c.fix.to ? <Link to={c.fix.to} className="btn btn-secondary btn-sm">{c.fix.label}</Link> : <button className="btn btn-secondary btn-sm" onClick={() => onFix(c.fix)}>{c.fix.label}</button>}
          </li>))}</ul>)}
    </Card>
  );
}

export default function ProjectStructure() {
  const { id } = useParams();
  const { can } = useAuth();
  const { data, loading, reload } = useFetch(`/projects/${id}/structure`);
  const [sheet, setSheet] = useState(null); // {kind:"floors"|"flat", tower, floor?}
  const qcTower = useQuickCreate("tower", { project_id: id }, () => reload());
  const onFix = (fix) => { const t = data.towers.find((x) => x.id === fix.block_id); if (t) setSheet({ kind: "floors", tower: t }); };
  if (loading || !data) return <div className="space-y-4" data-testid="structure-loading"><Skeleton className="h-24 rounded-2xl" /><Skeleton className="h-96 rounded-2xl" /></div>;
  const p = data.project;
  const total = data.towers.reduce((s, t) => s + t.units.total, 0);
  return (
    <div className="space-y-6" data-testid="project-structure-page">
      <nav className="text-xs text-txt-muted"><Link to="/projects" className="hover:text-ink-950">Projects</Link> › <Link to={`/projects/${id}`} className="hover:text-ink-950">{p.name}</Link> › Structure</nav>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="label">Structure builder</p><h1 className="mt-1 font-display text-4xl text-ink-950" data-testid="structure-title">{p.name}</h1>
          <p className="mt-2 text-sm text-txt-secondary" data-testid="structure-summary">{data.towers.length} tower{data.towers.length === 1 ? "" : "s"} · {total} flats</p></div>
        <StatusPill status={p.status} />
      </header>
      <ContextActions testId="structure-context-actions" items={[
        { label: "Add tower", onClick: qcTower.onCreateNew, perm: "masters.tower.create", primary: true, icon: Building2 },
        data.towers[0] ? { label: "Add floors", onClick: () => setSheet({ kind: "floors", tower: data.towers[0] }), perm: "masters.tower.edit", icon: Layers } : null,
        data.towers[0] ? { label: "Add flat", onClick: () => setSheet({ kind: "flat", tower: data.towers[0] }), perm: "masters.flat.create", icon: Plus } : null,
        { label: "Stage plans", to: `/projects/${id}/setup?section=stages`, perm: "masters.stage_plan.view" },
        { label: "Payment plans", to: `/projects/${id}/setup?section=plans`, perm: "masters.payment_plan.view" },
        { label: "Project workspace", to: `/projects/${id}`, perm: "masters.project.view", icon: ChevronRight },
      ]} />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-3" data-testid="structure-tree">
          {data.towers.length === 0 && <Card testId="structure-empty"><p className="text-sm text-txt-muted">No towers yet. Add the first tower to start generating floors and flats.</p></Card>}
          {data.towers.map((t) => <TowerNode key={t.id} tower={t} projectId={id} can={can} onAddFloors={() => setSheet({ kind: "floors", tower: t })} onAddFlat={(floor) => setSheet({ kind: "flat", tower: t, floor })} onChanged={reload} />)}
        </div>
        <div className="space-y-6"><Checklist r={data.readiness} towers={data.towers} onFix={onFix} /><ConnectedTo entity="project" id={id} /></div>
      </div>
      {qcTower.node}
      {sheet?.kind === "floors" && <AddFloorsSheet tower={sheet.tower} onClose={() => setSheet(null)} onSaved={(n) => { toast.success(`${n} flat(s) generated`); setSheet(null); reload(); }} />}
      {sheet?.kind === "flat" && <AddFlatSheet tower={sheet.tower} floor={sheet.floor} onClose={() => setSheet(null)} onSaved={(f) => { toast.success(`Flat ${f.flat_number} added`); setSheet(null); reload(); }} />}
    </div>
  );
}
