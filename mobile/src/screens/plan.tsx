// Payment plan summary (Home card + My Flat section).
import { View } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";

import { fmtDate, inr } from "@/src/format";
import { makeStyles, radius, useTheme } from "@/src/theme";
import { Card, Chip, Press } from "@/src/ui/primitives";
import { T } from "@/src/ui/text";

export type PaymentPlan = { name: string; plan_type?: string | null; accepted_on?: string | null };
export type NextInstallment = {
  name: string;
  percent?: number | null;
  trigger_label?: string | null;
  due_date?: string | null;
  expected_date?: string | null;
  cash_expected?: number | null;
  account_expected?: number | null;
  total_expected?: number | null;
};

// "On stage: Brickwork" → "On completion of Brickwork"; dates appended when known.
export function triggerText(label?: string | null, date?: string | null): string {
  let t = label || "";
  const m = /^On stage:\s*(.+)$/i.exec(t);
  if (m) t = `On completion of ${m[1]}`;
  if (date) t = t ? `${t} · ${fmtDate(date)}` : fmtDate(date);
  return t || "As per plan";
}

export function PaymentPlanCard({ plan, next, testID = "payment-plan-card", showLink }: { plan?: PaymentPlan | null; next?: NextInstallment | null; testID?: string; showLink?: boolean }) {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  if (!plan && !next) return null;
  const date = next?.due_date || next?.expected_date;
  return (
    <Card testID={testID}>
      <View style={s.head}>
        <View style={s.icon}>
          <Feather name="calendar" size={17} color={colors.gold} />
        </View>
        <View style={{ flex: 1 }}>
          <T v="label" tone="muted">
            Payment plan
          </T>
          <T v="title" testID={`${testID}-name`}>
            {plan?.name || "—"}
          </T>
        </View>
        {plan?.plan_type ? <Chip label={plan.plan_type} tone="gold" testID={`${testID}-type`} /> : null}
      </View>
      {plan?.accepted_on ? (
        <T v="small" tone="muted" style={{ marginTop: 8 }} testID={`${testID}-accepted`}>
          Accepted on {fmtDate(plan.accepted_on)}
        </T>
      ) : null}
      {next ? (
        <View style={s.next} testID={`${testID}-next`}>
          <View style={s.nextHead}>
            <T v="label" tone="gold">
              Next installment
            </T>
            {next.percent != null ? <T v="small" tone="muted">{next.percent}% of agreement</T> : null}
          </View>
          <T v="bodyStrong" style={{ marginTop: 4 }}>
            {next.name}
          </T>
          <T v="small" tone="muted" testID={`${testID}-trigger`}>
            {triggerText(next.trigger_label, date)}
          </T>
          <View style={s.cols}>
            <View style={{ flex: 1 }}>
              <T v="small" tone="muted">Cash</T>
              <T v="money" testID={`${testID}-cash`}>{inr(next.cash_expected)}</T>
            </View>
            <View style={{ flex: 1 }}>
              <T v="small" tone="muted">Account</T>
              <T v="money" testID={`${testID}-account`}>{inr(next.account_expected)}</T>
            </View>
            <View style={{ flex: 1, alignItems: "flex-end" }}>
              <T v="small" tone="muted">Total</T>
              <T v="money">{inr(next.total_expected ?? (next.cash_expected || 0) + (next.account_expected || 0))}</T>
            </View>
          </View>
        </View>
      ) : (
        <T tone="muted" style={{ marginTop: 10 }}>
          All installments have been raised.
        </T>
      )}
      {showLink ? (
        <Press onPress={() => router.push({ pathname: "/payments", params: { tab: "schedule" } })} testID={`${testID}-schedule-link`} style={s.link}>
          <T v="small" tone="gold" style={{ fontFamily: "Manrope_700Bold" }}>
            View full schedule
          </T>
          <Feather name="chevron-right" size={14} color={colors.gold} />
        </Press>
      ) : null}
    </Card>
  );
}

const useStyles = makeStyles((c) => ({
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  icon: { width: 38, height: 38, borderRadius: 12, backgroundColor: c.surfaceInverse, alignItems: "center", justifyContent: "center" },
  next: { marginTop: 14, backgroundColor: c.surface, borderRadius: radius.md, padding: 14 },
  nextHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cols: { flexDirection: "row", gap: 8, marginTop: 10 },
  link: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 12, minHeight: 36, alignSelf: "flex-start" },
}));
