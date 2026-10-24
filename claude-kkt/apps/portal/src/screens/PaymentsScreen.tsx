import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { LEDGER_EVENT_LABELS, SCHEDULE_STATUS_LABELS, TRIGGER_TYPE_LABELS, type PortalDemandRow, type PortalLedgerRow, type PortalReceiptRow, type PortalScheduleRow } from "@kkt/contracts";
import { api } from "@/api/client";
import { refreshBooking, useDemands, useLedger, useReceipts, useSchedule } from "@/api/queries";
import { daysUntil, formatDate, formatINR } from "@/lib/format";
import { Card, Divider } from "@/ui/Card";
import { BucketChip, Chip, DemandStatusChip, PaymentStatusChip, ScheduleStatusChip } from "@/ui/Chip";
import { Icon } from "@/ui/Icon";
import { DueMoney, Money } from "@/ui/Money";
import { ProgressBar } from "@/ui/ProgressRing";
import { useLayout } from "@/ui/Responsive";
import { Screen } from "@/ui/Screen";
import { SegmentedControl } from "@/ui/SegmentedControl";
import { SkeletonRows } from "@/ui/Skeleton";
import { EmptyState, ErrorState, Notice, StatusBar } from "@/ui/States";
import { Table } from "@/ui/Table";
import { T } from "@/ui/Text";
import { colors, radius, space } from "@/ui/theme";
import { BookingGate, PdfButtons, TabHeader, useFileActions } from "./shared";

type Tab = "receipts" | "ledger" | "demands" | "schedule";
const TABS: ReadonlyArray<{ key: Tab; label: string }> = [
  { key: "receipts", label: "Receipts" },
  { key: "ledger", label: "Ledger" },
  { key: "demands", label: "Demands" },
  { key: "schedule", label: "Schedule" },
];
const isTab = (v: unknown): v is Tab => v === "receipts" || v === "ledger" || v === "demands" || v === "schedule";

export function PaymentsScreen(): React.JSX.Element {
  return <BookingGate title="Payments">{(id) => <Body bookingId={id} />}</BookingGate>;
}

