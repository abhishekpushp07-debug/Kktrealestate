import { ActivityIndicator, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { fmtDate, inr } from "@/src/format";
import { makeStyles, useTheme } from "@/src/theme";
import { Card, Chip, Press } from "@/src/ui/primitives";
import { T } from "@/src/ui/text";
import { toast } from "@/src/ui/toast";
import { statusTone } from "@/src/screens/shared";

export type Payment = {
  id: string;
  receipt_number: string;
  payment_category?: string | null;
  other_charge_name?: string | null;
  amount: number;
  payment_date: string;
  payment_mode_name?: string;
  instrument?: { number?: string; date?: string; bank_name?: string; branch?: string } | null;
  status: string;
  bounced_at?: string | null;
};

export function DownloadDot({ onPress, busy, testID, label }: { onPress: () => void; busy?: boolean; testID: string; label: string }) {
  const s = useStyles();
  const { colors } = useTheme();
  return (
    <Press onPress={onPress} testID={testID} style={s.dl} accessibilityLabel={label} disabled={busy}>
      {busy ? <ActivityIndicator size="small" color={colors.onSurface} /> : <Feather name="download" size={17} color={colors.onSurface} />}
    </Press>
  );
}

export function ViewPill({ onPress, busy, testID, label }: { onPress: () => void; busy?: boolean; testID: string; label: string }) {
  const s = useStyles();
  const { colors } = useTheme();
  return (
    <Press onPress={onPress} testID={testID} style={s.view} accessibilityLabel={label} disabled={busy}>
      {busy ? <ActivityIndicator size="small" color={colors.onSurface} /> : <Feather name="eye" size={15} color={colors.onSurface} />}
      <T v="small" style={s.viewText}>
        View
      </T>
    </Press>
  );
}

export function PaymentRow({ p, onPdf, busy, last }: { p: Payment; onPdf?: () => void; busy?: boolean; last?: boolean }) {
  const s = useStyles();
  const cleared = p.status === "Cleared";
  const tap = () => (cleared ? onPdf?.() : toast.info(p.status === "Pending" ? "Receipt will be available once the cheque clears" : `Receipt not available — payment ${p.status.toLowerCase()}`));
  const instr = [p.instrument?.number ? `#${p.instrument.number}` : null, p.instrument?.bank_name].filter(Boolean).join(" · ");
  return (
    <View style={[s.row, last && { borderBottomWidth: 0 }]} testID={`receipt-row-${p.receipt_number}`}>
      <Press onPress={tap} haptics={cleared} testID={`receipt-open-${p.id}`} style={{ flex: 1, gap: 4 }}>
        <View style={s.line}>
          <T v="money" style={p.status === "Reversed" || p.status === "Bounced" ? s.struck : undefined}>
            {inr(p.amount)}
          </T>
          <Chip label={p.status} tone={statusTone(p.status)} testID={`receipt-status-${p.id}`} />
          {p.payment_category ? <Chip label={p.other_charge_name ? p.other_charge_name : p.payment_category} tone="neutral" /> : null}
        </View>
        <T v="small" tone="muted">
          {p.receipt_number} · {fmtDate(p.payment_date)} · {p.payment_mode_name || "—"}
        </T>
        {cleared ? (
          <T v="small" tone="gold" style={{ fontFamily: "Manrope_700Bold" }}>
            Tap to view receipt
          </T>
        ) : null}
        {instr ? (
          <T v="small" tone="muted">
            {instr}
          </T>
        ) : null}
      </Press>
      {cleared && onPdf ? <ViewPill onPress={onPdf} busy={busy} testID={`receipt-pdf-${p.id}`} label="View receipt" /> : null}
    </View>
  );
}

export function Receipts({ items, onPdf, busy, empty }: { items: Payment[]; onPdf: (p: Payment) => void; busy: string | null; empty: React.ReactNode }) {
  if (!items.length) return <>{empty}</>;
  return (
    <Card testID="receipts-list" style={{ paddingVertical: 4 }}>
      {items.map((p, i) => (
        <PaymentRow key={p.id} p={p} onPdf={() => onPdf(p)} busy={!!busy && busy.includes(p.id)} last={i === items.length - 1} />
      ))}
    </Card>
  );
}

const useStyles = makeStyles((c) => ({
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.divider },
  line: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  struck: { textDecorationLine: "line-through", color: c.muted },
  view: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40, paddingHorizontal: 14, borderRadius: 999, backgroundColor: c.brandTertiary },
  viewText: { fontFamily: "Manrope_700Bold", color: c.onSurface },
  dl: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.surface, alignItems: "center", justifyContent: "center" },
}));
