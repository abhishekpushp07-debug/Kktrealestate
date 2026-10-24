import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Printer, Receipt } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useList, useFetch } from "@/hooks/useList";
import { DataTable } from "@/components/common/DataTable";
import { PageHeader, StatCard } from "@/components/common/Bits";
import { Pill } from "@/components/common/StatusChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { inr, fmtDate } from "@/lib/format";

const TONE = { Cleared: "emerald", Pending: "amber", Bounced: "red", Reversed: "red" };

export default function Payments() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ status: "all", payment_category: "all", date_from: "", date_to: "" });
  const extra = { status: f.status === "all" ? undefined : f.status, payment_category: f.payment_category === "all" ? undefined : f.payment_category, date_from: f.date_from || undefined, date_to: f.date_to || undefined };
  const list = useList("/payments", extra, { sort: "-payment_date", pageSize: 500 });
  const cheques = useFetch("/payments/cheques-in-hand");
  const act = async (p, path, body, msg) => { try { await api.post(`/payments/${p.id}/${path}`, body); toast.success(msg); list.reload(); cheques.reload(); } catch (e) { toast.error(errMsg(e)); } };
  const columns = [
    { key: "receipt_number", label: "Receipt", sortable: true, render: (p) => <span className="font-mono text-xs font-semibold text-navy">{p.receipt_number}</span> },
    { key: "payment_date", label: "Date", sortable: true, render: (p) => fmtDate(p.payment_date) },
    { key: "customer_name", label: "Customer", render: (p) => <div><p className="font-semibold text-navy">{p.customer_name}</p><p className="text-xs text-slate-500">{p.booking_number} · {p.project_code} {p.flat_number}</p></div> },
    { key: "towards", label: "Towards", render: (p) => p.against === "FLAT_VALUE" ? <Pill tone={p.payment_category === "Cash" ? "gold" : "navy"}>{p.payment_category}</Pill> : <Pill tone="slate">{p.other_charge_name}</Pill> },
    { key: "payment_mode_name", label: "Mode", render: (p) => <span>{p.payment_mode_name}{p.instrument?.number && <span className="block text-xs text-slate-500">{p.instrument.number}</span>}</span> },
    { key: "amount_paise", label: "Amount", sortable: true, align: "right", render: (p) => <span className={`tabular font-semibold ${p.status === "Reversed" ? "line-through text-slate-400" : ""}`}>{inr(p.amount)}</span> },
    { key: "status", label: "Status", sortable: true, render: (p) => <Pill tone={TONE[p.status]}>{p.status}</Pill> },
    { key: "actions", label: "", render: (p) => <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>{can("receipt.print") && <Button size="sm" variant="ghost" onClick={() => nav(`/erp/print/receipt/${p.id}`)} data-testid={`print-${p.id}`}><Printer className="h-3.5 w-3.5" /></Button>}{p.status === "Pending" && can("payment.post") && <><Button size="sm" variant="ghost" className="text-emerald-700" onClick={() => act(p, "clear", {}, "Cleared")} data-testid={`clear-${p.id}`}>Clear</Button><Button size="sm" variant="ghost" className="text-red-600" onClick={() => act(p, "bounce", { reason: "Returned unpaid" }, "Bounced")} data-testid={`bounce-${p.id}`}>Bounce</Button></>}</div> },
  ];
  const totals = list.totals || {};
  return (
    <div data-testid="payments-page">
      <PageHeader title="Payments" subtitle="Receipts across all bookings. Only cleared payments count toward dues." />
      <div className="mb-4 grid gap-4 md:grid-cols-4">
        <StatCard label="Cleared (filtered)" value={inr(totals.Cleared?.amount)} hint={`${totals.Cleared?.count || 0} receipts`} accent="emerald" />
        <StatCard label="Cheques in hand" value={inr(cheques.data?.amount)} hint={`${cheques.data?.total || 0} pending`} accent="amber" testId="cheques-in-hand-stat" />
        <StatCard label="Bounced" value={inr(totals.Bounced?.amount)} hint={`${totals.Bounced?.count || 0}`} />
        <StatCard label="Reversed" value={inr(totals.Reversed?.amount)} hint={`${totals.Reversed?.count || 0}`} />
      </div>
      <Tabs defaultValue="all">
        <TabsList className="bg-white"><TabsTrigger value="all" data-testid="payments-tab-all">All receipts</TabsTrigger><TabsTrigger value="cheques" data-testid="payments-tab-cheques">Cheques in hand</TabsTrigger></TabsList>
        <TabsContent value="all" className="mt-3">
          <DataTable {...list} columns={columns} testId="payments-table" exportPath="/payments" searchPlaceholder="Receipt, customer, booking, UTR…" onRowClick={(p) => nav(`/erp/bookings/${p.booking_id}`)} empty={{ icon: Receipt, title: "No payments" }}
            toolbar={<div className="flex flex-wrap gap-2">
              <Select value={f.status} onValueChange={(v) => setF({ ...f, status: v })}><SelectTrigger className="h-9 w-32" data-testid="pay-filter-status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All status</SelectItem>{Object.keys(TONE).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
              <Select value={f.payment_category} onValueChange={(v) => setF({ ...f, payment_category: v })}><SelectTrigger className="h-9 w-32" data-testid="pay-filter-category"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All buckets</SelectItem><SelectItem value="Cash">Cash</SelectItem><SelectItem value="Account">Account</SelectItem></SelectContent></Select>
              <Input type="date" value={f.date_from} onChange={(e) => setF({ ...f, date_from: e.target.value })} className="h-9 w-36" /><Input type="date" value={f.date_to} onChange={(e) => setF({ ...f, date_to: e.target.value })} className="h-9 w-36" /></div>} />
        </TabsContent>
        <TabsContent value="cheques" className="mt-3">
          <div className="card-elev divide-y" data-testid="cheques-list">{(cheques.data?.items || []).map((p) => <div key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm"><span className="font-mono text-xs font-semibold text-navy">{p.receipt_number}</span><span>{p.customer_name} · {p.booking_number}</span><span className="text-xs text-slate-500">{p.payment_mode_name} {p.instrument?.number} · {fmtDate(p.payment_date)}</span><span className="ml-auto tabular font-semibold">{inr(p.amount)}</span>{can("payment.post") && <><Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => act(p, "clear", {}, "Cleared")}>Clear</Button><Button size="sm" variant="outline" className="text-red-600" onClick={() => act(p, "bounce", { reason: "Returned unpaid" }, "Bounced")}>Bounce</Button></>}</div>)}{(cheques.data?.items || []).length === 0 && <p className="px-4 py-8 text-center text-sm text-slate-500">No cheques pending realisation.</p>}</div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