function Body({ bookingId }: { bookingId: string }): React.JSX.Element {
  const params = useLocalSearchParams<{ tab?: string }>();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(isTab(params.tab) ? params.tab : "receipts");
  useEffect(() => {
    if (isTab(params.tab)) setTab(params.tab);
  }, [params.tab]);
  const change = (t: Tab) => {
    setTab(t);
    router.setParams({ tab: t });
  };
  const schedule = useSchedule(bookingId);
  const pendingCheques = schedule.data?.pending_cheques ?? [];
  return (
    <View style={{ flex: 1, backgroundColor: colors.ivory }}>
      <TabHeader title="Payments">
        <SegmentedControl segments={TABS} value={tab} onChange={change} />
      </TabHeader>
      <Screen onRefresh={() => refreshBooking(bookingId)}>
        {pendingCheques.length > 0 && tab !== "schedule" ? (
          <Notice tone="warning" icon="clock" title={`${pendingCheques.length} cheque${pendingCheques.length > 1 ? "s" : ""} pending clearance · ${formatINR(pendingCheques.reduce((s, c) => s + c.amount_paise, 0))}`} body="Pending cheques appear as “cheques in hand” and count towards paid only once they clear." />
        ) : null}
        {tab === "receipts" ? <Receipts bookingId={bookingId} /> : null}
        {tab === "ledger" ? <Ledger bookingId={bookingId} /> : null}
        {tab === "demands" ? <Demands bookingId={bookingId} /> : null}
        {tab === "schedule" ? <Schedule bookingId={bookingId} /> : null}
      </Screen>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------

function Receipts({ bookingId }: { bookingId: string }): React.JSX.Element {
  const q = useReceipts(bookingId);
  const files = useFileActions();
  const rows = q.data?.items ?? [];
  if (!q.data) return q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : <SkeletonRows rows={5} />;
  if (rows.length === 0) return <EmptyState icon="rupee" title="No receipts yet" body="Receipts appear here as soon as a payment is recorded against your booking." />;
  return (
    <>
      {q.isError ? <StatusBar text="Showing saved receipts — couldn't refresh." tone="warning" /> : null}
      <View style={{ gap: space.md }}>
        {rows.map((r) => (
          <ReceiptCard key={r.payment_id} r={r} bookingId={bookingId} files={files} />
        ))}
      </View>
    </>
  );
}

function ReceiptCard({ r, bookingId, files }: { r: PortalReceiptRow; bookingId: string; files: ReturnType<typeof useFileActions> }): React.JSX.Element {
  return (
    <Card style={r.is_cancelled ? { opacity: 0.7 } : null}>
      <View style={styles.rowHead}>
        <View style={{ flex: 1, gap: 2 }}>
          <T variant="caption" color={colors.inkSubtle}>
            {r.receipt_number} · {formatDate(r.payment_date)}
          </T>
          <T variant="bodyStrong">{r.against_label}</T>
          <T variant="small" color={colors.inkMuted}>
            {r.mode_name}
            {r.instrument_number ? ` · ${r.instrument_number}` : ""}
          </T>
        </View>
        <View style={{ alignItems: "flex-end", gap: 6 }}>
          <Money paise={r.amount_paise} variant="h3" color={r.is_cancelled ? colors.inkSubtle : colors.navy} style={r.is_cancelled ? { textDecorationLine: "line-through" } : null} />
          <View style={styles.chips}>
            <BucketChip bucket={r.bucket} />
            <PaymentStatusChip status={r.status} cancelled={r.is_cancelled} small />
          </View>
        </View>
      </View>
      <Divider style={{ marginVertical: space.sm }} />
      <View style={styles.rowFoot}>
        {r.status === "PENDING" ? (
          <T variant="caption" color={colors.warning} style={{ flex: 1 }}>
            Subject to realisation
          </T>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        <PdfButtons keyBase={`receipt:${r.payment_id}`} fetchLink={() => api.bookings.receiptPdf(bookingId, r.payment_id)} actions={files} />
      </View>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

function Ledger({ bookingId }: { bookingId: string }): React.JSX.Element {
  const q = useLedger(bookingId);
  const { isPhone } = useLayout();
  const rows = q.data?.items ?? [];
  if (!q.data) return q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : <SkeletonRows rows={6} />;
  if (rows.length === 0) return <EmptyState icon="document" title="Ledger is empty" body="Demands and payments will be listed here in order, with running totals." />;
  const last = rows[rows.length - 1];
  return (
    <>
      {q.isError ? <StatusBar text="Showing saved ledger — couldn't refresh." tone="warning" /> : null}
      {last ? (
        <Card tone="gold">
          <View style={styles.summaryRow}>
            <Summary label="Cash paid" value={<Money paise={last.cash_paid_paise} />} />
            <Summary label="Account paid" value={<Money paise={last.account_paid_paise} />} />
            <Summary label="Cash due" value={<DueMoney paise={last.cash_due_paise} showZeroLabel={false} />} />
            <Summary label="Account due" value={<DueMoney paise={last.account_due_paise} showZeroLabel={false} />} />
            <Summary label="Total due" value={<DueMoney paise={last.total_due_paise} variant="h3" showZeroLabel={false} />} />
          </View>
        </Card>
      ) : null}
      {isPhone ? (
        <View style={{ gap: space.sm }}>
          {rows.map((r) => (
            <LedgerCard key={r.seq} r={r} />
          ))}
        </View>
      ) : (
        <Table
          minWidth={980}
          rows={rows}
          keyOf={(r) => String(r.seq)}
          columns={[
            { key: "date", title: "Date", width: 104, render: (r) => <T variant="small">{formatDate(r.entry_date)}</T> },
            { key: "event", title: "Event", flex: 2, render: (r) => (
              <View style={{ gap: 2 }}>
                <T variant="bodyStrong" numberOfLines={2}>{r.label}</T>
                <View style={styles.chips}>
                  <Chip label={LEDGER_EVENT_LABELS[r.event]} tone="neutral" small />
                  <BucketChip bucket={r.bucket} />
                </View>
              </View>
            ) },
            { key: "amount", title: "Amount", align: "right", render: (r) => <Money paise={r.amount_paise} color={r.amount_paise < 0 ? colors.danger : colors.ink} signed={r.event === "PAYMENT"} /> },
            { key: "cashPaid", title: "Cash paid", align: "right", render: (r) => <Money paise={r.cash_paid_paise} /> },
            { key: "accPaid", title: "Account paid", align: "right", render: (r) => <Money paise={r.account_paid_paise} /> },
            { key: "cashDue", title: "Cash due", align: "right", render: (r) => <DueMoney paise={r.cash_due_paise} showZeroLabel={false} /> },
            { key: "accDue", title: "Account due", align: "right", render: (r) => <DueMoney paise={r.account_due_paise} showZeroLabel={false} /> },
            { key: "totalDue", title: "Total due", align: "right", render: (r) => <DueMoney paise={r.total_due_paise} showZeroLabel={false} /> },
            { key: "ref", title: "Ref", width: 120, render: (r) => <T variant="caption" color={colors.inkSubtle}>{r.ref_number ?? "—"}</T> },
          ]}
        />
      )}
    </>
  );
}

function Summary({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <View style={styles.summaryCell}>
      <T variant="caption" color={colors.inkSubtle}>
        {label}
      </T>
      {value}
    </View>
  );
}

function LedgerCard({ r }: { r: PortalLedgerRow }): React.JSX.Element {
  const isPayment = r.event === "PAYMENT" || r.event === "OTHER_CHARGE_PAYMENT";
  const isReversal = r.event === "REVERSAL" || r.event === "OTHER_CHARGE_REVERSAL";
  return (
    <Card style={{ padding: space.md }}>
      <View style={styles.rowHead}>
        <View style={{ flex: 1, gap: 4 }}>
          <T variant="caption" color={colors.inkSubtle}>
            {formatDate(r.entry_date)}
            {r.ref_number ? ` · ${r.ref_number}` : ""}
          </T>
          <T variant="bodyStrong">{r.label}</T>
          <View style={styles.chips}>
            <Chip label={LEDGER_EVENT_LABELS[r.event]} tone={isPayment ? "success" : isReversal ? "danger" : "neutral"} small />
            <BucketChip bucket={r.bucket} />
          </View>
        </View>
        <Money paise={r.amount_paise} variant="h3" color={isReversal || r.amount_paise < 0 ? colors.danger : isPayment ? colors.success : colors.navy} />
      </View>
      <View style={styles.ledgerGrid}>
        <Mini label="Cash paid" value={<Money paise={r.cash_paid_paise} variant="small" />} />
        <Mini label="Account paid" value={<Money paise={r.account_paid_paise} variant="small" />} />
        <Mini label="Cash due" value={<DueMoney paise={r.cash_due_paise} variant="small" showZeroLabel={false} />} />
        <Mini label="Account due" value={<DueMoney paise={r.account_due_paise} variant="small" showZeroLabel={false} />} />
      </View>
      <View style={styles.totalDue}>
        <T variant="small" color={colors.inkMuted}>
          Total due after this
        </T>
        <DueMoney paise={r.total_due_paise} variant="bodyStrong" showZeroLabel={false} />
      </View>
    </Card>
  );
}

function Mini({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <View style={styles.mini}>
      <T variant="caption" color={colors.inkSubtle}>
        {label}
      </T>
      {value}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Demands
// ---------------------------------------------------------------------------

function Demands({ bookingId }: { bookingId: string }): React.JSX.Element {
  const q = useDemands(bookingId);
  const files = useFileActions();
  const rows = q.data?.items ?? [];
  if (!q.data) return q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : <SkeletonRows rows={4} />;
  if (rows.length === 0) return <EmptyState icon="notice" title="No demands raised yet" body="Installment demands are raised as your payment plan triggers — on booking, on construction stages or on dates." />;
  return (
    <>
      {q.isError ? <StatusBar text="Showing saved demands — couldn't refresh." tone="warning" /> : null}
      <View style={{ gap: space.md }}>
        {rows.map((d) => (
          <DemandCard key={d.demand_id} d={d} bookingId={bookingId} files={files} />
        ))}
      </View>
    </>
  );
}

function DemandCard({ d, bookingId, files }: { d: PortalDemandRow; bookingId: string; files: ReturnType<typeof useFileActions> }): React.JSX.Element {
  const balance = d.total_demand_paise - d.paid_paise;
  const days = daysUntil(d.due_date);
  const open = d.status === "OPEN" || d.status === "PARTIALLY_PAID";
  return (
    <Card style={d.is_overdue && open ? styles.overdue : null}>
      <View style={styles.rowHead}>
        <View style={{ flex: 1, gap: 2 }}>
          <T variant="caption" color={colors.inkSubtle}>
            {d.demand_number} · raised {formatDate(d.demand_date)}
          </T>
          <T variant="bodyStrong">{d.installment_name}</T>
          <T variant="small" color={colors.inkMuted}>
            {d.trigger_label}
          </T>
        </View>
        <View style={{ alignItems: "flex-end", gap: 6 }}>
          <Money paise={d.total_demand_paise} variant="h3" color={colors.navy} />
          <DemandStatusChip status={d.status} overdue={d.is_overdue} small />
        </View>
      </View>
      <View style={[styles.chips, { marginTop: space.sm }]}>
        <Chip label={`Cash ${formatINR(d.cash_demand_paise)}`} tone="gold" small />
        <Chip label={`Account ${formatINR(d.account_demand_paise)}`} tone="navy" small />
      </View>
      <Divider style={{ marginVertical: space.sm }} />
      <View style={styles.rowFoot}>
        <View style={{ flex: 1, gap: 2 }}>
          <T variant="caption" color={d.is_overdue && open ? colors.danger : colors.inkMuted}>
            {open ? (days < 0 ? `Due ${formatDate(d.due_date)} · ${-days} day${-days === 1 ? "" : "s"} overdue` : days === 0 ? "Due today" : `Due ${formatDate(d.due_date)} · in ${days} day${days === 1 ? "" : "s"}`) : `Due date ${formatDate(d.due_date)}`}
          </T>
          {open && balance > 0 ? (
            <T variant="small">
              Balance <Money paise={balance} variant="small" color={colors.danger} />
              {d.paid_paise > 0 ? ` · paid ${formatINR(d.paid_paise)}` : ""}
            </T>
          ) : null}
        </View>
        <PdfButtons keyBase={`demand:${d.demand_id}`} fetchLink={() => api.bookings.demandPdf(bookingId, d.demand_id)} actions={files} compact />
      </View>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

function Schedule({ bookingId }: { bookingId: string }): React.JSX.Element {
  const q = useSchedule(bookingId);
  const d = q.data;
  if (!d) return q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : <SkeletonRows rows={6} />;
  const paid = d.rows.filter((r) => r.status === "PAID").length;
  return (
    <>
      {q.isError ? <StatusBar text="Showing saved schedule — couldn't refresh." tone="warning" /> : null}
      <Card>
        <View style={styles.rowHead}>
          <View style={{ flex: 1 }}>
            <T variant="label" color={colors.inkSubtle}>
              Plan progress
            </T>
            <T variant="h2">{Math.round(d.progress_percent)}% paid</T>
            <T variant="small" color={colors.inkMuted}>
              {paid} of {d.rows.length} installments settled
            </T>
          </View>
        </View>
        <ProgressBar percent={d.progress_percent} height={10} />
      </Card>
      {d.pending_cheques.length ? (
        <Card>
          <T variant="h3" style={{ marginBottom: space.sm }}>
            Cheques in hand
          </T>
          {d.pending_cheques.map((c, i) => (
            <View key={c.payment_id}>
              <View style={styles.rowHead}>
                <View style={{ flex: 1 }}>
                  <T variant="bodyStrong">{c.receipt_number}</T>
                  <T variant="small" color={colors.inkMuted}>
                    {c.mode_name}
                    {c.instrument_number ? ` ${c.instrument_number}` : ""} · {formatDate(c.payment_date)}
                  </T>
                </View>
                <View style={{ alignItems: "flex-end", gap: 4 }}>
                  <Money paise={c.amount_paise} />
                  <BucketChip bucket={c.bucket} />
                </View>
              </View>
              {i < d.pending_cheques.length - 1 ? <Divider style={{ marginVertical: space.sm }} /> : null}
            </View>
          ))}
        </Card>
      ) : null}
      {d.rows.length === 0 ? <EmptyState icon="calendar" title="No installments" body="Your payment plan has no installments configured yet." /> : null}
      <View>
        {d.rows.map((r, i) => (
          <ScheduleRow key={r.seq} r={r} isLast={i === d.rows.length - 1} />
        ))}
      </View>
    </>
  );
}

function ScheduleRow({ r, isLast }: { r: PortalScheduleRow; isLast: boolean }): React.JSX.Element {
  const done = r.status === "PAID";
  const active = r.status === "RAISED" || r.status === "PARTIALLY_PAID" || r.status === "OVERDUE";
  const balance = r.total_paise - r.paid_paise;
  return (
    <View style={styles.stageRow}>
      <View style={styles.rail}>
        <View style={[styles.dot, done ? styles.dotDone : active ? (r.status === "OVERDUE" ? styles.dotOverdue : styles.dotActive) : null]}>{done ? <Icon name="check" size={12} color={colors.onNavy} /> : <T variant="caption" color={active ? colors.navy : colors.inkSubtle} style={{ fontSize: 10, lineHeight: 12 }}>{r.seq}</T>}</View>
        {!isLast ? <View style={[styles.line, done ? styles.lineDone : null]} /> : null}
      </View>
      <Card style={[styles.stageCard, active ? styles.stageActive : null, r.status === "OVERDUE" ? styles.overdue : null]}>
        <View style={styles.rowHead}>
          <View style={{ flex: 1, gap: 2 }}>
            <T variant="bodyStrong">{r.name}</T>
            <T variant="small" color={colors.inkMuted}>
              {r.percent}% · {r.trigger_label || TRIGGER_TYPE_LABELS[r.trigger_type]}
            </T>
            <T variant="caption" color={colors.inkSubtle}>
              {r.expected_date ? `Expected ${formatDate(r.expected_date)}` : "Date depends on construction"}
              {r.due_date ? ` · due ${formatDate(r.due_date)}` : ""}
            </T>
          </View>
          <View style={{ alignItems: "flex-end", gap: 6 }}>
            <Money paise={r.total_paise} variant="h3" color={colors.navy} />
            <ScheduleStatusChip status={r.status} small />
          </View>
        </View>
        <View style={[styles.chips, { marginTop: space.sm }]}>
          <Chip label={`Cash ${formatINR(r.cash_paise)}`} tone="gold" small />
          <Chip label={`Account ${formatINR(r.account_paise)}`} tone="navy" small />
          {r.paid_paise > 0 && !done ? <Chip label={`Paid ${formatINR(r.paid_paise)} · balance ${formatINR(balance)}`} tone="warning" small /> : null}
          {done ? <Chip label={SCHEDULE_STATUS_LABELS[r.status]} tone="success" small icon="check" /> : null}
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  rowHead: { flexDirection: "row", alignItems: "flex-start", gap: space.md },
  rowFoot: { flexDirection: "row", alignItems: "center", gap: space.md },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 4, justifyContent: "flex-end" },
  summaryRow: { flexDirection: "row", flexWrap: "wrap", gap: space.md },
  summaryCell: { minWidth: 120, flexGrow: 1, gap: 2 },
  ledgerGrid: { flexDirection: "row", flexWrap: "wrap", marginTop: space.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, paddingTop: space.sm },
  mini: { width: "50%", paddingVertical: 4, gap: 2 },
  totalDue: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: space.xs, paddingTop: space.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  overdue: { borderWidth: 1, borderColor: "#F2C4BE" },
  stageRow: { flexDirection: "row", gap: space.md },
  rail: { width: 24, alignItems: "center" },
  dot: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.navy200, alignItems: "center", justifyContent: "center", marginTop: 18 },
  dotDone: { backgroundColor: colors.success, borderColor: colors.success },
  dotActive: { borderColor: colors.gold, backgroundColor: colors.gold100 },
  dotOverdue: { borderColor: colors.danger, backgroundColor: colors.dangerBg },
  line: { flex: 1, width: 2, backgroundColor: colors.navy100, marginTop: 4, marginBottom: -space.md },
  lineDone: { backgroundColor: colors.success },
  stageCard: { flex: 1, marginBottom: space.md, borderRadius: radius.lg },
  stageActive: { borderWidth: 1.5, borderColor: colors.gold },
});
