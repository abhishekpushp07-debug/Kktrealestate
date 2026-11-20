import { useCallback, useEffect, useMemo, useState } from "react";
import { pick, branch } from "@/lib/branch";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { CompletenessRing } from "@/components/v2/Completeness";
import {
  BadgeCheck,
  CalendarDays,
  Copy,
  FileText,
  LifeBuoy,
  Mail,
  MessageCircle,
  MessageSquare,
  Pencil,
  Phone,
  Plus,
  Printer,
  Receipt,
} from "lucide-react";
import { toast } from "sonner";
import { HistoryButton } from "@/components/common/HistoryTimeline";
import { TrendSpark } from "@/components/common/TrendSpark";
import api, { errMsg, BASE_PATH } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useFetch } from "@/hooks/useList";
import { useCatalogues } from "@/hooks/useCatalogues";
import { cn } from "@/lib/utils";
import { MemberCards } from "@/components/customer/MemberCard";
import { QuickActions } from "@/components/customer/QuickActions";
import { fmtDate, inr, inrShort } from "@/lib/format";
import { Card, EmptyState, Skeleton, StatusPill } from "@/components/v2";
import { Avatar, CommSheet, ThreeLedgers, usePeople } from "@/components/v2/CustomerBits";
import { PostPayment } from "@/components/v2/PostPayment";
import { C360Actions, DocsToolbar, MoneyToolbar } from "@/components/v2/C360Actions";
import { CustomerLifecycle, MergedBanner, reactivate } from "@/components/v2/CustomerLifecycle";
import { DocumentsPanel } from "@/components/common/DocumentsPanel";
import { PortalAccessCard } from "@/components/common/PortalAccessCard";
import {
  C360Timeline,
  BookingRich,
  DemandsTab,
  ReceiptsDocsTab,
  ConstructionTab,
  ProfileTab,
} from "@/components/v2/C360Tabs";
import { KycBadge, KycSlots } from "@/components/common/KycSlots";
import { SendReminderButton } from "@/components/common/SendReminderButton";

import { ConnectedTo } from "@/components/common/ConnectedTo";
import { Button } from "@/components/ui/button";

// REQ-119: exactly five tabs; older ?tab= links land on the tab that now holds their content
const TABS = ["overview", "bookings", "money", "kyc", "activity"];
const LEGACY_TAB = {
  ledger: "money",
  demands: "money",
  receipts: "money",
  construction: "bookings",
  service: "activity",
  timeline: "activity",
  notes: "activity",
  coapplicants: "kyc",
};
const LABEL = {
  overview: "Overview",
  bookings: "Bookings",
  money: "Money",
  kyc: "Documents & KYC",
  activity: "Activity",
};
const KEYS = ["1", "2", "3", "4", "5"];

function Tile({ label, value, hint, tone, testId, spark }) {
  return (
    <div
      className={cn("min-h-[88px] rounded-[18px] border border-warm-200 bg-white px-4 py-3")}
      data-testid={testId}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="e-caps !text-[10.5px] !tracking-[0.2em]">{label}</p>
          <p
            className={cn(
              "mt-1 whitespace-nowrap font-display text-[19px] leading-7 tabular-nums text-ink-950 sm:text-[22px]",
              tone === "brick" && "text-brick",
              tone === "sage" && "text-sage",
            )}
          >
            {value}
          </p>
          {hint && <p className="mt-0.5 truncate text-[11px] text-txt-secondary">{hint}</p>}
        </div>
        {spark}
      </div>
    </div>
  );
}

