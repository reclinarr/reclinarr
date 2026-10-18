/** Layout metrics each app computes from window size (phone vs TV vs web diverge). */
export type NativeLayout = {
  pageX: number;
  cardWidth: number;
  cardGap: number;
  posterH: number;
  railTitleSize: number;
  railGap: number;
  heroH: number;
  /** PosterCard typography / art sizing */
  titleSize: number;
  metaSize: number;
  titleLine: number;
  metaLine: number;
  cardTextGap: number;
  artMaxWidth: number;
  /** Optional extras used by some shells */
  cardH?: number;
  railTitleH?: number;
  railListH?: number;
  headerH?: number;
  gridColumns?: number;
  width?: number;
  height?: number;
};
