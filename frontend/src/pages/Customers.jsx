import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, UserRound } from "lucide-react";
import { toast } from "sonner";
import api, { errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useList } from "@/hooks/useList";
import { DataTable } from "@/components/common/DataTable";
import { PageHeader, Field } from "@/components/common/Bits";
import { Pill } from "@/components/common/StatusChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { fmtDate } from "@/lib/format";

export const KYC_TONE = { Pending: "slate", Submitted: "amber", Verified: "emerald", Rejected: "red" };
const SOURCES = ["Walk-in", "Website", "Referral", "Broker", "Campaign"];
const BANDS = ["<5L", "5-10L", "10-25L", "25-50L", "50L-1Cr", ">1Cr"];
const EMPTY = { salutation: "Mr", full_name: "", father_or_spouse_name: "", dob: "", gender: "Male", phone: "", alt_phone: "", email: "", occupation: "", company_name: "", annual_income_band: "", source: "Walk-in", pan: "", aadhaar: "", notes: "",
  address_current: { line1: "", city: "Patna", state: "Bihar", pincode: "" }, permanent_same_as_current: true, bank: { bank_name: "", account_number: "", ifsc: "" }, nominee: { name: "", relation: "", dob: "" }, co_applicants: [] };

export function CustomerForm({ open, onOpenChange, item, onSaved }) {
  const [f, setF] = useState(() => item ? { ...EMPTY, ...item, pan: "", aadhaar: "", bank: { bank_name: item.bank?.bank_name || "", account_number: "", ifsc: item.bank?.ifsc || "" }, nominee: item.nominee || EMPTY.nominee, address_current: item.address_current || EMPTY.address_current, co_applicants: (item.co_applicants || []).map((c) => ({ name: c.name, relation: c.relation || "", phone: c.phone || "", pan: "", aadhaar: "" })) } : EMPTY);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const setN = (k, sub, v) => setF((p) => ({ ...p, [k]: { ...p[k], [sub]: v } }));
  const clean = (v) => (v === "" ? null : v);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const body = { salutation: f.salutation || null, full_name: f.full_name, father_or_spouse_name: clean(f.father_or_spouse_name), dob: clean(f.dob), gender: f.gender || null, phone: f.phone, alt_phone: clean(f.alt_phone), email: clean(f.email), occupation: clean(f.occupation), company_name: clean(f.company_name),
        annual_income_band: clean(f.annual_income_band), source: f.source || null, address_current: f.address_current, permanent_same_as_current: f.permanent_same_as_current, notes: clean(f.notes),
        nominee: f.nominee?.name ? { name: f.nominee.name, relation: clean(f.nominee.relation), dob: clean(f.nominee.dob) } : null,
        bank: f.bank?.bank_name || f.bank?.account_number ? { bank_name: clean(f.bank.bank_name), ifsc: clean(f.bank.ifsc), ...(f.bank.account_number ? { account_number: f.bank.account_number } : {}) } : null,
        co_applicants: f.co_applicants.map((c) => ({ name: c.name, relation: clean(c.relation), phone: clean(c.phone), pan: clean(c.pan), aadhaar: clean(c.aadhaar) })) };
      if (f.pan) body.pan = f.pan.toUpperCase();
      if (f.aadhaar) body.aadhaar = f.aadhaar;
      const r = item ? await api.patch(`/customers/${item.id}`, { ...body, version: item.version }) : await api.post("/customers", body);
      toast.success(item ? "Customer updated" : `Customer ${r.data.customer_code} created`);
      onSaved?.(r.data); onOpenChange(false);
    } catch (err) { toast.error(errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl" data-testid="customer-form">
        <SheetHeader><SheetTitle>{item ? "Edit customer" : "New customer"}</SheetTitle><SheetDescription>KYC fields are encrypted at rest; leave PAN/Aadhaar blank to keep existing values.</SheetDescription></SheetHeader>
        <form onSubmit={submit} className="mt-4 space-y-4">
          <div className="grid grid-cols-6 gap-3">
            <Field label="Title" className="col-span-1"><Select value={f.salutation} onValueChange={(v) => set("salutation", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["Mr", "Mrs", "Ms", "Dr", "M/s"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="Full name" required className="col-span-3"><Input value={f.full_name} onChange={(e) => set("full_name", e.target.value)} required data-testid="cust-name" /></Field>
            <Field label="Gender" className="col-span-2"><Select value={f.gender} onValueChange={(v) => set("gender", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["Male", "Female", "Other"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="Father / spouse name" className="col-span-3"><Input value={f.father_or_spouse_name} onChange={(e) => set("father_or_spouse_name", e.target.value)} /></Field>
            <Field label="Date of birth" className="col-span-3"><Input type="date" value={f.dob || ""} onChange={(e) => set("dob", e.target.value)} /></Field>
            <Field label="Mobile" required className="col-span-2"><Input value={f.phone} onChange={(e) => set("phone", e.target.value)} placeholder="10-digit" required data-testid="cust-phone" /></Field>
            <Field label="Alt. phone" className="col-span-2"><Input value={f.alt_phone} onChange={(e) => set("alt_phone", e.target.value)} /></Field>
            <Field label="Email" className="col-span-2"><Input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} data-testid="cust-email" /></Field>
            <Field label="Occupation" className="col-span-2"><Input value={f.occupation} onChange={(e) => set("occupation", e.target.value)} /></Field>
            <Field label="Company" className="col-span-2"><Input value={f.company_name} onChange={(e) => set("company_name", e.target.value)} /></Field>
            <Field label="Income band" className="col-span-2"><Select value={f.annual_income_band || ""} onValueChange={(v) => set("annual_income_band", v)}><SelectTrigger><SelectValue placeholder="—" /></SelectTrigger><SelectContent>{BANDS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="Source" className="col-span-2"><Select value={f.source} onValueChange={(v) => set("source", v)}><SelectTrigger data-testid="cust-source"><SelectValue /></SelectTrigger><SelectContent>{SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="PAN" className="col-span-2" hint="AAAAA9999A"><Input value={f.pan} onChange={(e) => set("pan", e.target.value.toUpperCase())} maxLength={10} placeholder={item?.pan_masked || ""} data-testid="cust-pan" /></Field>
            <Field label="Aadhaar" className="col-span-2" hint="12 digits"><Input value={f.aadhaar} onChange={(e) => set("aadhaar", e.target.value)} maxLength={12} placeholder={item?.aadhaar_masked || ""} data-testid="cust-aadhaar" /></Field>
          </div>
          <div className="rounded-lg border bg-surface/60 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Current address</p>
            <div className="grid grid-cols-6 gap-3">
              <Field label="Line 1" className="col-span-6"><Input value={f.address_current.line1 || ""} onChange={(e) => setN("address_current", "line1", e.target.value)} /></Field>
              <Field label="City" className="col-span-2"><Input value={f.address_current.city || ""} onChange={(e) => setN("address_current", "city", e.target.value)} /></Field>
              <Field label="State" className="col-span-2"><Input value={f.address_current.state || ""} onChange={(e) => setN("address_current", "state", e.target.value)} /></Field>
              <Field label="Pincode" className="col-span-2"><Input value={f.address_current.pincode || ""} onChange={(e) => setN("address_current", "pincode", e.target.value)} /></Field>
            </div>
            <label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={f.permanent_same_as_current} onChange={(e) => set("permanent_same_as_current", e.target.checked)} />Permanent address same as current</label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border p-3"><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Bank</p>
              <Field label="Bank"><Input value={f.bank.bank_name} onChange={(e) => setN("bank", "bank_name", e.target.value)} /></Field>
              <Field label="Account no." hint={item?.bank?.account_number_masked ? `Stored ${item.bank.account_number_masked}` : undefined}><Input value={f.bank.account_number} onChange={(e) => setN("bank", "account_number", e.target.value)} /></Field>
              <Field label="IFSC"><Input value={f.bank.ifsc} onChange={(e) => setN("bank", "ifsc", e.target.value.toUpperCase())} /></Field></div>
            <div className="rounded-lg border p-3"><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Nominee</p>
              <Field label="Name"><Input value={f.nominee.name || ""} onChange={(e) => setN("nominee", "name", e.target.value)} /></Field>
              <Field label="Relation"><Input value={f.nominee.relation || ""} onChange={(e) => setN("nominee", "relation", e.target.value)} /></Field>
              <Field label="DOB"><Input type="date" value={f.nominee.dob || ""} onChange={(e) => setN("nominee", "dob", e.target.value)} /></Field></div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="mb-2 flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Co-applicants</p><Button type="button" size="sm" variant="outline" onClick={() => set("co_applicants", [...f.co_applicants, { name: "", relation: "", phone: "", pan: "", aadhaar: "" }])} data-testid="cust-add-coapplicant"><Plus className="mr-1 h-3.5 w-3.5" />Add</Button></div>
            {f.co_applicants.map((c, i) => <div key={i} className="mb-2 grid grid-cols-5 gap-2">{["name", "relation", "phone", "pan", "aadhaar"].map((k) => <Input key={k} placeholder={k} value={c[k]} onChange={(e) => set("co_applicants", f.co_applicants.map((x, j) => j === i ? { ...x, [k]: e.target.value } : x))} />)}</div>)}
          </div>
          <Field label="Notes"><Textarea value={f.notes || ""} onChange={(e) => set("notes", e.target.value)} rows={2} /></Field>
          <Button type="submit" disabled={busy} className="w-full bg-navy hover:bg-navy-700" data-testid="cust-submit">{busy ? "Saving…" : item ? "Save changes" : "Create customer"}</Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export default function Customers() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [kyc, setKyc] = useState("all");
  const list = useList("/customers", { kyc_status: kyc === "all" ? undefined : kyc }, { sort: "-created_at" });
  const columns = [
    { key: "customer_code", label: "Code", sortable: true, render: (c) => <span className="font-mono text-xs font-semibold text-navy">{c.customer_code}</span> },
    { key: "full_name", label: "Customer", sortable: true, render: (c) => <div><p className="font-semibold text-navy">{c.salutation} {c.full_name}</p><p className="text-xs text-slate-500">{c.email || "—"}</p></div> },
    { key: "phone", label: "Phone", sortable: true },
    { key: "pan_masked", label: "PAN", render: (c) => <span className="font-mono text-xs">{c.pan_masked || "—"}</span> },
    { key: "source", label: "Source" },
    { key: "kyc_status", label: "KYC", sortable: true, render: (c) => <Pill tone={KYC_TONE[c.kyc_status]}>{c.kyc_status}</Pill> },
    { key: "created_at", label: "Since", sortable: true, render: (c) => fmtDate(c.created_at) },
  ];
  const bulkEnable = async () => { if (!window.confirm("Create portal logins for every customer with an Active booking who has none yet? Temporary passwords are shown once.")) return; try { const { data } = await api.post("/customers/portal/bulk-enable"); if (!data.count) return toast.info("All active buyers already have portal access"); window.alert(data.enabled.map((x) => `${x.full_name}: ${x.login_phone} / ${x.temporary_password}`).join("\n")); toast.success(`${data.count} portal account(s) created`); } catch (e) { toast.error(errMsg(e)); } };
  return (
    <div data-testid="customers-page">
      <PageHeader title="Customers" subtitle="Buyers, KYC and co-applicants." actions={<div className="flex gap-2">{can("customer.portal_manage") && <Button variant="outline" onClick={bulkEnable} data-testid="bulk-portal-enable-btn">Enable portal for active buyers</Button>}{can("customer.write") && <Button onClick={() => setOpen(true)} className="bg-navy hover:bg-navy-700" data-testid="new-customer-btn"><Plus className="mr-1 h-4 w-4" />New customer</Button>}</div>} />
      <DataTable {...list} columns={columns} testId="customers-table" exportPath="/customers" searchPlaceholder="Name, phone, code, PAN…" onRowClick={(c) => nav(`/customers/${c.id}`)}
        toolbar={<Select value={kyc} onValueChange={setKyc}><SelectTrigger className="h-9 w-36" data-testid="kyc-filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All KYC</SelectItem>{Object.keys(KYC_TONE).map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent></Select>}
        empty={{ icon: UserRound, title: "No customers yet" }} />
      {open && <CustomerForm open={open} onOpenChange={setOpen} onSaved={() => list.reload()} />}
    </div>
  );
}
