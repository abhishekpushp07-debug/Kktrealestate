import { View } from "react-native";
import { useRouter } from "expo-router";

import type { Booking } from "@/src/hooks";
import { fmtDate, inr, inrShort, isPast } from "@/src/format";
import { makeStyles, radius } from "@/src/theme";
import { Button, Card, Chip, Press } from "@/src/ui/primitives";
import { ProgressBar } from "@/src/ui/progress";
import { T } from "@/src/ui/text";

// Due (warm red) or advance (green, "(advance)") for a bucket balance.
export function Balance({ v, testID, big }: { v: number; testID?: string; big?: boolean }) {
  if (!v) return <T v={big ? "moneyLg" : "money"} testID={testID}>₹0</T>;
  return v > 0 ? (
    <T v={big ? "moneyLg" : "money"} tone="error" testID={testID}>
      {inrShort(v)}
    </T>
  ) : (
    <T v={big ? "moneyLg" : "money"} tone="success" testID={testID}>
      {inrShort(-v)} <T v="small" tone="success">(advance)</T>
    </T>
  );
}

function Bucket({ name, agreed, paid, due, id }: { name: string; agreed: number; paid: number; due: number; id: string }) {
  const s = useStyles();
  return (
    <View style={s.bucket} testID={`home-bucket-${id}`}>
      <T v="label" tone="muted">
        {name}
      </T>
      <View style={s.line}>
        <T v="small" tone="muted">Agreed</T>
        <T v="bodyStrong">{inrShort(agreed)}</T>
      </View>
      <View style={s.line}>
        <T v="small" tone="muted">Paid</T>
        <T v="bodyStrong" testID={`home-bucket-${id}-paid`}>{inrShort(paid)}</T>
      </View>
      <View style={s.line}>
        <T v="small" tone="muted">{due < 0 ? "Advance" : "Due"}</T>
        <Balance v={due} testID={`home-bucket-${id}-due`} />
      </View>
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
      <T v="moneyLg" style={{ marginTop: 6 }} testID="home-paid-total">
        {inrShort(b.paid)} <T tone="muted" style={{ fontSize: 15 }}>of {inrShort(b.agreement_value)}</T>
      </T>
      <View style={{ marginTop: 10 }}>
        <ProgressBar value={pct} testID="home-paid-progress" />
      </View>
      <T v="small" tone="muted" style={{ marginTop: 6 }}>{pct}% of agreement value paid</T>
      <View style={s.buckets}>
        <Bucket id="cash" name="Cash" agreed={b.cash_agreed} paid={b.cash_paid} due={b.cash_due} />
        <View style={s.vr} />
        <Bucket id="account" name="Account" agreed={b.account_agreed} paid={b.account_paid} due={b.account_due} />
      </View>
      {b.other_charges_due > 0 ? (
        <View style={s.line}>
          <T v="small" tone="muted">Other charges due</T>
          <T v="money" tone="error" testID="home-other-charges-due">{inr(b.other_charges_due)}</T>
        </View>
      ) : null}
      {b.pending_cheques > 0 ? (
        <View style={[s.line, s.pending]}>
          <T v="small" tone="warning">Cheques awaiting clearance</T>
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
          <Button small kind="gold" label="View demands" icon="file-text" onPress={() => router.push({ pathname: "/payments", params: { tab: "demands" } })} testID="home-view-demand" style={{ marginTop: 16, alignSelf: "flex-start" }} />
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
  buckets: { flexDirection: "row", marginTop: 16, backgroundColor: c.surface, borderRadius: radius.md, padding: 14, gap: 12 },
  bucket: { flex: 1, gap: 6 },
  vr: { width: 1, backgroundColor: c.divider },
  line: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 4 },
  pending: { marginTop: 10, backgroundColor: c.warningSoft, padding: 10, borderRadius: radius.sm },
}));
