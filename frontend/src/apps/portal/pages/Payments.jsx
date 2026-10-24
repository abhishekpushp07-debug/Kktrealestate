import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Download, Landmark, Wallet } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Empty, PageTitle, Skeleton } from "../PortalShell";
import { fmtDate, inr, inrShort, useActiveBooking, useBookingSub } from "../hooks";
import papi, { openPdf, perr } from "../api";
import { BookingSwitcher } from "./Home";

const TABS = ["receipts", "demands", "schedule", "ledger", "bank"];
const tone = (s) => ({ Cleared: "bg-emerald-50 text-emerald-700", Pending: "bg-amber-50 text-amber-700", Bounced: "bg-red-50 text-red-700", Reversed: "bg-slate-100 text-slate-600", Paid: "bg-emerald-50 text-emerald-700", Open: "bg-amber-50 text-amber-700", "Partially Paid": "bg-blue-50 text-blue-700", Completed: "bg-emerald-50 text-emerald-700" }[s] || "bg-slate-100 text-slate-600");

export default function Payments() {
  const { items, active, select, isLoading } = useActiveBooking();
  const [sp, setSp] = useSearchParams();
  const tab = TABS.includes(sp.get("tab")) ? sp.get("tab") : "receipts";
  const id = active?.id;
  const pay = useBookingSub(id, "payments", tab === "receipts");
  const dem = useBookingSub(id, "demands", tab === "demands");
  const sch = useBookingSub(id, "schedule", tab === "schedule");
  const led = useBookingSub(id, "ledger", tab === "ledger");
  const bank = useQuery({ queryKey: ["p-bank"], queryFn: () => papi.get("/bank-details").then((r) => r.data), enabled: tab === "bank" });
  const [dl, setDl] = useState(null);
  const pdf = async (path, name) => { setDl(path); try { await openPdf(path, name); } catch (e) { toast.error(perr(e)); } finally { setDl(null); } };
  if (isLoading) return <div className="space-y-4"><Skeleton h={48} /><Skeleton h={160} /></div>;
  if (!active) return <Empty title="No booking yet" icon={Wallet} />;
  return (
    <div data-testid="portal-payments">
      <PageTitle title="Payments" sub={`${active.booking_number} · Flat ${active.flat_number}`} right={<button onClick={() => pdf(`/bookings/${id}/statement.pdf`, `statement-${active.booking_number}.pdf`)} className="pbtn pbtn-sm pbtn-ghost" disabled={!!dl} data-testid="payments-statement-pdf"><Download className="h-4 w-4" />Statement</button>} />
      <BookingSwitcher items={items} active={active} select={select} />
      <div className="pcard-navy mb-4 grid grid-cols-2 gap-4 p-5 fade-up sm:grid-cols-4" data-testid="payments-summary">
        {[["Agreement", active.agreement_value], ["Paid", active.paid], ["Due now", active.total_due], ["Pending cheques", active.pending_cheques]].map(([l, v]) => <div key={l}><p className="text-[11px] uppercase tracking-wider text-slate-300">{l}</p><p className="serif text-2xl font-semibold">{inrShort(v)}</p></div>)}
      </div>
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1" role="tablist">{TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setSp({ tab: t })} className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold capitalize transition-colors ${tab === t ? "bg-[#0B1F3A] text-white" : "bg-white text-slate-600"}`} data-testid={`payments-tab-${t}`}>{t === "bank" ? "Bank details" : t}</button>)}</div>
      {tab === "receipts" && (pay.isLoading ? <Skeleton h={200} /> : pay.data?.items?.length ? <div className="pcard px-5 fade-up" data-testid="receipts-list">{pay.data.items.map((p) => <div key={p.id} className="row" data-testid={`receipt-${p.receipt_number}`}><div className="min-w-0"><p className="font-bold text-[#0B1F3A]">{inr(p.amount)} <span className={`pchip ml-1 ${tone(p.status)}`}>{p.status}</span></p><p className="truncate text-xs text-slate-500">{p.receipt_number} · {fmtDate(p.payment_date)} · {p.payment_mode_name}{p.other_charge_name ? ` · ${p.other_charge_name}` : ""}{p.instrument?.number ? ` · #${p.instrument.number}` : ""}</p></div>{p.status === "Cleared" && <button onClick={() => pdf(`/bookings/${id}/payments/${p.id}/receipt.pdf`, `${p.receipt_number.replace(/\//g, "-")}.pdf`)} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#F8F6F1] text-[#0B1F3A]" aria-label="Download receipt" disabled={!!dl} data-testid={`receipt-pdf-${p.id}`}><Download className="h-4 w-4" /></button>}</div>)}</div> : <Empty title="No payments recorded yet" icon={Wallet} />)}
      {tab === "demands" && (dem.isLoading ? <Skeleton h={200} /> : dem.data?.items?.length ? <div className="pcard px-5 fade-up" data-testid="demands-list">{dem.data.items.map((d) => <div key={d.id} className="row"><div className="min-w-0"><p className="font-bold text-[#0B1F3A]">{d.milestone_name} <span className={`pchip ml-1 ${tone(d.status)}`}>{d.status}</span></p><p className="text-xs text-slate-500">{d.demand_number} · due {fmtDate(d.due_date)} · {inr(d.total_demand)}{d.paid ? ` · paid ${inr(d.paid)}` : ""}</p></div><button onClick={() => pdf(`/bookings/${id}/demands/${d.id}/letter.pdf`, `${d.demand_number}.pdf`)} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#F8F6F1] text-[#0B1F3A]" aria-label="Demand letter" disabled={!!dl} data-testid={`demand-pdf-${d.id}`}><Download className="h-4 w-4" /></button></div>)}</div> : <Empty title="No demands raised yet" hint="Demands are raised when construction milestones are certified." />)}
      {tab === "schedule" && (sch.isLoading ? <Skeleton h={200} /> : <div className="pcard px-5 fade-up" data-testid="schedule-list">{sch.data?.items?.map((m) => <div key={m.seq} className="row"><div><p className="font-bold text-[#0B1F3A]">{m.seq}. {m.name} <span className="text-xs font-normal text-slate-500">{m.cumulative_percent}%</span></p><p className="text-xs text-slate-500">{m.construction_status === "Completed" ? `Completed ${fmtDate(m.completed_on)}` : "Pending"}{m.demanded ? ` · demanded${m.demand_status ? ` (${m.demand_status})` : ""}` : ""}</p></div><p className="text-right text-sm font-semibold text-[#0B1F3A]">{inr(m.total)}</p></div>)}</div>)}
      {tab === "ledger" && (led.isLoading ? <Skeleton h={200} /> : <div className="pcard overflow-x-auto fade-up" data-testid="ledger-table"><table className="w-full min-w-[560px] text-sm"><thead><tr className="text-left text-[11px] uppercase tracking-wider text-slate-500"><th className="px-4 py-3">Date</th><th className="px-4 py-3">Particulars</th><th className="px-4 py-3 text-right">Amount</th><th className="px-4 py-3 text-right">Balance due</th></tr></thead><tbody>{led.data?.items?.map((e) => <tr key={e.seq} className="border-t border-[rgba(11,31,58,0.06)]"><td className="px-4 py-3 text-slate-500">{fmtDate(e.date)}</td><td className="px-4 py-3 font-medium text-[#0B1F3A]">{e.description}{e.ref ? <span className="block text-xs font-normal text-slate-400">{e.ref}</span> : null}</td><td className={`px-4 py-3 text-right tabular-nums ${e.amount < 0 ? "text-emerald-700" : ""}`}>{inr(Math.abs(e.amount))}</td><td className="px-4 py-3 text-right tabular-nums">{inr(e.total_due + (e.other_charges_due || 0))}</td></tr>)}</tbody></table></div>)}
      {tab === "bank" && (bank.isLoading ? <Skeleton h={160} /> : <div className="space-y-4 fade-up" data-testid="bank-details">{bank.data?.items?.map((b, i) => <div key={i} className="pcard p-5"><div className="flex items-center gap-3"><Landmark className="h-5 w-5 text-[#C9A227]" /><p className="font-bold text-[#0B1F3A]">{b.bank_name}{b.is_default ? " · Primary" : ""}</p></div><div className="mt-2 grid gap-1 text-sm"><p><span className="text-slate-500">A/c name:</span> {b.account_name}</p><p><span className="text-slate-500">A/c no:</span> <span className="font-mono">{b.account_number}</span></p><p><span className="text-slate-500">IFSC:</span> <span className="font-mono">{b.ifsc}</span></p>{b.branch && <p><span className="text-slate-500">Branch:</span> {b.branch}</p>}</div></div>)}<p className="text-xs text-slate-500">{bank.data?.note}</p></div>)}
    </div>
  );
}
