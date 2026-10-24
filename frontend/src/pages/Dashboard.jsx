import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Building2, CircleDollarSign, Grid3X3, PauseCircle, History } from "lucide-react";
import { useFetch } from "@/hooks/useList";
import { useAuth } from "@/context/AuthContext";
import { inr, inrShort, fmtDateTime, fmtRelative } from "@/lib/format";
import { PageHeader, StatCard, EmptyState } from "@/components/common/Bits";
import { RoleWidgets } from "@/components/common/RoleWidgets";
import { StatusChip, Pill } from "@/components/common/StatusChip";
import { Skeleton } from "@/components/ui/skeleton";
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip, Legend } from "recharts";
import { TodayVisitsWidget } from "@/pages/SiteVisits";
import { BrochureLeadsWidget } from "@/components/common/BrochureStats";

const STATUS_HEX = { Available: "#10B981", Hold: "#F59E0B", Booked: "#0B1F3A", Sold: "#C9A227", Blocked: "#94A3B8" };

function Charts({ data }) {
  const inv = data.inventory;
  const donut = ["Available", "Hold", "Booked", "Sold", "Blocked"].map((s) => ({ name: s, value: inv[s] || 0 })).filter((d) => d.value);
  const bars = data.projects.map((p) => ({ name: p.code, Available: p.inventory.Available, Hold: p.inventory.Hold, Blocked: p.inventory.Blocked, Booked: p.inventory.Booked + p.inventory.Sold }));
  const [ready, setReady] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setReady(true)); return () => cancelAnimationFrame(id); }, []);
  if (!ready) return <div className="mt-6 grid gap-4 lg:grid-cols-2" data-testid="dashboard-charts"><div className="card-elev h-72 p-5" /><div className="card-elev h-72 p-5" /></div>;
  return (
    <div className="mt-6 grid gap-4 lg:grid-cols-2" data-testid="dashboard-charts">
      <div className="card-elev p-5"><h2 className="mb-2 text-base font-bold text-navy">Inventory by status</h2>
        <div className="relative h-56 min-w-0"><ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 220 }}><PieChart><Pie data={donut} dataKey="value" nameKey="name" innerRadius={62} outerRadius={88} paddingAngle={2} minAngle={6} isAnimationActive={false} stroke="#fff">{donut.map((d) => <Cell key={d.name} fill={STATUS_HEX[d.name]} />)}</Pie><RTooltip /></PieChart></ResponsiveContainer><div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><span className="text-2xl font-bold tabular text-navy">{donut.reduce((a, d) => a + d.value, 0)}</span><span className="label-xs">units</span></div></div>
        <div className="flex flex-wrap justify-center gap-3 text-xs">{donut.map((d) => <span key={d.name} className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_HEX[d.name] }} />{d.name} <b>{d.value}</b></span>)}</div>
      </div>
      <div className="card-elev p-5"><h2 className="mb-2 text-base font-bold text-navy">Units per project</h2>
        <div className="h-64 min-w-0"><ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 220 }}><BarChart data={bars} layout="vertical" margin={{ left: 8, right: 32, top: 8, bottom: 8 }} barSize={22}><XAxis type="number" allowDecimals={false} tick={{ fontSize: 12, fill: "#3C4A5E" }} /><YAxis type="category" dataKey="name" width={70} tick={{ fontSize: 12, fill: "#0B1F3A", fontWeight: 600 }} /><RTooltip cursor={{ fill: "#F7F5EF" }} /><Legend verticalAlign="top" align="right" iconType="circle" wrapperStyle={{ fontSize: 12, paddingBottom: 8 }} /><Bar dataKey="Available" stackId="a" fill={STATUS_HEX.Available} /><Bar dataKey="Hold" stackId="a" fill={STATUS_HEX.Hold} /><Bar dataKey="Booked" stackId="a" fill={STATUS_HEX.Booked} /><Bar dataKey="Blocked" stackId="a" fill={STATUS_HEX.Blocked} radius={[0, 4, 4, 0]} label={{ position: "right", fontSize: 12, fill: "#0B1F3A", formatter: (v) => v || "" }} /></BarChart></ResponsiveContainer></div>
      </div>
    </div>
  );
}

