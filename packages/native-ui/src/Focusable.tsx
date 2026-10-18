import {
  Pressable,
  Text,
  StyleSheet,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { isTvFocused, tvFocusFill } from "./focus.js";
import { colors } from "./theme.js";

/** TV-style focusable control (D-pad). Prefer `Button` with `showFocusRing` for shared CTAs. */
export function Focusable({
  label,
  style,
  focusedStyle,
  children,
  ...rest
}: PressableProps & { label?: string; focusedStyle?: StyleProp<ViewStyle> }) {
  return (
    <Pressable
      {...rest}
      style={(state) => [
        styles.base,
        typeof style === "function" ? style(state) : style,
        isTvFocused(state) ? [tvFocusFill, focusedStyle] : null,
      ]}
    >
      {children ??
        ((state) => (
          <Text style={[styles.label, isTvFocused(state) ? styles.labelFocused : null]}>{label}</Text>
        ))}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: "transparent",
  },
  label: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "600",
  },
  labelFocused: {
    color: colors.bg,
  },
});