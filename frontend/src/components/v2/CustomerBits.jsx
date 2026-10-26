import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FileText, Phone, Receipt, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useFetch } from "@/hooks/useList";
import { useCatalogues } from "@/hooks/useCatalogues";
import { cn } from "@/lib/utils";
import { fmtDate, fmtRelative, initials, inr } from "@/lib/format";
import { Card, Field, IconTile, Money, Num, Skeleton, StatusPill } from "@/components/v2";
import { Select } from "@/components/v2/Select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const PALETTE = [["#1A1F27", "#D8B64A"], ["#2A313C", "#FBF9F4"], ["#EAE4D8", "#0A0C10"], ["#F4F0E8", "#2F7D5B"], ["#E3F0E9", "#2F7D5B"], ["#F7EBD4", "#B7791F"], ["#5B6B85", "#FBF9F4"], ["#C9A227", "#0A0C10"]];
export const hueOf = (s = "") => [...s].reduce((a, c) => a + c.charCodeAt(0), 0);

export function Avatar({ name, size = 40, className }) {
  const [bg, fg] = PALETTE[hueOf(name) % PALETTE.length];
  return <span className={cn("grid shrink-0 place-items-center rounded-full font-display font-semibold", className)} style={{ width: size, height: size, background: bg, color: fg, fontSize: size * 0.36 }}>{initials(name)}</span>;
}

export function ScoreRing({ value = 0, size = 28 }) {
  const r = (size - 3) / 2, c = 2 * Math.PI * r;
  return (
    <span className="relative inline-grid place-items-center" style={{ width: size, height: size }} title={`Engagement ${Math.round(value)}`}>
      <svg width={size} height={size} className="-rotate-90"><circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#EAE4D8" strokeWidth="3" /><circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={value >= 60 ? "#2F7D5B" : value >= 30 ? "#C9A227" : "#B4423A"} strokeWidth="3" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(100, value) / 100)} /></svg>
      <span className="absolute text-[9px] font-bold text-ink-950">{Math.round(value)}</span>
    </span>
  );
}

export function Segmented({ options, value, onChange, testId, className }) {
  return (
    <div className={cn("inline-flex rounded-xl bg-warm-100 p-2", className)} role="tablist" data-testid={testId}>
      {options.map((o) => <button key={o.value} type="button" role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)} className={cn("h-8 rounded-lg px-3 text-[13px] font-semibold transition-colors", value === o.value ? "bg-ink-950 text-warm-50 shadow-sm" : "text-txt-secondary hover:text-ink-950")} data-testid={testId ? `${testId}-${o.value}` : undefined}>{o.label}{o.hint != null && <span className={cn("ml-1.5 text-[11px]", value === o.value ? "text-warm-200/70" : "text-txt-muted")}>{o.hint}</span>}</button>)}
    </div>
  );
}

export function usePeople() {
  const { data } = useFetch("/customers/rm-options");
  return useMemo(() => (data?.items || []).map((u) => ({ value: u.id, label: u.name, sub: u.role_name })), [data]);
}

