import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { ApiError, errorMessage } from "@/api/client";
import { Button } from "./Button";
import { Icon, type IconName } from "./Icon";
import { T } from "./Text";
import { colors, radius, space, toneStyles, type Tone } from "./theme";

export function EmptyState({ icon = "document", title, body, action, onAction, style }: { icon?: IconName; title: string; body?: string; action?: string; onAction?: () => void; style?: StyleProp<ViewStyle> }): React.JSX.Element {
  return (
    <View style={[styles.wrap, style]}>
      <View style={styles.iconRing}>
        <Icon name={icon} size={26} color={colors.gold700} />
      </View>
      <T variant="h3" align="center">
        {title}
      </T>
      {body ? (
        <T variant="small" color={colors.inkMuted} align="center" style={{ maxWidth: 360 }}>
          {body}
        </T>
      ) : null}
      {action && onAction ? <Button title={action} variant="outline" size="sm" onPress={onAction} style={{ marginTop: space.sm }} /> : null}
    </View>
  );
}

export function ErrorState({ error, onRetry, title, style }: { error: unknown; onRetry?: () => void; title?: string; style?: StyleProp<ViewStyle> }): React.JSX.Element {
  const offline = error instanceof ApiError && error.isNetwork;
  const notFound = error instanceof ApiError && error.isNotFound;
  return (
    <View style={[styles.wrap, style]}>
      <View style={[styles.iconRing, { backgroundColor: offline ? colors.warningBg : colors.dangerBg }]}>
        <Icon name={offline ? "refresh" : notFound ? "search" : "warning"} size={26} color={offline ? colors.warning : colors.danger} />
      </View>
      <T variant="h3" align="center">
        {title ?? (offline ? "You're offline" : notFound ? "Not found" : "Couldn't load this")}
      </T>
      <T variant="small" color={colors.inkMuted} align="center" style={{ maxWidth: 360 }}>
        {errorMessage(error)}
      </T>
      {onRetry ? <Button title="Try again" variant="outline" size="sm" icon="refresh" onPress={onRetry} style={{ marginTop: space.sm }} /> : null}
    </View>
  );
}

/** Inline message strip (info / warning / danger / success). */
export function Notice({ tone = "info", title, body, icon, style, children }: { tone?: Tone; title?: string; body?: string; icon?: IconName; style?: StyleProp<ViewStyle>; children?: React.ReactNode }): React.JSX.Element {
  const t = toneStyles[tone];
  const defaultIcon: IconName = tone === "danger" ? "warning" : tone === "warning" ? "clock" : tone === "success" ? "check" : "info";
  return (
    <View style={[styles.notice, { backgroundColor: t.bg, borderColor: t.border }, style]}>
      <Icon name={icon ?? defaultIcon} size={18} color={t.fg} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: 2 }}>
        {title ? (
          <T variant="bodyStrong" color={t.fg}>
            {title}
          </T>
        ) : null}
        {body ? (
          <T variant="small" color={colors.ink}>
            {body}
          </T>
        ) : null}
        {children}
      </View>
    </View>
  );
}

/** Thin bar shown while a cached screen refreshes or when offline with cached data. */
export function StatusBar({ text, tone = "info" }: { text: string; tone?: Tone }): React.JSX.Element {
  const t = toneStyles[tone];
  return (
    <View style={[styles.statusBar, { backgroundColor: t.bg }]}>
      <T variant="caption" color={t.fg} align="center">
        {text}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: space.sm, paddingVertical: space.xxxl, paddingHorizontal: space.lg },
  iconRing: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.gold100, alignItems: "center", justifyContent: "center", marginBottom: space.xs },
  notice: { flexDirection: "row", gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: 1 },
  statusBar: { paddingVertical: 6, paddingHorizontal: space.lg },
});
