// Responsive shell: a left sidebar at ≥ 1024 px, the bottom tab bar on phones. One navigator
// serves both — the tab bar is simply not rendered on desktop. The bar is laid out below the
// screens (never absolutely positioned), so content is never hidden behind it.
import { Tabs } from "expo-router/tabs";
import { StyleSheet, View } from "react-native";
import { useLayout } from "@/ui/Responsive";
import { Sidebar } from "@/ui/shell/Sidebar";
import { TabBar } from "@/ui/shell/TabBar";
import { colors } from "@/ui/theme";

export default function AppLayout(): React.JSX.Element {
  const { isDesktop } = useLayout();
  return (
    <View style={styles.row}>
      {isDesktop ? <Sidebar /> : null}
      <View style={styles.content}>
        <Tabs
          tabBar={(props) => (isDesktop ? null : <TabBar {...props} />)}
          screenOptions={{ headerShown: false, lazy: true, sceneStyle: { backgroundColor: colors.ivory } }}
          backBehavior="history"
        >
          <Tabs.Screen name="index" options={{ title: "Home" }} />
          <Tabs.Screen name="flat" options={{ title: "My Flat" }} />
          <Tabs.Screen name="payments" options={{ title: "Payments" }} />
          <Tabs.Screen name="construction" options={{ title: "Construction" }} />
          <Tabs.Screen name="more" options={{ title: "More" }} />
        </Tabs>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: "row", backgroundColor: colors.ivory },
  content: { flex: 1, minWidth: 0 },
});
