/** Shared Reclinarr palette for React Native surfaces (mobile + TV). */
export const colors = {
  bg: "#141414",
  bg1: "#181818",
  bg2: "#2f2f2f",
  text: "#ffffff",
  muted: "#b3b3b3",
  accent: "#c83a9f",
  accentFrom: "#7c3aed",
  accentTo: "#e11d48",
  focus: "#ffffff",
  danger: "#e87c03",
} as const;

export type NativeColors = typeof colors;
