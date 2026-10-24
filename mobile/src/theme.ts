// Design tokens for the KKT Customer Portal (ivory / navy / gold). Light theme only.
// Build sheets with makeStyles so colours and layout live together; read
// useTheme().colors for non-style colour props (icons, placeholders, spinners).

import { useMemo } from "react";
import { Appearance, Platform, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const light = {
  // Surfaces
  surface: "#F8F6F1", // ivory canvas
  onSurface: "#0B1F3A", // navy text
  surfaceSecondary: "#FFFFFF", // cards
  onSurfaceSecondary: "#0B1F3A",
  surfaceTertiary: "#F1EEE6", // inputs, chips, soft fills
  onSurfaceTertiary: "#4A5568",
  surfaceInverse: "#0B1F3A", // navy hero cards, toasts
  onSurfaceInverse: "#FFFFFF",
  muted: "#6B7280",
  mutedInverse: "#B8C2D3", // secondary text on navy
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
  navy700: "#163866",

  // Status
  success: "#15803D",
  onSuccess: "#FFFFFF",
  successSoft: "#E8F5EC",
  warning: "#B45309",
  onWarning: "#FFFFFF",
  warningSoft: "#FDF1E2",
  error: "#C2410C", // warm red for dues
  onError: "#FFFFFF",
  errorSoft: "#FDECE4",
  info: "#1D4ED8",
  onInfo: "#FFFFFF",
  infoSoft: "#E8EEFC",

  // Lines
  border: "rgba(11,31,58,0.08)",
  borderStrong: "rgba(11,31,58,0.22)",
  divider: "rgba(11,31,58,0.07)",
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

export const shadow = Platform.select({
  web: { boxShadow: "0 6px 24px rgba(11,31,58,0.07)" } as object,
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