export function CustomerCard({ c, people = [] }) {
  const { label } = useCatalogues();
  const rm = people.find((p) => p.value === c.assigned_sales_user_id)?.label;
  const due = (c.total_due_paise || 0) / 100;
  return (
    <Link to={`/customers/${c.id}`} className="block h-full" data-testid={`customer-card-${c.customer_code}`}>
      <Card hover className="flex h-full flex-col !p-5">
        <div className="flex items-start gap-3">
          <Avatar name={c.full_name} size={44} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-base font-semibold text-ink-950">{c.salutation ? `${c.salutation} ` : ""}{c.full_name}</p>
            <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-txt-secondary"><Phone className="h-3 w-3" strokeWidth={1.75} /><a href={`tel:${c.phone}`} aria-label={`Call ${c.full_name || c.name || c.phone}`} onClick={(e) => e.stopPropagation()} className="inline-flex min-h-[24px] items-center rounded px-1 hover:text-ink-950" data-testid={`call-${c.customer_code}`}>{c.phone}</a>{(c.city || c.address_current?.city) && <span>· {c.city || c.address_current?.city}</span>}</p>
          </div>
          <ScoreRing value={c.engagement_score || 0} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {c.lifecycle_stage && <StatusPill status={c.lifecycle_stage} />}
          <StatusPill status={c.kyc_status} />
          {(c.segment_ids || []).slice(0, 2).map((s) => <span key={s} className="pill bg-warm-100 text-txt-secondary">{label("customer_segment", s)}</span>)}
          {rm && <span className="pill border border-warm-200 bg-white text-txt-secondary"><Avatar name={rm} size={14} className="!text-[7px]" />{rm.split(" ")[0]}</span>}
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 border-t border-warm-100 pt-3">
          <div><p className="text-[11px] font-semibold text-txt-secondary">Bookings</p><p className="font-display text-lg text-ink-950">{c.bookings_count ?? 0}</p></div>
          <div><p className="text-[11px] font-semibold text-txt-secondary">Agreement</p><Money value={(c.agreement_paise || 0) / 100} short className="text-lg" /></div>
          <div><p className="text-[11px] font-semibold text-txt-secondary">Due</p><Money value={due} short className={cn("text-lg", due > 0 ? "text-brick" : "text-sage")} /></div>
        </div>
        <p className="mt-3 text-[11px] text-txt-muted">{c.last_contacted_at ? `Last contacted ${fmtRelative(c.last_contacted_at)}` : "Never contacted"}{c.overdue_count ? ` · ${c.overdue_count} overdue` : ""}</p>
      </Card>
    </Link>
  );
}

const BUCKETS = [["cash", "Cash"], ["account", "Account"], ["other_charges", "Other charges"], ["combined", "Combined"]];
const TYPE = { DEMAND: ["Demand raised", FileText, "amber"], PAYMENT: ["Payment", Receipt, "sage"], REVERSAL: ["Reversal", RotateCcw, "brick"], AGREEMENT_CHANGE: ["Agreement change", FileText, "slate"], OTHER_CHARGE_DEMAND: ["Charge demanded", FileText, "amber"], OTHER_CHARGE_PAYMENT: ["Charge paid", Receipt, "sage"], CANCELLATION: ["Cancellation", RotateCcw, "brick"] };

function SumTile({ label, value, tone, hint }) {
  return <div className="rounded-xl bg-warm-50 px-4 py-3"><p className="text-[11px] font-semibold text-txt-secondary">{label}</p><Money value={value / 100} className={cn("text-xl", tone === "brick" && "text-brick", tone === "sage" && "text-sage", tone === "amber" && "text-amber2")} />{hint && <p className="mt-0.5 text-[11px] text-amber2">{hint}</p>}</div>;
}

