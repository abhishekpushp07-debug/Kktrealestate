import { HistoryButton } from "@/components/common/HistoryTimeline";
import { lazy, Suspense, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowUpRight, Building2, Pencil } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useFetch } from "@/hooks/useList";
import { inrShort, initials } from "@/lib/format";
import { Card, EmptyState, EntityCard, MiniBar, Money, PageHero, ProgressRing, Skeleton, StatusPill, Tabs, Timeline, CELL } from "@/components/v2";
import { ConstructionStatusPanel } from "@/components/common/ConstructionStatusPanel";
import { PaymentPlanMatrix } from "@/components/common/PaymentPlanMatrix";
import { RateCardsTab, ParkingTab } from "@/components/common/ProjectTabs";
import { cn } from "@/lib/utils";

const ProjectWebsiteTab = lazy(() => import("@/pages/cms/ProjectWebsiteTab").then((m) => ({ default: m.ProjectWebsiteTab })));
const FlatsTable = lazy(() => import("@/components/common/FlatsTable"));
const TABS = [["overview", "Overview"], ["towers", "Towers"], ["inventory", "Inventory"], ["construction", "Construction"], ["plans", "Payment Plans"], ["pricing", "Pricing"], ["customers", "Customers"], ["bookings", "Bookings"], ["collections", "Collections"], ["website", "Website"]];

function TowerCard({ t, pid }) {
  const c = t.construction;
  return (
    <Card hover className="flex flex-col gap-4" testId={`tower-card-${t.code}`}>
      <div className="flex items-start justify-between gap-3"><div><Link to={`/blocks/${t.id}`} className="font-display text-xl text-ink-950 hover:text-gold">{t.name}</Link><p className="text-xs text-txt-secondary">{t.floors} floors · {t.units.total} units · {t.plans.length} plan{t.plans.length === 1 ? "" : "s"}</p></div><ProgressRing value={c.percent} size={52} stroke={5} /></div>
      <MiniBar counts={t.units.by_status} />
      <div className="flex flex-wrap gap-1.5 text-xs">{Object.entries(t.units.by_status).map(([k, v]) => <span key={k} className={cn("pill", CELL[k])}>{v} {k}</span>)}</div>
      <div className="flex items-end justify-between border-t border-warm-100 pt-3 text-xs text-txt-secondary"><div><p>Current stage</p><p className="font-semibold text-ink-950">{c.current || "Not started"}</p></div><div className="text-right"><p>Next</p><p className="font-semibold text-ink-950">{c.next || "Possession done"}</p></div></div>
      <Link to={`/projects/${pid}?tab=construction&tower=${t.id}`} className="btn btn-ghost btn-sm self-start" data-testid={`tower-update-stage-${t.code}`}>Update stage</Link>
    </Card>
  );
}

function Overview({ s, p }) {
  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <div className="space-y-6 xl:col-span-2">
        <div><h3 className="mb-4 font-display text-xl">Towers</h3><div className="grid gap-6 md:grid-cols-2">{s.towers.map((t) => <TowerCard key={t.id} t={t} pid={p.id} />)}</div></div>
      </div>
      <div className="space-y-6">
        <Card><h3 className="font-display text-lg">Setup checklist</h3><ul className="mt-3 space-y-2 text-sm">{Object.entries(s.checklist).map(([k, v]) => <li key={k} className="flex items-center justify-between"><span className="text-txt-secondary">{k.replace(/_/g, " ")}</span><span className={cn("pill", v ? "bg-sage-50 text-sage" : "bg-amber2-50 text-amber2")}>{v ? "Done" : "Pending"}</span></li>)}</ul><Link to={`/projects/${p.id}/setup`} className="btn btn-ghost btn-sm mt-4"><Pencil className="h-3.5 w-3.5" />Edit setup</Link></Card>
        {p.amenities?.length > 0 && <Card><h3 className="font-display text-lg">Amenities</h3><div className="mt-3 flex flex-wrap gap-1.5">{p.amenities.map((a) => <span key={a.id || a} className="pill bg-warm-100 text-txt-secondary">{a.name || a}</span>)}</div></Card>}
        {p.approvals?.length > 0 && <Card><h3 className="font-display text-lg">Approvals</h3><ul className="mt-3 space-y-2 text-sm">{p.approvals.map((a, i) => <li key={i} className="flex justify-between"><span>{a.name}</span><span className="text-txt-muted">{a.number || a.date || ""}</span></li>)}</ul></Card>}
        {p.team_members?.length > 0 && <Card><h3 className="font-display text-lg">Team</h3><div className="mt-3 flex flex-wrap gap-2">{p.team_members.map((u) => <span key={u.id} className="flex items-center gap-2 rounded-full bg-warm-100 py-1 pl-1 pr-3 text-xs"><span className="grid h-6 w-6 place-items-center rounded-full bg-ink-950 text-[10px] font-bold text-gold-400">{initials(u.name)}</span>{u.name}</span>)}</div></Card>}
      </div>
    </div>
  );
}

