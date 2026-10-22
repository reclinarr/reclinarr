/**
 * Last rail card a TV page opened Details / Player from. The TV shell unmounts
 * page content while an overlay route is up, so this outlives the page and lets
 * it hand D-pad focus (and scroll) back to the same card on return.
 */
export type RailFocus = { rowId: string; index: number };

const memory = new Map<string, RailFocus>();

export function rememberRailFocus(page: string, focus: RailFocus | null) {
  if (focus) memory.set(page, focus);
  else memory.delete(page);
}

/** Remembered card, if that rail still has an item at the index. */
export function recallRailFocus(
  page: string,
  rows: ReadonlyArray<{ id: string; items: ReadonlyArray<unknown> }>,
): RailFocus | null {
  const focus = memory.get(page);
  if (!focus) return null;
  const row = rows.find((r) => r.id === focus.rowId);
  return row && focus.index < row.items.length ? focus : null;
}
