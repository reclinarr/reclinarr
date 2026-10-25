import { useEffect, useState, type ReactNode, type Ref } from "react";
import {
  Pressable,
  Text,
  StyleSheet,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { isTvFocused, tvFocusFill, tvFocusRingOnLight, useTvFocusAllowed } from "./focus.js";
import { DownloadIcon, PlayIcon } from "./icons.js";
import { colors } from "./theme.js";

/**
 * Fills the button from the left up to `percent`. `content` is drawn twice — once on the
 * track and once clipped inside the fill — so the label inverts where the fill covers it.
 */
function ProgressFill({
  percent,
  fill,
  content,
}: {
  percent: number;
  fill: string;
  content: ReactNode;
}) {
  if (percent <= 0) return null;
  // Inner layer spans the whole button: clip is percent% wide, so inner is 100/percent of it.
  return (
    <View style={[progressStyles.clip, { width: `${percent}%`, backgroundColor: fill }]}>
      <View style={[progressStyles.inner, { width: `${(100 / percent) * 100}%` }]}>{content}</View>
    </View>
  );
}

function clampPercent(progress: number | null | undefined): number {
  if (progress == null || !Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(100, progress));
}

const progressStyles = StyleSheet.create({
  clip: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    overflow: "hidden",
    pointerEvents: "none",
  },
  inner: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
});