export default function Customer360() {
  const { id } = useParams();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const { can, surfaces, user } = useAuth();
  const [life, setLife] = useState(null);
  const { label } = useCatalogues();
  const people = usePeople();
  const [c, setC] = useState(null);
  const [reveal, setReveal] = useState(false);
  const [comm, setComm] = useState(false);
  const [pay, setPay] = useState(false);
  const rawTab = LEGACY_TAB[sp.get("tab")] || sp.get("tab");
  const tab = TABS.includes(rawTab) ? rawTab : "overview";
  const setTab = useCallback(
    (t) => {
      const n = new URLSearchParams(sp);
      n.set("tab", t);
      setSp(n, { replace: true });
    },
    [sp, setSp],
  );
  const inclCancelled = sp.get("cancelled") === "1";
  const panels = useFetch(
    `/customers/${id}/panels${inclCancelled ? "?include_cancelled=true" : ""}`,
  );
  const { data: tr } = useFetch(`/trends?scope=customer&id=${id}&months=12`);
  const P = panels.data;
  const load = useCallback(
    (rev = false) =>
      api
        .get(`/customers/${id}`, { params: { reveal: rev || undefined } })
        .then((r) => {
          if (r.data.id !== id) {
            nav(`/customers/${r.data.id}`, { replace: true });
            return;
          }
          setC(r.data);
          setReveal(rev);
        })
        .catch((e) => toast.error(errMsg(e))),
    [id, nav],
  );
  useEffect(() => {
    load(false);
  }, [load]);
  useEffect(() => {
    const h = (e) => {
      if (e.target.closest("input,textarea,select,[contenteditable]")) return;
      const i = KEYS.indexOf(e.key);
      if (i >= 0 && i < TABS.length) {
        e.preventDefault();
        setTab(TABS[i]);
      }
      if (e.key === "/") {
        e.preventDefault();
        document.querySelector("[data-testid=c360-search]")?.focus();
      }
      if (e.key === "p" && can("finance.payment.create")) setPay(true);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [setTab, can]);
  const counts = useMemo(
    () => ({
      bookings: c?.bookings.length,
      demands: P?.counts.demands,
      receipts: P?.counts.receipts,
      construction: P?.counts.construction,
      service: P?.counts.tickets,
      coapplicants: c?.co_applicants.length,
    }),
    [c, P],
  );
  if (!c)
    return (
      <div className="space-y-6" data-testid="c360-skeleton">
        <Skeleton className="h-52 rounded-2xl" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
          {Array.from({ length: 4 }, (_, n) => n).map((n) => (
            <Skeleton key={n} className="h-[88px] rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );
  const active = c.bookings.filter((b) => b.status === "Active");
  const rm = people.find((p) => p.value === c.assigned_sales_user_id)?.label;
  const S = P?.summary;
  const phone = (c.phone || "").replace(/\D/g, "");
  const copy = (t) => {
    navigator.clipboard?.writeText(t);
    toast.success("Copied");
  };
  const vip = (c.segment_ids || []).some((s) =>
    /vip|hni|premium/i.test(label("customer_segment", s) || ""),
  );
  const Act = ({ icon: I, label: l, onClick, to, href, testId, primary }) => {
    const cls = cn("btn btn-sm", primary ? "btn-primary" : "btn-secondary");
    const body = (
      <>
        <I className="h-3.5 w-3.5" strokeWidth={1.75} />
        <span className="hidden xl:inline">{l}</span>
      </>
    );
    return branch(
      to,
      () => (
        <Link to={to} className={cls} title={l} data-testid={testId}>
          {body}
        </Link>
      ),
      href,
      () => (
        <a
          href={href}
          target={href.startsWith("http") ? "_blank" : undefined}
          rel="noreferrer"
          className={cls}
          title={l}
          data-testid={testId}
        >
          {body}
        </a>
      ),
      () => (
        <button onClick={onClick} className={cls} title={l} data-testid={testId}>
          {body}
        </button>
      ),
    );
  };
  return (
    <div className="space-y-6" data-testid="customer-360">
      <MergedBanner c={c} />
      {life && (
        <CustomerLifecycle c={c} action={life} onClose={() => setLife(null)} onDone={load} />
      )}
      <Card className="!p-6 print:!p-0" testId="customer-hero">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <div className={cn("rounded-full p-[3px]", vip ? "bg-gold" : "bg-transparent")}>
              <Avatar name={c.full_name} size={64} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h1
                  className="font-display text-[28px] leading-tight text-ink-950"
                  data-testid="hero-title"
                >
                  {c.salutation ? `${c.salutation} ` : ""}
                  {c.full_name}
                </h1>
                <span
                  className="font-mono text-sm text-txt-secondary"
                  data-testid="hero-cust-number"
                >
                  {c.customer_code}
                </span>
                <HistoryButton entityType="customer" entityId={c.id} label="History" />
              </div>
              <div
                className="mt-2 flex flex-wrap items-center gap-1.5 text-xs"
                data-testid="hero-chips"
              >
                {(c.segment_ids || []).length
                  ? (c.segment_ids || []).map((s) => (
                      <span
                        key={s}
                        className={cn(
                          "pill",
                          vip
                            ? "bg-gold-light text-[var(--accent)]"
                            : "bg-warm-100 text-txt-secondary",
                        )}
                        data-testid="chip-segment"
                      >
                        {label("customer_segment", s)}
                      </span>
                    ))
                  : null}
                <span
                  className={cn(
                    "pill",
                    c.kyc_status === "Verified"
                      ? "bg-gold-light text-[var(--accent)]"
                      : "bg-warm-100 text-txt-secondary",
                  )}
                >
                  {c.kyc_status === "Verified" && <BadgeCheck className="h-3.5 w-3.5" />}KYC{" "}
                  {c.kyc_status}
                </span>
                {rm && (
                  <span className="pill border border-warm-200 bg-white text-txt-secondary">
                    <Avatar name={rm} size={16} className="!text-[8px]" />
                    RM · {rm}
                  </span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 text-sm text-txt-secondary">
                <span>Customer since {fmtDate(c.created_at)}</span>
                {P && (
                  <span data-testid="chip-portal">
                    Portal {P.portal_enabled ? "active" : "not enabled"}
                  </span>
                )}
                <span className="flex items-center gap-1.5">
                  <Phone className="h-4 w-4" />
                  {c.phone}
                </span>
                {c.email && (
                  <span className="flex items-center gap-1.5">
                    <Mail className="h-4 w-4" />
                    {c.email}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div
            className="flex flex-wrap items-center gap-1.5 print:hidden"
            data-testid="hero-actions"
          >
            <C360Actions
              c={c}
              headerOnly
              active={active}
              can={can}
              onPay={() => setPay(true)}
              onNote={() => setComm(true)}
              onTab={setTab}
              portal={surfaces?.customer_portal}
            />
          </div>
        </div>
      </Card>
      {S?.cancelled?.count > 0 && (
        <div
          className="flex flex-wrap items-center gap-3 text-xs text-txt-secondary print:hidden"
          data-testid="cancelled-rule"
        >
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={inclCancelled}
              onChange={(e) => {
                const n = new URLSearchParams(sp);
                if (e.target.checked) n.set("cancelled", "1");
                else n.delete("cancelled");
                setSp(n, { replace: true });
              }}
              data-testid="include-cancelled-toggle"
            />
            Include {S.cancelled.count} cancelled {S.cancelled.count === 1 ? "booking" : "bookings"}{" "}
            in totals
          </label>
          <span className="text-txt-muted">
            Cancelled: received {inrShort(S.cancelled.received_paise / 100)} · forfeited{" "}
            {inrShort(S.cancelled.forfeiture_paise / 100)} · refund{" "}
            {inrShort(S.cancelled.refund_paise / 100)}
          </span>
        </div>
      )}
      <div className="flex flex-col gap-5 xl:flex-row xl:items-start">
        <MemberCards customerId={c.id} />
        <div className="min-w-0 flex-1 space-y-4">
          <div className="grid grid-cols-2 gap-3" data-testid="key-strip">
            {!S ? (
              Array.from({ length: 4 }, (_, n) => n).map((n) => (
                <Skeleton key={n} className="h-[88px] rounded-2xl" />
              ))
            ) : (
              <>
                <Tile
                  label="Agreement"
                  value={inrShort(S.agreement_paise / 100)}
                  hint={`${P.counts.bookings} ${inclCancelled ? "" : "live "}${P.counts.bookings === 1 ? "booking" : "bookings"}`}
                  testId="kn-agreement"
                />
                <Tile
                  label="Billed"
                  value={inrShort(S.bill_raised_paise / 100)}
                  hint="Cash · Account · Other"
                  testId="kn-bill_raised"
                  spark={
                    tr && (
                      <TrendSpark
                        months={tr.months}
                        values={tr.demands}
                        label="Bills raised"
                        w={64}
                        h={26}
                        linkFor={(m) =>
                          `/demands?customer=${c.customer_code}&basis=raised&date_from=${m}-01&date_to=${m}-31`
                        }
                        testId="kn-bill_raised-spark"
                      />
                    )
                  }
                />
                <Tile
                  label="Received"
                  value={inrShort(S.received_paise / 100)}
                  hint={
                    S.pending_cheques_paise > 0
                      ? `+ ${inrShort(S.pending_cheques_paise / 100)} cheques in hand`
                      : "cleared"
                  }
                  tone="sage"
                  testId="kn-received"
                  spark={
                    tr && (
                      <TrendSpark
                        months={tr.months}
                        values={tr.collections}
                        label="Collections"
                        w={64}
                        h={26}
                        linkFor={(m) =>
                          `/payments?customer_id=${id}&date_from=${m}-01&date_to=${m}-31`
                        }
                        testId="kn-received-spark"
                      />
                    )
                  }
                />
                <Tile
                  label="Balance"
                  value={
                    S.balance_paise === 0 && !S.overdue_paise
                      ? "All clear"
                      : inrShort(Math.abs(S.balance_paise) / 100)
                  }
                  hint={
                    S.overdue_count
                      ? `Due · overdue ${S.overdue_oldest_days} days`
                      : pick(
                          S.balance_paise > 0,
                          "Due",
                          S.balance_paise < 0,
                          "Advance",
                          "Nothing due",
                        )
                  }
                  tone={pick(S.overdue_count, "brick", S.balance_paise > 0, undefined, "sage")}
                  testId="kn-balance"
                  spark={
                    tr && (
                      <TrendSpark
                        months={tr.months}
                        values={tr.outstanding_eom}
                        label="Bills unpaid at month end"
                        w={64}
                        h={26}
                        testId="kn-balance-spark"
                      />
                    )
                  }
                />
              </>
            )}
          </div>
          <QuickActions
            c={c}
            can={can}
            onPay={() => setPay(true)}
            more={
              <C360Actions
                c={c}
                round
                active={active}
                can={can}
                onPay={() => setPay(true)}
                onNote={() => setComm(true)}
                onTab={setTab}
                portal={surfaces?.customer_portal}
                onCopy={() => copy(c.phone)}
                superAdmin={user?.role_name === "Super Admin"}
                onLifecycle={(a) => (a === "reactivate" ? reactivate(c, load) : setLife(a))}
              />
            }
          />
        </div>
      </div>
      <div
        className="sticky top-0 z-20 -mx-2 overflow-x-auto border-b border-warm-200 bg-warm-50/90 px-2 backdrop-blur print:hidden"
        role="tablist"
        data-testid="c360-tabs"
      >
        <div className="flex gap-5">
          {TABS.map((t, i) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cn("tab whitespace-nowrap", tab === t && "active")}
              title={`Press ${KEYS[i]}`}
              data-testid={`tab-${t}`}
            >
              {LABEL[t]}
              {counts[t] != null && (
                <span className="ml-1.5 rounded-full bg-warm-100 px-1.5 py-0.5 text-[10px] text-txt-secondary">
                  {counts[t]}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
      <div data-testid={`c360-panel-${tab}`}>
        {tab === "overview" && <Overview c={c} P={P} id={id} can={can} />}
        {tab === "bookings" && c.bookings.length > 0 && can("sales.booking.create") && (
          <div className="mb-4 flex justify-end">
            <Link
              to={`/bookings/new?customer_id=${id}`}
              className="btn btn-secondary btn-sm"
              data-testid="c360-bookings-new-booking"
            >
              <Plus className="h-3.5 w-3.5" /> New booking
            </Link>
          </div>
        )}
        {tab === "bookings" &&
          (c.bookings.length === 0 ? (
            <EmptyState
              title="No bookings yet"
              description="Start a booking to open the ledgers."
              action={
                can("sales.booking.create") && (
                  <Link
                    to={`/bookings/new?customer_id=${id}`}
                    className="btn btn-primary btn-sm"
                    data-testid="c360-new-booking"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    New booking
                  </Link>
                )
              }
              testId="bookings-empty"
            />
          ) : (
            <div className="grid gap-5 lg:grid-cols-2">
              {c.bookings.map((b) => (
                <BookingRich
                  key={b.id}
                  b={b}
                  plan={(P?.plans || []).find((p) => p.booking_id === b.id)}
                  can={can}
                  onPay={() => setPay(true)}
                />
              ))}
            </div>
          ))}
        {tab === "money" && <MoneyToolbar active={active} can={can} />}
        {tab === "money" &&
          (can("finance.ledger.view") ? (
            <ThreeLedgers customerId={id} testId="customer-ledgers" />
          ) : (
            <EmptyState title="No permission" description="finance.ledger.view required" />
          ))}
        {tab === "money" && (
          <DemandsTab items={P?.demands.items || []} loading={panels.loading} can={can} />
        )}
        {tab === "money" && (
          <ReceiptsDocsTab
            receipts={P?.receipts.items || []}
            docs={P?.generated_documents.items || []}
            can={can}
            kyc={null}
          />
        )}
        {tab === "bookings" && (
          <ConstructionTab items={P?.construction || []} photos={P?.photos || []} />
        )}
        {tab === "activity" && (
          <Card testId="service-tab">
            <div className="flex items-center justify-between">
              <h3 className="e-caps-blue">Open tickets</h3>
              {can("service.ticket.create") && (
                <Link
                  to={`/service-requests?new=1&customer_id=${id}`}
                  className="btn btn-secondary btn-sm"
                >
                  New ticket
                </Link>
              )}
            </div>
            {(P?.tickets.items || []).length === 0 ? (
              <p className="mt-3 text-sm text-txt-muted">No open tickets.</p>
            ) : (
              <ul className="mt-3 divide-y divide-warm-100">
                {P.tickets.items.map((t) => (
                  <li key={t.id} className="flex items-center justify-between py-2 text-sm">
                    <Link
                      to={`/service-requests/${t.id}`}
                      className="font-semibold text-ink-950 hover:text-gold"
                    >
                      {t.ticket_number} · {t.subject}
                    </Link>
                    <StatusPill status={t.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
        {tab === "activity" && <C360Timeline id={id} />}
        {tab === "kyc" && <DocsToolbar c={c} active={active} can={can} />}
        {tab === "kyc" && (
          <Card testId="c360-kyc-documents">
            <DocumentsPanel
              entityType="customer"
              entityId={id}
              canWrite={can("sales.customer.edit")}
              initial={P ? { items: P.documents.items, types: P.document_types.items } : null}
            />
          </Card>
        )}
        {tab === "kyc" && (
          <ProfileTab
            c={c}
            reveal={reveal}
            onReveal={() => load(!reveal)}
            can={can}
            label={label}
            onSaved={() => load(reveal)}
            onKyc={async (v) => {
              try {
                await api.post(`/customers/${id}/kyc-status`, {
                  kyc_status: v,
                  version: c.version,
                });
                toast.success(`KYC ${v}`);
                load(reveal);
              } catch (e) {
                toast.error(errMsg(e));
              }
            }}
            portal={surfaces?.customer_portal && <PortalAccessCard customerId={id} />}
          />
        )}
        {tab === "kyc" && (
          <Card testId="coapplicants-card" id="coapplicants">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="e-caps-blue">Co-applicants & nominee</h3>
              <KycBadge k={c.kyc_completeness} testId="c360-kyc-badge" />
            </div>
            {c.co_applicants.length === 0 && !c.nominee?.name && (
              <p className="mt-2 text-sm text-txt-muted">None recorded.</p>
            )}
            <ul className="mt-3 grid gap-2 md:grid-cols-2">
              {c.co_applicants.map((a, i) => (
                <li
                  key={a.customer_id || a.id || a.full_name}
                  className="rounded-xl bg-warm-50 p-3"
                  data-testid={`c360-coapp-${i}`}
                >
                  <div className="flex items-center gap-3">
                    <Avatar name={a.name} size={32} />
                    <div>
                      <p className="text-sm font-semibold text-ink-950">{a.name}</p>
                      <p className="text-xs text-txt-secondary">
                        {[a.relation, a.phone].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                  </div>
                  {a.id && (
                    <div className="mt-2">
                      <KycSlots
                        coId={a.id}
                        value={a.kyc || {}}
                        customerId={c.id}
                        onChange={() => load(reveal)}
                        testId={`c360-coapp-kyc-${i}`}
                      />
                    </div>
                  )}
                </li>
              ))}
              {c.nominee?.name && (
                <li className="flex items-center gap-3 rounded-xl border border-dashed border-warm-200 p-3">
                  <Avatar name={c.nominee.name} size={32} />
                  <div>
                    <p className="text-sm font-semibold text-ink-950">
                      {c.nominee.name}{" "}
                      <span className="pill bg-warm-100 text-txt-secondary">Nominee</span>
                    </p>
                    <p className="text-xs text-txt-secondary">{c.nominee.relation}</p>
                  </div>
                </li>
              )}
            </ul>
          </Card>
        )}
        {tab === "activity" && (
          <Card className="!p-0" testId="comms-card">
            <div className="flex items-center justify-between px-6 pt-5">
              <h3 className="e-caps-blue">Notes & communication</h3>
              {can("sales.customer.edit") && (
                <Button
                  onClick={() => setComm(true)}
                  variant="soft"
                  size="compact"
                  data-testid="log-comm-btn"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add note
                </Button>
              )}
            </div>
            {c.notes && (
              <p className="mx-6 mt-3 rounded-xl bg-warm-50 p-3 text-xs text-txt-secondary">
                {c.notes}
              </p>
            )}
            <ul className="mt-3 divide-y divide-warm-100">
              {(P?.communications.items || []).length === 0 && (
                <li className="px-6 py-6 text-center text-sm text-txt-muted">No notes yet.</li>
              )}
              {(P?.communications.items || []).map((m) => (
                <li key={m.id} className="px-6 py-3">
                  <p className="text-sm font-semibold text-ink-950">
                    {m.type_label || label("communication_type", m.type_id)}
                    {m.outcome_id && (
                      <span className="font-normal text-txt-secondary">
                        {" "}
                        · {m.outcome_label || label("communication_outcome", m.outcome_id)}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-txt-secondary">{m.notes || "—"}</p>
                  <p className="mt-0.5 text-[11px] text-txt-muted">
                    {m.by_name || m.user_name || ""} · {fmtDate(m.happened_at || m.created_at)}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
      <CommSheet
        open={comm}
        onOpenChange={setComm}
        customerId={id}
        onSaved={() => {
          panels.reload();
          load(reveal);
        }}
      />
      {pay && (
        <PostPayment
          open={pay}
          onOpenChange={setPay}
          customerId={id}
          bookingId={active.length === 1 ? active[0].id : undefined}
          onPosted={() => {
            load(reveal);
            panels.reload();
          }}
        />
      )}
    </div>
  );
}

function Overview({ c, P, id, can }) {
  const n = P?.next_due;
  return (
    <div className="grid gap-5 lg:grid-cols-3" data-testid="overview-grid">
      <Card className={cn("lg:col-span-2", n?.overdue && "border-brick/40")} testId="next-due-card">
        <p className="label-xs">Next due</p>
        {branch(
          !P,
          () => (
            <Skeleton className="mt-2 h-16" />
          ),
          !n,
          () => (
            <p className="mt-2 text-sm text-txt-muted">
              Nothing due — all bills settled and no planned installment pending.
            </p>
          ),
          () => (
            <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="font-display text-xl text-ink-950">{n.what}</p>
                <p className="text-xs text-txt-secondary">
                  {n.why}
                  {n.booking_number ? ` · ${n.booking_number}` : ""}
                </p>
                <p
                  className={cn(
                    "mt-1 text-xs font-semibold",
                    n.overdue ? "text-brick" : "text-txt-secondary",
                  )}
                >
                  {n.when
                    ? `${pick(n.overdue, "Overdue since", n.kind === "demand", "Due on", "Expected")} ${fmtDate(n.when)}`
                    : "Due today"}
                </p>
              </div>
              <div className="text-right">
                <p className="font-display text-2xl tabular-nums text-ink-950">
                  {inr((n.amount_paise || 0) / 100)}
                </p>
              </div>
            </div>
          ),
        )}
      </Card>
      <Card testId="open-tickets-card">
        <p className="label-xs">Open tickets</p>
        {(P?.tickets.items || []).length === 0 ? (
          <p className="mt-2 text-sm text-txt-muted">None</p>
        ) : (
          P.tickets.items.slice(0, 3).map((t) => (
            <p key={t.id} className="mt-2 truncate text-sm">
              <Link
                to={`/service-requests/${t.id}`}
                className="font-semibold text-ink-950 hover:text-gold"
              >
                {t.ticket_number}
              </Link>{" "}
              · {t.subject}
            </p>
          ))
        )}
      </Card>
      <Card className="lg:col-span-2" testId="overview-bookings">
        <div className="flex items-center justify-between">
          <p className="label-xs">Bookings</p>
          {can("sales.booking.create") && (
            <Link
              to={`/bookings/new?customer_id=${id}`}
              className="text-xs font-semibold text-ink-950 hover:text-gold"
              data-testid="c360-new-booking"
            >
              + New booking
            </Link>
          )}
        </div>
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          {c.bookings.map((b) => (
            <Link
              key={b.id}
              to={`/bookings/${b.id}`}
              className="rounded-xl border border-warm-200 p-3 hover:border-gold"
              data-testid={`booking-mini-${b.booking_number}`}
            >
              <div className="flex items-center justify-between">
                <p className="truncate text-sm font-semibold text-ink-950">
                  {[b.block_name, b.flat_snapshot?.flat_number].filter(Boolean).join(" · ")}
                </p>
                <StatusPill status={b.status} />
              </div>
              <p className="text-xs text-txt-secondary">
                {b.booking_number} · {b.plan_summary?.plan_name || "No plan"}
              </p>
              {b.summary && (
                <p className="mt-1 text-xs tabular-nums text-txt-secondary">
                  Billed {inrShort(b.summary.total_bill_raised_paise / 100)} · Received{" "}
                  {inrShort(b.summary.total_received_paise / 100)} ·{" "}
                  <BookingBalance v={b.summary.balance_signed_paise} />
                </p>
              )}
            </Link>
          ))}
          {c.bookings.length === 0 && <p className="text-sm text-txt-muted">No bookings yet.</p>}
        </div>
      </Card>
      <ConnectedTo entity="customer" id={id} defaultOpen={["bookings"]} />
      <Card testId="overview-docs">
        <p className="label-xs">Recent documents</p>
        {(P?.generated_documents.items || []).length === 0 ? (
          <p className="mt-2 text-sm text-txt-muted">Nothing generated yet.</p>
        ) : (
          P.generated_documents.items.slice(0, 5).map((d) => (
            <p key={d.id} className="mt-2 flex items-center justify-between gap-2 text-sm">
              <span className="truncate">
                <span className="font-semibold text-ink-950">{d.type_name}</span> · {d.number}
              </span>
              <a
                href={`${BASE_PATH}/api/docgen/${d.id}/download`}
                target="_blank"
                rel="noreferrer"
                className="text-txt-secondary hover:text-ink-950"
                aria-label={`Download ${d.type_name} ${d.number}`}
                data-testid={`c360-doc-download-${d.id}`}
              >
                <Printer className="h-3.5 w-3.5" aria-hidden />
              </a>
            </p>
          ))
        )}
      </Card>
      <div className="lg:col-span-2">
        <C360Timeline id={id} compact />
      </div>
      <Card testId="overview-notes">
        <p className="label-xs">RM notes</p>
        {(P?.communications.items || []).slice(0, 4).map((m) => (
          <p key={m.id} className="mt-2 text-xs text-txt-secondary">
            <span className="font-semibold text-ink-950">
              {fmtDate(m.happened_at || m.created_at)}
            </span>{" "}
            · {m.notes || m.type_label}
          </p>
        ))}
        {(P?.communications.items || []).length === 0 && (
          <p className="mt-2 text-sm text-txt-muted">No notes.</p>
        )}
      </Card>
    </div>
  );
}

// balance_signed = received − billed: negative → due, positive → advance
function BookingBalance({ v }) {
  if (v < 0) return <span className="text-ink-950">Due {inrShort(-v / 100)}</span>;
  if (v > 0) return <span className="text-sage">Advance {inrShort(v / 100)}</span>;
  return <span className="text-sage">All clear</span>;
}
