import { useState } from "react";
import { TextInput, View, type TextInputProps } from "react-native";
import { Feather } from "@expo/vector-icons";

import { fonts, makeStyles, radius, useTheme } from "@/src/theme";
import { Press, type IconName } from "./primitives";
import { T } from "./text";

type Props = TextInputProps & { label?: string; icon?: IconName; error?: string | null; secureToggle?: boolean; hint?: string };

export function Field({ label, icon, error, secureToggle, hint, style, multiline, testID, ...rest }: Props) {
  const s = useStyles();
  const { colors } = useTheme();
  const [focus, setFocus] = useState(false);
  const [hidden, setHidden] = useState(true);
  return (
    <View style={{ gap: 6 }}>
      {label ? <T style={s.label}>{label}</T> : null}
      <View style={[s.box, multiline && s.boxMulti, focus && s.focus, !!error && s.err]}>
        {icon ? <Feather name={icon} size={17} color={colors.muted} /> : null}
        <TextInput
          {...rest}
          testID={testID}
          placeholderTextColor={colors.muted}
          style={[s.input, multiline && s.inputMulti, style]}
          secureTextEntry={secureToggle ? hidden : rest.secureTextEntry}
          multiline={multiline}
          onFocus={(e) => {
            setFocus(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocus(false);
            rest.onBlur?.(e);
          }}
        />
        {secureToggle ? (
          <Press haptics={false} onPress={() => setHidden((h) => !h)} style={s.eye} testID={testID ? `${testID}-toggle` : undefined} accessibilityLabel={hidden ? "Show password" : "Hide password"}>
            <Feather name={hidden ? "eye" : "eye-off"} size={18} color={colors.muted} />
          </Press>
        ) : null}
      </View>
      {error ? (
        <T v="small" tone="error" testID={testID ? `${testID}-error` : undefined}>
          {error}
        </T>
      ) : hint ? (
        <T v="small" tone="muted">
          {hint}
        </T>
      ) : null}
    </View>
  );
}

// Single-choice chips (used as a select on mobile).
export function ChoiceChips({ options, value, onChange, testIDPrefix }: { options: string[]; value: string; onChange: (v: string) => void; testIDPrefix: string }) {
  const s = useStyles();
  return (
    <View style={s.chips}>
      {options.map((o) => {
        const on = o === value;
        return (
          <Press key={o} onPress={() => onChange(o)} testID={`${testIDPrefix}-${o.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`} style={[s.chip, on && s.chipOn]}>
            <T style={[s.chipText, on && s.chipTextOn]}>{o}</T>
          </Press>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  label: { fontFamily: fonts.bold, fontSize: 12, color: c.onSurfaceTertiary, letterSpacing: 0.4 },
  box: { minHeight: 52, borderRadius: radius.md, backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: c.borderStrong, flexDirection: "row", alignItems: "center", paddingHorizontal: 14, gap: 10 },
  boxMulti: { alignItems: "flex-start", paddingVertical: 12 },
  focus: { borderColor: c.gold, borderWidth: 1.5 },
  err: { borderColor: c.error },
  input: { flex: 1, fontFamily: fonts.medium, fontSize: 15, color: c.onSurface, paddingVertical: 12, outlineStyle: "none" } as any,
  inputMulti: { minHeight: 110, textAlignVertical: "top", paddingVertical: 0 },
  eye: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 42, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: c.borderStrong, backgroundColor: c.surfaceSecondary, justifyContent: "center" },
  chipOn: { backgroundColor: c.brandPrimary, borderColor: c.brandPrimary },
  chipText: { fontFamily: fonts.semibold, fontSize: 13, color: c.onSurface },
  chipTextOn: { color: c.onBrandPrimary },
}));
