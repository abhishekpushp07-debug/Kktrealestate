import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { BadgeCheck, CalendarDays, Download, Eye, EyeOff, FileText, FileWarning, Landmark, LifeBuoy, Lock, Mail, MapPin, MessageSquare, MoreHorizontal, Pencil, Phone, Plus, Receipt, ShieldCheck, Users } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useFetch } from "@/hooks/useList";
import { useCatalogues } from "@/hooks/useCatalogues";
import { openPdf } from "@/pages/Reports";
import { cn } from "@/lib/utils";
import { fmtDate, fmtDateTime, fmtRelative, inr, inrShort } from "@/lib/format";
import { Card, EmptyState, IconTile, Money, Num, Skeleton, StatTile, StatusPill, Tabs } from "@/components/v2";
import { Avatar, CommSheet, ScoreRing, Segmented, ThreeLedgers, usePeople } from "@/components/v2/CustomerBits";
import { PostPayment } from "@/components/v2/PostPayment";
import { DocumentsPanel } from "@/components/common/DocumentsPanel";
import { PortalAccessCard } from "@/components/common/PortalAccessCard";

const EV = { payment: [Receipt, "sage"], demand: [FileText, "amber"], communication: [MessageSquare, undefined], visit: [CalendarDays, undefined], booking: [FileText, "gold"], service: [LifeBuoy, "brick"], lead: [Users, undefined], kyc: [ShieldCheck, "sage"] };

function BookingCard({ b }) {
  const ps = b.plan_summary || {}, due = ps.due || {}, paid = (b.summary?.paid_paise || 0), agr = b.agreement_value_paise || 1;
  const oc = (b.summary?.other_charges_due_paise || 0);
  const title = [b.block_name, b.flat_snapshot?.flat_number, b.flat_snapshot?.flat_type_code, b.flat_snapshot?.super_builtup_sqft && `${b.flat_snapshot.super_builtup_sqft.toLocaleString("en-IN")} sq ft`].filter(Boolean).join(" · ");
  const sub = [b.booking_number, b.project_name, ps.plan_name || "No plan"].join(" · ");
  return (
    <Link to={`/bookings/${b.id}`} className="block min-w-0" data-testid={`booking-card-${b.booking_number}`}>
      <Card hover className="min-w-0 !p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1"><p className="truncate text-[15px] font-semibold leading-6 text-ink-950" title={title}>{title}</p><p className="mt-1 truncate text-xs text-txt-secondary" title={sub}>{sub}</p></div>
          <StatusPill status={b.status} className="shrink-0" />
        </div>
        <div className="mt-5"><div className="flex items-center justify-between text-xs leading-6"><span className="text-txt-secondary">Paid <Money value={paid / 100} short className="text-ink-950" /> of <Money value={agr / 100} short className="text-ink-950" /></span><span className="font-semibold text-ink-950">{Math.round((paid / agr) * 100)}%</span></div><div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-warm-100"><span className="block h-full rounded-full bg-sage" style={{ width: `${Math.min(100, (paid / agr) * 100)}%` }} /></div></div>
        <div className="mt-5 grid grid-cols-3 gap-2">{[["Cash due", due.cash_paise], ["Account due", due.account_paise], ["Other charges", oc]].map(([l, v]) => <div key={l} className="min-w-0 rounded-xl bg-warm-50 px-3 py-2"><p className="truncate text-[11px] font-semibold text-txt-secondary">{l}</p><Money value={(v || 0) / 100} short className={cn("text-base", v > 0 ? "text-brick" : "text-sage")} /></div>)}</div>
        {ps.next_installment && <div className="mt-4 flex min-w-0 flex-wrap items-center gap-2 text-xs text-txt-secondary" title={`${ps.next_installment.name} · ${ps.next_installment.trigger_label}`}><span className="pill bg-gold-light text-[#6b5410]">Next · {ps.next_installment.name}</span><span className="truncate">{ps.next_installment.trigger_label}{ps.next_installment.expected_date ? ` · ${fmtDate(ps.next_installment.expected_date)}` : ""}</span><Num s={inr(ps.next_installment.total_paise / 100)} className="ml-auto font-semibold text-ink-950" /></div>}
        {ps.overdue_count > 0 && <p className="mt-1 text-xs font-semibold text-brick">{ps.overdue_count} overdue demand{ps.overdue_count > 1 ? "s" : ""}</p>}
      </Card>
    </Link>
  );
}

