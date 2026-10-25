import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Layers, Pencil, Plus } from "lucide-react";
import { useFetch } from "@/hooks/useList";
import { useAuth } from "@/context/AuthContext";
import { inrShort, fmtDate } from "@/lib/format";
import { PageHeader, KV, EmptyState, StatCard } from "@/components/common/Bits";
import { Pill } from "@/components/common/StatusChip";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PaymentPlanMatrix, StageSequenceEditor, ProjectStageList } from "@/components/common/PaymentPlanMatrix";
import { Skeleton } from "@/components/ui/skeleton";
import { ProjectForm } from "@/components/forms/ProjectForm";
import { BlockForm } from "@/components/forms/BlockForm";
import FlatsTable from "@/components/common/FlatsTable";
import { RateCardsTab, ParkingTab } from "@/components/common/ProjectTabs";
import { DocumentsPanel } from "@/components/common/DocumentsPanel";
import { HistoryTimeline } from "@/components/common/HistoryTimeline";
import { ProjectWebsiteTab } from "@/pages/cms/ProjectWebsiteTab";
import { useMasterOptions } from "@/hooks/useList";

// eslint-disable-next-line no-unused-vars
function DocumentsTab({ appliesTo }) {
  const { items } = useMasterOptions("document-types");
  const docs = items.filter((d) => d.applies_to === appliesTo);
  return (
    <div className="card p-5" data-testid="documents-tab">
      <p className="mb-3 text-sm text-txt-secondary">Document checklist bound to Document Types master. Upload arrives in Phase 2 (object storage).</p>
      <ul className="divide-y">{docs.map((d) => <li key={d.id} className="flex items-center justify-between py-2 text-sm"><span className="font-semibold text-ink-950">{d.name}</span><Pill tone="slate">Not uploaded</Pill></li>)}</ul>
      {docs.length === 0 && <p className="text-sm text-txt-secondary">No document types apply to {appliesTo}.</p>}
    </div>
  );
}