function Construction({ s }) {
  const [sp] = useSearchParams();
  const [tower, setTower] = useState(sp.get("tower") || s.towers[0]?.id);
  const t = s.towers.find((x) => x.id === tower);
  if (!t) return <EmptyState title="No towers" description="Add a tower in Setup first." icon={Building2} />;
  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <div className="space-y-3"><p className="label">Tower</p>{s.towers.map((x) => <button key={x.id} onClick={() => setTower(x.id)} className={cn("card-hover flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left", x.id === tower ? "border-ink-950 bg-ink-950 text-warm-50" : "border-warm-200 bg-white")} data-testid={`constr-tower-${x.code}`}><span><span className="font-semibold">{x.name}</span><span className={cn("block text-xs", x.id === tower ? "text-warm-200/60" : "text-txt-muted")}>{x.construction.current || "Not started"}</span></span><ProgressRing value={x.construction.percent} size={40} stroke={4} light={x.id === tower} /></button>)}</div>
      <div className="xl:col-span-2 space-y-6">
        <Card><h3 className="font-display text-lg">{t.name} · stage timeline</h3><p className="mb-4 text-xs text-txt-secondary">The only place stages are completed. Completing a stage raises the linked installments for every active booking in this tower.</p><ConstructionStatusPanel key={t.id} blockId={t.id} onChanged={() => window.location.reload()} /></Card>
        <Card><h3 className="font-display text-lg">Sequence</h3><Timeline items={t.construction.stages.map((st) => ({ id: st.stage_id, tone: st.status === "Completed" ? "sage" : undefined, title: `${st.seq}. ${st.name}`, subtitle: st.status === "Completed" ? `Completed ${st.completed_on || ""}` : "Pending" }))} /></Card>
      </div>
    </div>
  );
}

function Collections({ s, pid }) {
  const { data } = useFetch(`/projects/${pid}/summary`);
  if (!data) return <Skeleton className="h-40 rounded-2xl" />;
  const o = data.outstanding;
  return (
    <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4" data-testid="collections-tab">
      {[["Agreement value", data.agreement_paise], ["Collected", data.paid_paise], ["Outstanding · Cash", o.cash_paise], ["Outstanding · Account", o.account_paise], ["Outstanding · Other charges", o.other_charges_paise], ["Collected this month", data.collections_mtd_paise], ["Overdue", data.overdue.amount_paise], ["Pending cheques", data.pending_cheques_paise]].map(([l, v]) => <Card key={l} className="!p-5"><p className="label">{l}</p><Money value={v / 100} className="mt-2 block text-2xl" /></Card>)}
    </div>
  );
}

