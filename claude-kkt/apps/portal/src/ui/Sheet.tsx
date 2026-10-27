// Bottom sheet on phones, centred dialog on wider screens. Used for pickers and confirmations.
import { type ReactNode } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "./Button";
import { useLayout } from "./Responsive";
import { T } from "./Text";
import { colors, radius, shadow, space } from "./theme";

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: number;
}

export function Sheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
  footer,
  maxWidth = 520,
}: SheetProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { isPhone } = useLayout();
  return (
    <Modal visible={visible} transparent animationType={isPhone ? "slide" : "fade"} onRequestClose={onClose}>
      <View style={[styles.backdrop, isPhone ? styles.bottom : styles.center]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={[
            styles.panel,
            shadow.raised,
            isPhone
              ? [styles.panelBottom, { paddingBottom: Math.max(insets.bottom, space.lg) }]
              : [styles.panelCenter, { maxWidth }],
          ]}
        >
          {isPhone ? <View style={styles.grabber} /> : null}
          {title ? (
            <View style={styles.head}>
              <View style={{ flex: 1 }}>
                <T variant="h2">{title}</T>
                {subtitle ? (
                  <T variant="small" color={colors.inkMuted}>
                    {subtitle}
                  </T>
                ) : null}
              </View>
              {!isPhone ? <Button title="Close" variant="ghost" size="sm" onPress={onClose} /> : null}
            </View>
          ) : null}
          <ScrollView
            style={{ maxHeight: 520 }}
            contentContainerStyle={{ gap: space.sm }}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

export function ConfirmDialog({
  visible,
  title,
  body,
  confirmLabel = "Confirm",
  destructive,
  loading,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  title: string;
  body?: string;
  confirmLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <Sheet visible={visible} onClose={onClose} title={title} maxWidth={440}>
      {body ? (
        <T variant="body" color={colors.inkMuted}>
          {body}
        </T>
      ) : null}
      <View style={styles.confirmRow}>
        <Button title="Cancel" variant="outline" onPress={onClose} />
        <Button
          title={confirmLabel}
          variant={destructive ? "danger" : "primary"}
          loading={loading}
          onPress={onConfirm}
        />
      </View>
    </Sheet>
  );
}

/** Simple option list for pickers. */
export function OptionRow({
  label,
  hint,
  selected,
  onPress,
}: {
  label: string;
  hint?: string;
  selected?: boolean;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        selected ? styles.optionSelected : null,
        pressed ? { opacity: 0.8 } : null,
      ]}
    >
      <View style={{ flex: 1 }}>
        <T variant="bodyStrong" color={selected ? colors.navy : colors.ink}>
          {label}
        </T>
        {hint ? (
          <T variant="small" color={colors.inkMuted}>
            {hint}
          </T>
        ) : null}
      </View>
      {selected ? <View style={styles.tick} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay },
  bottom: { justifyContent: "flex-end" },
  center: { justifyContent: "center", alignItems: "center", padding: space.lg },
  panel: { backgroundColor: colors.ivory, padding: space.lg, gap: space.md },
  panelBottom: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: "88%" },
  panelCenter: { borderRadius: radius.xl, width: "100%" },
  grabber: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.lineStrong,
    marginTop: -4,
  },
  head: { flexDirection: "row", alignItems: "flex-start", gap: space.md },
  footer: { paddingTop: space.sm },
  confirmRow: { flexDirection: "row", justifyContent: "flex-end", gap: space.sm, marginTop: space.md },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  optionSelected: { borderColor: colors.gold, backgroundColor: colors.gold50 },
  tick: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.gold },
});
