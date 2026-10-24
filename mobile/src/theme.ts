// Design tokens for the KKT Customer Portal (ivory / navy / gold). Light theme only.
// Build sheets with makeStyles so colours and layout live together; read
// useTheme().colors for non-style colour props (icons, placeholders, spinners).

import { useMemo } from "react";
import { Appearance, Platform, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const light = {
  // Surfaces
  surface: "#F7F5EF", // ivory canvas
  onSurface: "#0B1F3A", // navy text
  surfaceSecondary: "#FFFFFF", // cards
  onSurfaceSecondary: "#0B1F3A",
  surfaceTertiary: "#F1EEE6", // inputs, chips, soft fills
  onSurfaceTertiary: "#3E4C63", // secondary text (AA on ivory/white)
  surfaceInverse: "#0B1F3A", // navy hero cards, toasts
  onSurfaceInverse: "#FFFFFF",
  muted: "#5B6880", // minimum muted text (AA on ivory/white)
  mutedInverse: "#C9D2E0", // secondary text on navy
  dueOnInverse: "#FDBA8C", // warm red that reads on navy
  advanceOnInverse: "#86EFAC", // green that reads on navy

  // Brand
  brand: "#0B1F3A",
  onBrand: "#FFFFFF",
  brandPrimary: "#0B1F3A",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#C9A227", // gold
  onBrandSecondary: "#0B1F3A",
  brandTertiary: "#FBF4DF", // pale gold chip
  onBrandTertiary: "#7A5F0E",
  gold: "#C9A227",
  goldDeep: "#9A7A12", // gold text on light surfaces (AA)
  goldGradStart: "#D8B64A",
  goldGradEnd: "#B8911C",
  navy700: "#163866",
  navy50: "#E9EDF3", // icon tiles

  // Status
  success: "#13703A",
  onSuccess: "#FFFFFF",
  successSoft: "#E8F5EC",
  warning: "#B45309",
  onWarning: "#FFFFFF",
  warningSoft: "#FDF1E2",
  error: "#B4380A", // warm red for dues
  onError: "#FFFFFF",
  errorSoft: "#FDECE4",
  info: "#1D4ED8",
  onInfo: "#FFFFFF",
  infoSoft: "#E8EEFC",

  // Lines
  border: "#E8E4DA", // hairline
  borderStrong: "#C9C3B4",
  divider: "#EEEAE1",
  overlay: "rgba(11,31,58,0.96)",
  skeleton: "#ECE8DE",
};

export type ThemeColors = typeof light;

export const defaultScheme = "light" satisfies ColorScheme;

export const themes: { light: ThemeColors; dark?: ThemeColors } = { light };

export const fonts = {
  regular: "Manrope_400Regular",
  medium: "Manrope_500Medium",
  semibold: "Manrope_600SemiBold",
  bold: "Manrope_700Bold",
  extrabold: "Manrope_800ExtraBold",
  serif: "CormorantGaramond_600SemiBold",
  serifBold: "CormorantGaramond_700Bold",
};

export const radius = { sm: 10, md: 14, lg: 18, xl: 22, pill: 999 };

export const BREAKPOINT = { table: 768, sidebar: 1024 };

export const shadow = Platform.select({
  web: { boxShadow: "0 1px 2px rgba(11,31,58,0.04), 0 8px 24px rgba(11,31,58,0.06)" } as object,
  default: {
    shadowColor: "#0B1F3A",
    shadowOpacity: 0.07,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
});

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme ?? "unspecified");
}

setColorScheme?.(themes.dark ? null : defaultScheme);

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme();
  const scheme: ColorScheme = (system === "light" || system === "dark") && themes[system] ? system : defaultScheme;
  return { scheme, colors: themes[scheme] ?? themes.light };
}

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}
