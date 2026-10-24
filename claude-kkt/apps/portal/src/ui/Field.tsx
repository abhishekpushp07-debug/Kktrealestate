import { useState, type ComponentProps } from "react";
import { Pressable, StyleSheet, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from "react-native";
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
}

export function Field({ ref, label, hint, error, icon, secureToggle, containerStyle, onNavy, secureTextEntry, multiline, style, editable = true, ...rest }: FieldProps): React.JSX.Element {
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(!!secureTextEntry);
  const borderColor = error ? colors.danger : focused ? colors.gold : onNavy ? "rgba(255,255,255,0.25)" : colors.lineStrong;
  return (
    <View style={[styles.wrap, containerStyle]}>
      {label ? (
        <T variant="caption" color={onNavy ? colors.onNavyMuted : colors.inkMuted}>
          {label}
        </T>
      ) : null}
      <View style={[styles.box, { borderColor, backgroundColor: onNavy ? "rgba(255,255,255,0.08)" : editable ? colors.surface : colors.surfaceMuted }, multiline ? styles.multi : null]}>
        {icon ? <Icon name={icon} size={18} color={onNavy ? colors.onNavyMuted : colors.inkSubtle} /> : null}
        <TextInput
          ref={ref}
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
          style={[styles.input, { color: onNavy ? colors.onNavy : colors.ink }, multiline ? styles.multiInput : null, style]}
          {...rest}
        />
        {secureToggle ? (
          <Pressable accessibilityRole="button" accessibilityLabel={hidden ? "Show password" : "Hide password"} onPress={() => setHidden((h) => !h)} hitSlop={8}>
            <T variant="caption" color={onNavy ? colors.gold200 : colors.navy}>
              {hidden ? "Show" : "Hide"}
            </T>
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <T variant="caption" color={colors.danger}>
          {error}
        </T>
      ) : hint ? (
        <T variant="caption" color={onNavy ? colors.onNavySubtle : colors.inkSubtle}>
          {hint}
        </T>
      ) : null}
    </View>
  );
}

/** Read-only "select" field that opens a picker when pressed. */
export function SelectField({ label, value, placeholder = "Choose…", onPress, error, disabled }: { label: string; value: string | null; placeholder?: string; onPress: () => void; error?: string | null; disabled?: boolean }): React.JSX.Element {
  return (
    <View style={styles.wrap}>
      <T variant="caption" color={colors.inkMuted}>
        {label}
      </T>
      <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.box, { borderColor: error ? colors.danger : colors.lineStrong, backgroundColor: colors.surface, opacity: pressed ? 0.8 : disabled ? 0.6 : 1 }]}>
        <T variant="body" color={value ? colors.ink : colors.inkSubtle} style={{ flex: 1 }} numberOfLines={1}>
          {value ?? placeholder}
        </T>
        <Icon name="chevron-down" size={16} color={colors.inkSubtle} />
      </Pressable>
      {error ? (
        <T variant="caption" color={colors.danger}>
          {error}
        </T>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  box: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 48, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md },
  multi: { minHeight: 120, alignItems: "flex-start", paddingVertical: space.sm },
  input: { flex: 1, fontFamily: fonts.body, fontSize: 15, paddingVertical: 10, minWidth: 0 },
  multiInput: { minHeight: 100, textAlignVertical: "top" },
});
