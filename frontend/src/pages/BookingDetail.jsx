import { Fragment, useCallback, useEffect, useState } from "react";
import { WaiversPanel } from "@/components/booking/WaiversPanel";
import { TypedMasterInput } from "@/components/common/TypedMasterInput";
import { EliteHero, Ring } from "@/components/elite";
import { showNextStep } from "@/components/common/NextStep";
import { AmountInput } from "@/components/common/AmountInput";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Ban, CheckCircle2, FileEdit, FileText, IndianRupee, Printer } from "lucide-react";
import { openPdf } from "@/pages/Reports";
import { toast } from "sonner";
import { HistoryButton } from "@/components/common/HistoryTimeline";
import api, { errMsg, BASE_PATH } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { KV, Field, EmptyState } from "@/components/common/Bits";

import { LedgerTable, Due } from "@/components/common/LedgerTable";
import { DocumentsPanel } from "@/components/common/DocumentsPanel";
import { OcPartRows } from "@/components/booking/OcPartRows";
import { Select } from "@/components/v2/Select";
import { DateInput } from "@/components/common/DateInput";
import { WhyDisabled } from "@/components/common/WhyDisabled";
import { businessToday } from "@/lib/businessDay";
import { HistoryTimeline } from "@/components/common/HistoryTimeline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BookingScheduleTab } from "@/components/common/PaymentSchedule";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { inr, inrShort, fmtDate, fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Card, Money, Num, StatusPill, Tabs } from "@/components/v2";
import { MoneyStrip } from "@/components/booking/MoneyStrip";
import { PlanTimeline } from "@/components/booking/PlanTimeline";
import { Avatar, ThreeLedgers } from "@/components/v2/CustomerBits";
import { PostPayment } from "@/components/v2/PostPayment";
import { RefundsTab, TransferDialog } from "@/components/common/BookingOps";
import { BookingMore } from "@/components/booking/BookingMore";
import {
  BalanceText,
  BillsToolbar,
  LedgerLaw,
  MainAction,
  OverviewTop,
} from "@/components/booking/BookingParts";
import { JourneyButton } from "@/components/common/JourneyPanel";
import { SendReminderButton } from "@/components/common/SendReminderButton";
import { ConnectedTo } from "@/components/common/ConnectedTo";
import { KycBadge } from "@/components/common/KycSlots";
import { PriceSummary } from "@/components/common/BreakdownCard";

// REQ-112: exactly five tabs
const TABS = [
  ["overview", "Overview"],
  ["bills", "Bills & Receipts"],
  ["ledger", "Ledger"],
  ["documents", "Documents"],
  ["activity", "Activity"],
];
const TAB_KEYS = TABS.map(([v]) => v);

