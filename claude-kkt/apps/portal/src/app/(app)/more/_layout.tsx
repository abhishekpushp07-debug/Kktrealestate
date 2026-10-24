import { Stack } from "expo-router";
import { colors } from "@/ui/theme";

export default function MoreLayout(): React.JSX.Element {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.ivory } }} />;
}
