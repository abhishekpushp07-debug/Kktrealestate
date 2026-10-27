/* eslint-disable react/no-array-index-key -- fixed-length skeleton placeholders (never reordered) */
import { useState } from "react";
import { Link } from "react-router-dom";
import { FileSignature, Plus, Search } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useFetch, useList } from "@/hooks/useList";
import { cn } from "@/lib/utils";
import { fmtDate } from "@/lib/format";
import { Card, EmptyState, Money, Skeleton, StatusPill } from "@/components/v2";
import { Select } from "@/components/v2/Select";
import { Avatar } from "@/components/v2/CustomerBits";

const STATUSES = ["Active", "Completed", "Cancelled"];

export function BookingTile({ b }) {
  const s = b.summary || {}, paid = s.paid_paise || 0, agr = b.agreement_value_paise || 1;
  return (
    <Link to={`/bookings/${b.id}`} className="block h-full" data-testid={`booking-card-${b.booking_number}`}>
      <Card hover className="flex h-full flex-col !p-5">
        <div className="flex items-start gap-3">
          <Avatar name={b.customer_name} size={40} />
          <div className="min-w-0 flex-1"><p className="truncate font-display text-base font-semibold text-ink-950">{b.customer_name}</p><p className="truncate text-xs text-txt-secondary">{b.booking_number} · {fmtDate(b.booking_date)}</p></div>
          <StatusPill status={b.status} />
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5"><span className="pill bg-ink-950 text-warm-50">{b.flat_snapshot?.flat_number}</span><span className="pill bg-warm-100 text-txt-secondary">{b.project_code} · {b.block_code || b.block_name}</span>{b.flat_snapshot?.flat_type_code && <span className="pill bg-warm-100 text-txt-secondary">{b.flat_snapshot.flat_type_code}</span>}{b.payment_plan_name && <span className="pill bg-warm-100 text-txt-secondary">{b.payment_plan_name}</span>}</div>
        <div className="mt-4"><div className="flex items-center justify-between text-xs text-txt-secondary"><span>Agreement <Money value={agr / 100} short className="text-ink-950" /></span><span className="font-semibold text-ink-950">{Math.round((paid / agr) * 100)}% paid</span></div><div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-warm-100"><span className="block h-full rounded-full bg-sage" style={{ width: `${Math.min(100, (paid / agr) * 100)}%` }} /></div></div>
        <div className="mt-4 grid grid-cols-3 gap-2 border-t border-warm-100 pt-3">{[["Cash due", s.cash_due_paise], ["Account due", s.account_due_paise], ["Charges due", s.other_charges_due_paise]].map(([l, v]) => <div key={l}><p className="text-[11px] font-semibold text-txt-secondary">{l}</p><Money value={Math.max(v || 0, 0) / 100} short className={cn("text-base", v > 0 ? "text-brick" : "text-sage")} /></div>)}</div>
      </Card>
    </Link>
  );
}

export default function Bookings() {
  const { can } = useAuth();
  const [f, setF] = useState({ status: "Active", project_id: null });
  const list = useList("/bookings", { status: f.status || undefined, project_id: f.project_id || undefined }, { sort: "-booking_date", pageSize: 24 });
  const { data: projects } = useFetch("/projects?page_size=100&with_total=false");
  const pages = Math.max(1, Math.ceil((list.total || 0) / list.pageSize));
  return (
    <div className="space-y-8" data-testid="bookings-page">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div><p className="label">Sales</p><h1 className="mt-1 font-display text-4xl text-ink-950">Bookings <span className="text-txt-muted">· {list.total ?? ""}</span></h1></div>
        {can("sales.booking.create") && <Link to="/bookings/new" className="btn btn-primary" data-testid="new-booking-btn"><Plus className="h-4 w-4" strokeWidth={1.75} />New booking</Link>}
      </header>
      <section className="flex flex-col gap-3 md:flex-row md:items-center" data-testid="booking-filters">
        <label className="relative flex-1"><Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-txt-muted" strokeWidth={1.75} /><input value={list.search} onChange={(e) => list.setSearch(e.target.value)} placeholder="Booking no., customer, flat…" className="input !pl-10" data-testid="booking-search" /></label>
        <Select options={(projects?.items || []).map((p) => ({ value: p.id, label: p.name, sub: p.code }))} value={f.project_id} onChange={(v) => setF({ ...f, project_id: v })} placeholder="All projects" allowAdd={false} className="w-56" testId="filter-project" />
        <div className="flex gap-1.5">{["", ...STATUSES].map((s) => <button key={s} onClick={() => setF({ ...f, status: s })} className={cn("pill border transition-colors", f.status === s ? "border-ink-950 bg-ink-950 text-warm-50" : "border-warm-200 bg-white text-txt-secondary hover:border-gold")} data-testid={`chip-status-${(s || "all").toLowerCase()}`}>{s || "All"}</button>)}</div>
      </section>
      {list.loading && list.items.length === 0 ? <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-56 rounded-2xl" />)}</div> : list.items.length === 0 ? <EmptyState icon={FileSignature} title="No bookings" description="Bookings appear here once a unit is sold." testId="bookings-empty" /> : (
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3" data-testid="bookings-grid">{list.items.map((b) => <BookingTile key={b.id} b={b} />)}</div>
      )}
      {pages > 1 && <div className="flex items-center justify-center gap-2" data-testid="bookings-pager"><button disabled={list.page <= 1} onClick={() => list.setPage(list.page - 1)} className="btn btn-secondary btn-sm">Previous</button><span className="text-xs text-txt-secondary">Page {list.page} of {pages}</span><button disabled={list.page >= pages} onClick={() => list.setPage(list.page + 1)} className="btn btn-secondary btn-sm">Next</button></div>}
    </div>
  );
}