export function ThreeLedgers({ customerId, bookingId, testId = "ledgers" }) {
  const path = customerId ? `/customers/${customerId}/ledgers` : `/bookings/${bookingId}/ledgers`;
  const { data, loading } = useFetch(path);
  const [bucket, setBucket] = useState("combined");
  const [bk, setBk] = useState("all");
  const perBooking = customerId ? data?.ledgers || [] : data ? [data] : [];
  const selected = bk === "all" ? null : perBooking.find((l) => l.booking_id === bk);
  const sum = selected ? selected[bucket].summary : customerId ? data?.totals?.[bucket] : data?.[bucket]?.summary;
  const rowsRaw = (selected ? [selected] : perBooking).flatMap((l) => l[bucket].rows.map((r) => ({ ...r, booking_number: l.booking_number })));
  const rows = (() => {
    if (bucket !== "combined") return rowsRaw.sort((a, b) => (a.at > b.at ? -1 : 1));
    const asc = [...rowsRaw].sort((a, b) => (a.at < b.at ? -1 : 1)); let bal = 0;
    return asc.map((r) => { const amt = r.amount_paise || 0; const isPay = (r.type || "").includes("PAYMENT"), isRev = r.type === "REVERSAL"; bal += isPay ? -amt : isRev ? amt : (r.type || "").includes("DEMAND") ? amt : 0; return { ...r, running_due_paise: Math.max(bal, 0) }; }).reverse();
  })();
  if (loading || !data) return <Skeleton className="h-64 rounded-2xl" />;
  return (
    <Card className="!p-0" testId={testId}>
      <div className="flex flex-wrap items-center justify-between gap-4 px-6 pt-5 pb-6">
        <h3 className="font-display text-lg">Ledgers</h3>
        <div className="flex flex-wrap items-center gap-3">
          {perBooking.length > 1 && <Select options={[{ value: "all", label: "All bookings" }, ...perBooking.map((l) => ({ value: l.booking_id, label: l.booking_number }))]} value={bk} onChange={(v) => setBk(v || "all")} clearable={false} allowAdd={false} className="w-44" testId="ledger-booking" />}
          <Segmented options={BUCKETS.map(([v, l]) => ({ value: v, label: l }))} value={bucket} onChange={setBucket} testId="ledger-bucket" />
        </div>
      </div>
      {sum && <div className="grid grid-cols-2 gap-3 px-6 pb-6 md:grid-cols-4" data-testid="ledger-summary">
        <SumTile label="Total Udhar (dues raised)" value={sum.total_udhar_paise ?? sum.raised_paise ?? 0} /><SumTile label="Total Jama (received)" value={sum.total_jama_paise ?? sum.paid_paise ?? 0} tone="sage" />
        <SumTile label="Balance (Udhar − Jama)" value={sum.balance_paise ?? ((sum.total_udhar_paise || 0) - (sum.total_jama_paise || 0))} tone={(sum.balance_paise ?? 0) > 0 ? "brick" : undefined} hint={sum.pending_cheques_paise > 0 ? `cheques in hand ${inr(sum.pending_cheques_paise / 100)}` : undefined} />
        <SumTile label="Advance held" value={sum.advance_paise || 0} tone="sage" />
      </div>}
      {rows.length === 0 ? <div className="flex flex-col items-center gap-2 border-t border-warm-100 px-6 py-12 text-center"><IconTile icon={FileText} /><p className="text-sm text-txt-muted">No entries in this ledger yet.</p></div> : (
        <div className="overflow-x-auto border-t border-warm-100"><table className="w-full min-w-[760px] text-sm" data-testid="ledger-rows">
          <thead><tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-txt-muted"><th className="px-6 py-3">Date</th><th className="px-4 py-3">Particulars</th><th className="px-4 py-3 text-right">Udhar (₹)</th><th className="px-4 py-3 text-right">Jama (₹)</th><th className="px-4 py-3">Mode / Instrument</th><th className="px-6 py-3 text-right">Balance (₹)</th></tr></thead>
          <tbody>{[...rows].sort((a, b) => (a.at < b.at ? -1 : 1)).slice(-80).map((r, i) => { const [lbl, Icon, tone] = TYPE[r.type] || [r.type, FileText, undefined]; const ud = r.udhar_paise || 0, ja = r.jama_paise || 0; return (
            <tr key={`${r.booking_number}-${r.seq}-${i}`} className={cn("h-11", i % 2 === 1 && "bg-warm-50")} data-testid={`ledger-row-${r.seq}`}>
              <td className="whitespace-nowrap px-6 py-2 text-txt-secondary">{fmtDate(r.date)}</td>
              <td className="px-4 py-2"><div className="flex items-center gap-3"><span className={cn("icon-tile !h-7 !w-7 !rounded-lg", tone)}><Icon className="!h-4 !w-4" /></span><div className="min-w-0"><p className="truncate font-semibold text-ink-950">{lbl}{r.tag && <span className="ml-2 rounded-full bg-brick-50 px-2 py-0.5 text-[10px] font-bold text-brick" data-testid={`ledger-tag-${r.seq}`}>{r.tag}</span>}</p><p className="truncate text-xs text-txt-muted">{[r.booking_number, r.note, r.ref].filter(Boolean).join(" · ")}</p></div></div></td>
              <td className="whitespace-nowrap px-4 py-2 text-right font-display text-base tabular-nums text-ink-950" data-testid={`ledger-udhar-${r.seq}`}>{ud ? <Num s={inr(ud / 100)} /> : ""}</td>
              <td className={cn("whitespace-nowrap px-4 py-2 text-right font-display text-base tabular-nums", ja < 0 ? "text-brick" : "text-sage")} data-testid={`ledger-jama-${r.seq}`}>{ja ? <Num s={inr(ja / 100)} /> : ""}</td>
              <td className="whitespace-nowrap px-4 py-2 text-xs text-txt-secondary">{r.mode && r.mode !== "Due" ? r.mode : ""}{r.instrument ? ` · ${r.instrument}` : ""}</td>
              <td className={cn("whitespace-nowrap px-6 py-2 text-right font-display text-base font-semibold tabular-nums", (r.balance_paise || 0) > 0 ? "text-brick" : "text-sage")} data-testid={`ledger-balance-${r.seq}`}>{r.balance_paise != null && <Num s={inr(r.balance_paise / 100)} />}</td>
            </tr>); })}</tbody>
          <tfoot><tr className="border-t-2 border-warm-200 bg-warm-50 font-semibold text-ink-950" data-testid="ledger-footer-totals"><td className="px-6 py-2" colSpan={2}>Totals · Balance = Udhar − Jama · Advance held {inr((sum?.advance_paise || 0) / 100)}</td><td className="px-4 py-2 text-right tabular-nums" data-testid="ledger-footer-udhar">{inr(rows.reduce((s, r) => s + (r.udhar_paise || 0), 0) / 100)}</td><td className="px-4 py-2 text-right tabular-nums text-sage" data-testid="ledger-footer-jama">{inr(rows.reduce((s, r) => s + (r.jama_paise || 0), 0) / 100)}</td><td /><td className="px-6 py-2 text-right tabular-nums" data-testid="ledger-footer-balance">{inr(rows.reduce((s, r) => s + (r.udhar_paise || 0) - (r.jama_paise || 0), 0) / 100)}</td></tr></tfoot>
        </table></div>
      )}
    </Card>
  );
}