function StatusBar({ inv }) {
  const t = inv.total || 1;
  const seg = [["Available", "bg-emerald-500"], ["Hold", "bg-amber-500"], ["Booked", "bg-navy"], ["Sold", "bg-gold"], ["Blocked", "bg-slate-400"]];
  return <div className="flex h-2 w-full gap-px overflow-hidden rounded-full bg-slate-100">{seg.map(([k, c]) => inv[k] ? <div key={k} className={c} style={{ width: `${(inv[k] / t) * 100}%`, minWidth: 6 }} title={`${k}: ${inv[k]}`} /> : null)}</div>;
}

function Collections({ c }) {
  return (
    <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4" data-testid="collections-widget">
      <StatCard label="Collected today" value={inr(c.today.total)} hint={`Cash ${inr(c.today.Cash)} · Account ${inr(c.today.Account)}`} accent="green" testId="collections-today" />
      <StatCard label="Collected this month" value={inr(c.month.total)} hint={`${c.month.count} receipts · Cash ${inr(c.month.Cash)} · Account ${inr(c.month.Account)}`} accent="gold" testId="collections-month" />
      <StatCard label="Cheques in hand" value={inr(c.pending_cheques.amount)} hint={`${c.pending_cheques.count} pending realisation`} accent="amber" />
      {c.dues_raised_month && <StatCard label="Dues raised this month" value={inr(c.dues_raised_month.total)} hint={`${c.dues_raised_month.count} installment(s) · paid ${inr(c.dues_raised_month.paid)}`} accent="amber" testId="dues-raised-month" />}
      {c.upcoming_installments && <StatCard label="Upcoming installments (30d)" value={inr(c.upcoming_installments.reduce((a, x) => a + (x.total || 0), 0))} hint={`${c.upcoming_installments.length} installment(s) expected · next: ${c.upcoming_installments[0] ? `${c.upcoming_installments[0].booking_number} ${c.upcoming_installments[0].installment}` : "—"}`} accent="green" testId="upcoming-installments" />}
      <StatCard label="Outstanding dues" value={inr(c.outstanding_due)} hint={`${c.overdue_demands} overdue demand(s) · ${c.active_bookings} active bookings`} accent="navy" testId="collections-due" />
    </div>
  );
}

