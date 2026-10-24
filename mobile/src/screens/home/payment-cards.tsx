import { View } from "react-native";
import { useRouter } from "expo-router";

import type { Booking } from "@/src/hooks";
import { fmtDate, inr, inrShort, isPast } from "@/src/format";
import { makeStyles, radius } from "@/src/theme";
import { Button, Card, Chip, Money, Press } from "@/src/ui/primitives";
import { ProgressBar } from "@/src/ui/progress";
import { T } from "@/src/ui/text";

// Due (warm red) or advance (green, "(advance)") for a bucket balance.
export function Balance({ v, testID, big }: { v: number; testID?: string; big?: boolean }) {
  if (!v) return <T v={big ? "moneyLg" : "money"} testID={testID}>₹0</T>;
  return v > 0 ? (
    <Money v={v} tone="error" big={big} testID={testID} />
  ) : (
    <View style={{ alignItems: "flex-end" }}>
      <Money v={-v} tone="success" big={big} testID={testID} />
      <T v="small" tone="success">(advance)</T>
    </View>
  );
}

// 3 rows (Agreed / Paid / Due|Advance) × 2 bucket columns, labels left, values right-aligned.
function BucketGrid({ b }: { b: Booking }) {
  const s = useStyles();
  const cols: { id: string; agreed: number; paid: number; due: number }[] = [
    { id: "cash", agreed: b.cash_agreed, paid: b.cash_paid, due: b.cash_due },
    { id: "account", agreed: b.account_agreed, paid: b.account_paid, due: b.account_due },
  ];
  const rows: { label: string; render: (c: (typeof cols)[number]) => React.ReactNode }[] = [
    { label: "Agreed", render: (c) => <Money v={c.agreed} style={s.num} /> },
    { label: "Paid", render: (c) => <Money v={c.paid} style={s.num} testID={`home-bucket-${c.id}-paid`} /> },
    {
      label: "Due / advance",
      render: (c) =>
        c.due < 0 ? (
          <View style={{ alignItems: "flex-end" }}>
            <Money v={-c.due} tone="success" style={s.num} testID={`home-bucket-${c.id}-due`} />
            <T v="small" tone="success">advance</T>
          </View>
        ) : (
          <Money v={c.due} tone={c.due > 0 ? "error" : undefined} style={s.num} testID={`home-bucket-${c.id}-due`} />
        ),
    },
  ];
  return (
    <View style={s.grid} testID="home-bucket-grid">
      <View style={s.gRow}>
        <View style={s.gLabel} />
        <T v="label" tone="muted" style={s.gHead}>Cash</T>
        <T v="label" tone="muted" style={s.gHead}>Account</T>
      </View>
      {rows.map((r, i) => (
        <View key={r.label} style={[s.gRow, s.gBody, i === rows.length - 1 && { borderBottomWidth: 0 }]} testID={`home-bucket-row-${i}`}>
          <T v="small" tone="secondary" style={s.gLabel}>{r.label}</T>
          {cols.map((c) => (
            <View key={c.id} style={s.gCell} testID={`home-bucket-${c.id}`}>{r.render(c)}</View>
          ))}
        </View>
      ))}
    </View>
  );
}

export function PaymentSummary({ b, wide }: { b: Booking; wide?: boolean }) {
  const s = useStyles();
  const router = useRouter();
  const pct = b.agreement_value ? Math.min(100, Math.round((b.paid / b.agreement_value) * 100)) : 0;
  return (
    <Card testID="home-payment-summary" style={wide ? { flex: 1 } : undefined}>
      <View style={s.head}>
        <T v="title">Payments</T>
        <Press onPress={() => router.push("/payments")} testID="home-payments-view-all" style={s.link}>
          <T v="small" tone="gold" style={{ fontFamily: "Manrope_700Bold" }}>View all</T>
        </Press>
      </View>
      <View style={s.hero}>
        <T style={s.heroNum} testID="home-paid-total">
          {inrShort(b.paid)} <T style={s.heroPaid}>paid</T>
        </T>
        <T v="small" tone="muted">of {inrShort(b.agreement_value)} agreement</T>
      </View>
      <View style={{ marginTop: 10 }}>
        <ProgressBar value={pct} testID="home-paid-progress" />
      </View>
      <T v="small" tone="muted" style={{ marginTop: 6 }}>{pct}% of agreement value paid</T>
      <BucketGrid b={b} />
      {b.other_charges_due > 0 ? (
        <View style={s.line}>
          <T v="small" tone="secondary" style={s.lineLabel}>Other charges due</T>
          <T v="money" tone="error" testID="home-other-charges-due">{inr(b.other_charges_due)}</T>
        </View>
      ) : null}
      {b.pending_cheques > 0 ? (
        <View style={[s.line, s.pending]}>
          <T v="small" tone="warning" style={s.lineLabel}>Cheques awaiting clearance</T>
          <T v="money" tone="warning" testID="home-pending-cheques">{inr(b.pending_cheques)}</T>
        </View>
      ) : null}
    </Card>
  );
}

