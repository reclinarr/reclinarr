import { useWindowDimensions } from "react-native";

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Browser layout matched to the current Netflix browse proportions. */
export function useWebLayout() {
  const { width, height } = useWindowDimensions();
  const pageX = Math.round(clamp(width * 0.04, 20, 60));
  const cardsAcross = width >= 1400 ? 6.2 : width >= 1100 ? 4.4 : width >= 800 ? 3.4 : 2.3;
  const cardGap = 8;
  const cardWidth = Math.round((width - pageX - cardGap * Math.floor(cardsAcross)) / cardsAcross);
  const posterH = Math.round((cardWidth * 9) / 16);
  const titleSize = Math.round(clamp(cardWidth * 0.07, 13, 16));
  const metaSize = Math.round(clamp(cardWidth * 0.06, 12, 14));
  const titleLine = titleSize + 3;
  const metaLine = metaSize + 3;
  const cardTextGap = 4;
  const cardH = posterH + cardTextGap + titleLine + metaLine;
  const railTitleSize = 18;
  const railTitleH = 26;
  const railGap = 36;
  const railListH = posterH + 8;
  const heroH = Math.round(clamp(height * 0.78, 420, 640));
  const gridColumns = width >= 1200 ? 5 : width >= 800 ? 4 : width >= 560 ? 3 : 2;

  // Full wordmark + nav + tools need ~980px; below that, tighten; below ~720, collapse nav.
  const compactHeader = width < 980;
  const narrowHeader = width < 720;

  return {
    width,
    height,
    pageX: narrowHeader ? Math.round(clamp(width * 0.04, 12, 20)) : pageX,
    cardWidth,
    cardGap,
    posterH,
    cardH,
    titleSize,
    metaSize,
    titleLine,
    metaLine,
    cardTextGap,
    railTitleSize,
    railTitleH,
    railGap,
    railListH,
    heroH,
    gridColumns,
    artMaxWidth: Math.min(960, cardWidth * 2),
    headerH: narrowHeader ? 56 : 68,
    compactHeader,
    narrowHeader,
    logoSize: narrowHeader ? 28 : compactHeader ? 28 : 32,
  };
}
