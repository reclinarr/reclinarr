import { useWindowDimensions } from "react-native";

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Touch layout: phone rails ~2.4 cards; tablets wider. */
export function useMobileLayout() {
  const { width, height } = useWindowDimensions();
  const pageX = Math.round(clamp(width * 0.04, 14, 28));
  const cardsAcross = width >= 900 ? 4.2 : width >= 600 ? 3.2 : 2.4;
  const cardGap = Math.round(clamp(width * 0.02, 8, 14));
  const cardWidth = Math.round((width - pageX * 2 - cardGap * Math.floor(cardsAcross)) / cardsAcross);
  const posterH = Math.round((cardWidth * 9) / 16);
  const titleSize = Math.round(clamp(cardWidth * 0.09, 12, 15));
  const metaSize = Math.round(clamp(cardWidth * 0.075, 11, 13));
  const titleLine = titleSize + 3;
  const metaLine = metaSize + 3;
  const cardTextGap = 4;
  const cardH = posterH + cardTextGap + titleLine + metaLine;
  const railTitleSize = Math.round(clamp(width * 0.045, 16, 20));
  const railTitleH = railTitleSize + 8;
  const railGap = 18;
  const railListH = cardH + 2;
  const heroH = Math.round(clamp(width * 0.52, 180, 280));
  const gridColumns = width >= 900 ? 4 : width >= 600 ? 3 : 2;

  return {
    width,
    height,
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
    artMaxWidth: Math.min(640, cardWidth * 2),
  };
}

export type MobileLayout = ReturnType<typeof useMobileLayout>;
