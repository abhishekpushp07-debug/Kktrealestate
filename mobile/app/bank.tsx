import { View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useQuery } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";

import { api, errMsg } from "@/src/api/client";
import { haptic } from "@/src/haptics";
import { makeStyles, useTheme } from "@/src/theme";
import { Screen, PageHeader } from "@/src/ui/screen";
import { Card, Chip, KV, Press } from "@/src/ui/primitives";
import { T } from "@/src/ui/text";
import { SkeletonList } from "@/src/ui/skeleton";
import { Empty, ErrorState } from "@/src/ui/states";
import { toast } from "@/src/ui/toast";

type Bank = { bank_name: string; account_name: string; branch?: string; ifsc: string; account_number: string; is_default?: boolean };

async function copy(text: string, what: string) {
  try {
    await Clipboard.setStringAsync(text);
    toast.success(`${what} copied`);
    haptic.tap();
  } catch {
    toast.info(`${what}: ${text}`);
  }
}

function CopyRow({ k, v, testID }: { k: string; v: string; testID: string }) {
  const { colors } = useTheme();
  return (
    <KV
      k={k}
      v={
        <Press onPress={() => copy(v, k)} testID={testID} style={{ flexDirection: "row", alignItems: "center", gap: 6, minHeight: 32 }} accessibilityLabel={`Copy ${k}`}>
          <T v="bodyStrong" selectable style={{ letterSpacing: 0.5 }}>
            {v}
          </T>
          <Feather name="copy" size={14} color={colors.gold} />
        </Press>
      }
    />
  );
}

export default function BankScreen() {
  const s = useStyles();
  const { colors } = useTheme();
  const q = useQuery({ queryKey: ["p-bank"], queryFn: () => api.get<{ items: Bank[]; note?: string }>("/bank-details") });
  return (
    <Screen testID="bank-screen" refreshKeys={[["p-bank"]]}>
      <PageHeader back title="Bank details" sub="For the Account component of your payments." />
      {q.isLoading ? (
        <SkeletonList rows={2} h={180} />
      ) : q.isError ? (
        <ErrorState message={errMsg(q.error)} onRetry={q.refetch} />
      ) : !q.data?.items?.length ? (
        <Empty icon="briefcase" title="No bank accounts published" hint="Please contact your Relationship Manager for transfer details." testID="bank-empty" />
      ) : (
        <>
          {q.data.items.map((b, i) => (
            <Card key={i} testID={`bank-account-${i}`}>
              <View style={s.head}>
                <Feather name="briefcase" size={18} color={colors.gold} />
                <T v="title" style={{ flex: 1 }}>
                  {b.bank_name}
                </T>
                {b.is_default ? <Chip label="Primary" tone="gold" /> : null}
              </View>
              <KV k="Account name" v={b.account_name} />
              <CopyRow k="Account number" v={b.account_number} testID={`bank-copy-account-${i}`} />
              <CopyRow k="IFSC" v={b.ifsc} testID={`bank-copy-ifsc-${i}`} />
              {b.branch ? <KV k="Branch" v={b.branch} last /> : null}
            </Card>
          ))}
          {q.data.note ? (
            <View style={s.note} testID="bank-note">
              <Feather name="shield" size={16} color={colors.warning} />
              <T v="small" style={{ flex: 1, color: colors.warning }}>
                {q.data.note}
              </T>
            </View>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const useStyles = makeStyles((c) => ({
  head: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 4 },
  note: { flexDirection: "row", gap: 10, backgroundColor: c.warningSoft, borderRadius: 14, padding: 14 },
}));
