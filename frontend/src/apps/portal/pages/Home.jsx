import { Link } from "react-router-dom";
import { ArrowRight, Download, FileText, HardHat, LifeBuoy, Phone, RefreshCw, Wallet } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { usePortalAuth } from "../PortalAuth";
import { Empty, Skeleton, useBase } from "../PortalShell";
import { fmtDate, inrShort, useActiveBooking, useRefresh } from "../hooks";
import papi, { openPdf } from "../api";

export function BookingSwitcher({ items, active, select }) {
  if (items.length < 2) return null;
  return <div className="mb-4 flex gap-2 overflow-x-auto pb-1 fade-up" data-testid="booking-switcher">{items.map((b) => <button key={b.id} onClick={() => select(b.id)} className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${active?.id === b.id ? "bg-[#0B1F3A] text-white" : "bg-white text-slate-600"}`} data-testid={`switch-booking-${b.booking_number}`}>{b.flat_number} · {b.block_name}</button>)}</div>;
}

export default function Home() {
  const { me } = usePortalAuth();
  const base = useBase();
  const { items, active, select, isLoading } = useActiveBooking();
  const { data: notices } = useQuery({ queryKey: ["p-notices"], queryFn: () => papi.get("/notices").then((r) => r.data), staleTime: 60_000 });
  const { data: reqs } = useQuery({ queryKey: ["p-requests"], queryFn: () => papi.get("/service-requests").then((r) => r.data.items), staleTime: 30_000 });
  const { busy, refresh } = useRefresh([["p-bookings"], ["p-notices"], ["p-requests"]]);
  if (isLoading) return <div className="space-y-4"><Skeleton h={40} /><Skeleton h={200} /><Skeleton h={120} /></div>;
  if (!active) return <Empty title="No booking linked yet" hint="Once your booking is confirmed it will appear here." icon={FileText} />;
  const paidPct = Math.min(100, Math.round((active.paid / active.agreement_value) * 100) || 0);
  const pinned = (notices?.items || []).filter((n) => n.pinned || !n.read).slice(0, 1);
  const openReqs = (reqs || []).filter((r) => !["Closed"].includes(r.status)).length;
  return (
    <div data-testid="portal-home">
      <div className="mb-4 flex items-start justify-between gap-3 fade-up">
        <div><p className="text-sm text-slate-500">{new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 17 ? "Good afternoon" : "Good evening"},</p><h1 className="serif text-3xl font-semibold text-[#0B1F3A] sm:text-4xl" data-testid="home-greeting">{me?.customer?.full_name}</h1></div>
        <button onClick={refresh} className="grid h-11 w-11 place-items-center rounded-full bg-white shadow-sm" aria-label="Refresh" data-testid="home-refresh"><RefreshCw className={`h-4 w-4 text-[#0B1F3A] ${busy ? "animate-spin" : ""}`} /></button>
      </div>
      <BookingSwitcher items={items} active={active} select={select} />
      <Link to={`${base}/flat/${active.id}`} className="pcard-navy relative block overflow-hidden p-5 fade-up" data-testid="home-flat-card">
        {active.cover_image && <img src={active.cover_image} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover opacity-20" />}
        <div className="relative">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#C9A227]">{active.project_name}</p>
          <p className="serif mt-1 text-3xl font-semibold">Flat {active.flat_number}</p>
          <p className="text-sm text-slate-300">{active.block_name} · Floor {active.floor} · {active.flat_type} · {active.super_builtup_sqft} sq.ft.{active.is_primary ? "" : " · Co-applicant"}</p>
          <div className="mt-5 flex items-center gap-4"><div className="ring" style={{ "--v": active.construction_percent }}><span>{active.construction_percent}%</span></div><div><p className="text-xs text-slate-300">Construction</p><p className="font-semibold">{active.current_milestone || "Starting soon"}</p>{active.next_milestone && <p className="text-xs text-slate-400">Up next: {active.next_milestone}</p>}</div><ArrowRight className="ml-auto h-5 w-5 text-[#C9A227]" /></div>
        </div>
      </Link>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="pcard p-5 fade-up" data-testid="home-payment-summary">
          <div className="flex items-center justify-between"><p className="font-bold text-[#0B1F3A]">Payments</p><Link to={`${base}/payments`} className="text-xs font-bold text-[#C9A227]">View all</Link></div>
          <p className="serif mt-2 text-3xl font-semibold text-[#0B1F3A]">{inrShort(active.paid)} <span className="text-base text-slate-400">of {inrShort(active.agreement_value)}</span></p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#F8F6F1]"><div className="h-full rounded-full bg-[#C9A227] transition-[width] duration-700" style={{ width: `${paidPct}%` }} /></div>
          <div className="mt-3 flex justify-between text-sm"><span className="text-slate-500">Total due</span><span className="font-bold text-[#0B1F3A]" data-testid="home-total-due">{inrShort(active.total_due)}</span></div>
          {active.pending_cheques > 0 && <p className="mt-1 text-xs text-amber-700">Cheques pending clearance: {inrShort(active.pending_cheques)}</p>}
        </div>
        <div className="pcard p-5 fade-up" data-testid="home-next-due">
          <p className="font-bold text-[#0B1F3A]">Next due</p>
          {active.next_due ? <><p className="serif mt-2 text-3xl font-semibold text-[#0B1F3A]">{inrShort(active.next_due.amount)}</p><p className="text-sm text-slate-500">{active.next_due.milestone} · due {fmtDate(active.next_due.due_date)}</p><Link to={`${base}/payments?tab=demands`} className="pbtn pbtn-sm pbtn-gold mt-4">View demand</Link></> : <><p className="mt-2 text-sm text-slate-500">No open demands. You're all caught up.</p><button onClick={() => openPdf(`/bookings/${active.id}/statement.pdf`, `statement-${active.booking_number}.pdf`)} className="pbtn pbtn-sm pbtn-ghost mt-4" data-testid="home-statement-pdf"><Download className="h-4 w-4" />Statement PDF</button></>}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3 fade-up">
        {[["Construction", HardHat, `${base}/construction`], ["Documents", FileText, `${base}/documents`], ["Requests", LifeBuoy, `${base}/requests`]].map(([l, I, to]) => <Link key={l} to={to} className="pcard flex flex-col items-center gap-2 py-4 text-xs font-bold text-[#0B1F3A]" data-testid={`home-quick-${l.toLowerCase()}`}><I className="h-5 w-5 text-[#C9A227]" />{l}{l === "Requests" && openReqs > 0 && <span className="pchip bg-[#FFF9E6] text-[#8a6d12]">{openReqs} open</span>}</Link>)}
      </div>
      {pinned.map((n) => <Link key={n.id} to={`${base}/notices`} className="pcard mt-4 block border-l-4 border-l-[#C9A227] p-4 fade-up" data-testid="home-notice"><p className="text-[11px] font-bold uppercase tracking-wider text-[#C9A227]">Notice</p><p className="font-bold text-[#0B1F3A]">{n.title}</p><p className="mt-1 line-clamp-2 text-sm text-slate-500">{n.body}</p></Link>)}
      {me?.relationship_manager && <div className="pcard mt-4 flex items-center gap-4 p-4 fade-up" data-testid="home-rm"><div className="grid h-11 w-11 place-items-center rounded-full bg-[#0B1F3A] font-bold text-[#C9A227]">{me.relationship_manager.name[0]}</div><div className="min-w-0 flex-1"><p className="text-xs text-slate-500">Your Relationship Manager</p><p className="truncate font-bold text-[#0B1F3A]">{me.relationship_manager.name}</p></div>{me.relationship_manager.phone && <a href={`tel:${me.relationship_manager.phone}`} className="pbtn pbtn-sm" data-testid="home-rm-call"><Phone className="h-4 w-4" />Call</a>}</div>}
      <div className="h-6" />
      <Wallet className="hidden" />
    </div>
  );
}
