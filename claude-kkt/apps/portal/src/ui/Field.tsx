import { useId, useState, type ComponentProps } from "react";
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { alertRegion, useAnnounce, webAria } from "./a11y";
import { Icon, type IconName } from "./Icon";
import { T } from "./Text";
import { colors, fonts, radius, space } from "./theme";

export interface FieldProps extends TextInputProps {
  ref?: ComponentProps<typeof TextInput>["ref"];
  label?: string;
  hint?: string;
  error?: string | null;
  icon?: IconName;
  secureToggle?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
  onNavy?: boolean;
  /** Marks the field as required for assistive tech (aria-required). */
  required?: boolean;
}

/**
 * Labelled text field. The TextInput carries the label as its accessible name (accessibilityLabel → aria-label on web), is
 * aria-invalid and aria-describedby the error (or hint) while one shows, and the error is an assertive live region announced when it
 * appears (role="alert" on web, accessibilityLiveRegion on Android, an explicit announcement on iOS).
 */
export function Field({
  ref,
  label,
  hint,
  error,
  icon,
  secureToggle,
  containerStyle,
  onNavy,
  required,
  secureTextEntry,
  multiline,
  style,
  editable = true,
  ...rest
}: FieldProps): React.JSX.Element {
  const baseId = `f${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const errorId = `${baseId}-error`;
  const hintId = `${baseId}-hint`;
  useAnnounce(error);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(!!secureTextEntry);
  // focus: gold on navy, the darker text gold on light surfaces (plain gold is 2.4:1 on white, below the 3:1 a focus indicator needs)
  const borderColor = error
    ? onNavy
      ? colors.dangerOnNavy
      : colors.danger
    : focused
      ? onNavy
        ? colors.gold
        : colors.goldText
      : onNavy
        ? colors.fieldBorderOnNavy
        : colors.fieldBorder;
  return (
    <View style={[styles.wrap, containerStyle]}>
      {label ? (
        <T variant="caption" color={onNavy ? colors.onNavyMuted : colors.inkMuted}>
          {label}
        </T>
      ) : null}
      <View
        style={[
          styles.box,
          {
            borderColor,
            backgroundColor: onNavy ? "rgba(255,255,255,0.08)" : editable ? colors.surface : colors.surfaceMuted,
          },
          multiline ? styles.multi : null,
        ]}
      >
        {icon ? <Icon name={icon} size={18} color={onNavy ? colors.onNavyMuted : colors.inkSubtle} /> : null}
        <TextInput
          ref={ref}
          accessibilityLabel={rest.accessibilityLabel ?? label ?? rest.placeholder}
          accessibilityHint={error ?? hint}
          {...webAria({
            "aria-invalid": Boolean(error),
            "aria-describedby": error ? errorId : hint ? hintId : undefined,
            "aria-required": required,
          })}
          placeholderTextColor={onNavy ? colors.onNavySubtle : colors.inkSubtle}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          secureTextEntry={secureToggle ? hidden : secureTextEntry}
          multiline={multiline}
          editable={editable}
          style={[
            styles.input,
            { color: onNavy ? colors.onNavy : colors.ink },
            multiline ? styles.multiInput : null,
            style,
          ]}
          {...rest}
        />
        {secureToggle ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={hidden ? "Show password" : "Hide password"}
            onPress={() => setHidden((h) => !h)}
            hitSlop={14}
            style={styles.toggle}
          >
            <T variant="caption" color={onNavy ? colors.gold200 : colors.navy}>
              {hidden ? "Show" : "Hide"}
            </T>
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <T variant="caption" color={onNavy ? colors.dangerOnNavy : colors.danger} id={errorId} {...alertRegion}>
          {error}
        </T>
      ) : hint ? (
        <T variant="caption" color={onNavy ? colors.onNavySubtle : colors.inkSubtle} id={hintId}>
          {hint}
        </T>
      ) : null}
    </View>
  );
}

/** Read-only "select" field that opens a picker when pressed. */
export function SelectField({
  label,
  value,
  placeholder = "Choose…",
  onPress,
  error,
  disabled,
}: {
  label: string;
  value: string | null;
  placeholder?: string;
  onPress: () => void;
  error?: string | null;
  disabled?: boolean;
}): React.JSX.Element {
  const errorId = `s${useId().replace(/[^A-Za-z0-9_-]/g, "")}-error`;
  useAnnounce(error);
  return (
    <View style={styles.wrap}>
      <T variant="caption" color={colors.inkMuted}>
        {label}
      </T>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value ?? placeholder}`}
        accessibilityHint={error ?? undefined}
        {...webAria({ "aria-invalid": Boolean(error), "aria-describedby": error ? errorId : undefined })}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [
          styles.box,
          {
            borderColor: error ? colors.danger : colors.fieldBorder,
            backgroundColor: colors.surface,
            opacity: pressed ? 0.8 : disabled ? 0.6 : 1,
          },
        ]}
      >
        <T variant="body" color={value ? colors.ink : colors.inkSubtle} style={{ flex: 1 }} numberOfLines={1}>
          {value ?? placeholder}
        </T>
        <Icon name="chevron-down" size={16} color={colors.inkSubtle} />
      </Pressable>
      {error ? (
        <T variant="caption" color={colors.danger} id={errorId} {...alertRegion}>
          {error}
        </T>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  box: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
  },
  multi: { minHeight: 120, alignItems: "flex-start", paddingVertical: space.sm },
  input: { flex: 1, fontFamily: fonts.body, fontSize: 15, paddingVertical: 10, minWidth: 0 },
  multiInput: { minHeight: 100, textAlignVertical: "top" },
  toggle: { minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center" },
});
