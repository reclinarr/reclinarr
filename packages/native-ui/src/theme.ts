/** Shared Reclinarr palette for React Native surfaces (mobile + TV). */
export const colors = {
  bg: "#141414",
  bg1: "#181818",
  bg2: "#2f2f2f",
  text: "#ffffff",
  muted: "#b3b3b3",
  accent: "#ffb000",
  focus: "#ffffff",
  danger: "#e87c03",
} as const;

export type NativeColors = typeof colors;