function TimelineCard({ id }) {
  const [type, setType] = useState("all");
  const { data, loading } = useFetch(`/customers/${id}/timeline?limit=60${type === "all" ? "" : `&types=${type}`}`);
  const groups = (data?.items || []).reduce((acc, e) => { const d = fmtDate(e.at); (acc[d] = acc[d] || []).push(e); return acc; }, {});
  return (
    <Card className="!p-0" testId="customer-timeline">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-warm-100 px-6 py-4"><h3 className="font-display text-lg">Timeline</h3><Segmented options={[["all", "All"], ["payment", "Payments"], ["demand", "Demands"], ["communication", "Calls"], ["visit", "Visits"]].map(([v, l]) => ({ value: v, label: l }))} value={type} onChange={setType} testId="timeline-filter" /></div>
      <div className="px-6 py-4">{loading ? <Skeleton className="h-40" /> : Object.keys(groups).length === 0 ? <p className="py-6 text-center text-sm text-txt-muted">Nothing recorded yet.</p> : Object.entries(groups).map(([day, evs]) => <div key={day} className="mb-5 last:mb-0"><p className="label mb-2">{day}</p><ul className="space-y-2">{evs.map((e, i) => { const [I, tone] = EV[e.type.split(".")[0]] || [FileText, undefined]; return <li key={i} className="flex items-center gap-3"><IconTile icon={I} tone={tone} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-ink-950">{e.title}</p>{e.subtitle && <p className="truncate text-xs text-txt-secondary">{e.subtitle}</p>}</div>{e.amount_paise != null && <Money value={e.amount_paise / 100} short className={cn("text-base", tone === "sage" ? "text-sage" : "text-ink-950")} />}</li>; })}</ul></div>)}</div>
    </Card>
  );
}

export default function Customer360() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can, user } = useAuth();
  const { label } = useCatalogues();
  const people = usePeople();
  const [c, setC] = useState(null);
  const [reveal, setReveal] = useState(false);
  const [comm, setComm] = useState(false);
  const [pay, setPay] = useState(false);
  const [tab, setTab] = useState("overview");
  const comms = useFetch(`/communications?customer_id=${id}&page_size=8`);
  const ledg = useFetch(c && c.bookings.length > 0 ? `/customers/${c.id}/ledgers` : null, [c?.id]);
  const load = useCallback((rev = false) => api.get(`/customers/${id}`, { params: { reveal: rev || undefined } }).then((r) => { if (r.data.id !== id) { nav(`/customers/${r.data.id}`, { replace: true }); return; } setC(r.data); setReveal(rev); }).catch((e) => toast.error(errMsg(e))), [id, nav]);
  useEffect(() => { load(false); }, [load]);
  if (!c) return <div className="space-y-6"><Skeleton className="h-56 rounded-2xl" /><Skeleton className="h-96 rounded-2xl" /></div>;
  const active = c.bookings.filter((b) => b.status === "Active");
  const totDue = c.bookings.reduce((s, b) => s + Math.max(b.summary?.due_paise || 0, 0) + Math.max(b.summary?.other_charges_due_paise || 0, 0), 0);
  const rm = people.find((p) => p.value === c.assigned_sales_user_id)?.label;
  const setKyc = async (v) => { try { await api.post(`/customers/${id}/kyc-status`, { kyc_status: v, version: c.version }); toast.success(`KYC ${v}`); load(reveal); } catch (e) { toast.error(errMsg(e)); } };
  const kv = (k) => (reveal ? c[k] : c[`${k}_masked`]) || "—";
  const T = ledg.data?.totals?.combined;
  const pendingCheques = T ? T.pending_cheques_paise || 0 : c.bookings.reduce((s, b) => s + (b.summary?.pending_cheques_paise || 0), 0);
  const agreementTotal = T ? T.agreed_paise || 0 : c.bookings.reduce((s, b) => s + (b.agreement_value_paise || 0), 0), paidTotal = T ? T.paid_paise || 0 : c.bookings.reduce((s, b) => s + (b.summary?.paid_paise || 0), 0);
  const dueTotal = T ? Math.max(T.due_paise || 0, 0) : totDue;
  const Left = (
    <div className="space-y-8">
      {c.bookings.length > 0 && <section data-testid="financial-summary">
        <h2 className="mb-4 font-display text-lg text-ink-950">Financial summary</h2>
        <div className="grid grid-cols-2 gap-6">
          <StatTile label="Agreement" value={inrShort(agreementTotal / 100)} hint="flat value + other charges" icon={FileText} testId="fin-agreement" />
          <StatTile label="Paid" value={inrShort(paidTotal / 100)} hint="cleared · all ledgers" icon={Receipt} iconTone="sage" tone="sage" testId="fin-paid" />
          <StatTile label={dueTotal > 0 ? "Due" : "Due / Advance"} value={inrShort(dueTotal / 100)} hint={dueTotal > 0 ? "all ledgers" : "nothing due"} icon={FileWarning} iconTone={dueTotal > 0 ? "brick" : undefined} tone={dueTotal > 0 ? "brick" : "sage"} testId="fin-due" />
          <StatTile label="Cheques" value={inrShort(pendingCheques / 100)} hint={pendingCheques > 0 ? "in hand" : "none in hand"} icon={Landmark} iconTone={pendingCheques > 0 ? "amber" : undefined} testId="fin-cheques" />
        </div>
      </section>}
      <section>
        <div className="mb-4 flex items-center justify-between"><h2 className="flex items-center gap-2 font-display text-lg text-ink-950">Bookings <span className="pill bg-warm-100 text-txt-secondary">{c.bookings.length}</span></h2>{can("booking.create") && <Link to={`/bookings/new?customer_id=${id}`} className="btn btn-secondary btn-sm" data-testid="c360-new-booking"><Plus className="h-3.5 w-3.5" />New booking</Link>}</div>
        {c.bookings.length === 0 ? <EmptyState title="No bookings yet" description="Start a booking to open the three ledgers for this customer." testId="bookings-empty" /> : <div className="grid gap-6 md:grid-cols-2">{c.bookings.map((b) => <BookingCard key={b.id} b={b} />)}</div>}
      </section>
      {can("booking.read") && c.bookings.length > 0 && <ThreeLedgers customerId={id} testId="customer-ledgers" />}
      <TimelineCard id={id} />
    </div>
  );
  const Right = (
    <div className="space-y-6">
      <Card testId="profile-card">
        <h3 className="font-display text-lg">Profile</h3>
        <div className="mt-3 flex flex-wrap gap-1.5">{(c.preferences?.bhk_ids || []).map((b) => <span key={b} className="pill bg-warm-100 text-txt-secondary">{label("bhk_preference", b)}</span>)}{(c.preferences?.facing_ids || []).map((b) => <span key={b} className="pill bg-warm-100 text-txt-secondary">{label("facing", b)} facing</span>)}{c.preferences?.budget_band_id && <span className="pill bg-gold-light text-[#8a6d12]">{label("budget_band", c.preferences.budget_band_id)}</span>}</div>
        <dl className="mt-4 space-y-2 text-sm">{[["Occupation", c.occupation], ["Company", c.company_name], ["Income band", c.annual_income_band], ["Source", c.source], ["Residency", label("residency", c.residency_id)], ["Address", [c.address_current?.line1, c.address_current?.city, c.address_current?.state, c.address_current?.pincode].filter(Boolean).join(", ")]].filter(([, v]) => v).map(([k, v]) => <div key={k} className="flex justify-between gap-4"><dt className="text-txt-secondary">{k}</dt><dd className="text-right font-medium text-ink-950">{v}</dd></div>)}</dl>
        {c.notes && <p className="mt-3 rounded-xl bg-warm-50 p-3 text-xs text-txt-secondary">{c.notes}</p>}
      </Card>
      <Card className="!p-0" testId="comms-card">
        <div className="flex items-center justify-between px-6 pt-5"><h3 className="font-display text-lg">Communication</h3>{can("customer.write") && <button onClick={() => setComm(true)} className="btn btn-secondary btn-sm" data-testid="log-comm-btn"><Plus className="h-3.5 w-3.5" />Log</button>}</div>
        <ul className="mt-3 divide-y divide-warm-100">{(comms.data?.items || []).length === 0 && <li className="px-6 py-6"><div className="flex flex-col items-center gap-2 text-center"><IconTile icon={MessageSquare} /><p className="text-sm text-txt-muted">No calls or meetings logged.</p>{can("customer.write") && <button onClick={() => setComm(true)} className="text-sm font-semibold text-ink-950 hover:text-gold" data-testid="log-first-call">Log first call</button>}</div></li>}{(comms.data?.items || []).map((m) => <li key={m.id} className="px-6 py-3"><p className="text-sm font-semibold text-ink-950">{m.type_label || label("communication_type", m.type_id)}{m.outcome_id && <span className="font-normal text-txt-secondary"> · {m.outcome_label || label("communication_outcome", m.outcome_id)}</span>}</p><p className="text-xs text-txt-secondary">{m.notes || "—"}</p><p className="mt-0.5 text-[11px] text-txt-muted">{m.by_name || m.user_name || ""} · {fmtRelative(m.happened_at || m.created_at)}{m.next_follow_up_at ? ` · follow-up ${fmtDate(m.next_follow_up_at)}` : ""}</p></li>)}</ul>
      </Card>
      <Card testId="kyc-card">
        <div className="flex items-center justify-between"><h3 className="font-display text-lg">KYC & documents</h3><StatusPill status={c.kyc_status} /></div>
        <dl className="mt-3 space-y-2 text-sm">{[["PAN", kv("pan")], ["Aadhaar", kv("aadhaar")], ["Bank", c.bank?.bank_name ? `${c.bank.bank_name} · ${(reveal ? c.bank.account_number : c.bank.account_number_masked) || "—"}` : "—"]].map(([k, v]) => <div key={k} className="flex items-baseline justify-between gap-4 leading-6"><dt className="flex items-center gap-1.5 text-txt-secondary"><Lock className="h-3.5 w-3.5 translate-y-px text-txt-muted" aria-hidden />{k}</dt><dd className="font-mono text-ink-950">{v}</dd></div>)}</dl>
        <div className="mt-4 flex flex-wrap items-center gap-2">{can("customer.kyc_view") && <button onClick={() => load(!reveal)} className="btn btn-secondary btn-sm" data-testid="kyc-reveal-btn">{reveal ? <><EyeOff className="h-3.5 w-3.5" />Hide</> : <><Eye className="h-3.5 w-3.5" />Reveal</>}</button>}{reveal && <span className="text-[11px] text-amber2">Reveal is audit-logged</span>}{can("customer.kyc_view") && <select value={c.kyc_status} onChange={(e) => setKyc(e.target.value)} className="input !h-8 !w-auto !text-xs" data-testid="kyc-status-select">{["Pending", "Submitted", "Verified", "Rejected"].map((k) => <option key={k}>{k}</option>)}</select>}</div>
        <div className="mt-5 border-t border-warm-100 pt-4"><DocumentsPanel entityType="customer" entityId={id} canWrite={can("customer.write")} /></div>
      </Card>
      <Card testId="coapplicants-card"><h3 className="font-display text-lg">Co-applicants & nominee</h3>{c.co_applicants.length === 0 && !c.nominee?.name && <p className="mt-2 text-sm text-txt-muted">None recorded.</p>}<ul className="mt-3 space-y-2">{c.co_applicants.map((a, i) => <li key={i} className="flex items-center gap-3 rounded-xl bg-warm-50 p-3"><Avatar name={a.name} size={32} /><div className="min-w-0"><p className="text-sm font-semibold text-ink-950">{a.name}</p><p className="text-xs text-txt-secondary">{[a.relation, a.phone].filter(Boolean).join(" · ")}</p></div></li>)}{c.nominee?.name && <li className="flex items-center gap-3 rounded-xl border border-dashed border-warm-200 p-3"><Avatar name={c.nominee.name} size={32} /><div><p className="text-sm font-semibold text-ink-950">{c.nominee.name} <span className="pill bg-warm-100 text-txt-secondary">Nominee</span></p><p className="text-xs text-txt-secondary">{c.nominee.relation}</p></div></li>}</ul></Card>
      <PortalAccessCard customerId={id} />
      {c.leads.length > 0 && <Card testId="leads-card"><h3 className="font-display text-lg">Lead history</h3>{c.leads.map((l) => <div key={l.id} className="mt-3 text-sm"><p className="font-semibold text-ink-950">{l.lead_number} · {l.status}</p><div className="mt-1 flex flex-wrap gap-1">{l.stage_history.map((s, i) => <span key={i} className="pill bg-warm-100 text-txt-secondary">{s.status} · {fmtDate(s.at)}</span>)}</div></div>)}</Card>}
    </div>
  );
  return (
    <div className="space-y-8" data-testid="customer-360">
      <Card className="!p-6 md:!p-8" testId="customer-hero">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <Avatar name={c.full_name} size={64} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <h1 className="font-display text-[28px] leading-tight text-ink-950" data-testid="hero-title">{c.salutation ? `${c.salutation} ` : ""}{c.full_name}</h1>
                <div className="flex flex-wrap items-center gap-1.5">{c.lifecycle_stage && <StatusPill status={c.lifecycle_stage} />}<span className={cn("pill", c.kyc_status === "Verified" ? "bg-gold-light text-[#8a6d12]" : "bg-warm-100 text-txt-secondary")}>{c.kyc_status === "Verified" && <BadgeCheck className="h-3.5 w-3.5" />}KYC {c.kyc_status}</span>{(c.segment_ids || []).map((s) => <span key={s} className="pill bg-warm-100 text-txt-secondary">{label("customer_segment", s)}</span>)}</div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm leading-6 text-txt-secondary">
                <a href={`tel:${c.phone}`} className="flex items-center gap-1.5 hover:text-ink-950" data-testid="hero-phone"><Phone className="h-4 w-4" strokeWidth={1.75} />{c.phone}</a>
                {c.email && <a href={`mailto:${c.email}`} className="flex items-center gap-1.5 hover:text-ink-950"><Mail className="h-4 w-4" strokeWidth={1.75} />{c.email}</a>}
                {c.address_current?.city && <span className="flex items-center gap-1.5"><MapPin className="h-4 w-4" strokeWidth={1.75} />{c.address_current.city}</span>}
                {rm && <span className="pill border border-warm-200 bg-white text-txt-secondary"><Avatar name={rm} size={16} className="!text-[8px]" />RM · {rm}</span>}
                <span className="flex items-center gap-1.5"><ScoreRing value={c.engagement_score || 0} size={22} />Engagement</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 xl:justify-end" data-testid="hero-actions">
            {can("payment.post") && active.length > 0 && <button onClick={() => setPay(true)} className="btn btn-primary" data-testid="hero-post-payment"><Receipt className="h-4 w-4" strokeWidth={1.75} />Post payment</button>}
            {can("booking.create") && <Link to={`/bookings/new?customer_id=${id}`} className="btn btn-secondary" data-testid="hero-new-booking"><Plus className="h-4 w-4" strokeWidth={1.75} />New booking</Link>}
            <div className="hidden items-center gap-1 md:flex">
              {can("customer.write") && <button onClick={() => setComm(true)} className="btn btn-ghost" data-testid="hero-log-comm"><MessageSquare className="h-4 w-4" strokeWidth={1.75} />Log</button>}
              {can("report.view") && active[0] && <button onClick={() => openPdf(`/reports/statement/${active[0].id}?format=pdf`)} className="btn btn-ghost" data-testid="hero-statement"><Download className="h-4 w-4" strokeWidth={1.75} />Statement</button>}
              {can("customer.write") && <Link to={`/customers/${id}/edit`} className="btn btn-ghost" data-testid="customer-edit-btn"><Pencil className="h-4 w-4" strokeWidth={1.75} />Edit</Link>}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><button className="btn btn-ghost !px-2" aria-label="More actions" data-testid="hero-more"><MoreHorizontal className="h-5 w-5" strokeWidth={1.75} /></button></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="v2 w-52 rounded-xl border-warm-200 p-1.5">
                <DropdownMenuItem className="md:hidden" onClick={() => setComm(true)} data-testid="more-log">Log communication</DropdownMenuItem>
                {active[0] && <DropdownMenuItem className="md:hidden" onClick={() => openPdf(`/reports/statement/${active[0].id}?format=pdf`)} data-testid="more-statement">Download statement</DropdownMenuItem>}
                <DropdownMenuItem className="md:hidden" onClick={() => window.location.assign(`${process.env.REACT_APP_BASE_PATH || "/erp"}/customers/${id}/edit`)} data-testid="more-edit">Edit profile</DropdownMenuItem>
                <DropdownMenuItem onClick={() => { const el = document.querySelector("[data-testid=portal-access-card]"); el?.scrollIntoView({ behavior: "smooth" }); }} data-testid="more-portal">Share portal login</DropdownMenuItem>
                {user?.role_name === "Super Admin" && c.kyc_status !== "Erased" && active.length === 0 && <DropdownMenuItem className="text-brick" onClick={async () => { const reason = window.prompt("Right to erasure — reason (PII anonymised; financial records kept):"); if (!reason) return; try { await api.post(`/admin/customers/${id}/erase`, { confirm: "ERASE", reason }); toast.success("Customer anonymised"); load(); } catch (e) { toast.error(errMsg(e)); } }} data-testid="erase-customer-btn">Erase PII</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </Card>
      <div className="xl:hidden"><Tabs tabs={[{ value: "overview", label: "Overview" }, { value: "profile", label: "Profile & KYC" }]} value={tab} onChange={setTab} testId="c360-tabs" /></div>
      <div className="grid gap-6 xl:grid-cols-12">
        <div className={cn("min-w-0 xl:col-span-8 xl:block", tab !== "overview" && "hidden")}>{Left}</div>
        <div className={cn("min-w-0 xl:col-span-4 xl:block", tab !== "profile" && "hidden")}>{Right}</div>
      </div>
      <CommSheet open={comm} onOpenChange={setComm} customerId={id} onSaved={() => { comms.reload(); load(reveal); }} />
      {pay && <PostPayment open={pay} onOpenChange={setPay} customerId={id} bookingId={active.length === 1 ? active[0].id : undefined} onPosted={() => load(reveal)} />}
      <span className="hidden">{fmtDateTime(c.created_at)}</span>
    </div>
  );
}