export default function ProjectDetail() {
  const { id } = useParams();
  const { data: p, loading, reload } = useFetch(`/projects/${id}`);
  const { can } = useAuth();
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  if (loading) return <div className="space-y-4"><Skeleton className="h-10 w-80" /><Skeleton className="h-40" /></div>;
  if (!p) return <EmptyState title="Project not found" description="It may be outside your project scope." />;
  const inv = p.inventory;
  return (
    <div data-testid="project-detail-page">
      <PageHeader crumbs={[{ label: "Projects", to: "/projects" }, { label: p.code }]} title={p.name} subtitle={`${p.project_type} · ${p.address?.city || ""} ${p.rera_number ? `· RERA ${p.rera_number}` : ""}`}
        actions={<>
          <Pill tone={p.status === "Ready" ? "green" : p.status === "Under Construction" ? "amber" : "slate"} className="px-3 py-1 text-xs">{p.status}</Pill>
          {can("project.write") && <Button variant="outline" onClick={() => setEditOpen(true)} data-testid="edit-project-btn"><Pencil className="mr-1.5 h-4 w-4" />Edit</Button>}
          {can("block.write") && <Button onClick={() => setBlockOpen(true)} className="bg-ink-950 hover:bg-ink-800" data-testid="new-block-btn"><Plus className="mr-1.5 h-4 w-4" />Add block</Button>}
        </>} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Total units" value={inv.total} testId="project-stat-total" />
        <StatCard label="Available" value={inv.Available} accent="green" testId="project-stat-available" />
        <StatCard label="Hold" value={inv.Hold} accent="amber" testId="project-stat-hold" />
        <StatCard label="Blocked" value={inv.Blocked} accent="slate" testId="project-stat-blocked" />
        <StatCard label="Inventory value" value={inrShort(inv.inventory_value)} accent="gold" testId="project-stat-value" />
      </div>
      <Tabs defaultValue="overview">
        <TabsList className="tabs-scroll h-auto justify-start bg-white" data-testid="project-tabs">
          {["overview", "blocks", "construction", "payment-plans", "inventory", "pricing", "parking", "amenities", "documents", "website", "history", "settings"].map((t) => <TabsTrigger key={t} value={t} className="capitalize data-[state=active]:bg-ink-950 data-[state=active]:text-white" data-testid={`project-tab-${t}`}>{t.replace("-", " ")}</TabsTrigger>)}
        </TabsList>
        <TabsContent value="pricing" className="mt-4"><RateCardsTab projectId={p.id} onApplied={reload} /></TabsContent>
        <TabsContent value="parking" className="mt-4"><ParkingTab projectId={p.id} /></TabsContent>
        <TabsContent value="history" className="mt-4"><div className="card p-5"><HistoryTimeline entityType="project" entityId={p.id} /></div></TabsContent>
        <TabsContent value="documents" className="mt-4"><div className="card p-5"><DocumentsPanel entityType="project" entityId={p.id} canWrite={can("project.write")} /></div></TabsContent>
        <TabsContent value="overview" className="mt-4 grid gap-4 lg:grid-cols-3">
          <div className="card p-5 lg:col-span-2">
            <h3 className="mb-4 text-base font-bold text-ink-950">Project details</h3>
            <p className="mb-5 text-sm text-txt-secondary">{p.description || "No description."}</p>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <KV label="Code" value={p.code} /><KV label="Type" value={p.project_type} /><KV label="RERA" value={p.rera_number} />
              <KV label="Launch" value={fmtDate(p.launch_date)} /><KV label="Possession" value={fmtDate(p.expected_possession_date)} /><KV label="Construction stages" value={`${(p.construction_stage_sequence || []).length} in sequence`} />
              <KV label="Address" value={[p.address?.line1, p.address?.city, p.address?.state, p.address?.pincode].filter(Boolean).join(", ")} />
              <KV label="Land area" value={p.land_area_sqft ? `${new Intl.NumberFormat("en-IN").format(p.land_area_sqft)} sq.ft` : "—"} /><KV label="Towers / Units" value={`${p.total_towers} / ${p.total_units}`} mono /><KV label="Parking" value={`${p.parking?.total || 0} slots`} mono />
            </div>
            {p.landmarks?.length > 0 && <div className="mt-5"><p className="label-xs mb-2">Landmarks</p><div className="flex flex-wrap gap-1.5">{p.landmarks.map((l, i) => <Pill key={i} tone="navy">{l.name} · {l.distance_km} km</Pill>)}</div></div>}
            {p.approvals?.length > 0 && <div className="mt-4"><p className="label-xs mb-2">Approvals</p><div className="grid gap-2 sm:grid-cols-3">{p.approvals.map((a, i) => <div key={i} className="rounded border bg-warm-50 p-2 text-xs"><p className="font-bold text-ink-950">{a.name}</p><p className="text-txt-secondary">{a.number}</p><p className="text-txt-muted">{fmtDate(a.date)}</p></div>)}</div></div>}
            {p.team_members?.length > 0 && <div className="mt-4"><p className="label-xs mb-2">Team</p><div className="flex flex-wrap gap-1.5">{p.team_members.map((u) => <Pill key={u.id} tone="gold">{u.name}</Pill>)}</div></div>}
          </div>
          <div className="card p-5">
            <h3 className="mb-4 text-base font-bold text-ink-950">Construction stage sequence</h3>
            <ProjectStageList sequence={p.construction_stage_sequence} />
          </div>
        </TabsContent>
        <TabsContent value="blocks" className="mt-4">
          {p.blocks.length === 0 ? <EmptyState icon={Layers} title="No blocks yet" description="Add a block to generate flats from your flat types." actionLabel={can("block.write") ? "Add block" : undefined} onAction={() => setBlockOpen(true)} testId="blocks-empty" /> : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {p.blocks.map((b) => (
                <Link to={`/blocks/${b.id}`} key={b.id} className="card p-5 transition-colors hover:border-gold/60" data-testid={`block-card-${b.code}`}>
                  <div className="flex items-start justify-between"><div><p className="text-lg font-extrabold text-ink-950">{b.name}</p><p className="text-xs text-txt-secondary">Code {b.code} · {b.floors} floors × {b.flats_per_floor}</p></div><Pill tone="slate">{b.status}</Pill></div>
                  <div className="mt-4 flex items-center gap-2"><div className="h-1.5 flex-1 rounded-full bg-warm-50"><div className="h-1.5 rounded-full bg-gold" style={{ width: `${b.construction_percent}%` }} /></div><span className="text-xs font-semibold tabular">{b.construction_percent}%</span></div>
                  <div className="mt-3 grid grid-cols-4 gap-2 text-center text-[11px]">
                    {[["Total", b.inventory.total, "text-ink-950"], ["Avail", b.inventory.Available, "text-emerald-600"], ["Hold", b.inventory.Hold, "text-amber-600"], ["Blocked", b.inventory.Blocked, "text-txt-secondary"]].map(([l, v, c]) => <div key={l} className="rounded bg-warm-50 py-1.5"><p className={`text-base font-extrabold tabular ${c}`}>{v}</p><p className="text-txt-secondary">{l}</p></div>)}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </TabsContent>
        <TabsContent value="inventory" className="mt-4"><FlatsTable fixed={{ project_id: p.id }} blocks={p.blocks} /></TabsContent>
        <TabsContent value="amenities" className="mt-4">
          {p.amenities.length === 0 ? <EmptyState title="No amenities selected" description="Edit the project to pick amenities from master data." /> : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" data-testid="project-amenities-list">{p.amenities.map((a) => <div key={a.id} className="card p-4"><div className="flex items-center justify-between"><p className="font-bold text-ink-950">{a.name}</p><Pill tone="gold">{a.category}</Pill></div><p className="mt-1 text-xs text-txt-secondary">{a.description}</p></div>)}</div>
          )}
        </TabsContent>
        <TabsContent value="website" className="mt-4"><ProjectWebsiteTab projectId={p.id} slugDefault={p.code} /></TabsContent>
        <TabsContent value="construction" className="mt-4"><StageSequenceEditor entityType="projects" entityId={p.id} sequence={p.construction_stage_sequence} onSaved={reload} /></TabsContent>
        <TabsContent value="payment-plans" className="mt-4"><PaymentPlanMatrix projectId={p.id} blocks={p.blocks.map((b) => ({ id: b.id, name: b.name }))} /></TabsContent>
        <TabsContent value="settings" className="mt-4">
          <div className="card p-5">
            <h3 className="mb-2 text-base font-bold text-ink-950">Website flags</h3>
            <p className="mb-4 text-sm text-txt-secondary">Edit these in the Website tab.</p>
            <div className="grid grid-cols-3 gap-4">{[["is_published", "Published"], ["show_prices", "Show prices"], ["show_availability", "Show availability"]].map(([k, l]) => <KV key={k} label={l} value={p[k] ? "Yes" : "No"} />)}</div>
            <div className="mt-6 grid grid-cols-3 gap-4"><KV label="Active" value={p.is_active ? "Yes" : "No"} /><KV label="Created" value={fmtDate(p.created_at)} /><KV label="Updated" value={fmtDate(p.updated_at)} /></div>
          </div>
        </TabsContent>
      </Tabs>
      {editOpen && <ProjectForm open={editOpen} onOpenChange={setEditOpen} project={p} onSaved={reload} />}
      {blockOpen && <BlockForm open={blockOpen} onOpenChange={setBlockOpen} project={p} onSaved={(b) => { reload(); navigate(`/blocks/${b.id}`); }} />}
    </div>
  );
}
