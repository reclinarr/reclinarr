import type { Media } from "@reclinarr/shared";

/** Split a flat discover list into Netflix-like row shelves. */
export function splitIntoShelves(
  items: Media[],
  labels: string[],
): Array<{ id: string; title: string; items: Media[] }> {
  if (items.length === 0) return labels.map((title, i) => ({ id: `shelf-${i}`, title, items: [] }));

  const chunk = Math.max(6, Math.ceil(items.length / labels.length));
  return labels.map((title, i) => {
    const start = i * chunk;
    const slice = items.slice(start, start + chunk);
    const shelfItems = i === labels.length - 1 ? items.slice(start) : slice;
    return { id: `shelf-${i}`, title, items: shelfItems };
  });
}
