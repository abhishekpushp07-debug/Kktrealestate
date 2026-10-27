import { JourneyButton } from "@/components/common/JourneyPanel";
import { Suspense, lazy, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, Banknote, FileWarning, Landmark, Plus, Printer, Receipt, Search } from "lucide-react";
import { toast } from "sonner";
import { HistoryButton } from "@/components/common/HistoryTimeline";
import api, { errMsg, BASE_PATH } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useFetch, useList } from "@/hooks/useList";
import { cn } from "@/lib/utils";
import { fmtDate, inr, inrShort } from "@/lib/format";
import { Card, EmptyState, Field, Money, Num, Skeleton, StatTile, StatusPill, Tabs } from "@/components/v2";
import { Select } from "@/components/v2/Select";
import { Avatar } from "@/components/v2/CustomerBits";
import { PostPayment } from "@/components/v2/PostPayment";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useCatalogues } from "@/hooks/useCatalogues";

const Roznamcha = lazy(() => import("@/pages/Roznamcha"));
const month = () => new Date().toISOString().slice(0, 7);

function ReasonSheet({ item, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [reasonId, setReasonId] = useState(null);
  const [busy, setBusy] = useState(false);
  const { label } = useCatalogues();
  if (!item) return null;
  const go = async () => { setBusy(true); try { await api.post(`/payments/${item.p.id}/${item.kind}`, item.kind === "clear" ? {} : { reason: reason || label("cancellation_reason", reasonId) || "Returned unpaid" }); toast.success(`Receipt ${item.p.receipt_number} ${item.kind === "clear" ? "cleared" : item.kind === "bounce" ? "marked bounced" : "reversed"}`); onDone(); onClose(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); } };
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="v2 w-full bg-warm-50 sm:max-w-md" data-testid="reason-sheet">
        <SheetHeader><SheetTitle className="font-display text-2xl capitalize">{item.kind} receipt</SheetTitle><SheetDescription>{item.p.receipt_number} · {item.p.customer_name} · <Num s={inr(item.p.amount)} /></SheetDescription></SheetHeader>
        <div className="mt-6 space-y-5">
          {item.kind !== "clear" && <><Field label="Reason"><Select type="cancellation_reason" value={reasonId} onChange={setReasonId} testId="reason-select" /></Field><Field label="Notes"><textarea className="input !h-24 py-2" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional detail" data-testid="reason-notes" /></Field></>}
          <button onClick={go} disabled={busy || (item.kind !== "clear" && !reason && !reasonId)} className={cn("btn w-full", item.kind === "clear" ? "btn-primary" : "btn-danger")} data-testid="reason-submit">{busy ? "Working…" : `Confirm ${item.kind}`}</button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Row({ p, can, onAct, nav }) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-6 py-3 md:flex-nowrap" data-testid={`receipt-${p.receipt_number}`}>
      <Avatar name={p.customer_name} size={36} />
      <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-ink-950">{p.customer_name} <span className="font-mono text-xs font-normal text-txt-muted">{p.receipt_number}</span></p><p className="truncate text-xs text-txt-secondary">{fmtDate(p.payment_date)} · {p.booking_number} · {p.project_code} {p.flat_number} · {p.payment_mode_name}{p.instrument?.number ? ` · ${p.instrument.number}` : ""}</p></div>
      <span className="pill bg-warm-100 text-txt-secondary">{p.against === "FLAT_VALUE" ? p.payment_category : p.other_charge_name}</span>
      <Money value={p.amount} className={cn("w-28 text-right text-lg", p.status === "Reversed" && "text-txt-muted line-through")} />
      <StatusPill status={p.status} />
      <div className="flex gap-1">
        <JourneyButton entityType="payment" entityId={p.id} className="btn btn-ghost btn-sm !px-2" label="" /><HistoryButton entityType="payment" entityId={p.id} label={p.receipt_number} />
        {can("finance.receipt.print") && <button onClick={() => window.open(`${BASE_PATH}/print/receipt/${p.id}`, "_blank")} className="btn btn-ghost btn-sm !px-2" aria-label="Print" data-testid={`print-${p.id}`}><Printer className="h-4 w-4" /></button>}
        {p.status === "Pending" && can("finance.cheque.clear") && <><button onClick={() => onAct({ p, kind: "clear" })} className="btn btn-secondary btn-sm" data-testid={`clear-${p.id}`}>Clear</button><button onClick={() => onAct({ p, kind: "bounce" })} className="btn btn-ghost btn-sm text-brick" data-testid={`bounce-${p.id}`}>Bounce</button></>}
        {p.status === "Cleared" && can("finance.payment.reverse") && <button onClick={() => onAct({ p, kind: "reverse" })} className="btn btn-ghost btn-sm text-brick" data-testid={`reverse-${p.id}`}>Reverse</button>}
      </div>
    </li>
  );
}

export default function Payments() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get("tab") || "receipts";
  const [post, setPost] = useState(!!sp.get("new"));
  const [act, setAct] = useState(null);
  const [f, setF] = useState({ status: sp.get("status") || "", payment_category: "", date_from: "", date_to: "" });
  const list = useList("/payments", Object.fromEntries(Object.entries(f).filter(([, v]) => v)), { sort: "-payment_date", pageSize: 20 });
  const cheques = useFetch("/payments/cheques-in-hand");
  const home = useFetch("/dashboard/home");
  const demands = useList("/payments/demands", { status: "Open,Partially Paid" }, { sort: "due_date", pageSize: 20 });
  useEffect(() => { if (sp.get("new")) { sp.delete("new"); setSp(sp, { replace: true }); } }, [sp, setSp]);
  const t = home.data?.totals, c = home.data?.counts;
  const reload = () => { list.reload(); cheques.reload(); home.reload(); };
  const pages = Math.max(1, Math.ceil((list.total || 0) / list.pageSize));
  return (
    <div className="space-y-8" data-testid="payments-page">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div><p className="label">Collections</p><h1 className="mt-1 font-display text-4xl text-ink-950">Payments</h1></div>
        {can("finance.payment.create") && <button onClick={() => setPost(true)} className="btn btn-gold" data-testid="post-payment-btn"><Plus className="h-4 w-4" strokeWidth={1.75} />Post payment</button>}
      </header>
      <section className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4" data-testid="payment-tiles">
        {!home.data ? Array.from({ length: 4 }, (_, n) => n).map((n) => <Skeleton key={n} className="h-28 rounded-2xl" />) : <>
          <StatTile label="Collected this month" value={inrShort(t.collections_mtd_paise / 100)} hint={`${month()} · cleared receipts`} icon={Banknote} iconTone="gold" testId="tile-mtd" />
          <StatTile label="Cheques in hand" value={inrShort((cheques.data?.amount || 0))} hint={`${cheques.data?.total || 0} awaiting realisation`} icon={Landmark} iconTone={cheques.data?.total ? "amber" : undefined} testId="tile-cheques" />
          <StatTile label="Bounced" value={String(home.data.attention.bounced.length)} hint="recent bounces to follow up" icon={AlertTriangle} iconTone={home.data.attention.bounced.length ? "brick" : undefined} tone={home.data.attention.bounced.length ? "brick" : undefined} testId="tile-bounced" />
          <StatTile label="Overdue demands" value={String(t.overdue_count)} hint={`${inrShort(t.overdue_paise / 100)} past due date`} icon={FileWarning} iconTone={t.overdue_count ? "brick" : undefined} tone={t.overdue_count ? "brick" : undefined} testId="tile-overdue" />
        </>}
      </section>
      <Tabs tabs={[{ value: "receipts", label: "Receipts" }, { value: "cheques", label: "Cheques", count: cheques.data?.total }, { value: "demands", label: "Demands" }, { value: "roznamcha", label: "Roznamcha" }]} value={tab} onChange={(v) => setSp({ tab: v })} testId="payments-tabs" />
      {tab === "receipts" && <Card className="!p-0" testId="receipts-card">
        <div className="flex flex-col gap-3 border-b border-warm-100 px-6 py-4 md:flex-row md:items-center">
          <label className="relative flex-1"><Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-txt-muted" /><input value={list.search} onChange={(e) => list.setSearch(e.target.value)} placeholder="Receipt, customer, booking, UTR…" className="input !pl-10" data-testid="receipt-search" /></label>
          <div className="flex flex-wrap gap-2">
            <Select options={["Cleared", "Pending", "Bounced", "Reversed"].map((s) => ({ value: s, label: s }))} value={f.status || null} onChange={(v) => setF({ ...f, status: v || "" })} placeholder="All status" allowAdd={false} className="w-36" testId="pay-filter-status" />
            <Select options={["Cash", "Account"].map((s) => ({ value: s, label: s }))} value={f.payment_category || null} onChange={(v) => setF({ ...f, payment_category: v || "" })} placeholder="All buckets" allowAdd={false} className="w-36" testId="pay-filter-category" />
            <input type="date" aria-label="From date" className="input !w-40" value={f.date_from} onChange={(e) => setF({ ...f, date_from: e.target.value })} data-testid="pay-from" /><input type="date" aria-label="To date" className="input !w-40" value={f.date_to} onChange={(e) => setF({ ...f, date_to: e.target.value })} data-testid="pay-to" />
          </div>
        </div>
        {list.loading && list.items.length === 0 ? <div className="space-y-3 p-6">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12" />)}</div> : list.items.length === 0 ? <div className="p-6"><EmptyState icon={Receipt} title="No receipts" description="Post the first payment to see it here." testId="receipts-empty" /></div> : <ul className="divide-y divide-warm-100" data-testid="receipts-list">{list.items.map((p) => <Row key={p.id} p={p} can={can} onAct={setAct} nav={nav} />)}</ul>}
        <div className="flex items-center justify-between border-t border-warm-100 px-6 py-3 text-xs text-txt-secondary"><span>{list.total} receipts · cleared <Num s={inr(list.totals?.Cleared?.amount || 0)} /></span>{pages > 1 && <span className="flex items-center gap-2"><button disabled={list.page <= 1} onClick={() => list.setPage(list.page - 1)} className="btn btn-secondary btn-sm">Prev</button>{list.page}/{pages}<button disabled={list.page >= pages} onClick={() => list.setPage(list.page + 1)} className="btn btn-secondary btn-sm">Next</button></span>}</div>
      </Card>}
      {tab === "cheques" && <Card className="!p-0" testId="cheques-card">{(cheques.data?.items || []).length === 0 ? <div className="p-6"><EmptyState icon={Landmark} title="No cheques in hand" description="Cheques and DDs wait here until they are cleared or bounced." testId="cheques-empty" /></div> : <ul className="divide-y divide-warm-100" data-testid="cheques-list">{cheques.data.items.map((p) => <Row key={p.id} p={p} can={can} onAct={setAct} nav={nav} />)}</ul>}</Card>}
      {tab === "demands" && <Card className="!p-0" testId="demands-card">{demands.items.length === 0 ? <div className="p-6"><EmptyState icon={FileWarning} title="No open demands" testId="demands-empty" /></div> : <ul className="divide-y divide-warm-100" data-testid="demands-list">{demands.items.map((d) => { const bal = (d.total_demand_paise || 0) - (d.paid_paise || 0), late = d.due_date < new Date().toISOString().slice(0, 10); return <li key={d.id} className="flex flex-wrap items-center gap-3 px-6 py-3 md:flex-nowrap" data-testid={`demand-${d.demand_number}`}><span className={cn("icon-tile", late ? "brick" : "amber")}><FileWarning /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-ink-950">{d.customer_name} <span className="font-mono text-xs font-normal text-txt-muted">{d.demand_number}</span></p><p className="truncate text-xs text-txt-secondary">{d.installment_name || d.milestone_name} · {d.project_name || d.project_code} {d.flat_number || ""} · due {fmtDate(d.due_date)}</p></div><Money value={bal / 100} className={cn("text-lg", late ? "text-brick" : "text-ink-950")} /><StatusPill status={late ? "Overdue" : d.status} /><button onClick={() => nav(`/bookings/${d.booking_id}`)} className="btn btn-secondary btn-sm" data-testid={`demand-open-${d.demand_number}`}>Open</button></li>; })}</ul>}</Card>}
      {tab === "roznamcha" && <div className="v2-embed" data-testid="roznamcha-embed"><Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}><Roznamcha /></Suspense></div>}
      {post && <PostPayment open={post} onOpenChange={setPost} onPosted={reload} />}
      {act && <ReasonSheet item={act} onClose={() => setAct(null)} onDone={reload} />}
      <span className="hidden">{c?.cheques_pending}</span>
    </div>
  );
}
