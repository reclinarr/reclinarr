import type { ViewStyle } from "react-native";
import { colors } from "./theme.js";

export type TvPressState = { pressed: boolean; focused?: boolean };

/** TV / RN-web Pressable style callback may include `focused`. */
export function isTvFocused(state: { pressed: boolean }): boolean {
  return Boolean((state as TvPressState).focused);
}

/** High-contrast focus fill (white surface, for dark UI). */
export const tvFocusFill: ViewStyle = {
  backgroundColor: colors.focus,
  borderColor: colors.focus,
  transform: [{ scale: 1.06 }],
};

/** Outline ring for surfaces that already use a light fill (e.g. primary buttons). */
export const tvFocusRingOnLight: ViewStyle = {
  borderColor: colors.bg,
  borderWidth: 3,
  transform: [{ scale: 1.06 }],
};

/** Soft lift + white ring for list rows / cards. */
export const tvFocusHighlight: ViewStyle = {
  backgroundColor: "rgba(255,255,255,0.16)",
  borderColor: colors.focus,
  borderWidth: 2,
  transform: [{ scale: 1.02 }],
};
