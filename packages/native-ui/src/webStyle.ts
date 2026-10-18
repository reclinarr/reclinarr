import { Platform, type TextStyle, type ViewStyle } from "react-native";

/** Page background measured from the current Netflix browse UI. */
export const webBg = "#000000";

/** Room under a poster so the absolute hover popover stays inside the rail box. */
export const HOVER_ROOM = 200;

/** Extra vertical room so a focused TV card can scale without clipping. */
export const FOCUS_ROOM = 36;

export function webGradient(image: string): ViewStyle {
  if (Platform.OS !== "web") return {};
  return { backgroundImage: image } as ViewStyle;
}

/** Cross-platform text shadow — RN Web wants `textShadow`, native wants the split props. */
export function textShadowStyle(
  offsetX: number,
  offsetY: number,
  radius: number,
  color: string,
): TextStyle {
  if (Platform.OS === "web") {
    return {
      textShadow: `${offsetX}px ${offsetY}px ${radius}px ${color}`,
    } as TextStyle;
  }
  return {
    textShadowColor: color,
    textShadowOffset: { width: offsetX, height: offsetY },
    textShadowRadius: radius,
  };
}
