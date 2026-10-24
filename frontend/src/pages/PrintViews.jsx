import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { inr, fmtDate } from "@/lib/format";

function Letterhead({ company, title }) {
  return (
    <div className="mb-6 flex items-start justify-between border-b-2 border-navy pb-4">
      <div><p className="text-2xl font-black tracking-tight text-navy">{company?.name}</p><p className="text-xs text-slate-600">{company?.legal_name}{company?.letterhead_tagline && ` · ${company.letterhead_tagline}`}</p>
        <p className="text-xs text-slate-600">{[company?.address?.line1, company?.address?.city, company?.address?.state, company?.address?.pincode].filter(Boolean).join(", ")}</p>
        <p className="text-xs text-slate-600">GSTIN {company?.gstin} · RERA {company?.rera_registration}{company?.letterhead_phone && ` · ${company.letterhead_phone}`}</p></div>
      <div className="text-right"><p className="text-lg font-bold uppercase tracking-widest text-gold">{title}</p></div>
    </div>
  );
}

const Row = ({ l, v }) => <div className="flex justify-between border-b border-dotted py-1 text-sm"><span className="text-slate-600">{l}</span><span className="font-semibold text-navy">{v}</span></div>;

export function ReceiptPrint() {
  const { id } = useParams();
  const [d, setD] = useState(null);
  useEffect(() => { api.get(`/payments/${id}/receipt`).then((r) => setD(r.data)).catch((e) => toast.error(errMsg(e))); }, [id]);
  useEffect(() => { if (d) setTimeout(() => window.print(), 400); }, [d]);
  if (!d) return <p className="p-8 text-sm">Loading…</p>;
  const { payment: p, booking: b, customer: c, company, after } = d;
  return (
    <div className="relative mx-auto max-w-2xl bg-white p-10 text-navy print:p-6" data-testid="receipt-print">
      {d.cancelled && <div className="pointer-events-none absolute inset-0 flex items-center justify-center"><span className="rotate-[-25deg] border-8 border-red-500 px-8 py-3 text-6xl font-black uppercase text-red-500 opacity-30">Cancelled</span></div>}
      <Letterhead company={company} title="Receipt" />
      <div className="mb-4 grid grid-cols-2 gap-6"><div><Row l="Receipt No." v={p.receipt_number} /><Row l="Date" v={fmtDate(p.payment_date)} /><Row l="Booking No." v={b.booking_number} /></div><div><Row l="Project" v={b.project_name} /><Row l="Unit" v={`${b.block_name} · ${b.flat_snapshot.flat_number}`} /><Row l="Customer code" v={c?.customer_code} /></div></div>
      <p className="mt-6 text-sm leading-7">Received with thanks from <b>{c?.salutation} {c?.full_name}</b>{c?.address_current?.line1 && <>, {c.address_current.line1}, {c.address_current.city}</>} a sum of <b className="text-base">{inr(p.amount)}</b> (<i>{d.amount_in_words}</i>) towards <b>{p.against === "FLAT_VALUE" ? `Flat value — ${p.payment_category} bucket` : p.other_charge_name}</b> for unit <b>{b.flat_snapshot.flat_number}</b> by <b>{p.payment_mode_name}</b>{p.instrument?.number && <> vide no. <b>{p.instrument.number}</b>{p.instrument.date && ` dated ${fmtDate(p.instrument.date)}`}{p.instrument.bank_name && ` drawn on ${p.instrument.bank_name}`}</>}.</p>
      {after && p.against === "FLAT_VALUE" && <div className="mt-6 grid grid-cols-3 gap-3 rounded-lg bg-surface p-3 text-xs"><div><p className="text-slate-500">Construction stage</p><p className="font-bold">{after.construction_percent}%</p></div><div><p className="text-slate-500">{p.payment_category} paid to date</p><p className="font-bold">{inr(p.payment_category === "Cash" ? after.cash_paid_cum : after.account_paid_cum)}</p></div><div><p className="text-slate-500">{p.payment_category} due after this receipt</p><p className={`font-bold ${(p.payment_category === "Cash" ? after.cash_due : after.account_due) < 0 ? "text-emerald-600" : ""}`}>{(() => { const v = p.payment_category === "Cash" ? after.cash_due : after.account_due; return v < 0 ? `${inr(-v)} (advance)` : inr(v); })()}</p></div></div>}
      {d.subject_to_realisation && <p className="mt-4 text-xs italic text-slate-600">* Cheque / DD receipts are subject to realisation.</p>}
      <div className="mt-12 flex items-end justify-between text-xs"><div><p className="text-slate-500">Received by: {p.received_by_name}</p><p className="text-slate-500">Generated {fmtDate(p.created_at)}</p></div><div className="text-center"><div className="mb-1 h-12 w-48 border-b border-navy" /><p className="font-semibold">{company?.authorised_signatory_name || "Authorised Signatory"}</p><p className="text-slate-500">for {company?.name}</p></div></div>
    </div>
  );
}