export default function Dashboard() {
  const { data, loading } = useFetch("/dashboard");
  const { user, can } = useAuth();
  const inv = data?.inventory || {};
  return (
    <div data-testid="dashboard-page">
      <PageHeader title={`Namaste, ${user?.name?.split(" ")[0]}`} subtitle="Here is your inventory at a glance." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {loading ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />) : <>
          <StatCard label="Total Units" value={inv.total} hint={`${data?.projects?.length || 0} projects · ${data?.blocks?.length || 0} blocks`} icon={Grid3X3} testId="stat-total" />
          <StatCard label="Available" value={inv.Available} hint={`${inv.Blocked || 0} blocked`} icon={Building2} accent="green" testId="stat-available" />
          <StatCard label="On Hold" value={inv.Hold} hint={`${(inv.Booked || 0) + (inv.Sold || 0)} booked/sold`} icon={PauseCircle} accent="amber" testId="stat-hold" />
          <StatCard label="Inventory Value" value={inrShort(inv.inventory_value)} hint="Sum of listed prices" icon={CircleDollarSign} accent="gold" testId="stat-value" />
        </>}
      </div>
      {data && <Charts data={data} />}
      <RoleWidgets />
      <TodayVisitsWidget />
      <BrochureLeadsWidget />
      {data?.collections && <Collections c={data.collections} />}
      {data?.follow_ups_due && data.follow_ups_due.count > 0 && <div className="card-elev mt-6 p-5" data-testid="followups-widget"><div className="mb-3 flex items-center justify-between"><h2 className="text-base font-bold text-navy md:text-lg">Follow-ups due today</h2><Link to="/leads" className="text-xs font-semibold text-gold-hover hover:underline">Open pipeline</Link></div><div className="grid gap-2 md:grid-cols-3">{data.follow_ups_due.items.map((l) => <Link key={l.id} to="/leads" className="rounded-lg border bg-white p-3 text-sm hover:border-navy"><p className="font-semibold text-navy">{l.name}</p><p className="text-xs text-slate-500">{l.phone} · {l.status}</p></Link>)}</div></div>}
      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <div className="card-elev p-5 xl:col-span-2" data-testid="dashboard-projects">
          <div className="mb-4 flex items-center justify-between"><h2 className="text-base font-bold text-navy md:text-lg">Projects overview</h2><Link to="/projects" className="text-xs font-semibold text-gold-hover hover:underline">View all</Link></div>
          {loading ? <Skeleton className="h-32" /> : data?.projects?.length === 0 ? <EmptyState title="No projects yet" description="Create your first project to begin generating inventory." /> : (
            <div className="space-y-3">
              {data?.projects?.map((p) => (
                <Link to={`/projects/${p.id}`} key={p.id} className="block rounded-lg border border-slate-100 p-4 transition-colors hover:border-gold/60 hover:bg-gold-light/30" data-testid={`dashboard-project-${p.code}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-3"><span className="rounded bg-navy px-2 py-0.5 text-[11px] font-bold text-gold">{p.code}</span><span className="font-bold text-navy">{p.name}</span><Pill tone="slate">{p.status}</Pill></div>
                    <div className="text-right"><p className="text-sm font-bold tabular text-navy">{inrShort(p.inventory_value)}</p><p className="text-[11px] text-slate-500">{p.inventory.total} units</p></div>
                  </div>
                  <div className="mt-3"><StatusBar inv={p.inventory} /></div>
                  <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-500">{["Available", "Hold", "Blocked", "Booked", "Sold"].map((s) => <span key={s}><b className="text-navy">{p.inventory[s]}</b> {s}</span>)}</div>
                </Link>
              ))}
            </div>
          )}
          <h2 className="mb-3 mt-8 text-base font-bold text-navy md:text-lg">Blocks progress</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {data?.blocks?.map((b) => (
              <Link to={`/blocks/${b.id}`} key={b.id} className="rounded-lg border border-slate-100 p-3 hover:border-gold/60" data-testid={`dashboard-block-${b.code}`}>
                <div className="flex items-center justify-between"><p className="text-sm font-bold text-navy">{b.name}</p><span className="text-[11px] text-slate-500">{b.project_name}</span></div>
                <div className="mt-2 flex items-center gap-2"><div className="h-1.5 flex-1 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-gold" style={{ width: `${b.construction_percent}%` }} /></div><span className="text-[11px] font-semibold tabular text-slate-600">{b.construction_percent}%</span></div>
                <p className="mt-1.5 text-[11px] text-slate-500">{b.inventory.total} units · {b.inventory.Available} available · {b.floors} floors</p>
              </Link>
            ))}
          </div>
        </div>
        <div className="card-elev p-5" data-testid="dashboard-audit">
          <div className="mb-4 flex items-center justify-between"><h2 className="text-base font-bold text-navy md:text-lg">Recent activity</h2>{can("audit.view") && <Link to="/audit" className="text-xs font-semibold text-gold-hover hover:underline">Audit log</Link>}</div>
          {!can("audit.view") ? <EmptyState icon={History} title="Audit access restricted" description="Your role does not include audit.view." /> : (
            <ol className="relative space-y-4 border-l border-slate-200 pl-4">
              {data?.recent_audit?.map((a) => (
                <li key={a.id} className="relative text-sm">
                  <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-gold" />
                  <p className="font-semibold text-navy">{a.action}</p>
                  <p className="text-xs text-slate-500">{a.actor_name} · {a.entity_type} · <span title={fmtDateTime(a.created_at)}>{fmtRelative(a.created_at)}</span></p>
                </li>
              ))}
            </ol>
          )}
          <div className="mt-6 border-t border-slate-100 pt-4"><p className="label-xs mb-2">Status legend</p><div className="flex flex-wrap gap-1.5">{["Available", "Hold", "Booked", "Sold", "Blocked"].map((s) => <StatusChip key={s} status={s} />)}</div></div>
        </div>
      </div>
    </div>
  );
}
