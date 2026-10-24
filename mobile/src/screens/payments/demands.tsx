import { View } from "react-native";

import { fmtDate, inr } from "@/src/format";
import { makeStyles } from "@/src/theme";
import { Card, Chip } from "@/src/ui/primitives";
import { T } from "@/src/ui/text";
import { statusTone } from "@/src/screens/shared";
import { DownloadDot } from "./receipts";

export type Demand = { id: string; demand_number: string; milestone_name: string; cumulative_percent: number; cash_demand: number; account_demand: number; total_demand: number; demand_date: string; due_date: string; status: string; paid: number };

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

const useStyles = makeStyles((c) => ({
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.divider },
  line: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
}));
