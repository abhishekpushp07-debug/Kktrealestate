// Haptic feedback on key actions — native only; a no-op on web.
import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

const native = Platform.OS === "ios" || Platform.OS === "android";

export const haptics = {
  tap(): void {
    if (native) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  },
  select(): void {
    if (native) void Haptics.selectionAsync().catch(() => undefined);
  },
  success(): void {
    if (native) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  },
  error(): void {
    if (native) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
  },
};
