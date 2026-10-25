import { useRouter } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { useUnreadCount } from "@/api/queries";
import { haptics } from "@/lib/haptics";
import { Badge } from "@/ui/Chip";
import { Icon } from "@/ui/Icon";
import { colors } from "@/ui/theme";

export function BellButton({ onNavy, count }: { onNavy?: boolean; count?: number }): React.JSX.Element {
  const router = useRouter();
  const query = useUnreadCount(count === undefined);
  const unread = count ?? query.data?.count ?? 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={unread ? `Notifications, ${unread} unread` : "Notifications"}
      onPress={() => {
        haptics.tap();
        router.navigate("/more/notifications");
      }}
      style={({ pressed }) => [styles.btn, { backgroundColor: onNavy ? "rgba(255,255,255,0.1)" : colors.surface, borderColor: onNavy ? "rgba(255,255,255,0.18)" : colors.line }, pressed ? { opacity: 0.8 } : null]}
    >
      <View>
        <Icon name="bell" size={20} color={onNavy ? colors.onNavy : colors.navy} />
        <Badge count={unread} style={styles.badge} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  badge: { position: "absolute", top: -8, right: -10 },
});
