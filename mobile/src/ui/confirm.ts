import { Alert, Platform } from "react-native";

// Cross-platform confirm dialog (Alert on native, window.confirm on web).
export function confirm(title: string, message: string, okLabel = "Continue", destructive = false): Promise<boolean> {
  if (Platform.OS === "web") return Promise.resolve(typeof window !== "undefined" ? window.confirm(`${title}\n\n${message}`) : true);
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: okLabel, style: destructive ? "destructive" : "default", onPress: () => resolve(true) },
    ]),
  );
}
