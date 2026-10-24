// Design tokens for the KKT customer portal — "royal deep navy + gold" on ivory surfaces.
// Fonts: the brand faces (Cormorant Garamond display / Manrope body) are loaded on web through
// Google Fonts (see src/app/+html.tsx) with system fallbacks everywhere else. Swap the
// `fonts` tokens below once the font packages are installed natively (expo-font).
import { Platform } from "react-native";

export const colors = {
  navy: "#0B1F3A",
  navy800: "#0F2A4D",
  navy700: "#163663",
  navy500: "#2A4D80",
  navy200: "#C9D3E3",
  navy100: "#E6EBF2",
  navy50: "#F1F4F8",
  gold: "#C9A227",
  gold700: "#A98518",
  gold200: "#EBD88F",
  gold100: "#F5ECCF",
  gold50: "#FBF6E7",
  ivory: "#F8F6F1",
  surface: "#FFFFFF",
  surfaceMuted: "#F2EFE8",
  ink: "#14213A",
  inkMuted: "#5B6778",
  inkSubtle: "#8B95A5",
  line: "#E5E1D8",
  lineStrong: "#D5D0C4",
  success: "#1E7D4B",
  successBg: "#E6F4EC",
  danger: "#B42318",
  dangerBg: "#FBEAE8",
  warning: "#B76E00",
  warningBg: "#FFF4E0",
  info: "#1C4E80",
  infoBg: "#E8F0F9",
  onNavy: "#FFFFFF",
  onNavyMuted: "rgba(255,255,255,0.72)",
  onNavySubtle: "rgba(255,255,255,0.5)",
  overlay: "rgba(5,12,24,0.6)",
} as const;

export const fonts = {
  display: Platform.select({
    ios: "Georgia",
    android: "serif",
    default: "'Cormorant Garamond', Georgia, 'Times New Roman', serif",
  }) as string,
  body: Platform.select({
    ios: "System",
    android: "sans-serif",
    default: "Manrope, Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  }) as string,
  mono: Platform.select({
    ios: "Menlo",
    android: "monospace",
    default: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  }) as string,
};

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  gutter: 16,
} as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 } as const;

export const shadow = {
  card: Platform.select({
    web: { boxShadow: "0 10px 30px rgba(11,31,58,0.08)" },
    default: { boxShadow: "0 6px 18px rgba(11,31,58,0.10)" },
  }) as { boxShadow: string },
  raised: Platform.select({
    web: { boxShadow: "0 18px 50px rgba(11,31,58,0.18)" },
    default: { boxShadow: "0 12px 30px rgba(11,31,58,0.22)" },
  }) as { boxShadow: string },
};

/** Layout breakpoints: the sidebar appears at ≥ 1024 px; cards become tables at ≥ 768 px. */
export const breakpoints = { tablet: 768, desktop: 1024 } as const;
export const SIDEBAR_WIDTH = 264;
export const CONTENT_MAX_WIDTH = 1080;
export const TAB_BAR_BASE_HEIGHT = 60;

export type Tone = "neutral" | "navy" | "gold" | "success" | "danger" | "warning" | "info";

export const toneStyles: Record<Tone, { bg: string; fg: string; border: string }> = {
  neutral: { bg: colors.surfaceMuted, fg: colors.inkMuted, border: colors.line },
  navy: { bg: colors.navy100, fg: colors.navy, border: colors.navy200 },
  gold: { bg: colors.gold100, fg: colors.gold700, border: colors.gold200 },
  success: { bg: colors.successBg, fg: colors.success, border: "#BFE3CD" },
  danger: { bg: colors.dangerBg, fg: colors.danger, border: "#F2C4BE" },
  warning: { bg: colors.warningBg, fg: colors.warning, border: "#F5DDA8" },
  info: { bg: colors.infoBg, fg: colors.info, border: "#C5D8EE" },
};
