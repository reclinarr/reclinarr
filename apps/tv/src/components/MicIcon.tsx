import Svg, { Path, Rect } from "react-native-svg";

type Props = { size?: number; color?: string };

/** Classic mic silhouette for voice search. */
export function MicIcon({ size = 22, color = "#fff" }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="9" y="2" width="6" height="11" rx="3" stroke={color} strokeWidth={1.8} />
      <Path
        d="M5.5 11a6.5 6.5 0 0 0 13 0"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <Path d="M12 17.5V21" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Path d="M8.5 21h7" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}