function BookingsTab({ pid, customers }) {
  const { data } = useFetch(`/bookings?project_id=${pid}&page_size=100&include=customer,flat`);
  if (!data) return <Skeleton className="h-40 rounded-2xl" />;
  if (!data.items.length) return <EmptyState title={customers ? "No customers yet" : "No bookings yet"} description="Bookings connect buyers to this project's units." />;
  if (customers) { const seen = new Map(); data.items.forEach((b) => b.customer && !seen.has(b.customer.id) && seen.set(b.customer.id, { ...b.customer, flats: [] })); data.items.forEach((b) => b.customer && seen.get(b.customer.id).flats.push(b.flat?.flat_number)); return <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">{[...seen.values()].map((c) => <EntityCard key={c.id} to={`/customers/${c.id}`} title={c.full_name} subtitle={c.phone} status={c.lifecycle_stage} meta={c.flats.filter(Boolean).map((f) => `Unit ${f}`)} testId={`cust-card-${c.customer_code}`} />)}</div>; }
  return <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">{data.items.map((b) => <EntityCard key={b.id} to={`/bookings/${b.id}`} title={b.booking_number} subtitle={`${b.customer?.full_name || b.customer_name} · Unit ${b.flat?.flat_number || b.flat_snapshot?.flat_number}`} status={b.status} meta={[inrShort(b.agreement_value_paise / 100), b.block_name]} foot={<><span>Paid <Money value={(b.summary?.paid_paise || 0) / 100} short className="text-ink-950" /></span><span>Due <Money value={Math.max(b.summary?.due_paise || 0, 0) / 100} short className="text-brick" /></span></>} testId={`booking-card-${b.booking_number}`} />)}</div>;
}

export default function ProjectWorkspace() {
  const { id } = useParams();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get("tab") || "overview";
  const { can } = useAuth();
  const { data: p, loading, reload } = useFetch(`/projects/${id}`);
  const { data: s } = useFetch(`/projects/${id}/setup`);
  const { data: sum } = useFetch(`/projects/${id}/summary`);
  if (loading || !p || !s) return <div className="space-y-6"><Skeleton className="h-64 rounded-2xl" /><Skeleton className="h-10 w-1/2" /><Skeleton className="h-80 rounded-2xl" /></div>;
  const units = sum?.units;
  return (
    <div className="space-y-6" data-testid="project-workspace">
      <PageHero cover={p.cover_image_url} crumbs={[{ label: "Projects", to: "/projects" }, { label: p.name }]} eyebrow={p.project_type} title={p.name} subtitle={[p.address?.line1, p.address?.city].filter(Boolean).join(", ")} ring={sum?.progress_pct ?? 0}
        chips={<>{p.rera_number && <span className="pill pill-hero">RERA {p.rera_number}</span>}<HistoryButton entityType="project" entityId={p.id} label={p.code} /><span className="pill pill-hero">{s.towers.length} towers</span><StatusPill status={p.status} /></>}
        actions={<>{can("masters.project.edit") && <Link to={`/projects/${id}/setup`} className="btn btn-secondary !border-white/15 !bg-ink-800 !text-warm-50 hover:!bg-ink-700" data-testid="edit-setup-btn"><Pencil className="h-4 w-4" strokeWidth={1.75} />Edit setup</Link>}{can("sales.booking.create") && <Link to={`/bookings/new?project_id=${id}`} className="btn btn-gold" data-testid="new-booking-btn">New booking <ArrowUpRight className="h-4 w-4" strokeWidth={1.75} /></Link>}</>}
        stats={[{ label: "Units sold", value: `${(units?.by_status?.Booked || 0) + (units?.by_status?.Sold || 0)} / ${units?.total ?? "—"}`, hint: `${units?.available ?? "—"} available` }, { label: "Collected", value: inrShort((sum?.paid_paise || 0) / 100), hint: `${inrShort((sum?.collections_mtd_paise || 0) / 100)} this month` }, { label: "Outstanding", value: inrShort((sum?.outstanding?.total_paise || 0) / 100), hint: `${sum?.overdue?.count || 0} overdue`, tone: sum?.outstanding?.total_paise ? undefined : "sage" }, { label: "Upcoming stage", value: s.towers.map((t) => t.construction.next).find(Boolean) || "—", hint: s.towers.map((t) => `${t.name} ${t.construction.percent}%`).join(" · ") }]} testId="project-hero" />
      <Tabs tabs={TABS.map(([v, l]) => ({ value: v, label: l }))} value={tab} onChange={(v) => setSp({ tab: v })} testId="project-tabs" />
      <Suspense fallback={<Skeleton className="h-80 rounded-2xl" />}>
        {tab === "overview" && <Overview s={s} p={p} />}
        {tab === "towers" && <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">{s.towers.map((t) => <TowerCard key={t.id} t={t} pid={id} />)}</div>}
        {tab === "inventory" && <Card className="!p-4"><FlatsTable fixed={{ project_id: id }} blocks={p.blocks} /></Card>}
        {tab === "construction" && <Construction s={s} />}
        {tab === "plans" && <Card><PaymentPlanMatrix projectId={id} blocks={s.towers.map((t) => ({ id: t.id, name: t.name }))} /></Card>}
        {tab === "pricing" && <div className="space-y-6"><RateCardsTab projectId={id} onApplied={reload} /><ParkingTab projectId={id} /></div>}
        {tab === "customers" && <BookingsTab pid={id} customers />}
        {tab === "bookings" && <BookingsTab pid={id} />}
        {tab === "collections" && <Collections s={s} pid={id} />}
        {tab === "website" && <ProjectWebsiteTab projectId={id} slugDefault={p.code} />}
      </Suspense>
    </div>
  );
}