function Table({ head, children, testId }) {
  return (
    <div className="card overflow-x-auto !p-0" data-testid={testId}>
      <table className="stack-table w-full text-sm">
        <thead className="text-xs font-medium text-txt-muted">
          <tr>
            {head.map((h) => (
              <th
                key={h.t || h.label || h}
                className={`px-4 py-3 ${h.r ? "text-right" : "text-left"}`}
              >
                {h.l ?? h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-warm-100">{children}</tbody>
      </table>
    </div>
  );
}
export default function BookingDetail() {
  const { id } = useParams();
  const { can, user } = useAuth();
  const [b, setB] = useState(null);
  const [ledger, setLedger] = useState([]);
  const [pay, setPay] = useState(false);
  const [rev, setRev] = useState(null);
  const [cancel, setCancel] = useState(null);
  const [transfer, setTransfer] = useState(false);
  const [preview, setPreview] = useState(null);
  const cancelOpen = !!cancel,
    deduction = cancel?.deduction;
  useEffect(() => {
    if (!cancelOpen) {
      setPreview(null);
      return;
    }
    const t = setTimeout(
      () =>
        api
          .get(`/bookings/${id}/cancellation-preview`, {
            params: deduction !== "" && deduction != null ? { deduction: Number(deduction) } : {},
          })
          .then((r) => setPreview(r.data))
          .catch(() => setPreview(null)),
      250,
    );
    return () => clearTimeout(t);
  }, [deduction, cancelOpen, id]);
  const [sp0] = useSearchParams();
  const [tab, setTab] = useState(TAB_KEYS.includes(sp0.get("tab")) ? sp0.get("tab") : "overview");
  const [rules, setRules] = useState(null);
  const load = useCallback(
    () =>
      Promise.all([
        api.get(`/bookings/${id}`),
        api.get(`/bookings/${id}/ledger`),
        api.get(`/bookings/${id}/actions`).catch(() => ({ data: null })),
      ])
        .then(([r1, r2, r3]) => {
          setB(r1.data);
          setLedger(r2.data.rows);
          setRules(r3.data);
        })
        .catch((e) => toast.error(errMsg(e))),
    [id],
  );
  useEffect(() => {
    load();
  }, [load]);
  const [sp, setSp] = useSearchParams();
  const canRevise = can("sales.agreement.revise");
  const [autoRefund, setAutoRefund] = useState(false);
  const payParam = sp.get("pay") === "1";
  useEffect(() => {
    if (!b || !payParam) return;
    if (b.status === "Active" && can("finance.payment.create")) setPay(true);
    sp.delete("pay"); // open once — a reload must not reopen the sheet
    setSp(sp, { replace: true });
  }, [b, payParam, can, sp, setSp]);
  useEffect(() => {
    if (b && sp.get("revise") === "1" && b.status === "Active" && canRevise)
      setRev((cur) => cur || { cash: b.cash_agreed, account: b.account_agreed, reason: "" });
  }, [b, sp, canRevise]);
  if (!b) return <Skeleton className="h-96" />;
  const s = b.summary || {};
  const act = async (path, body, msg) => {
    try {
      await api.post(path, body);
      toast.success(msg);
      load();
    } catch (e) {
      toast.error(errMsg(e), { duration: 8000 });
    }
  };
  const revise = async () =>
    act(
      `/bookings/${id}/agreement-revisions`,
      {
        cash_agreed: Number(rev.cash),
        account_agreed: Number(rev.account),
        reason: rev.reason,
        version: b.version,
      },
      "Agreement revised",
    ).then(() => setRev(null));
  const doCancel = async () =>
    act(
      `/bookings/${id}/cancel`,
      {
        reason: cancel.reason,
        ...(cancel.deduction !== "" && cancel.deduction != null
          ? { deduction: Number(cancel.deduction) }
          : {}),
        version: b.version,
      },
      "Booking cancelled",
    ).then(async () => {
      setCancel(null);
      const nb = await api.get(`/bookings/${id}`).catch(() => null);
      if ((nb?.data?.cancellation?.refund || 0) > 0)
        showNextStep({
          title: `Booking cancelled · refund ${inr(nb.data.cancellation.refund)} due`,
          actions: [
            {
              label: "Pay refund",
              onClick: () => {
                setTab("bills");
                setAutoRefund(true);
              },
            },
          ],
        });
    });
  const complete = async () =>
    act(`/bookings/${id}/complete`, { version: b.version }, "Handover complete — flat marked Sold");
  const canComplete =
    b.status === "Active" &&
    b.construction_percent >= 100 &&
    s.due <= 0 &&
    s.other_charges_due <= 0;

  return (
    <div className="space-y-8" data-testid="booking-detail">
      <EliteHero testId="booking-hero" className="[&_.e-diamond]:!hidden">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <span className="e-caps-gold" data-testid="booking-caps">
              {[b.project_name, b.block_name, b.flat_snapshot.flat_number]
                .filter(Boolean)
                .join(" · ")}
            </span>
            <h1 className="e-stmt !text-[34px] md:!text-[42px]">
              <Link
                to={`/customers/${b.customer_id}`}
                className="hover:underline"
                data-testid="hero-customer-link"
              >
                {b.customer_name}
              </Link>
            </h1>
            <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[#aab4c8]">
              <StatusPill status={b.status} />
              <KycBadge k={b.kyc_completeness} testId="booking-kyc-badge" />
              {b.booking_number} · {b.flat_snapshot.flat_type_code} ·{" "}
              {b.payment_plan_snapshot?.name || "No plan"} · booked {fmtDate(b.booking_date)}
            </p>
          </div>
          <div className="flex items-start gap-5">
            <Ring
              pct={(s.total_received / (s.total_bill_raised || 1)) * 100}
              label="received"
              testId="booking-ring"
            />
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2" data-testid="booking-actions">
          <MainAction
            b={b}
            rules={rules}
            onPay={() => setPay(true)}
            onRefund={() => setTab("bills")}
          />
          <BookingMore
            b={b}
            rules={rules}
            onRevise={() => setRev({ cash: b.cash_agreed, account: b.account_agreed, reason: "" })}
            onTransfer={() => setTransfer(true)}
            onCancel={() => setCancel({ reason: "", deduction: "" })}
            onChanged={load}
            signedForm={(close) => (
              <AgreementSigned
                b={b}
                onDone={(msg) => {
                  toast.success(msg);
                  close();
                  load();
                }}
              />
            )}
          />
          <span className="text-[#dfe5ef] [&_button]:!text-[#dfe5ef]">
            <HistoryButton entityType="booking" entityId={id} label={b.booking_number} compact />
          </span>
          <span className="ml-auto text-xs text-[#8f9ab0]">
            {b.construction_percent}% constructed
          </span>
        </div>
      </EliteHero>
      <Tabs
        tabs={TABS.map(([value, label]) => ({ value, label }))}
        value={tab}
        onChange={setTab}
        testId="booking-tabs"
      />
      <div className="hidden">
        {TAB_KEYS.map((t) => (
          <span key={t} data-testid={`booking-tab-${t}`} />
        ))}
      </div>
      {tab === "overview" && (
        <div className="space-y-6" data-testid="booking-overview">
          <MoneyStrip agreement={b.agreement_value} s={s} />
          <OverviewTop b={b} s={s} />
          <PlanTimeline b={b} />
          <div className="grid gap-6 lg:grid-cols-3">
            <Card>
              <h3 className="mb-3 e-caps-blue">Customer</h3>
              <KV
                label="Name"
                value={
                  <Link to={`/customers/${b.customer_id}`} className="hover:underline">
                    {b.customer?.full_name}
                  </Link>
                }
              />
              <KV label="Phone" value={b.customer?.phone} />
              <KV label="KYC" value={b.customer?.kyc_status} />
              {b.co_applicants?.length > 0 && (
                <KV
                  label="Co-applicants"
                  value={b.co_applicants.map((c) => c.full_name).join(", ")}
                />
              )}
            </Card>
            <PriceSummary booking={b} />
            <Card>
              <h3 className="mb-3 e-caps-blue">Unit</h3>
              <KV
                label="Flat"
                value={`${b.flat_snapshot.flat_number} · ${b.flat_snapshot.flat_type_code}`}
              />
              <KV
                label="Saleable area"
                value={`${b.flat_snapshot.saleable_sqft || b.flat_snapshot.super_builtup_sqft || "—"} sq.ft`}
              />
              <KV label="Rate" value={b.rate_per_sqft ? `₹${b.rate_per_sqft}/sq.ft` : "Lump sum"} />
              <KV
                label="Parking"
                value={
                  b.parking_slots?.length ? b.parking_slots.map((p) => p.number).join(", ") : "None"
                }
              />
              <div className="mt-3 flex flex-wrap gap-2">
                {b.status === "Active" && can("sales.booking.edit") && (
                  <Button
                    variant="outline"
                    why={!canComplete ? "Needs 100% construction and nothing due" : undefined}
                    disabled={!canComplete}
                    onClick={complete}
                    title={canComplete ? "" : "Needs 100% construction and zero dues"}
                    className="btn btn-ghost btn-sm"
                    data-testid="complete-booking-btn"
                  >
                    <CheckCircle2 className="h-4 w-4" strokeWidth={1.75} />
                    Handover
                  </Button>
                )}
                {can("reports.project_statement.view") && (
                  <Link
                    to={`/reports/project-statement?project_id=${b.project_id}&block_id=${b.block_id}`}
                    className="btn btn-ghost btn-sm"
                    data-testid="booking-project-statement-link"
                  >
                    Project Statement
                  </Link>
                )}
              </div>
            </Card>
            <Card>
              <h3 className="mb-3 e-caps-blue">Milestones</h3>
              <ol className="space-y-1.5 text-xs">
                {b.block_milestones.map((m) => (
                  <li key={m.seq} className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full ${m.status === "Completed" ? "bg-sage" : "bg-warm-200"}`}
                    />
                    <span className={m.status === "Completed" ? "text-ink-950" : "text-txt-muted"}>
                      {m.name}
                    </span>
                    <span className="ml-auto tabular-nums">{m.cumulative_percent}%</span>
                  </li>
                ))}
              </ol>
              {b.cancellation && (
                <div className="mt-3 rounded-xl bg-brick-50 p-3 text-xs text-brick">
                  Cancelled {fmtDate(b.cancellation.at)}: {b.cancellation.reason}. Refund{" "}
                  {inr(b.cancellation.refund)} · deduction {inr(b.cancellation.deduction)}
                </div>
              )}
            </Card>
          </div>
        </div>
      )}
      {tab === "ledger" && (
        <div className="space-y-6" data-testid="booking-ledger-tab">
          <ThreeLedgers bookingId={id} testId="booking-ledgers" />
          <LedgerTable
            rows={ledger}
            bookingId={id}
            bookingNumber={b.booking_number}
            advance={b.summary?.advance_paise ? b.summary.advance_paise / 100 : 0}
          />
          <LedgerLaw s={s} />
        </div>
      )}
      {tab === "bills" && <BillsToolbar b={b} can={can} />}
      {tab === "bills" && <h3 className="e-caps-blue">Bills</h3>}
      {tab === "bills" && (
        <Table
          head={[
            "Bill",
            "Milestone",
            "%",
            "Date",
            "Due date",
            { l: "Cash", r: 1 },
            { l: "Account", r: 1 },
            { l: "Total", r: 1 },
            { l: "Paid", r: 1 },
            "Status",
            "",
          ]}
          testId="demands-table"
        >
          {b.demands.map((d) => (
            <tr key={d.id} className="border-t">
              <td className="px-3 py-2 font-mono text-xs">
                <span className="inline-flex items-center gap-2">
                  {d.demand_number}
                  <HistoryButton entityType="demand" entityId={d.id} label={d.demand_number} />
                </span>
              </td>
              <td className="px-3 py-2">{d.milestone_name}</td>
              <td className="px-3 py-2">{d.cumulative_percent}%</td>
              <td className="px-3 py-2">{fmtDate(d.demand_date)}</td>
              <td className="px-3 py-2">{fmtDate(d.due_date)}</td>
              <td className="px-3 py-2 text-right tabular">{inr(d.cash_demand)}</td>
              <td className="px-3 py-2 text-right tabular">{inr(d.account_demand)}</td>
              <td className="px-3 py-2 text-right tabular font-semibold">{inr(d.total_demand)}</td>
              <td className="px-3 py-2 text-right tabular">{inr(d.paid)}</td>
              <td className="px-3 py-2">
                <StatusPill status={d.status} />
                {d.paid_detail && (
                  <p
                    className="text-[11px] text-txt-secondary"
                    data-testid={`booking-demand-paid-detail-${d.demand_number}`}
                  >
                    {d.paid_detail}
                  </p>
                )}
              </td>
              <td className="px-3 py-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => window.open(`${BASE_PATH}/print/demand/${id}/${d.id}`, "_blank")}
                  data-testid={`demand-letter-${d.id}`}
                >
                  <Printer className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => openPdf(`/bookings/${id}/demands/${d.id}/letter.pdf`)}
                  title="Download PDF"
                  data-testid={`demand-pdf-${d.id}`}
                >
                  <FileText className="h-3.5 w-3.5" />
                </Button>
              </td>
            </tr>
          ))}
          {b.demands.length === 0 && (
            <tr>
              <td colSpan={11} className="px-3 py-6 text-center text-txt-secondary">
                No demands yet — raised automatically by the payment plan (booking, dates,
                construction stages).
              </td>
            </tr>
          )}
        </Table>
      )}
      {tab === "bills" && <WaiversPanel b={b} can={can} user={user} onChanged={load} />}
      {tab === "bills" && <h3 className="e-caps-blue">Receipts</h3>}
      {tab === "bills" && (
        <Table
          head={[
            "Receipt",
            "Date",
            "Towards",
            "Mode",
            "Instrument",
            { l: "Amount", r: 1 },
            "Status",
            "",
          ]}
          testId="booking-payments-table"
        >
          {b.payments.map((p) => (
            <tr
              key={p.id}
              className={`border-t ${p.status === "Reversed" ? "line-through opacity-60" : ""}`}
            >
              <td className="px-3 py-2 font-mono text-xs">{p.receipt_number}</td>
              <td className="px-3 py-2">{fmtDate(p.payment_date)}</td>
              <td className="px-3 py-2">
                {p.against === "FLAT_VALUE"
                  ? `Flat value · ${p.payment_category}`
                  : p.other_charge_name}
              </td>
              <td className="px-3 py-2">{p.payment_mode_name}</td>
              <td className="px-3 py-2 text-xs">{p.instrument?.number || "—"}</td>
              <td className="px-3 py-2 text-right tabular font-semibold">{inr(p.amount)}</td>
              <td className="px-3 py-2">
                <StatusPill status={p.status} />
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                {can("finance.receipt.print") && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => window.open(`${BASE_PATH}/print/receipt/${p.id}`, "_blank")}
                      data-testid={`receipt-${p.id}`}
                    >
                      <Printer className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => openPdf(`/payments/${p.id}/receipt.pdf`)}
                      title="Download PDF"
                      data-testid={`receipt-pdf-${p.id}`}
                    >
                      <FileText className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
                {p.status === "Pending" && can("finance.payment.create") && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-sage"
                      onClick={() => act(`/payments/${p.id}/clear`, {}, "Cheque cleared")}
                      data-testid={`clear-${p.id}`}
                    >
                      Clear
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-brick"
                      onClick={() =>
                        act(
                          `/payments/${p.id}/bounce`,
                          { reason: "Returned unpaid" },
                          "Marked bounced",
                        )
                      }
                      data-testid={`bounce-${p.id}`}
                    >
                      Bounce
                    </Button>
                  </>
                )}
                {p.status === "Cleared" && can("finance.refund.pay") && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-brick"
                    onClick={() => {
                      const r = window.prompt("Reason for reversal");
                      if (r && r.length >= 3)
                        act(`/payments/${p.id}/reverse`, { reason: r }, "Payment reversed");
                    }}
                    data-testid={`reverse-${p.id}`}
                  >
                    Reverse
                  </Button>
                )}
              </td>
            </tr>
          ))}
          {b.payments.length === 0 && (
            <tr>
              <td colSpan={8} className="px-3 py-6 text-center text-txt-secondary">
                No payments posted.
              </td>
            </tr>
          )}
        </Table>
      )}
      {tab === "bills" && <h3 className="e-caps-blue">Other charges</h3>}
      {tab === "bills" && (
        <Table
          head={[
            "Charge",
            { l: "Amount", r: 1 },
            "GST",
            { l: "Total", r: 1 },
            "Bill",
            { l: "Billed", r: 1 },
            { l: "Paid", r: 1 },
            { l: "Due", r: 1 },
            "",
          ]}
          testId="charges-table"
        >
          {b.other_charges.map((l) => (
            <Fragment key={l.line_id}>
              <tr className="border-t">
                <td className="px-3 py-2 font-medium text-ink-950">{l.name}</td>
                <td className="px-3 py-2 text-right tabular">{inr(l.amount)}</td>
                <td className="px-3 py-2">
                  {l.gst_percent}% ({inr(l.gst)})
                </td>
                <td className="px-3 py-2 text-right tabular font-semibold">{inr(l.total)}</td>
                <td className="px-3 py-2 text-xs">
                  {l.demand_at.replace("_", " ")}
                  {l.parts?.length === 1 &&
                    ` · ${fmtDate(l.parts[0].bill_day)} · due ${fmtDate(l.parts[0].due_on)}`}
                  {l.parts?.length > 1 && ` · ${l.parts.length} parts`}
                </td>
                <td className="px-3 py-2 text-right tabular">{inr(l.demanded)}</td>
                <td className="px-3 py-2 text-right tabular">{inr(l.paid)}</td>
                <td className="px-3 py-2 text-right">
                  <Due v={l.demanded - l.paid} />
                </td>
                <td className="px-3 py-2">
                  {!l.demanded_at && b.status === "Active" && can("sales.booking.edit") && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        act(
                          `/bookings/${id}/other-charges/demand`,
                          { line_id: l.line_id, version: b.version },
                          "Charge billed",
                        )
                      }
                      data-testid={`demand-charge-${l.line_id}`}
                    >
                      Bill now
                    </Button>
                  )}
                </td>
              </tr>
              <OcPartRows line={l} cols={9} />
            </Fragment>
          ))}
          {b.other_charges.length === 0 && (
            <tr>
              <td colSpan={9} className="px-3 py-6 text-center text-txt-secondary">
                No other charges.
              </td>
            </tr>
          )}
        </Table>
      )}
      {tab === "bills" && (
        <section id="refunds" className="space-y-3">
          <h3 className="e-caps-blue">Refunds</h3>
          <RefundsTab
            bookingId={id}
            canPay={can("finance.refund.pay")}
            onChanged={load}
            autoPay={autoRefund}
          />
        </section>
      )}
      {tab === "bills" && (
        <section className="space-y-3">
          <h3 className="e-caps-blue">Payment schedule</h3>
          <BookingScheduleTab bookingId={id} />
        </section>
      )}
      {tab === "documents" && can("documents.document.generate") && (
        <div className="flex justify-end">
          <Link
            to={`/documents?mode=generate&project_id=${b.project_id}&block_id=${b.block_id}&booking_id=${b.id}`}
            className="btn btn-secondary btn-sm"
            data-testid="booking-generate-document"
          >
            Generate document
          </Link>
        </div>
      )}
      {tab === "documents" && (
        <Card>
          <DocumentsPanel entityType="booking" entityId={id} canWrite={can("sales.booking.edit")} />
        </Card>
      )}
      {tab === "activity" && (
        <div
          className="flex flex-wrap items-center justify-between gap-2"
          data-testid="booking-activity-toolbar"
        >
          <h3 className="e-caps-blue">Agreement revisions</h3>
          {can("admin.audit.view") && (
            <JourneyButton entityType="booking" entityId={b.id} className="btn btn-ghost btn-sm" />
          )}
        </div>
      )}
      {tab === "activity" &&
        (b.agreement_revisions.length === 0 ? (
          <EmptyState title="No agreement revisions" />
        ) : (
          <Card className="divide-y divide-warm-100 !p-0" testId="revisions-list">
            {b.agreement_revisions.map((r) => (
              <div key={r.id} className="px-5 py-3 text-sm">
                <p className="font-semibold text-ink-950">
                  {fmtDateTime(r.at)} · {r.by_name}
                </p>
                <p className="text-xs">
                  Cash {inr(r.before.cash_agreed)} → <b>{inr(r.after.cash_agreed)}</b> · Account{" "}
                  {inr(r.before.account_agreed)} → <b>{inr(r.after.account_agreed)}</b> · Total{" "}
                  {inr(r.before.agreement_value)} → <b>{inr(r.after.agreement_value)}</b>
                </p>
                <p className="mt-1 text-xs text-txt-muted">Reason: {r.reason}</p>
              </div>
            ))}
          </Card>
        ))}
      {tab === "activity" && (
        <Card>
          <HistoryTimeline entityType="booking" entityId={id} />
        </Card>
      )}
      {tab === "activity" && <ConnectedTo entity="booking" id={id} />}
      {pay && <PostPayment open={pay} onOpenChange={setPay} bookingId={id} onPosted={load} />}
      {transfer && (
        <TransferDialog open={transfer} onOpenChange={setTransfer} booking={b} onDone={load} />
      )}
      <Dialog open={!!rev} onOpenChange={(o) => !o && setRev(null)}>
        <DialogContent data-testid="revision-dialog">
          <DialogHeader>
            <DialogTitle>Revise agreement</DialogTitle>
            <DialogDescription>
              Each bucket must stay ≥ amount already received (Cash {inr(s.cash_paid)}, Account{" "}
              {inr(s.account_paid)}).
            </DialogDescription>
          </DialogHeader>
          {rev && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Cash agreed ₹">
                  <AmountInput
                    value={rev.cash}
                    onChange={(e) => setRev({ ...rev, cash: e.target.value })}
                    data-testid="rev-cash"
                  />
                </Field>
                <Field label="Account agreed ₹">
                  <AmountInput
                    value={rev.account}
                    onChange={(e) => setRev({ ...rev, account: e.target.value })}
                    data-testid="rev-account"
                  />
                </Field>
              </div>
              <p className="text-sm">
                New agreement value:{" "}
                <b className="text-ink-950">{inr(Number(rev.cash) + Number(rev.account))}</b>
              </p>
              <Field label="Reason" required>
                <TypedMasterInput
                  list="revision_reason"
                  value={rev.reason}
                  onChange={(v) => setRev({ ...rev, reason: v })}
                  placeholder="Why the agreement changes"
                  testId="rev-reason"
                />
              </Field>
              <WhyDisabled
                reason={
                  rev.reason.trim().length < 3 ? "Type the reason (at least 3 characters)" : null
                }
                className="block"
              >
                <Button
                  disabled={rev.reason.trim().length < 3}
                  onClick={revise}
                  className="w-full bg-ink-950 hover:bg-ink-800"
                  data-testid="rev-submit"
                >
                  Save revision
                </Button>
              </WhyDisabled>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={!!cancel} onOpenChange={(o) => !o && setCancel(null)}>
        <DialogContent data-testid="cancel-dialog">
          <DialogHeader>
            <DialogTitle>Cancel booking</DialogTitle>
            <DialogDescription>
              Flat and parking return to Available. Refund cannot exceed{" "}
              {inr(s.paid + s.other_charges_paid)} received.
            </DialogDescription>
          </DialogHeader>
          {cancel && (
            <div className="space-y-3">
              <Field label="Reason" required>
                <TypedMasterInput
                  list="cancel_reason"
                  value={cancel.reason}
                  onChange={(v) => setCancel({ ...cancel, reason: v })}
                  placeholder="Why the booking is cancelled"
                  testId="cancel-reason"
                />
              </Field>
              <Field label="Deduction ₹ (blank = project cancellation policy)">
                <AmountInput
                  value={cancel.deduction}
                  onChange={(e) => setCancel({ ...cancel, deduction: e.target.value })}
                  data-testid="cancel-deduction"
                />
              </Field>
              {preview && (
                <div className="rounded-xl bg-warm-50 p-3 text-xs" data-testid="cancel-refund-hint">
                  <p className="label mb-1">
                    Refund formula (
                    {preview.policy.deduction_base === "received"
                      ? "% of received"
                      : preview.policy.deduction_base === "fixed"
                        ? "fixed"
                        : "% of agreement"}{" "}
                    policy)
                  </p>
                  {preview.lines.map((l, i) => (
                    <div
                      key={l.label}
                      className={
                        `flex justify-between py-0.5 ${l.info ? "text-txt-muted" : ""} ` +
                        `${l.label.startsWith("=") ? "border-t border-warm-200 mt-1 pt-1 font-semibold text-ink-950" : ""}`
                      }
                      data-testid={`cancel-line-${i}`}
                    >
                      <span>{l.label}</span>
                      <span className="font-mono">{inr(l.amount_paise / 100)}</span>
                    </div>
                  ))}
                  <p className="mt-2 text-txt-secondary">
                    {preview.refund_paise > 0
                      ? "A refund record (Pending) is created for Accounts to pay; the payout posts contra ledger rows and a Roznamcha cash-out."
                      : "Nothing refundable → a forfeiture record is created; no payout."}
                  </p>
                </div>
              )}
              <Button
                why={cancel.reason.length < 3 ? "Type a reason (3+ letters)" : undefined}
                disabled={cancel.reason.length < 3}
                onClick={doCancel}
                className="w-full bg-brick hover:bg-brick"
                data-testid="cancel-submit"
              >
                Confirm cancellation
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AgreementSigned({ b, onDone }) {
  const [mode, setMode] = useState("In person");
  const [on, setOn] = useState(businessToday());
  const bookedOn = String(b.booking_date || "").slice(0, 10);
  const why = !on
    ? "Pick the signing date"
    : on > businessToday()
      ? "The signing date cannot be in the future"
      : on < bookedOn
        ? "The signing date cannot be before the booking date"
        : null;
  const signed = b.plan_acceptance?.marked_at;
  if (signed)
    return (
      <span
        className="pill border border-sage bg-sage-50 text-sage"
        data-testid="agreement-signed-pill"
      >
        Agreement signed · {b.plan_acceptance.mode} · {b.plan_acceptance.accepted_on}
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1" data-testid="agreement-signed">
      <Select
        options={["In person", "WhatsApp", "Email", "Courier"].map((m) => ({ value: m, label: m }))}
        value={mode}
        onChange={(v) => setMode(v || "In person")}
        allowAdd={false}
        clearable={false}
        className="!w-36"
        testId="agreement-signed-mode"
      />
      <DateInput
        value={on}
        min={bookedOn}
        max={businessToday()}
        onChange={(e) => setOn(e.target.value)}
        className="!h-9 !w-40"
        data-testid="agreement-signed-on"
      />
      <WhyDisabled reason={why}>
        <Button
          variant="outline"
          className="btn btn-ghost"
          disabled={!!why}
          onClick={async () => {
            try {
              await api.post(`/bookings/${b.id}/agreement-signed`, { mode, signed_on: on });
              onDone("Agreement marked signed");
            } catch (e) {
              toast.error(errMsg(e));
            }
          }}
          data-testid="agreement-signed-btn"
        >
          Mark agreement signed
        </Button>
      </WhyDisabled>
    </span>
  );
}
