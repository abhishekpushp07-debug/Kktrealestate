// Payments → Schedule: installment timeline driven by the booking's payment plan.
import { View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { fmtDate, inr, inrShort } from "@/src/format";
import { makeStyles, useTheme } from "@/src/theme";
import { Card, Chip } from "@/src/ui/primitives";
import { ProgressBar } from "@/src/ui/progress";
import { T } from "@/src/ui/text";
import { triggerText } from "@/src/screens/plan";

export type ScheduleItem = {
  seq: number;
  name: string;
  percent?: number | null;
  cumulative_percent?: number | null;
  cash: number;
  account: number;
  total: number;
  cash_expected?: number;
  account_expected?: number;
  cash_paid?: number;
  account_paid?: number;
  paid: number;
  status?: string | null;
  demand_status?: string | null;
  trigger_label?: string | null;
  due_date?: string | null;
  expected_date?: string | null;
  demanded?: boolean;
};
export type ScheduleData = { items: ScheduleItem[]; plan?: { name?: string; plan_type?: string } | null };

type Tone = "error" | "success" | "gold" | "neutral" | "info";
export const instTone = (s?: string | null): Tone =>
  s === "Overdue" ? "error" : s === "Paid" ? "success" : s === "Raised" ? "gold" : s === "Partially paid" ? "info" : "neutral";

const statusOf = (m: ScheduleItem) => m.status || m.demand_status || (m.demanded ? "Raised" : "Not yet due");

function Summary({ items, plan }: { items: ScheduleItem[]; plan?: ScheduleData["plan"] }) {
  const s = useStyles();
  const total = items.reduce((a, m) => a + (m.total || 0), 0);
  const raised = items.filter((m) => statusOf(m) !== "Not yet due").reduce((a, m) => a + (m.total || 0), 0);
  const paid = items.reduce((a, m) => a + (m.paid || 0), 0);
  const outstanding = Math.max(0, raised - paid);
  const cells: [string, string, "inverse" | "due" | "adv"][] = [
    ["Raised so far", inrShort(raised), "inverse"],
    ["Paid", inrShort(paid), "adv"],
    ["Outstanding", inrShort(outstanding), outstanding > 0 ? "due" : "inverse"],
    ["Yet to be raised", inrShort(Math.max(0, total - raised)), "inverse"],
  ];
  return (
    <Card navy testID="schedule-summary" style={{ padding: 20 }}>
      {plan?.name ? (
        <T v="small" tone="inverseMuted" testID="schedule-plan-name">
          {plan.name}
          {plan.plan_type ? ` · ${plan.plan_type}` : ""} · {items.length} installments
        </T>
      ) : null}
      <View style={s.sumGrid}>
        {cells.map(([l, v, tone]) => (
          <View key={l} style={s.sumCell}>
            <T v="label" tone="inverseMuted">
              {l}
            </T>
            <T v="moneyLg" style={tone === "due" ? s.due : tone === "adv" ? s.adv : s.inv} testID={`schedule-summary-${l.toLowerCase().replace(/\s+/g, "-")}`}>
              {v}
            </T>
          </View>
        ))}
      </View>
      <View style={{ marginTop: 14 }}>
        <ProgressBar value={total ? (paid / total) * 100 : 0} h={6} />
      </View>
      <T v="small" tone="inverseMuted" style={{ marginTop: 6 }}>
        {total ? Math.round((paid / total) * 100) : 0}% of {inr(total)} paid
      </T>
    </Card>
  );
}

function Installment({ m, last }: { m: ScheduleItem; last: boolean }) {
  const s = useStyles();
  const { colors } = useTheme();
  const st = statusOf(m);
  const tone = instTone(st);
  const pct = m.total ? Math.min(100, Math.round((m.paid / m.total) * 100)) : 0;
  const dot = tone === "error" ? colors.error : tone === "success" ? colors.success : tone === "gold" ? colors.gold : tone === "info" ? colors.info : colors.borderStrong;
  const date = m.due_date || m.expected_date;
  return (
    <View style={s.item} testID={`schedule-row-${m.seq}`}>
      <View style={s.rail}>
        <View style={[s.dot, { borderColor: dot, backgroundColor: tone === "neutral" ? colors.surfaceSecondary : dot }]}>
          {tone === "success" ? <Feather name="check" size={12} color={colors.onSuccess} /> : <T style={[s.dotText, tone !== "neutral" && { color: colors.onBrandPrimary }]}>{m.seq}</T>}
        </View>
        {!last ? <View style={[s.line, tone === "success" && { backgroundColor: colors.success }]} /> : null}
      </View>
      <View style={[s.body, last && { paddingBottom: 2 }]}>
        <View style={s.head}>
          <T v="bodyStrong" style={{ flexShrink: 1 }}>
            {m.name}
          </T>
          {m.percent != null ? <Chip label={`${m.percent}%`} /> : null}
          <Chip label={st} tone={tone} testID={`schedule-status-${m.seq}`} />
        </View>
        <T v="small" tone="muted" testID={`schedule-trigger-${m.seq}`}>
          {triggerText(m.trigger_label)}
          {m.due_date ? ` · due ${fmtDate(m.due_date)}` : date ? ` · expected ${fmtDate(date)}` : ""}
        </T>
        <View style={s.cols}>
          <View style={{ flex: 1 }}>
            <T v="small" tone="muted">Cash</T>
            <T v="small" style={s.amt}>
              {inr(m.cash_paid ?? 0)} / {inr(m.cash_expected ?? m.cash)}
            </T>
          </View>
          <View style={{ flex: 1 }}>
            <T v="small" tone="muted">Account</T>
            <T v="small" style={s.amt}>
              {inr(m.account_paid ?? 0)} / {inr(m.account_expected ?? m.account)}
            </T>
          </View>
        </View>
        <View style={{ marginTop: 8 }}>
          <ProgressBar value={pct} tone={pct >= 100 ? "success" : "gold"} h={6} testID={`schedule-progress-${m.seq}`} />
        </View>
        <T v="small" tone={st === "Overdue" ? "error" : "muted"} style={{ marginTop: 4 }}>
          {inr(m.paid)} paid of {inr(m.total)} · {pct}%
        </T>
      </View>
    </View>
  );
}

export function Schedule({ data }: { data: ScheduleData }) {
  return (
    <View style={{ gap: 14 }} testID="schedule-list">
      <Summary items={data.items} plan={data.plan} />
      <Card style={{ paddingTop: 20 }} testID="schedule-timeline">
        {data.items.map((m, i) => (
          <Installment key={m.seq} m={m} last={i === data.items.length - 1} />
        ))}
      </Card>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  sumGrid: { flexDirection: "row", flexWrap: "wrap", rowGap: 14, marginTop: 10 },
  sumCell: { width: "50%", minWidth: 140, flexGrow: 1, gap: 4 },
  inv: { color: c.onSurfaceInverse, fontSize: 24 },
  due: { color: c.dueOnInverse, fontSize: 24 },
  adv: { color: c.advanceOnInverse, fontSize: 24 },
  item: { flexDirection: "row", gap: 14 },
  rail: { alignItems: "center", width: 28 },
  dot: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  dotText: { fontFamily: "Manrope_800ExtraBold", fontSize: 11, color: c.muted },
  line: { flex: 1, width: 2, backgroundColor: c.divider, marginVertical: 2 },
  body: { flex: 1, paddingBottom: 22, gap: 3 },
  head: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap", minHeight: 28 },
  cols: { flexDirection: "row", gap: 8, marginTop: 8 },
  amt: { fontFamily: "Manrope_700Bold", color: c.onSurface },
}));