export function Button({
  label,
  style,
  variant = "primary",
  showFocusRing = false,
  focusedStyle,
  hasTVPreferredFocus,
  focusable,
  progress,
  ...rest
}: PressableProps & {
  label: string;
  style?: StyleProp<ViewStyle>;
  variant?: "primary" | "ghost" | "danger" | "accent";
  /** When true, apply TV-style focus ring via Pressable `focused` state. */
  showFocusRing?: boolean;
  focusedStyle?: StyleProp<ViewStyle>;
  /** Turns the button into a progress bar (0–100; null = track only, size not known yet). */
  progress?: number | null;
}) {
  const focusAllowed = useTvFocusAllowed();
  const showProgress = progress !== undefined;
  return (
    <Pressable
      {...rest}
      focusable={focusAllowed && focusable !== false}
      hasTVPreferredFocus={focusAllowed ? hasTVPreferredFocus : undefined}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={(state) => {
        const focused = showFocusRing && isTvFocused(state);
        // Primary is already a light fill — use a dark ring so focus is visible.
        // Progress keeps its dark track on focus so the fill stays visible.
        const focusChrome = showProgress
          ? styles.progressFocused
          : variant === "primary"
            ? tvFocusRingOnLight
            : tvFocusFill;
        return [
          styles.base,
          showProgress && styles.progressTrack,
          !showProgress && variant === "primary" && styles.primary,
          !showProgress && variant === "ghost" && styles.ghost,
          !showProgress && variant === "danger" && styles.danger,
          !showProgress && variant === "accent" && styles.accent,
          state.pressed && styles.pressed,
          focused ? [focusChrome, focusedStyle] : null,
          typeof style === "function" ? style(state) : style,
        ];
      }}
    >
      {(state) => {
        if (showProgress) {
          return (
            <>
              <Text style={[styles.label, styles.labelGhost, styles.labelProgress]}>{label}</Text>
              <ProgressFill
                percent={clampPercent(progress)}
                fill={colors.text}
                content={
                  <Text style={[styles.label, styles.labelOnPrimary, styles.labelProgress]}>{label}</Text>
                }
              />
            </>
          );
        }
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
  progressTrack: { backgroundColor: colors.bg2, overflow: "hidden", minWidth: 160 },
  progressFocused: { borderColor: colors.focus, transform: [{ scale: 1.06 }] },
  labelProgress: { fontVariant: ["tabular-nums"] },
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
  focusRef,
  forceFocused,
  onFocus,
  onBlur,
  progress,
}: {
  label: string;
  icon?: "play" | "info" | "download";
  tone?: "light" | "glass";
  onPress: () => void;
  disabled?: boolean;
  showFocusRing?: boolean;
  hasTVPreferredFocus?: boolean;
  focusRef?: Ref<View>;
  /** Draw as focused: native focus was restored without a focus event. */
  forceFocused?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  /** Turns the pill into a progress bar (0–100; null = track only, size not known yet). */
  progress?: number | null;
}) {
  const focusAllowed = useTvFocusAllowed();
  const [hovered, setHovered] = useState(false);
  const [pillFocused, setPillFocused] = useState(!!hasTVPreferredFocus || !!forceFocused);
  // Preferred-focus reclaim (Android restores native focus with no onFocus) is
  // drawn via forceFocused / hasTVPreferredFocus from usePreferredFocusOnce —
  // keep pillFocused in sync so we never need a blur grace period that leaves
  // the previous pill lit while focus moves to a sibling.
  useEffect(() => {
    if (forceFocused || hasTVPreferredFocus) setPillFocused(true);
  }, [forceFocused, hasTVPreferredFocus]);
  const light = tone === "light";
  const showProgress = progress !== undefined;
  const content = (fg: string) => (
    <>
      {icon === "play" ? <PlayIcon color={fg} size={22} /> : null}
      {icon === "download" ? <DownloadIcon color={fg} size={20} /> : null}
      {icon === "info" ? (
        <View style={[pillStyles.info, { borderColor: fg }]}>
          <Text style={[pillStyles.infoText, { color: fg }]}>i</Text>
        </View>
      ) : null}
      <Text style={[pillStyles.label, showProgress && pillStyles.labelProgress, { color: fg }]}>
        {label}
      </Text>
    </>
  );
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      focusable={focusAllowed}
      hasTVPreferredFocus={focusAllowed ? hasTVPreferredFocus : undefined}
      accessibilityRole={showProgress ? "progressbar" : "button"}
      accessibilityLabel={label}
      accessibilityValue={
        showProgress && progress != null ? { min: 0, max: 100, now: Math.round(progress) } : undefined
      }
      ref={focusRef}
      onFocus={() => {
        setPillFocused(true);
        onFocus?.();
      }}
      onBlur={() => {
        onBlur?.();
        setPillFocused(false);
      }}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={(state) => {
        const focused =
          showFocusRing &&
          (isTvFocused(state) || pillFocused || !!forceFocused || !!hasTVPreferredFocus);
        if (showProgress) {
          return [
            pillStyles.base,
            pillStyles.progressTrack,
            hovered && { opacity: 0.88 },
            focused && pillStyles.progressFocused,
          ];
        }
        // TV focus ring: focused = solid white; idle = glass for every tone.
        // Idle light used to stay white, which matched focused glass and made
        // Resume / More Info look identical when the secondary had focus.
        if (showFocusRing) {
          return [
            pillStyles.base,
            focused ? pillStyles.focused : pillStyles.glass,
            disabled && { opacity: 0.6 },
          ];
        }
        return [
          pillStyles.base,
          light ? pillStyles.light : pillStyles.glass,
          (disabled || (hovered && !light)) && { opacity: disabled ? 0.6 : 0.88 },
        ];
      }}
    >
      {(state) => {
        if (showProgress) {
          return (
            <>
              {content("#fff")}
              <ProgressFill
                percent={clampPercent(progress)}
                fill="#fff"
                content={content("#000")}
              />
            </>
          );
        }
        const focused =
          showFocusRing &&
          (isTvFocused(state) || pillFocused || !!forceFocused || !!hasTVPreferredFocus);
        // TV: white pill → black label; glass idle → white label. Web keeps tone colors.
        const fg = showFocusRing ? (focused ? "#000" : "#fff") : light ? "#000" : "#fff";
        return content(fg);
      }}
    </Pressable>
  );
}

const pillStyles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
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
  progressTrack: {
    backgroundColor: "rgba(128, 128, 128, 0.45)",
    overflow: "hidden",
    minWidth: 200,
  },
  progressFocused: {
    borderColor: "#fff",
    transform: [{ scale: 1.1 }],
    shadowColor: "#fff",
    shadowOpacity: 0.95,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  label: { fontSize: 16, fontWeight: "500" },
  labelProgress: { fontVariant: ["tabular-nums"] },
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
