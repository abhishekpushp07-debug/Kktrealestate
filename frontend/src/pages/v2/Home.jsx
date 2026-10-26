import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, ArrowRight, CalendarDays, FileWarning, PhoneCall, Receipt, Wallet } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useFetch } from "@/hooks/useList";
import { fmtDate, fmtRelative, inr, inrShort } from "@/lib/format";
import { Card, EmptyState, EntityCard, IconTile, Num, SegmentBar, Skeleton, SkeletonCards, StatTile, Timeline } from "@/components/v2";

const greet = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; };
const tip = { contentStyle: { borderRadius: 12, border: "1px solid #EAE4D8", boxShadow: "0 8px 24px rgba(20,16,8,.08)", fontSize: 12 }, formatter: (v) => inr(v) };

function Attention({ a }) {
  const rows = [
    ...a.overdue.map((d) => ({ tone: "brick", icon: FileWarning, title: `${d.customer_name || d.demand_number || "Customer"} · ${inrShort(d.balance_paise / 100)} overdue ${d.days} d`, sub: [d.installment_name || d.milestone_name, d.project_name].filter(Boolean).join(" · "), to: `/bookings/${d.booking_id}`, cta: "Open booking" })),
    ...a.bounced.map((p) => ({ tone: "brick", icon: Receipt, title: `${p.payment_mode_name} bounced · ${inrShort(p.amount_paise / 100)}`, sub: `${p.customer_name} · ${p.receipt_number}`, to: `/bookings/${p.booking_id}`, cta: "Follow up" })),
    ...a.unassigned.map((l) => ({ tone: "amber", icon: PhoneCall, title: `Unassigned enquiry · ${l.name}`, sub: `${l.source} · ${l.project_name || "—"} · ${fmtRelative(l.created_at)}`, to: `/leads`, cta: "Assign" })),
  ];
  if (!rows.length) return <EmptyState title="All clear" description="No overdue dues, bounced cheques or unassigned enquiries." icon={AlertTriangle} testId="attention-empty" />;
  return (
    <Card className="min-w-0 !p-0" testId="attention-list">
      <div className="flex items-center justify-between px-6 pt-5"><h3 className="font-display text-lg">Needs attention</h3><span className="pill bg-brick-50 text-brick">{rows.length}</span></div>
      <ul className="mt-4 divide-y divide-warm-100">{rows.slice(0, 8).map((r, i) => <li key={i} className="flex items-center gap-4 px-6 py-3"><IconTile icon={r.icon} tone={r.tone} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-ink-950">{r.title}</p><p className="truncate text-xs text-txt-secondary">{r.sub}</p></div><Link to={r.to} className="btn btn-secondary btn-sm shrink-0" data-testid={`attention-cta-${i}`}>{r.cta}</Link></li>)}</ul>
    </Card>
  );
}

export default function Home() {
  const { user } = useAuth();
  const { data, loading } = useFetch("/dashboard/home");
  const first = (user?.name || "").split(" ")[0];
  const t = data?.totals, c = data?.counts;
  return (
    <div className="space-y-8" data-testid="home-page">
      <header className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div><p className="label">{new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p><h1 className="mt-1 font-display text-4xl text-ink-950 md:text-[40px]" data-testid="home-greeting">{greet()}, {first}</h1></div>
        {data && <p className="text-xs text-txt-muted">Snapshot {fmtRelative(data.computed_at)}</p>}
      </header>
      {data && (c.followups_due > 0 || data.attention.overdue.length > 0) && <div className="notice" data-testid="home-notice"><AlertTriangle className="h-4 w-4 shrink-0 text-gold" strokeWidth={1.75} /><p className="text-sm text-ink-950">{[c.followups_due > 0 && `${c.followups_due} follow-up${c.followups_due > 1 ? "s" : ""} due`, data.attention.overdue.length > 0 && `${data.attention.overdue.length} overdue demand${data.attention.overdue.length > 1 ? "s" : ""}`].filter(Boolean).join(" · ")}</p><a href="#attention" className="ml-auto text-sm font-semibold text-ink-950 hover:text-gold">Review</a></div>}
      {data && (c?.projects ?? 1) === 0 && <Card className="!border-gold/50 !bg-gold-light/40" testId="home-first-run"><p className="label text-[#6b5410]">Welcome</p><h2 className="mt-1 font-display text-2xl text-ink-950">Set up your first project</h2><p className="mt-2 max-w-xl text-sm text-txt-secondary">Add towers, floor plans, construction stages and payment plans once — bookings, demands and the customer portal all flow from it.</p><div className="mt-4 flex flex-wrap gap-2"><Link to="/projects/new" className="btn btn-primary" data-testid="first-run-project">Start project setup</Link><Link to="/settings/catalogues" className="btn btn-secondary" data-testid="first-run-catalogues">Review catalogues</Link></div></Card>}
      <section className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4" data-testid="today-row">
        {loading ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />) : <>
          <StatTile label="Visits today" value={c.visits_today} hint={data.visits_today_list.slice(0, 2).map((v) => `${v.slot_start} ${v.name}`).join(" · ") || "No visits scheduled"} icon={CalendarDays} to="/site-visits" testId="tile-visits" />
          <StatTile label="Follow-ups due" value={c.followups_due} hint="Leads waiting for a call" icon={PhoneCall} iconTone={c.followups_due ? "brick" : undefined} to="/leads" testId="tile-followups" tone={c.followups_due ? "brick" : undefined} />
          <StatTile label="Cheques to clear" value={c.cheques_pending} hint={inrShort(t.pending_cheques_paise / 100) + " pending"} icon={Receipt} to="/payments?status=Pending" testId="tile-cheques" />
          <StatTile label="Collected this month" value={inrShort(t.collections_mtd_paise / 100)} hint={`${inrShort(t.outstanding_paise / 100)} outstanding${t.advance_paise ? ` · advance held ${inrShort(t.advance_paise / 100)}` : ""}`} icon={Wallet} iconTone="gold" testId="tile-collections" />
        </>}
      </section>
      <section>
        <div className="mb-4 flex items-center justify-between"><h2 className="font-display text-2xl">Projects</h2><Link to="/projects" className="flex items-center gap-1 text-sm font-semibold text-ink-950 hover:text-gold" data-testid="home-all-projects">All projects <ArrowRight className="h-4 w-4" /></Link></div>
        {loading ? <SkeletonCards n={2} /> : <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3" data-testid="projects-strip">{data.projects.map((p) => <EntityCard key={p.project_id} to={`/projects/${p.project_id}`} cover={p.cover_image_url || null} initialsOf={p.name} title={p.name} subtitle={[p.city, `${p.towers} towers · ${p.units.total} units`].filter(Boolean).join(" · ")} status={p.status} progress={p.progress_pct} counts={p.units.by_status} money={[{ label: "Collected", value: p.paid_paise / 100 }, { label: "Outstanding", value: p.outstanding.total_paise / 100, tone: p.outstanding.total_paise ? "brick" : "sage" }]} testId={`project-card-${p.code}`} />)}</div>}
      </section>
      <section className="grid gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-3" testId="collections-chart">
          <div className="flex items-center justify-between"><h3 className="font-display text-lg">Collections · last 12 months</h3><div className="flex gap-3 text-xs text-txt-secondary"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-ink-950" />Account</span><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-gold" />Cash</span></div></div>
          <div className="mt-4 h-60 min-w-0">{loading ? <Skeleton className="h-full" /> : <ResponsiveContainer width="100%" height="100%"><BarChart data={data.collections_12m} barSize={18}><CartesianGrid vertical={false} stroke="#EAE4D8" /><XAxis dataKey="month" tickFormatter={(m) => new Date(m + "-01").toLocaleDateString("en-IN", { month: "short" })} tick={{ fontSize: 11, fill: "#8A8F9A" }} axisLine={false} tickLine={false} /><YAxis tickFormatter={(v) => inrShort(v)} tick={{ fontSize: 11, fill: "#8A8F9A" }} axisLine={false} tickLine={false} width={52} /><Tooltip {...tip} /><Bar dataKey="Account" stackId="a" fill="#0A0C10" radius={[0, 0, 4, 4]} /><Bar dataKey="Cash" stackId="a" fill="#C9A227" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>}</div>
        </Card>
        <Card className="xl:col-span-2" testId="ageing-card">
          <h3 className="font-display text-lg">Due ageing</h3>
          <p className="mt-1 text-xs text-txt-secondary">Open demand balances by days overdue</p>
          <div className="mt-4">{loading ? <Skeleton className="h-24" /> : <SegmentBar segments={[["Not due", "not_due", "#5B6B85"], ["0–30 days", "d0_30", "#C9A227"], ["31–60 days", "d31_60", "#B7791F"], ["61–90 days", "d61_90", "#C9654A"], ["90+ days", "d90", "#B4423A"]].map(([label, k, color]) => ({ label, color, value: data.ageing_paise[k] / 100, count: data.ageing_counts?.[k] }))} />}</div>
          {!loading && Object.values(data.ageing_paise).some(Boolean) && <p className="mt-4 border-t border-warm-100 pt-4 font-display text-2xl"><Num s={inr(Object.values(data.ageing_paise).reduce((a, b) => a + b, 0) / 100)} /> <span className="font-sans text-xs text-txt-muted">total open</span></p>}
        </Card>
      </section>
      <section className="grid gap-6 xl:grid-cols-5" id="attention">
        <div className="min-w-0 xl:col-span-3">{loading ? <Skeleton className="h-64 rounded-2xl" /> : <Attention a={data.attention} />}</div>
        <Card className="xl:col-span-2" testId="recent-activity">
          <h3 className="font-display text-lg">Recent activity</h3>
          <div className="mt-5">{loading ? <Skeleton className="h-48" /> : <Timeline items={data.recent.map((r) => ({ id: r.id, tone: r.action.startsWith("payment") ? "sage" : r.action.startsWith("stage") ? "gold" : undefined, title: r.action.replace(".", " · ").replace(/_/g, " "), subtitle: `${r.user_name || "System"} · ${fmtDate(r.created_at)} · ${Object.values(r.after || {}).slice(0, 2).join(" · ")}` }))} />}</div>
        </Card>
      </section>
    </div>
  );
}