export function CommSheet({ open, onOpenChange, customerId, bookingId, leadId, onSaved }) {
  const [f, setF] = useState({ type_id: null, outcome_id: null, notes: "", duration_min: "", next_follow_up_at: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setF({ type_id: null, outcome_id: null, notes: "", duration_min: "", next_follow_up_at: "" }); }, [open]);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      await api.post("/communications", { customer_id: customerId || null, booking_id: bookingId || null, lead_id: leadId || null, type_id: f.type_id, outcome_id: f.outcome_id || null, notes: f.notes || null, duration_min: f.duration_min ? Number(f.duration_min) : null, next_follow_up_at: f.next_follow_up_at ? new Date(f.next_follow_up_at).toISOString() : null });
      toast.success("Communication logged"); onSaved?.(); onOpenChange(false);
    } catch (err) { toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="v2 w-full overflow-y-auto bg-warm-50 sm:max-w-md" data-testid="comm-sheet">
        <SheetHeader><SheetTitle className="font-display text-2xl">Log a call / meeting</SheetTitle><SheetDescription>Every touchpoint feeds the engagement score and the timeline.</SheetDescription></SheetHeader>
        <form onSubmit={submit} className="mt-6 space-y-5">
          <Field label="Type" required><Select type="communication_type" value={f.type_id} onChange={(v) => setF({ ...f, type_id: v })} testId="comm-type" /></Field>
          <Field label="Outcome"><Select type="communication_outcome" value={f.outcome_id} onChange={(v) => setF({ ...f, outcome_id: v })} testId="comm-outcome" /></Field>
          <Field label="Notes"><textarea className="input !h-24 py-2" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} data-testid="comm-notes" /></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Duration (min)"><input type="number" min="0" className="input" value={f.duration_min} onChange={(e) => setF({ ...f, duration_min: e.target.value })} data-testid="comm-duration" /></Field>
            <Field label="Next follow-up"><input type="datetime-local" className="input" value={f.next_follow_up_at} onChange={(e) => setF({ ...f, next_follow_up_at: e.target.value })} data-testid="comm-next" /></Field>
          </div>
          <button type="submit" disabled={busy || !f.type_id} className="btn btn-primary w-full" data-testid="comm-submit">{busy ? "Saving…" : "Save communication"}</button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