export function DemandLetterPrint() {
  const { bookingId, demandId } = useParams();
  const [d, setD] = useState(null);
  useEffect(() => { api.get(`/bookings/${bookingId}/demands/${demandId}/letter`).then((r) => setD(r.data)).catch((e) => toast.error(errMsg(e))); }, [bookingId, demandId]);
  useEffect(() => { if (d) setTimeout(() => window.print(), 400); }, [d]);
  if (!d) return <p className="p-8 text-sm">Loading…</p>;
  const { company, bank, customer: c, booking: b, demand: dm } = d;
  return (
    <div className="mx-auto max-w-2xl bg-white p-10 text-navy print:p-6" data-testid="demand-letter-print">
      <Letterhead company={company} title="Demand Letter" />
      <div className="mb-4 flex justify-between text-sm"><div><p className="font-bold">{c?.salutation} {c?.full_name}</p><p className="text-slate-600">{[c?.address_current?.line1, c?.address_current?.city, c?.address_current?.pincode].filter(Boolean).join(", ")}</p><p className="text-slate-600">{c?.phone}</p></div><div className="text-right"><Row l="Demand No." v={dm.demand_number} /><Row l="Date" v={fmtDate(dm.demand_date)} /><Row l="Due date" v={fmtDate(dm.due_date)} /></div></div>
      <p className="text-sm">Sub: Payment demand on completion of <b>{dm.milestone_name}</b> ({dm.cumulative_percent}% stage) — Unit <b>{b.flat_snapshot.flat_number}</b>, {b.block_name}, {b.project_name} (Booking {b.booking_number})</p>
      <p className="mt-4 text-sm leading-7">Dear {c?.salutation} {c?.full_name?.split(" ").slice(-1)[0]},<br />We are pleased to inform you that construction has reached the <b>{dm.milestone_name}</b> stage. As per the agreed payment schedule, the following instalment is now due:</p>
      <table className="mt-4 w-full text-sm"><thead><tr className="border-b-2 border-navy text-left text-xs uppercase text-slate-500"><th className="py-1">Bucket</th><th className="py-1 text-right">Agreed</th><th className="py-1 text-right">This demand</th></tr></thead><tbody>
        <tr className="border-b"><td className="py-1.5">Cash</td><td className="py-1.5 text-right tabular">{inr(b.cash_agreed)}</td><td className="py-1.5 text-right tabular font-semibold">{inr(dm.cash_demand)}</td></tr>
        <tr className="border-b"><td className="py-1.5">Account (bank transfer)</td><td className="py-1.5 text-right tabular">{inr(b.account_agreed)}</td><td className="py-1.5 text-right tabular font-semibold">{inr(dm.account_demand)}</td></tr>
        <tr className="font-bold"><td className="py-2">Total payable by {fmtDate(dm.due_date)}</td><td /><td className="py-2 text-right text-base tabular">{inr(dm.total_demand)}</td></tr></tbody></table>
      <p className="mt-2 text-xs italic">{d.amount_in_words}</p>
      {bank && <div className="mt-5 rounded-lg bg-surface p-3 text-xs"><p className="mb-1 font-semibold uppercase tracking-wide text-slate-500">Bank details for Account bucket</p><p>{bank.account_name} · {bank.bank_name}, {bank.branch}</p><p>A/c No. <b>{bank.account_number}</b> · IFSC <b>{bank.ifsc}</b></p></div>}
      <p className="mt-4 text-xs text-slate-600">Kindly remit the amount on or before the due date to avoid interest as per the agreement. Please quote the booking number in all correspondence.</p>
      <div className="mt-12 flex items-end justify-between text-xs"><p className="text-slate-500">Current outstanding: {inr(Math.max(b.summary?.due || 0, 0))}</p><div className="text-center"><div className="mb-1 h-12 w-48 border-b border-navy" /><p className="font-semibold">{company?.authorised_signatory_name || "Authorised Signatory"}</p><p className="text-slate-500">for {company?.name}</p></div></div>
    </div>
  );
}
