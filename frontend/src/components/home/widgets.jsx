import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, ArrowRight, CalendarDays, FileWarning, PhoneCall, Receipt, Wallet } from "lucide-react";
import { useFetch } from "@/hooks/useList";
import { fmtDate, fmtRelative, inr, inrShort } from "@/lib/format";
import { Card, EmptyState, EntityCard, IconTile, Num, SegmentBar, Skeleton, SkeletonCards, StatTile, Timeline } from "@/components/v2";
import { TrendSpark, monthLabel } from "@/components/common/TrendSpark";
import { TowerSalesWidget } from "@/components/common/TowerSalesChart";

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
      <ul className="mt-4 divide-y divide-warm-100">{rows.slice(0, 8).map((r, i) => <li key={r.id || `${r.title}-${r.at}`} className="flex items-center gap-4 px-6 py-3"><IconTile icon={r.icon} tone={r.tone} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-ink-950">{r.title}</p><p className="truncate text-xs text-txt-secondary">{r.sub}</p></div><Link to={r.to} className="btn btn-secondary btn-sm shrink-0" data-testid={`attention-cta-${i}`}>{r.cta}</Link></li>)}</ul>
    </Card>
  );
}


const W = {
  tower_sales: ({ data, size }) => <TowerSalesWidget projects={data?.projects || []} size={size} />,
  today: ({ data, loading, c, t }) => (
      <section className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4" data-testid="today-row">
        {loading ? Array.from({ length: 4 }, (_, n) => n).map((n) => <Skeleton key={n} className="h-28 rounded-2xl" />) : <>
          <StatTile label="Visits today" value={c.visits_today} hint={data.visits_today_list.slice(0, 2).map((v) => `${v.slot_start} ${v.name}`).join(" · ") || "No visits scheduled"} icon={CalendarDays} to="/site-visits" testId="tile-visits" />
          <StatTile label="Follow-ups due" value={c.followups_due} hint="Leads waiting for a call" icon={PhoneCall} iconTone={c.followups_due ? "brick" : undefined} to="/leads" testId="tile-followups" tone={c.followups_due ? "brick" : undefined} />
          <StatTile label="Cheques to clear" value={c.cheques_pending} hint={inrShort(t.pending_cheques_paise / 100) + " pending"} icon={Receipt} to="/payments?status=Pending" testId="tile-cheques" />
          <StatTile label="Collected this month" value={inrShort(t.collections_mtd_paise / 100)} hint={`${inrShort(t.outstanding_paise / 100)} outstanding${t.advance_paise ? ` · advance held ${inrShort(t.advance_paise / 100)}` : ""}`} icon={Wallet} iconTone="gold" testId="tile-collections" />
        </>}
      </section>
  ),
  trends: ({ trends }) => trends && (
      <section className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4" data-testid="trend-row">
        {[["Collected", "collections", true, (m) => `/reports/collections-v2?date_from=${m}-01&date_to=${m}-31`, "tile-trend-collected"], ["Outstanding (month end)", "outstanding_eom", true, (m) => `/reports/outstanding-v2?date_to=${m}-31`, "tile-trend-outstanding"], ["Demands raised", "demands", true, (m) => `/demands?basis=raised&date_from=${m}-01&date_to=${m}-31`, "tile-trend-demands"], ["Bookings", "bookings", false, (m) => `/bookings?date_from=${m}-01&date_to=${m}-31`, "tile-trend-bookings"]].map(([label, k, money, link, tid]) => {
          const v = trends[k] || [], last = v[v.length - 1] || 0, prev = v[v.length - 2] || 0, delta = prev ? Math.round(((last - prev) / prev) * 100) : null;
          return <Card key={k} className="flex items-center justify-between gap-4 !p-5" testId={tid}><div className="min-w-0"><p className="stat-label">{label} · {monthLabel(trends.months[trends.months.length - 1])}</p><p className="stat-value font-display text-ink-950">{money ? inrShort(last / 100) : last}</p><p className="stat-hint">{delta == null ? "12-month trend" : `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta)}% vs ${monthLabel(trends.months[trends.months.length - 2])}`}</p></div><TrendSpark months={trends.months} values={v} money={money} label={label} linkFor={link} testId={`${tid}-spark`} /></Card>;
        })}
      </section>
  ),
  projects: ({ data, loading }) => (
      <section>
        <div className="mb-4 flex items-center justify-between"><h2 className="font-display text-2xl">Projects</h2><Link to="/projects" className="flex items-center gap-1 text-sm font-semibold text-ink-950 hover:text-gold" data-testid="home-all-projects">All projects <ArrowRight className="h-4 w-4" /></Link></div>
        {loading ? <SkeletonCards n={2} /> : <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3" data-testid="projects-strip">{data.projects.map((p) => <EntityCard key={p.project_id} to={`/projects/${p.project_id}`} cover={p.cover_image_url || null} initialsOf={p.name} title={p.name} subtitle={[p.city, `${p.towers} towers · ${p.units.total} units`].filter(Boolean).join(" · ")} status={p.status} progress={p.progress_pct} counts={p.units.by_status} money={[{ label: "Collected", value: p.paid_paise / 100 }, { label: "Outstanding", value: p.outstanding.total_paise / 100, tone: p.outstanding.total_paise ? "brick" : "sage" }]} testId={`project-card-${p.code}`} />)}</div>}
      </section>
  ),
  collections_chart: ({ data, loading }) => (
        <Card className="xl:col-span-3" testId="collections-chart">
          <div className="flex items-center justify-between"><h3 className="font-display text-lg">Collections · last 12 months</h3><div className="flex gap-3 text-xs text-txt-secondary"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-ink-950" />Account</span><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-gold" />Cash</span></div></div>
          <div className="mt-4 h-60 min-w-0">{loading ? <Skeleton className="h-full" /> : <ResponsiveContainer width="100%" height="100%"><BarChart data={data.collections_12m} barSize={18}><CartesianGrid vertical={false} stroke="#EAE4D8" /><XAxis dataKey="month" tickFormatter={(m) => new Date(m + "-01").toLocaleDateString("en-IN", { month: "short" })} tick={{ fontSize: 11, fill: "#8A8F9A" }} axisLine={false} tickLine={false} /><YAxis tickFormatter={(v) => inrShort(v)} tick={{ fontSize: 11, fill: "#8A8F9A" }} axisLine={false} tickLine={false} width={52} /><Tooltip {...tip} /><Bar dataKey="Account" stackId="a" fill="#0A0C10" radius={[0, 0, 4, 4]} /><Bar dataKey="Cash" stackId="a" fill="#C9A227" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>}</div>
        </Card>
  ),
  ageing: ({ data, loading }) => (
        <Card className="xl:col-span-2" testId="ageing-card">
          <h3 className="font-display text-lg">Due ageing</h3>
          <p className="mt-1 text-xs text-txt-secondary">Open demand balances by days overdue</p>
          <div className="mt-4">{loading ? <Skeleton className="h-24" /> : <SegmentBar segments={[["Not due", "not_due", "#5B6B85"], ["0–30 days", "d0_30", "#C9A227"], ["31–60 days", "d31_60", "#B7791F"], ["61–90 days", "d61_90", "#C9654A"], ["90+ days", "d90", "#B4423A"]].map(([label, k, color]) => ({ label, color, value: data.ageing_paise[k] / 100, count: data.ageing_counts?.[k] }))} />}</div>
          {!loading && Object.values(data.ageing_paise).some(Boolean) && <p className="mt-4 border-t border-warm-100 pt-4 font-display text-2xl"><Num s={inr(Object.values(data.ageing_paise).reduce((a, b) => a + b, 0) / 100)} /> <span className="font-sans text-xs text-txt-muted">total open</span></p>}
        </Card>
  ),
  attention: ({ data, loading }) => (
        <div className="min-w-0">{loading ? <Skeleton className="h-64 rounded-2xl" /> : <Attention a={data.attention} />}</div>
  ),
  activity: ({ data, loading }) => (
        <Card className="xl:col-span-2" testId="recent-activity">
          <h3 className="font-display text-lg">Recent activity</h3>
          <div className="mt-5">{loading ? <Skeleton className="h-48" /> : <Timeline items={data.recent.map((r) => ({ id: r.id, tone: r.action.startsWith("payment") ? "sage" : r.action.startsWith("stage") ? "gold" : undefined, title: r.action.replace(".", " · ").replace(/_/g, " "), subtitle: `${r.user_name || "System"} · ${fmtDate(r.created_at)} · ${Object.values(r.after || {}).slice(0, 2).join(" · ")}` }))} />}</div>
        </Card>
  ),
};

/** Home widget registry — each entry renders one Home section; order/size/visibility come from /me/home-layout. */
export function HomeWidget({ id, ...props }) {
  const C = W[id];
  return C ? <C {...props} /> : null;
}
