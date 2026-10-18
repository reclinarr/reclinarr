import { useWindowDimensions } from "react-native";
import { FOCUS_ROOM } from "@reclinarr/native-ui";

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Netflix TV proportions — tall billboard, room for focus-scale rails. */
export function useTvLayout() {
  const { width, height } = useWindowDimensions();

  const headerH = Math.round(clamp(height * 0.07, 56, 72));
  const pageX = Math.round(clamp(width * 0.04, 36, 60));

  const cardsAcross = width >= 1800 ? 6.2 : width >= 1400 ? 5.6 : width >= 1100 ? 5.0 : 4.2;
  const cardGap = Math.round(clamp(width * 0.01, 10, 16));
  const cardWidth = Math.round(
    (width - pageX * 2 - cardGap * Math.floor(cardsAcross)) / cardsAcross,
  );
  const posterH = Math.round((cardWidth * 9) / 16);
  const titleSize = Math.round(clamp(cardWidth * 0.055, 13, 16));
  const metaSize = Math.round(clamp(cardWidth * 0.045, 12, 14));
  const titleLine = titleSize + 3;
  const metaLine = metaSize + 3;
  const cardTextGap = 4;
  const cardH = posterH + cardTextGap + titleLine + metaLine;
  const railTitleSize = 18;
  const railTitleH = 26;
  const railGap = Math.round(clamp(height * 0.028, 24, 36));
  // Focus-scale cards: no captions; leave FOCUS_ROOM under the poster.
  const railListH = posterH + FOCUS_ROOM;
  const heroH = Math.round(clamp(height * 0.55, 360, 560));
  const gridColumns = width >= 1600 ? 6 : width >= 1200 ? 5 : 4;

  return {
    width,
    height,
    headerH,
    pageX,
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
  };
}

export type TvLayout = ReturnType<typeof useTvLayout>;
