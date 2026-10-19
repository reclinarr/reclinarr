import { useState } from "react";
import {
  Pressable,
  Text,
  StyleSheet,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { isTvFocused, tvFocusFill, tvFocusRingOnLight } from "./focus.js";
import { PlayIcon } from "./icons.js";
import { colors } from "./theme.js";

export function Button({
  label,
  style,
  variant = "primary",
  showFocusRing = false,
  focusedStyle,
  ...rest
}: PressableProps & {
  label: string;
  style?: StyleProp<ViewStyle>;
  variant?: "primary" | "ghost" | "danger" | "accent";
  /** When true, apply TV-style focus ring via Pressable `focused` state. */
  showFocusRing?: boolean;
  focusedStyle?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      {...rest}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={(state) => {
        const focused = showFocusRing && isTvFocused(state);
        // Primary is already a light fill — use a dark ring so focus is visible.
        const focusChrome =
          variant === "primary" ? tvFocusRingOnLight : tvFocusFill;
        return [
          styles.base,
          variant === "primary" && styles.primary,
          variant === "ghost" && styles.ghost,
          variant === "danger" && styles.danger,
          variant === "accent" && styles.accent,
          state.pressed && styles.pressed,
          focused ? [focusChrome, focusedStyle] : null,
          typeof style === "function" ? style(state) : style,
        ];
      }}
    >
      {(state) => {
        const focused = showFocusRing && isTvFocused(state);
        const invertLabel = focused && variant !== "primary";
        return (
          <Text
            style={[
              styles.label,
              variant === "primary" && styles.labelOnPrimary,
              variant === "ghost" && styles.labelGhost,
              variant === "danger" && styles.labelOnPrimary,
              variant === "accent" && styles.labelOnAccent,
              invertLabel ? styles.labelFocused : null,
            ]}
          >
            {label}
          </Text>
        );
      }}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignSelf: "flex-start",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "transparent",
  },
  primary: { backgroundColor: colors.text },
  ghost: { backgroundColor: colors.bg2 },
  danger: { backgroundColor: colors.danger },
  accent: { backgroundColor: colors.accent, borderRadius: 4 },
  pressed: { opacity: 0.85 },
  label: { fontSize: 15, fontWeight: "700" },
  labelOnPrimary: { color: colors.bg },
  labelOnAccent: { color: colors.bg },
  labelGhost: { color: colors.text },
  labelFocused: { color: colors.bg },
});

/** White / frosted pills used on the Netflix-style billboard. */
export function PillButton({
  label,
  icon,
  tone = "light",
  onPress,
  disabled,
  showFocusRing = false,
  hasTVPreferredFocus,
}: {
  label: string;
  icon?: "play" | "info";
  tone?: "light" | "glass";
  onPress: () => void;
  disabled?: boolean;
  showFocusRing?: boolean;
  hasTVPreferredFocus?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const light = tone === "light";
  const color = light ? "#000" : "#fff";
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={(state) => {
        const focused = showFocusRing && isTvFocused(state);
        return [
          pillStyles.base,
          light ? pillStyles.light : pillStyles.glass,
          (disabled || (hovered && !light)) && { opacity: disabled ? 0.6 : 0.88 },
          focused && pillStyles.focused,
        ];
      }}
    >
      {(state) => {
        const focused = showFocusRing && isTvFocused(state);
        const fg = focused && !light ? "#000" : color;
        return (
          <>
            {icon === "play" ? <PlayIcon color={fg} size={22} /> : null}
            {icon === "info" ? (
              <View style={[pillStyles.info, { borderColor: fg }]}>
                <Text style={[pillStyles.infoText, { color: fg }]}>i</Text>
              </View>
            ) : null}
            <Text style={[pillStyles.label, { color: fg }]}>{label}</Text>
          </>
        );
      }}
    </Pressable>
  );
}

const pillStyles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 18,
    minHeight: 40,
    borderWidth: 3,
    borderColor: "transparent",
  },
  light: { backgroundColor: "#fff" },
  glass: { backgroundColor: "rgba(128, 128, 128, 0.4)" },
  focused: {
    backgroundColor: "#fff",
    borderColor: "#111",
    borderWidth: 3,
    transform: [{ scale: 1.1 }],
    shadowColor: "#fff",
    shadowOpacity: 0.95,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  label: { fontSize: 16, fontWeight: "500" },
  info: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  infoText: { fontSize: 12, fontWeight: "700", lineHeight: 14 },
});
