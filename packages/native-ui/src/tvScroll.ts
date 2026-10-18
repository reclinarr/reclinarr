import type { RefObject } from "react";
import type { ScrollView, View } from "react-native";

type ScrollOpts = {
  /** Pixels from the top of the window that are covered (e.g. header). */
  topInset?: number;
  pad?: number;
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
  const bottom = y + height;

  if (bottom > viewBottom) {
    const next = scrollY.current + (bottom - viewBottom);
    scrollY.current = next;
    scrollRef.current.scrollTo({ y: next, animated: true });
  } else if (y < viewTop) {
    const next = Math.max(0, scrollY.current - (viewTop - y));
    scrollY.current = next;
    scrollRef.current.scrollTo({ y: next, animated: true });
  }
}

export function measureAndScrollIntoView(
  target: View | null | undefined,
  scrollRef: RefObject<ScrollView | null>,
  scrollY: RefObject<number>,
  screenH: number,
  opts?: ScrollOpts,
) {
  if (!target) return;
  target.measureInWindow((_x, y, _w, h) => {
    scrollWindowRectIntoView(scrollRef, scrollY, y, h, screenH, opts);
  });
}
