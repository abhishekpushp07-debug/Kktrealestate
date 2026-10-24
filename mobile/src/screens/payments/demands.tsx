import { View } from "react-native";

import { fmtDate, inr } from "@/src/format";
import { makeStyles } from "@/src/theme";
import { Card, Chip } from "@/src/ui/primitives";
import { ProgressBar } from "@/src/ui/progress";
import { T } from "@/src/ui/text";
import { statusTone } from "@/src/screens/shared";
import { DownloadDot } from "./receipts";

export type Demand = { id: string; demand_number: string; milestone_name: string; cumulative_percent: number; cash_demand: number; account_demand: number; total_demand: number; demand_date: string; due_date: string; status: string; paid: number };
export type ScheduleItem = { seq: number; name: string; cumulative_percent: number; cash: number; account: number; total: number; construction_status: string; completed_on?: string | null; demanded: boolean; due_date?: string | null; paid: number; demand_status?: string | null };

export function Demands({ items, onPdf, busy }: { items: Demand[]; onPdf: (d: Demand) => void; busy: string | null }) {
  const s = useStyles();
  return (
    <Card testID="demands-list" style={{ paddingVertical: 4 }}>
      {items.map((d, i) => (
        <View key={d.id} style={[s.row, i === items.length - 1 && { borderBottomWidth: 0 }]} testID={`demand-row-${d.demand_number}`}>
          <View style={{ flex: 1, gap: 4 }}>
            <View style={s.line}>
              <T v="bodyStrong">{d.milestone_name}</T>
              <Chip label={d.status} tone={statusTone(d.status)} testID={`demand-status-${d.id}`} />
            </View>
            <T v="money">{inr(d.total_demand)}</T>
            <T v="small" tone="muted">
              {d.demand_number} · due {fmtDate(d.due_date)}
            </T>
            <T v="small" tone="muted">
              Cash {inr(d.cash_demand)} · Account {inr(d.account_demand)}
              {d.paid ? ` · paid ${inr(d.paid)}` : ""}
            </T>
          </View>
          <DownloadDot onPress={() => onPdf(d)} busy={!!busy && busy.includes(d.id)} testID={`demand-pdf-${d.id}`} label="Demand letter PDF" />
        </View>
      ))}
    </Card>
  );
}

export function Schedule({ items }: { items: ScheduleItem[] }) {
  const s = useStyles();
  return (
    <View style={{ gap: 10 }} testID="schedule-list">
      {items.map((m) => {
        const pct = m.total ? Math.min(100, Math.round((m.paid / m.total) * 100)) : 0;
        const done = m.construction_status === "Completed";
        return (
          <Card key={m.seq} testID={`schedule-row-${m.seq}`} style={{ padding: 16 }}>
            <View style={s.line}>
              <T v="bodyStrong" style={{ flex: 1 }}>
                {m.seq}. {m.name}{" "}
                <T v="small" tone="muted">
                  {m.cumulative_percent}%
                </T>
              </T>
              <Chip label={m.demand_status || (done ? "Due soon" : "Upcoming")} tone={m.demand_status ? statusTone(m.demand_status) : "neutral"} />
            </View>
            <View style={s.cols}>
              <View style={{ flex: 1 }}>
                <T v="small" tone="muted">Cash</T>
                <T v="bodyStrong">{inr(m.cash)}</T>
              </View>
              <View style={{ flex: 1 }}>
                <T v="small" tone="muted">Account</T>
                <T v="bodyStrong">{inr(m.account)}</T>
              </View>
              <View style={{ flex: 1, alignItems: "flex-end" }}>
                <T v="small" tone="muted">Paid</T>
                <T v="bodyStrong" tone={m.paid >= m.total && m.total > 0 ? "success" : undefined}>
                  {inr(m.paid)}
                </T>
              </View>
            </View>
            <View style={{ marginTop: 10 }}>
              <ProgressBar value={pct} tone={pct >= 100 ? "success" : "gold"} h={6} />
            </View>
            <T v="small" tone="muted" style={{ marginTop: 6 }}>
              {done ? `Completed ${fmtDate(m.completed_on)}` : "Construction pending"}
              {m.due_date ? ` · due ${fmtDate(m.due_date)}` : ""} · {pct}% paid of {inr(m.total)}
            </T>
          </Card>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.divider },
  line: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  cols: { flexDirection: "row", gap: 8, marginTop: 10 },
}));
