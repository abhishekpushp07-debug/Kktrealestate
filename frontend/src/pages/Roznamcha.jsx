import { useState } from "react";
import { ArrowDownToLine, Printer } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useFetch, useMasterOptions } from "@/hooks/useList";
import { PageHeader, StatCard, Field } from "@/components/common/Bits";
import { Pill } from "@/components/common/StatusChip";
import { Combobox } from "@/components/common/Combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { inr, fmtDate } from "@/lib/format";

export default function Roznamcha() {
  const { can } = useAuth();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [contra, setContra] = useState({ kind: "DEPOSIT", amount: "", bank_account_id: null, remarks: "" });
  const { data: d, loading, reload } = useFetch(`/roznamcha?date=${date}`, [date]);
  const { options: banks } = useMasterOptions("bank-accounts", (b) => ({ value: b.id, label: `${b.bank_name} ${b.account_number_masked || ""}` }));
  const postContra = async () => { try { await api.post("/roznamcha/contra", { date, kind: contra.kind, amount: Number(contra.amount), bank_account_id: contra.bank_account_id, remarks: contra.remarks || null }); toast.success("Contra entry posted"); setContra({ ...contra, amount: "", remarks: "" }); reload(); } catch (e) { toast.error(errMsg(e)); } };
  return (
    <div data-testid="roznamcha-page">
      <PageHeader title="Roznamcha" subtitle="Day book — cash in hand, receipts by mode and bucket, bank contra." actions={<div className="flex items-center gap-2 print:hidden"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 w-40" data-testid="rozn-date" /><Button variant="outline" onClick={() => window.print()} data-testid="rozn-print"><Printer className="mr-1 h-4 w-4" />Print</Button></div>} />
      {loading && <p className="text-sm text-slate-500" data-testid="rozn-loading">Loading {date}…</p>}
      {d && !loading && <>
        <div className="grid gap-4 md:grid-cols-5" data-testid="rozn-summary">
          <StatCard label="Opening cash" value={inr(d.opening_cash)} testId="rozn-opening" />
          <StatCard label="Cash received" value={inr(d.cash_received)} accent="emerald" />
          <StatCard label="Deposited to bank" value={inr(d.bank_deposits)} hint={d.cash_withdrawals ? `withdrawn ${inr(d.cash_withdrawals)}` : undefined} />
          <StatCard label="Closing cash" value={inr(d.closing_cash)} accent="gold" testId="rozn-closing" />
          <StatCard label="Total receipts" value={inr(d.total_receipts)} hint={`pending cheques ${inr(d.pending)}`} accent="navy" />
        </div>
        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <div className="card-elev p-5"><h3 className="mb-3 text-base font-bold text-navy">By mode</h3>{Object.entries(d.by_mode).length === 0 ? <p className="text-sm text-slate-500">No receipts</p> : Object.entries(d.by_mode).map(([k, v]) => <div key={k} className="flex justify-between border-b py-1.5 text-sm last:border-0"><span>{k} <span className="text-xs text-slate-500">×{v.count}</span></span><b className="tabular text-navy">{inr(v.amount)}</b></div>)}</div>
          <div className="card-elev p-5"><h3 className="mb-3 text-base font-bold text-navy">By bucket</h3>{Object.entries(d.by_category).map(([k, v]) => <div key={k} className="flex justify-between border-b py-1.5 text-sm last:border-0"><span>{k}</span><b className="tabular text-navy">{inr(v.amount)}</b></div>)}<h3 className="mb-2 mt-4 text-base font-bold text-navy">By project</h3>{Object.entries(d.by_project).map(([k, v]) => <div key={k} className="flex justify-between py-1 text-sm"><span>{k} <span className="text-xs text-slate-500">×{v.count}</span></span><b className="tabular">{inr(v.amount)}</b></div>)}</div>
          <div className="card-elev p-5 print:hidden"><h3 className="mb-3 text-base font-bold text-navy">Contra entry</h3>{can("payment.post") ? <div className="space-y-2">
            <Select value={contra.kind} onValueChange={(v) => setContra({ ...contra, kind: v })}><SelectTrigger data-testid="contra-kind"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="DEPOSIT">Cash deposited to bank</SelectItem><SelectItem value="WITHDRAWAL">Cash withdrawn from bank</SelectItem></SelectContent></Select>
            <Field label="Amount ₹"><Input type="number" value={contra.amount} onChange={(e) => setContra({ ...contra, amount: e.target.value })} data-testid="contra-amount" /></Field>
            <Field label="Bank account"><Combobox options={banks} value={contra.bank_account_id} onChange={(v) => setContra({ ...contra, bank_account_id: v })} testId="contra-bank" /></Field>
            <Field label="Remarks"><Input value={contra.remarks} onChange={(e) => setContra({ ...contra, remarks: e.target.value })} /></Field>
            <Button onClick={postContra} disabled={!contra.amount || !contra.bank_account_id} className="w-full bg-navy hover:bg-navy-700" data-testid="contra-submit"><ArrowDownToLine className="mr-1 h-4 w-4" />Post contra</Button></div> : <p className="text-sm text-slate-500">payment.post required</p>}</div>
        </div>
        <div className="card-elev mt-6 overflow-x-auto" data-testid="rozn-receipts"><table className="w-full text-sm"><thead className="bg-surface text-[10px] uppercase text-slate-500"><tr><th className="px-3 py-2 text-left">Receipt</th><th className="px-3 py-2 text-left">Customer</th><th className="px-3 py-2 text-left">Unit</th><th className="px-3 py-2 text-left">Towards</th><th className="px-3 py-2 text-left">Mode</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2">Status</th></tr></thead>
          <tbody>{d.receipts.map((p) => <tr key={p.id} className="border-t"><td className="px-3 py-2 font-mono text-xs">{p.receipt_number}</td><td className="px-3 py-2">{p.customer_name}</td><td className="px-3 py-2">{p.project_code} {p.flat_number}</td><td className="px-3 py-2">{p.against === "FLAT_VALUE" ? p.payment_category : p.other_charge_name}</td><td className="px-3 py-2">{p.payment_mode_name}</td><td className="px-3 py-2 text-right tabular font-semibold">{inr(p.amount)}</td><td className="px-3 py-2 text-center"><Pill tone={p.status === "Cleared" ? "emerald" : p.status === "Pending" ? "amber" : "red"}>{p.status}</Pill></td></tr>)}
            {d.contra.map((c) => <tr key={c.id} className="border-t bg-slate-50"><td className="px-3 py-2 text-xs">CONTRA</td><td className="px-3 py-2" colSpan={3}>{c.kind === "DEPOSIT" ? "Cash deposited to" : "Cash withdrawn from"} {c.bank_name} {c.remarks && `· ${c.remarks}`}</td><td className="px-3 py-2">{fmtDate(c.date)}</td><td className={`px-3 py-2 text-right tabular font-semibold ${c.kind === "DEPOSIT" ? "text-red-600" : "text-emerald-600"}`}>{c.kind === "DEPOSIT" ? "−" : "+"}{inr(c.amount)}</td><td /></tr>)}
            {d.receipts.length === 0 && d.contra.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-500">No entries on {fmtDate(date)}.</td></tr>}</tbody></table></div>
      </>}
    </div>
  );
}
