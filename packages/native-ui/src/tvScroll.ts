import type { RefObject } from "react";
import type { ScrollView, View } from "react-native";

type ScrollOpts = {
  /** Pixels from the top of the window that are covered (e.g. header). */
  topInset?: number;
  pad?: number;
  /** Extra space below the measured box (focus scale, caption under the poster). */
  bottomExtra?: number;
  /**
   * `start` puts a clipped target at the top of the view (TV rails: first Down
   * from the hero must not leave the focused tile hanging off the bottom).
   * `nearest` only nudges far enough to reveal the clipped edge.
   */
  align?: "nearest" | "start";
};

/**
 * Keep a focused view on screen by adjusting a vertical ScrollView.
 * Uses window coordinates from measureInWindow so nested layout.y quirks do not matter.
 * Eagerly updates scrollY so rapid D-pad moves stay accurate before onScroll fires.
 */
export function scrollWindowRectIntoView(
  scrollRef: RefObject<ScrollView | null>,
  scrollY: RefObject<number>,
  y: number,
  height: number,
  screenH: number,
  opts?: ScrollOpts,
) {
  if (!scrollRef.current || screenH <= 0 || height <= 0) return;
  const pad = opts?.pad ?? 28;
  const topInset = opts?.topInset ?? 0;
  const viewTop = topInset + pad;
  const viewBottom = screenH - pad;
  const bottom = y + height + (opts?.bottomExtra ?? 0);
  const clipped = bottom > viewBottom || y < viewTop;
  if (!clipped) return;

  const fits = bottom - y <= viewBottom - viewTop;
  const next =
    opts?.align === "start" && fits
      ? Math.max(0, scrollY.current + (y - viewTop))
      : bottom > viewBottom
        ? scrollY.current + (bottom - viewBottom)
        : Math.max(0, scrollY.current - (viewTop - y));
  if (Math.abs(next - scrollY.current) < 2) return;
  scrollY.current = next;
  scrollRef.current.scrollTo({ y: next, animated: true });
}

export function measureAndScrollIntoView(
  target: View | null | undefined,
  scrollRef: RefObject<ScrollView | null>,
  scrollY: RefObject<number>,
  screenH: number,
  opts?: ScrollOpts,
) {
  if (!target) return;
  const scroll = scrollRef.current as (ScrollView & { getInnerViewRef?: () => View | null }) | null;
  const outer = scroll?.getNativeScrollRef?.() as View | null | undefined;
  const inner = scroll?.getInnerViewRef?.();
  if (!outer || !inner) {
    target.measureInWindow((_x, y, _w, h) => {
      scrollWindowRectIntoView(scrollRef, scrollY, y, h, screenH, opts);
    });
    return;
  }
  // Android already scrolled natively to reveal the focused child, and onScroll for
  // that lands after the focus event: read the real offset from the views instead.
  outer.measureInWindow((_ox, outerY) => {
    inner.measureInWindow((_ix, innerY) => {
      target.measureInWindow((_x, y, _w, h) => {
        scrollY.current = Math.max(0, outerY - innerY);
        scrollWindowRectIntoView(scrollRef, scrollY, y, h, screenH, opts);
      });
    });
  });
}