export function NextDue({ b, onStatement, busy, wide }: { b: Booking; onStatement: () => void; busy: boolean; wide?: boolean }) {
  const router = useRouter();
  const nd = b.next_due;
  return (
    <Card testID="home-next-due" style={wide ? { flex: 1 } : undefined}>
      <T v="title">Next due</T>
      {nd ? (
        <>
          <T v="moneyLg" tone="error" style={{ marginTop: 8 }} testID="home-next-due-amount">
            {inr(nd.amount)}
          </T>
          <T tone="muted">
            {nd.milestone} · due {fmtDate(nd.due_date)}
          </T>
          {isPast(nd.due_date) ? <View style={{ marginTop: 8 }}><Chip label="Overdue" tone="error" testID="home-next-due-overdue" /></View> : null}
          <Button small kind="gold" label="View demands" trailingIcon="chevron-right" onPress={() => router.push({ pathname: "/payments", params: { tab: "demands" } })} testID="home-view-demand" style={{ marginTop: 16, alignSelf: "flex-start" }} />
        </>
      ) : (
        <>
          <T tone="muted" style={{ marginTop: 8 }} testID="home-all-caught-up">
            No open demands. You&apos;re all caught up.
          </T>
          <Button small kind="ghost" label="Statement PDF" icon="download" loading={busy} onPress={onStatement} testID="home-statement-pdf" style={{ marginTop: 16, alignSelf: "flex-start" }} />
        </>
      )}
      <T v="small" tone="muted" style={{ marginTop: 14 }}>
        Total due now: <T v="small" tone={b.total_due > 0 ? "error" : "success"} testID="home-total-due">{b.total_due > 0 ? inr(b.total_due) : b.total_due < 0 ? `${inr(-b.total_due)} (advance)` : "₹0"}</T>
      </T>
    </Card>
  );
}

const useStyles = makeStyles((c) => ({
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  link: { minHeight: 36, justifyContent: "center", paddingHorizontal: 6 },
  buckets: { flexDirection: "row", flexWrap: "wrap", marginTop: 16, backgroundColor: c.surface, borderRadius: radius.md, padding: 14, gap: 12 },
  bucket: { flex: 1, minWidth: 130, gap: 6 },
  hero: { marginTop: 8, gap: 2 },
  heroNum: { fontFamily: "Manrope_800ExtraBold", fontSize: 30, lineHeight: 36, letterSpacing: -0.6, color: c.onSurface, fontVariant: ["tabular-nums"] },
  heroPaid: { fontFamily: "Manrope_600SemiBold", fontSize: 16, color: c.onSurfaceTertiary, letterSpacing: 0 },
  grid: { marginTop: 16, backgroundColor: c.surface, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 8 },
  gRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 36 },
  gBody: { borderBottomWidth: 1, borderBottomColor: c.divider, paddingVertical: 8 },
  gLabel: { flex: 1.1 },
  gHead: { flex: 1, textAlign: "right" },
  gCell: { flex: 1, alignItems: "flex-end" },
  num: { textAlign: "right", fontVariant: ["tabular-nums"] },
  line: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 4 },
  lineLabel: { flexShrink: 1 },
  pending: { marginTop: 12, backgroundColor: c.warningSoft, paddingHorizontal: 12, paddingVertical: 10, borderRadius: radius.sm },
}));
