import { Linking, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { phoneDigits } from "@/src/format";
import { makeStyles, useTheme } from "@/src/theme";
import { Button, Card, Press, type IconName } from "@/src/ui/primitives";
import { T } from "@/src/ui/text";
import { toast } from "@/src/ui/toast";

export const openUrl = async (url: string) => {
  try {
    await Linking.openURL(url);
  } catch {
    toast.error("Couldn't open that on this device");
  }
};

export function QuickAction({ icon, label, onPress, testID, busy }: { icon: IconName; label: string; onPress: () => void; testID: string; busy?: boolean }) {
  const s = useStyles();
  const { colors } = useTheme();
  return (
    <Press onPress={onPress} testID={testID} style={s.qa} disabled={busy}>
      <View style={s.qaIcon}>
        <Feather name={icon} size={20} color={colors.onSurface} />
      </View>
      <T v="small" style={s.qaLabel} numberOfLines={2}>
        {busy ? "Opening…" : label}
      </T>
    </Press>
  );
}

export function RMCard({ rm, fallbackPhone, whatsapp }: { rm: { name: string; phone?: string | null } | null; fallbackPhone?: string | null; whatsapp?: string | null }) {
  const s = useStyles();
  const phone = phoneDigits(rm?.phone) || phoneDigits(fallbackPhone);
  const wa = phoneDigits(rm?.phone) || phoneDigits(whatsapp) || null;
  if (!rm && !phone) return null;
  return (
    <Card testID="home-rm-card">
      <View style={s.rmRow}>
        <View style={s.avatar}>
          <T style={s.avatarText}>{(rm?.name || "K")[0]}</T>
        </View>
        <View style={{ flex: 1 }}>
          <T v="small" tone="muted">
            Your Relationship Manager
          </T>
          <T v="title" testID="home-rm-name">
            {rm?.name || "KKT customer care"}
          </T>
          {!phoneDigits(rm?.phone) && phone ? (
            <T v="small" tone="muted">
              Calls go to our office line
            </T>
          ) : null}
        </View>
      </View>
      {phone || wa ? (
        <View style={s.btns}>
          {phone ? <Button small icon="phone" label="Call" onPress={() => openUrl(`tel:+${phone}`)} testID="home-rm-call" style={{ flex: 1 }} /> : null}
          {wa ? <Button small kind="ghost" icon="message-circle" label="WhatsApp" onPress={() => openUrl(`https://wa.me/${wa}`)} testID="home-rm-whatsapp" style={{ flex: 1 }} /> : null}
        </View>
      ) : null}
    </Card>
  );
}

const useStyles = makeStyles((c) => ({
  qa: { flexBasis: "40%", flexGrow: 1, minWidth: 140, backgroundColor: c.surfaceSecondary, borderRadius: 18, borderWidth: 1, borderColor: c.border, padding: 14, gap: 10, minHeight: 96 },
  qaIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: c.navy50, alignItems: "center", justifyContent: "center" },
  qaLabel: { fontFamily: "Manrope_700Bold", color: c.onSurface, fontSize: 13 },
  rmRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: c.surfaceInverse, alignItems: "center", justifyContent: "center" },
  avatarText: { fontFamily: "CormorantGaramond_700Bold", fontSize: 24, color: c.gold },
  btns: { flexDirection: "row", gap: 10, marginTop: 16 },
}));
