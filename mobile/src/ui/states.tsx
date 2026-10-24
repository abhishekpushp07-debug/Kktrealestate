import { View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { makeStyles, useTheme } from "@/src/theme";
import { Button, Card, type IconName } from "./primitives";
import { T } from "./text";

export function Empty({ title, hint, icon = "inbox", action, testID = "empty-state" }: { title: string; hint?: string; icon?: IconName; action?: { label: string; onPress: () => void; testID?: string }; testID?: string }) {
  const s = useStyles();
  const { colors } = useTheme();
  return (
    <Card testID={testID} style={s.wrap}>
      <View style={s.icon}>
        <Feather name={icon} size={24} color={colors.onSurface} />
      </View>
      <T v="title" style={s.center}>
        {title}
      </T>
      {hint ? (
        <T tone="muted" style={[s.center, { marginTop: 4 }]}>
          {hint}
        </T>
      ) : null}
      {action ? <Button small kind="gold" label={action.label} onPress={action.onPress} testID={action.testID} style={{ marginTop: 16 }} /> : null}
    </Card>
  );
}

export function ErrorState({ message, onRetry, testID = "error-state" }: { message?: string; onRetry?: () => void; testID?: string }) {
  return (
    <Empty
      testID={testID}
      icon="wifi-off"
      title="Couldn't load this"
      hint={message || "Please check your connection and try again."}
      action={onRetry ? { label: "Try again", onPress: onRetry, testID: `${testID}-retry` } : undefined}
    />
  );
}

export function NoBooking() {
  return <Empty testID="no-booking-state" icon="home" title="No booking linked yet" hint="Once your booking is confirmed, your flat, payments and construction updates will appear here." />;
}

const useStyles = makeStyles((c) => ({
  wrap: { alignItems: "center", paddingVertical: 36, paddingHorizontal: 24 },
  icon: { width: 52, height: 52, borderRadius: 26, backgroundColor: c.surface, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  center: { textAlign: "center" },
}));
