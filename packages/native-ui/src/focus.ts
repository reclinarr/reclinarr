import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import * as ReactNative from "react-native";
import { Platform, type View, type ViewStyle } from "react-native";
import { colors } from "./theme.js";

export type TvPressState = { pressed: boolean; focused?: boolean };

/** TV / RN-web Pressable style callback may include `focused`. */
export function isTvFocused(state: { pressed: boolean }): boolean {
  return Boolean((state as TvPressState).focused);
}

/**
 * When false, background screens under a transparent Details/Player modal must
 * not accept D-pad focus or re-assert hasTVPreferredFocus (Android TV otherwise
 * steals the remote back to Home after a query/re-render settle).
 */
const TvFocusAllowedContext = createContext(true);

export function TvFocusLockProvider({
  allow,
  children,
}: {
  allow: boolean;
  children: ReactNode;
}) {
  return createElement(TvFocusAllowedContext.Provider, { value: allow }, children);
}

export function useTvFocusAllowed(): boolean {
  return useContext(TvFocusAllowedContext);
}

/**
 * When true, usePreferredFocusOnce targets inside give up their initial claim,
 * e.g. while the user skims the TV top nav and focus must stay on the tabs.
 */
const TvInitialFocusSuppressedContext = createContext(false);

export function TvInitialFocusSuppressProvider({
  suppress,
  children,
}: {
  suppress: boolean;
  children: ReactNode;
}) {
  return createElement(TvInitialFocusSuppressedContext.Provider, { value: suppress }, children);
}

/** How long after landing a keyless blur is still treated as a screen transition. */
const PREFERRED_FOCUS_SETTLE_MS = 1000;
const PREFERRED_FOCUS_MAX_RECLAIMS = 3;
/**
 * hasTVPreferredFocus can land on nothing, e.g. when the screen underneath tears
 * down its focused view while a modal mounts. Claim focus directly after this.
 */
const PREFERRED_FOCUS_FALLBACK_MS = 800;
/** Remote key events reach JS after the focus change they cause (on key up). */
const REMOTE_KEY_LAG_MS = 300;

type TvRemoteEvent = { eventType?: string };
type TvEventHandlerModule = { addListener(cb: (evt: TvRemoteEvent) => void): unknown };
type TvFocusableView = View & { requestTVFocus?: () => void };

const DPAD_MOVES = new Set(["up", "down", "left", "right"]);
let lastRemoteKeyAt = 0;
let trackingRemoteKeys = false;

/** Timestamps D-pad moves so focus code can tell user moves from system ones. */
function trackRemoteKeys() {
  if (trackingRemoteKeys || !Platform.isTV) return;
  trackingRemoteKeys = true;
  const handler = (ReactNative as unknown as { TVEventHandler?: TvEventHandlerModule }).TVEventHandler;
  handler?.addListener((evt) => {
    // Only D-pad arrows move focus; Back / Select key-ups land after the screen
    // change they triggered and must not count as the user moving on.
    if (evt?.eventType && DPAD_MOVES.has(evt.eventType)) {
      lastRemoteKeyAt = Date.now();
    }
  });
}

/**
 * One-shot hasTVPreferredFocus. Android TV re-requests focus whenever a view
 * re-renders with the flag still true, which yanks the remote back to the
 * initial target (e.g. on every scroll). Drop the flag once it has landed.
 *
 * Screen transitions (a closing modal, a tab switch) can also clear focus right
 * after it lands. Attach `ref` and `onBlur` to the target: an early blur with no
 * remote press since landing claims focus back.
 */
export function usePreferredFocusOnce(want: boolean): {
  prefer: true | undefined;
  /**
   * Focus was claimed back natively. Android sends no focus event when the view
   * still held native focus, so the target must draw its focused state from this.
   */
  reclaimed: boolean;
  ref: RefObject<View | null>;
  onFocus: () => void;
  onBlur: () => void;
} {
  const suppressed = useContext(TvInitialFocusSuppressedContext);
  const [landed, setLanded] = useState(false);
  const [reclaimed, setReclaimed] = useState(false);
  const ref = useRef<View | null>(null);
  const landedAt = useRef(0);
  const reclaims = useRef(0);
  const dbgId = useRef(Math.random().toString(36).slice(2, 6)).current;
  trackRemoteKeys();
  // Treat a suppressed claim as spent so it can't fire once suppression lifts.
  useEffect(() => {
    if (suppressed && want) setLanded(true);
  }, [suppressed, want]);
  useEffect(() => {
    if (!want || landed || suppressed || !Platform.isTV) return;
    const armedAt = Date.now();
    const timer = setTimeout(() => {
      if (lastRemoteKeyAt >= armedAt) return;
      const view = ref.current as TvFocusableView | null;
      if (!view?.requestTVFocus) return;
      console.log("[dbg-focus]", dbgId, Date.now() % 100000, "fallback request");
      view.requestTVFocus();
      setReclaimed(true);
    }, PREFERRED_FOCUS_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [want, landed, suppressed]);
  return {
    prefer: want && !landed && !suppressed ? true : undefined,
    reclaimed,
    ref,
    onFocus: () => {
      console.log("[dbg-focus]", dbgId, Date.now() % 100000, "focus", want, landed);
      setReclaimed(false);
      if (!want || landed) return;
      landedAt.current = Date.now();
      setLanded(true);
    },
    onBlur: () => {
      console.log("[dbg-focus]", dbgId, Date.now() % 100000, "blur", landedAt.current ? Date.now() - landedAt.current : null);
      setReclaimed(false);
      const since = landedAt.current;
      if (!since) return;
      if (
        Date.now() - since > PREFERRED_FOCUS_SETTLE_MS ||
        reclaims.current >= PREFERRED_FOCUS_MAX_RECLAIMS
      ) {
        landedAt.current = 0;
        return;
      }
      setTimeout(() => {
        if (lastRemoteKeyAt >= since) {
          landedAt.current = 0;
          return;
        }
        const view = ref.current as TvFocusableView | null;
        if (!view?.requestTVFocus) return;
        reclaims.current += 1;
        console.log("[dbg-focus]", dbgId, Date.now() % 100000, "reclaim");
        view.requestTVFocus();
        setReclaimed(true);
      }, REMOTE_KEY_LAG_MS);
    },
  };
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
