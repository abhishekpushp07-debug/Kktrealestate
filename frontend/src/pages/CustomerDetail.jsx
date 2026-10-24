import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Eye, EyeOff, Pencil, ShieldCheck, UserX } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader, KV, StatCard, EmptyState } from "@/components/common/Bits";
import { Pill, StatusChip } from "@/components/common/StatusChip";
import { HistoryTimeline } from "@/components/common/HistoryTimeline";
import { DocumentsPanel } from "@/components/common/DocumentsPanel";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { inr, fmtDate, fmtDateTime } from "@/lib/format";
import { CustomerForm, KYC_TONE } from "./Customers";

export default function CustomerDetail() {
  const { id } = useParams();
  const { can, user } = useAuth();
  const erase = async () => { const reason = window.prompt("Right to erasure — reason (PII will be anonymised; financial records kept):"); if (!reason) return; try { await api.post(`/admin/customers/${id}/erase`, { confirm: "ERASE", reason }); toast.success("Customer anonymised"); reload(); } catch (e) { toast.error(errMsg(e)); } };
  const [c, setC] = useState(null);
  const [reveal, setReveal] = useState(false);
  const [edit, setEdit] = useState(false);
  const [payments, setPayments] = useState(null);
  const load = useCallback((rev = false) => api.get(`/customers/${id}`, { params: { reveal: rev || undefined } }).then((r) => { setC(r.data); setReveal(rev); }).catch((e) => toast.error(errMsg(e))), [id]);
  useEffect(() => { load(false); }, [load]);
  useEffect(() => { if (can("payment.read")) api.get(`/customers/${id}/payments`).then((r) => setPayments(r.data.items)).catch(() => {}); }, [id, can]);
  if (!c) return <Skeleton className="h-96" />;
  const setKyc = async (v) => { try { await api.post(`/customers/${id}/kyc-status`, { kyc_status: v, version: c.version }); toast.success(`KYC ${v}`); load(reveal); } catch (e) { toast.error(errMsg(e)); } };
  const kv = (k) => reveal ? c[k] : c[`${k}_masked`];
  return (
    <div data-testid="customer-detail">
      <PageHeader title={`${c.salutation || ""} ${c.full_name}`} subtitle={`${c.customer_code} · ${c.phone}${c.email ? ` · ${c.email}` : ""}`} crumbs={[{ label: "Customers", to: "/erp/customers" }, { label: c.customer_code }]}
        actions={<div className="flex gap-2"><Pill tone={KYC_TONE[c.kyc_status]}>{`KYC ${c.kyc_status}`}</Pill>{user?.role_name === "Super Admin" && c.kyc_status !== "Erased" && !c.bookings.some((b) => b.status === "Active") && <Button variant="outline" className="text-red-700" onClick={erase} data-testid="erase-customer-btn"><UserX className="mr-1 h-4 w-4" />Erase PII</Button>}{can("customer.write") && <Button variant="outline" onClick={() => setEdit(true)} data-testid="customer-edit-btn"><Pencil className="mr-1 h-4 w-4" />Edit</Button>}</div>} />
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Bookings" value={c.bookings.length} hint={c.bookings.filter((b) => b.status === "Active").length + " active"} />
        <StatCard label="Agreement value" value={inr(c.bookings.reduce((s, b) => s + (b.agreement_value_paise || 0) / 100, 0))} accent="gold" />
        <StatCard label="Paid" value={inr(c.bookings.reduce((s, b) => s + ((b.summary?.paid_paise || 0) / 100), 0))} accent="emerald" />
        <StatCard label="Due" value={inr(c.bookings.reduce((s, b) => s + Math.max((b.summary?.due_paise || 0) / 100, 0), 0))} accent="amber" />
      </div>
      <Tabs defaultValue="profile" className="mt-6">
        <TabsList className="flex-wrap bg-white" data-testid="customer-tabs">{["profile", "kyc", "bookings", "payments", "documents", "leads", "history"].map((t) => <TabsTrigger key={t} value={t} className="capitalize data-[state=active]:bg-navy data-[state=active]:text-white" data-testid={`customer-tab-${t}`}>{t}</TabsTrigger>)}</TabsList>
        <TabsContent value="profile" className="mt-4 grid gap-4 lg:grid-cols-3">
          <div className="card-elev p-5"><h3 className="mb-3 text-base font-bold text-navy">Personal</h3><KV label="Father / spouse" value={c.father_or_spouse_name} /><KV label="DOB" value={fmtDate(c.dob)} /><KV label="Gender" value={c.gender} /><KV label="Occupation" value={c.occupation} /><KV label="Company" value={c.company_name} /><KV label="Income band" value={c.annual_income_band} /><KV label="Source" value={c.source} /></div>
          <div className="card-elev p-5"><h3 className="mb-3 text-base font-bold text-navy">Address</h3><p className="text-sm">{[c.address_current?.line1, c.address_current?.city, c.address_current?.state, c.address_current?.pincode].filter(Boolean).join(", ") || "—"}</p><h3 className="mb-3 mt-5 text-base font-bold text-navy">Nominee</h3><KV label="Name" value={c.nominee?.name} /><KV label="Relation" value={c.nominee?.relation} /></div>
          <div className="card-elev p-5"><h3 className="mb-3 text-base font-bold text-navy">Co-applicants</h3>{c.co_applicants.length === 0 ? <p className="text-sm text-slate-500">None</p> : c.co_applicants.map((a, i) => <div key={i} className="mb-2 rounded-md bg-surface p-2 text-sm"><b className="text-navy">{a.name}</b> · {a.relation} · {a.phone}<p className="font-mono text-xs text-slate-500">PAN {reveal ? a.pan : a.pan_masked || "—"} · Aadhaar {reveal ? a.aadhaar : a.aadhaar_masked || "—"}</p></div>)}{c.notes && <p className="mt-3 text-xs text-slate-500">{c.notes}</p>}</div>
        </TabsContent>
        <TabsContent value="kyc" className="mt-4">
          <div className="card-elev p-5" data-testid="kyc-panel">
            <div className="mb-4 flex flex-wrap items-center gap-3"><h3 className="text-base font-bold text-navy">KYC</h3>
              {can("customer.kyc_view") ? <Button size="sm" variant="outline" onClick={() => load(!reveal)} data-testid="kyc-reveal-btn">{reveal ? <><EyeOff className="mr-1 h-4 w-4" />Hide</> : <><Eye className="mr-1 h-4 w-4" />Reveal</>}</Button> : <span className="text-xs text-slate-500">Masked — you lack customer.kyc_view</span>}
              {reveal && <span className="text-xs text-amber-700">Reveal is audit-logged.</span>}
              {can("customer.kyc_view") && <div className="ml-auto flex items-center gap-2 text-xs"><ShieldCheck className="h-4 w-4 text-navy" />Status<Select value={c.kyc_status} onValueChange={setKyc}><SelectTrigger className="h-8 w-36" data-testid="kyc-status-select"><SelectValue /></SelectTrigger><SelectContent>{Object.keys(KYC_TONE).map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent></Select></div>}
            </div>
            <div className="grid gap-3 md:grid-cols-3"><KV label="PAN" value={kv("pan") || "—"} mono /><KV label="Aadhaar" value={kv("aadhaar") || "—"} mono /><KV label="Bank" value={c.bank?.bank_name ? `${c.bank.bank_name} · ${(reveal ? c.bank.account_number : c.bank.account_number_masked) || "—"} · ${c.bank.ifsc || ""}` : "—"} mono /></div>
            {c.kyc_verified_at && <p className="mt-3 text-xs text-slate-500">Verified {fmtDateTime(c.kyc_verified_at)}</p>}
          </div>
        </TabsContent>
        <TabsContent value="bookings" className="mt-4">
          {c.bookings.length === 0 ? <EmptyState title="No bookings" /> : <div className="card-elev divide-y" data-testid="customer-bookings">{c.bookings.map((b) => <Link key={b.id} to={`/bookings/${b.id}`} className="flex items-center gap-4 px-4 py-3 text-sm hover:bg-surface"><span className="font-mono font-semibold text-navy">{b.booking_number}</span><span>{b.flat_snapshot?.flat_number}</span><StatusChip status={b.status === "Active" ? "Booked" : b.status === "Completed" ? "Sold" : "Blocked"} /><span className="ml-auto tabular">{inr(b.agreement_value_paise / 100)}</span><span className={`tabular ${(b.summary?.due_paise || 0) > 0 ? "text-red-600" : "text-emerald-600"}`}>{inr(Math.abs((b.summary?.due_paise || 0) / 100))} {(b.summary?.due_paise || 0) < 0 ? "adv" : "due"}</span></Link>)}</div>}
        </TabsContent>
        <TabsContent value="payments" className="mt-4">
          {!payments ? <p className="text-sm text-slate-500">Payments require payment.read.</p> : payments.length === 0 ? <EmptyState title="No payments" /> : <div className="card-elev overflow-x-auto"><table className="w-full text-sm"><thead className="bg-surface text-[10px] uppercase text-slate-500"><tr><th className="px-3 py-2 text-left">Receipt</th><th className="px-3 py-2 text-left">Date</th><th className="px-3 py-2 text-left">Booking</th><th className="px-3 py-2 text-left">Towards</th><th className="px-3 py-2 text-left">Mode</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2">Status</th></tr></thead><tbody>{payments.map((p) => <tr key={p.id} className="border-t"><td className="px-3 py-2 font-mono text-xs">{p.receipt_number}</td><td className="px-3 py-2">{fmtDate(p.payment_date)}</td><td className="px-3 py-2">{p.booking_number}</td><td className="px-3 py-2">{p.against === "FLAT_VALUE" ? `Flat value · ${p.payment_category}` : p.other_charge_name}</td><td className="px-3 py-2">{p.payment_mode_name}</td><td className="px-3 py-2 text-right tabular font-semibold">{inr(p.amount)}</td><td className="px-3 py-2 text-center"><Pill tone={p.status === "Cleared" ? "emerald" : p.status === "Pending" ? "amber" : "red"}>{p.status}</Pill></td></tr>)}</tbody></table></div>}
        </TabsContent>
        <TabsContent value="documents" className="mt-4"><div className="card-elev p-5"><DocumentsPanel entityType="customer" entityId={id} canWrite={can("customer.write")} /></div></TabsContent>
        <TabsContent value="leads" className="mt-4">{c.leads.length === 0 ? <EmptyState title="No lead history" /> : c.leads.map((l) => <div key={l.id} className="card-elev mb-2 p-4 text-sm"><b className="text-navy">{l.lead_number}</b> · {l.status}<div className="mt-1 flex flex-wrap gap-1">{l.stage_history.map((s, i) => <Pill key={i} tone="slate">{`${s.status} · ${fmtDate(s.at)}`}</Pill>)}</div></div>)}</TabsContent>
        <TabsContent value="history" className="mt-4"><div className="card-elev p-5"><HistoryTimeline entityType="customer" entityId={id} /></div></TabsContent>
      </Tabs>
      {edit && <CustomerForm open={edit} onOpenChange={setEdit} item={c} onSaved={() => load(reveal)} />}
    </div>
  );
}
