// Page scaffolding: a scrolling content column (max width, gutters, pull-to-refresh, safe bottom
// padding) and a header with back button / title / actions. Tab screens pass `tabbed` so the
// bottom padding accounts for the tab bar (which is laid out outside the content, never over it).
import { useRouter } from "expo-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { haptics } from "@/lib/haptics";
import { IconButton } from "./Button";
import { useLayout } from "./Responsive";
import { T } from "./Text";
import { colors, space } from "./theme";

export interface ScreenProps extends Omit<ScrollViewProps, "refreshControl"> {
  children: ReactNode;
  onRefresh?: () => Promise<unknown>;
  /** Extra space at the bottom (e.g. above a sticky footer). */
  bottomInset?: number;
  padded?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  tone?: "ivory" | "navy";
}

export function Screen({
  children,
  onRefresh,
  bottomInset = 0,
  padded = true,
  contentStyle,
  tone = "ivory",
  ...rest
}: ScreenProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const layout = useLayout();
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    if (!onRefresh) return;
    haptics.select();
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <ScrollView
      style={[styles.scroll, { backgroundColor: tone === "navy" ? colors.navy : colors.ivory }]}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: Math.max(insets.bottom, space.lg) + bottomInset + space.lg },
        padded ? { paddingHorizontal: layout.gutter } : null,
        contentStyle,
      ]}
      keyboardShouldPersistTaps="handled"
      // web: the screen scroller is focusable so keyboard users can scroll screens that hold no controls (WCAG 2.1.1)
      focusable={Platform.OS === "web"}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={colors.gold}
            colors={[colors.navy, colors.gold]}
          />
        ) : undefined
      }
      {...rest}
    >
      <View style={[styles.column, { maxWidth: layout.maxWidth }]}>{children}</View>
    </ScrollView>
  );
}

export interface HeaderProps {
  title: string;
  subtitle?: string;
  back?: boolean;
  onBack?: () => void;
  right?: ReactNode;
  tone?: "ivory" | "navy";
  /** Large editorial title (tab roots). */
  large?: boolean;
  children?: ReactNode;
}

/** Web: the browser tab / screen-reader page title follows the screen ("Payments · KKT Customer Portal"). */
export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    document.title = title ? `${title} · KKT Customer Portal` : "KKT Customer Portal";
  }, [title]);
}

/** Screen header with safe-area top padding. */
export function Header({
  title,
  subtitle,
  back,
  onBack,
  right,
  tone = "ivory",
  large,
  children,
}: HeaderProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const layout = useLayout();
  const onNavy = tone === "navy";
  useDocumentTitle(title);
  const goBack = () => {
    if (onBack) return onBack();
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };
  return (
    <View
      style={[
        styles.header,
        {
          paddingTop: Math.max(insets.top, Platform.OS === "web" ? 0 : 8) + (layout.isDesktop ? space.lg : space.sm),
          backgroundColor: onNavy ? colors.navy : colors.ivory,
          paddingHorizontal: layout.gutter,
        },
      ]}
    >
      <View style={[styles.headerInner, { maxWidth: layout.maxWidth }]}>
        <View style={styles.headerRow}>
          {back ? (
            <IconButton
              name="chevron-left"
              label="Back"
              onPress={goBack}
              color={onNavy ? colors.onNavy : colors.navy}
              bg={onNavy ? "rgba(255,255,255,0.1)" : colors.surface}
              style={{ marginLeft: -4 }}
            />
          ) : null}
          <View style={{ flex: 1, gap: 2 }}>
            <T variant={large ? "h1" : "h2"} color={onNavy ? colors.onNavy : colors.ink} numberOfLines={1}>
              {title}
            </T>
            {subtitle ? (
              <T variant="small" color={onNavy ? colors.onNavyMuted : colors.inkMuted} numberOfLines={1}>
                {subtitle}
              </T>
            ) : null}
          </View>
          {right ? <View style={styles.headerRight}>{right}</View> : null}
        </View>
        {children}
      </View>
    </View>
  );
}

export function Section({
  title,
  action,
  onAction,
  children,
  style,
}: {
  title?: string;
  action?: string;
  onAction?: () => void;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  return (
    <View style={[styles.section, style]}>
      {title ? (
        <View style={styles.sectionHead}>
          <T variant="label" color={colors.inkSubtle}>
            {title}
          </T>
          {action && onAction ? (
            <Pressable accessibilityRole="button" onPress={onAction} style={styles.sectionAction}>
              <T variant="caption" color={colors.navy}>
                {action}
              </T>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {children}
    </View>
  );
}

/** Two columns at ≥ 768 px, stacked on phones. */
export function Columns({ children, gap = space.lg }: { children: ReactNode; gap?: number }): React.JSX.Element {
  const { isPhone } = useLayout();
  return <View style={[{ gap }, isPhone ? null : { flexDirection: "row", alignItems: "flex-start" }]}>{children}</View>;
}

export function Col({ children, flex = 1 }: { children: ReactNode; flex?: number }): React.JSX.Element {
  const { isPhone } = useLayout();
  return <View style={isPhone ? { gap: space.lg } : { flex, gap: space.lg, minWidth: 0 }}>{children}</View>;
}

const styles = StyleSheet.create({
  sectionAction: { minHeight: 44, justifyContent: "center", paddingHorizontal: 4, marginVertical: -12 },
  scroll: { flex: 1 },
  content: { paddingTop: space.lg, alignItems: "center" },
  column: { width: "100%", gap: space.lg },
  header: { paddingBottom: space.md, alignItems: "center" },
  headerInner: { width: "100%", gap: space.md },
  headerRow: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 44 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: space.sm },
  section: { gap: space.md },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 2 },
});
