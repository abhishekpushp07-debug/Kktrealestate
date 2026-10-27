import { useWindowDimensions } from "react-native";
import { breakpoints, CONTENT_MAX_WIDTH, SIDEBAR_WIDTH, space } from "./theme";

export interface Layout {
  width: number;
  height: number;
  isDesktop: boolean;
  isTablet: boolean;
  isPhone: boolean;
  /** Horizontal page gutter. */
  gutter: number;
  /** Width available for content (window minus sidebar). */
  contentWidth: number;
  maxWidth: number;
}

export function useLayout(): Layout {
  const { width, height } = useWindowDimensions();
  const isDesktop = width >= breakpoints.desktop;
  const isTablet = width >= breakpoints.tablet && !isDesktop;
  const contentWidth = isDesktop ? width - SIDEBAR_WIDTH : width;
  return {
    width,
    height,
    isDesktop,
    isTablet,
    isPhone: !isDesktop && !isTablet,
    gutter: isDesktop ? space.xxxl : isTablet ? space.xxl : space.gutter,
    contentWidth,
    maxWidth: CONTENT_MAX_WIDTH,
  };
}
