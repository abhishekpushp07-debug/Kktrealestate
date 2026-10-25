import * as Clipboard from "expo-clipboard";
import { Pressable, StyleSheet, View } from "react-native";
import { refreshBooking, useBankDetails } from "@/api/queries";
import { haptics } from "@/lib/haptics";
import { Card, Divider } from "@/ui/Card";
import { Icon } from "@/ui/Icon";
import { Header, Screen } from "@/ui/Screen";
import { SkeletonCard } from "@/ui/Skeleton";
import { ErrorState, Notice } from "@/ui/States";
import { T } from "@/ui/Text";
import { useToast } from "@/ui/Toast";
import { colors, space } from "@/ui/theme";
import { BookingGate } from "./shared";

export function BankDetailsScreen(): React.JSX.Element {
  return <BookingGate title="Bank details">{(id) => <Body bookingId={id} />}</BookingGate>;
}

function Body({ bookingId }: { bookingId: string }): React.JSX.Element {
  const q = useBankDetails(bookingId);
  const toast = useToast();
  const d = q.data;
  const copy = async (label: string, value: string) => {
    haptics.tap();
    await Clipboard.setStringAsync(value);
    toast.success(`${label} copied`);
  };
  const copyAll = async () => {
    if (!d) return;
    const text = `${d.account_name}\nBank: ${d.bank_name}${d.branch ? ` (${d.branch})` : ""}\nAccount no: ${d.account_number}\nIFSC: ${d.ifsc}`;
    await Clipboard.setStringAsync(text);
    toast.success("Bank details copied");
  };
  return (
    <View style={{ flex: 1, backgroundColor: colors.ivory }}>
      <Header title="Bank details" subtitle="For Account-bucket transfers (NEFT / RTGS / loan disbursement)" back />
      <Screen onRefresh={() => refreshBooking(bookingId)}>
        <Notice tone="info" title="Pay only to this account" body="Transfer the Account portion of your installments here and share the UTR with your relationship manager. Never pay to a personal account." />
        {d ? (
          <Card>
            <Row label="Account name" value={d.account_name} onCopy={() => void copy("Account name", d.account_name)} />
            <Divider />
            <Row label="Bank" value={`${d.bank_name}${d.branch ? ` · ${d.branch}` : ""}`} onCopy={() => void copy("Bank", d.bank_name)} />
            <Divider />
            <Row label="Account number" value={d.account_number} mono onCopy={() => void copy("Account number", d.account_number)} />
            <Divider />
            <Row label="IFSC" value={d.ifsc} mono onCopy={() => void copy("IFSC", d.ifsc)} />
            {d.note ? (
              <>
                <Divider />
                <T variant="small" color={colors.inkMuted} style={{ paddingTop: space.md }}>
                  {d.note}
                </T>
              </>
            ) : null}
            <Pressable accessibilityRole="button" onPress={() => void copyAll()} style={({ pressed }) => [styles.copyAll, pressed ? { opacity: 0.8 } : null]}>
              <Icon name="copy" size={16} color={colors.navy} />
              <T variant="bodyStrong" color={colors.navy}>
                Copy all details
              </T>
            </Pressable>
          </Card>
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <SkeletonCard lines={5} />
        )}
      </Screen>
    </View>
  );
}

function Row({ label, value, mono, onCopy }: { label: string; value: string; mono?: boolean; onCopy: () => void }): React.JSX.Element {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1, gap: 2 }}>
        <T variant="caption" color={colors.inkSubtle}>
          {label}
        </T>
        <T variant={mono ? "mono" : "bodyStrong"} style={mono ? { fontSize: 17, lineHeight: 22, letterSpacing: 1 } : null} selectable>
          {value}
        </T>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Copy ${label}`} onPress={onCopy} hitSlop={8} style={({ pressed }) => [styles.copyBtn, pressed ? { opacity: 0.7 } : null]}>
        <Icon name="copy" size={16} color={colors.navy} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md },
  copyBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.navy50, alignItems: "center", justifyContent: "center" },
  copyAll: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm, marginTop: space.lg, paddingVertical: 12, borderRadius: 999, backgroundColor: colors.navy100 },
});
