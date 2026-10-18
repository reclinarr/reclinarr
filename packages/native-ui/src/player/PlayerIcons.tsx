import Svg, { Circle, Path, Polyline, Rect, Line } from "react-native-svg";

type IconProps = { size?: number; color?: string };

/** Netflix top-left back chevron. */
export function NfBackIcon({ size = 28, color = "#fff" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M15.5 5L8 12.5 15.5 20"
        stroke={color}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** AirPlay — rectangle screen with upward triangle (SF Symbol–like). */
export function NfAirPlayIcon({ size = 26, color = "#fff" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M5 4.5h14A1.5 1.5 0 0 1 20.5 6v8A1.5 1.5 0 0 1 19 15.5h-3.2"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <Path
        d="M8.2 15.5H5A1.5 1.5 0 0 1 3.5 14V6A1.5 1.5 0 0 1 5 4.5"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <Path d="M12 14.2l5.2 6.3H6.8L12 14.2z" fill={color} />
    </Svg>
  );
}

/** Netflix top-right report flag. */
export function NfFlagIcon({ size = 26, color = "#fff" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6 21V4h.5l1.2 1.8c.4.6 1 .9 1.7.9H18l-1.8 5.2L18 16H9.4c-.7 0-1.3.3-1.7.9L6 21"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Solid play triangle. */
export function NfPlayIcon({ size = 28, color = "#fff" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M7 4.5v15l13-7.5L7 4.5z" fill={color} />
    </Svg>
  );
}

/** Pause — two bars. */
export function NfPauseIcon({ size = 28, color = "#fff" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={6} y={4} width={4.5} height={16} rx={1} fill={color} />
      <Rect x={13.5} y={4} width={4.5} height={16} rx={1} fill={color} />
    </Svg>
  );
}

function SkipTenLabel({ color }: { color: string }) {
  return (
    <>
      <Path d="M11.575 11.7v6.7h-1.15v-5.4l-.85.55v-1.15l2-.7z" fill={color} />
      <Path
        d="M15.775 11.55c1.6 0 2.65 1.4 2.65 3.45s-1.05 3.45-2.65 3.45-2.65-1.4-2.65-3.45 1.05-3.45 2.65-3.45zm0 1.2c-.8 0-1.35.85-1.35 2.25s.55 2.25 1.35 2.25 1.35-.85 1.35-2.25-.55-2.25-1.35-2.25z"
        fill={color}
        fillRule="evenodd"
      />
    </>
  );
}

/** Counter-clockwise skip with 10. */
export function NfRewind10Icon({ size = 32, color = "#fff" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 28 28" fill="none">
      <Path d="M10 8.072A8 8 0 1 0 14 7" stroke={color} strokeWidth={1.9} strokeLinecap="round" />
      <Path d="M12.6 5.1L14 9.2 9.9 7.2" fill={color} />
      <SkipTenLabel color={color} />
    </Svg>
  );
}

/** Clockwise skip with 10. */
export function NfForward10Icon({ size = 32, color = "#fff" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 28 28" fill="none">
      <Path d="M18 8.072A8 8 0 1 1 14 7" stroke={color} strokeWidth={1.9} strokeLinecap="round" />
      <Path d="M15.4 5.1L14 9.2 18.1 7.2" fill={color} />
      <SkipTenLabel color={color} />
    </Svg>
  );
}

/** Speaker + sound waves. */
export function NfVolumeIcon({
  size = 28,
  color = "#fff",
  muted = false,
}: IconProps & { muted?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4.5 9.5h3.2L12.5 5v14l-4.8-4.5H4.5V9.5z" fill={color} />
      {muted ? (
        <Path
          d="M15 9l5 6M20 9l-5 6"
          stroke={color}
          strokeWidth={1.8}
          strokeLinecap="round"
        />
      ) : (
        <>
          <Path
            d="M15.2 9.2a3.6 3.6 0 0 1 0 5.6"
            stroke={color}
            strokeWidth={1.7}
            strokeLinecap="round"
          />
          <Path
            d="M17.6 7a6.2 6.2 0 0 1 0 10"
            stroke={color}
            strokeWidth={1.7}
            strokeLinecap="round"
          />
        </>
      )}
    </Svg>
  );
}

/** Next episode: play triangle + end bar. */
export function NfNextEpisodeIcon({ size = 28, color = "#fff" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 5.5v13l10-6.5L4 5.5z" fill={color} />
      <Rect x={16.5} y={5.5} width={3.2} height={13} rx={0.6} fill={color} />
    </Svg>
  );
}

/** Episodes — overlapping cards. */
export function NfEpisodesIcon({ size = 28, color = "#fff" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={4} y={7} width={12.5} height={9.5} rx={1.2} stroke={color} strokeWidth={1.7} />
      <Rect
        x={7.5}
        y={4.5}
        width={12.5}
        height={9.5}
        rx={1.2}
        stroke={color}
        strokeWidth={1.7}
        fill="none"
      />
    </Svg>
  );
}

/** Audio & subtitles speech bubble. */
export function NfAudioSubsIcon({ size = 28, color = "#fff" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 5.5h16a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H10l-3.5 3v-3H4A1.5 1.5 0 0 1 2.5 15V7A1.5 1.5 0 0 1 4 5.5z"
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      <Line x1={7} y1={9} x2={17} y2={9} stroke={color} strokeWidth={1.5} strokeLinecap="round" />
      <Line x1={7} y1={12} x2={14.5} y2={12} stroke={color} strokeWidth={1.5} strokeLinecap="round" />
    </Svg>
  );
}

/** Playback speed gauge. */
export function NfSpeedIcon({ size = 28, color = "#fff" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 20a8 8 0 1 1 7.2-4.5" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Path d="M12 12l4.2-3.2" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Circle cx={12} cy={12} r={1.6} fill={color} />
    </Svg>
  );
}

/** Fullscreen corners. */
export function NfFullscreenIcon({
  size = 26,
  color = "#fff",
  exit = false,
}: IconProps & { exit?: boolean }) {
  if (exit) {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Polyline
          points="9,4 9,9 4,9"
          stroke={color}
          strokeWidth={1.9}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Polyline
          points="15,4 15,9 20,9"
          stroke={color}
          strokeWidth={1.9}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Polyline
          points="9,20 9,15 4,15"
          stroke={color}
          strokeWidth={1.9}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Polyline
          points="15,20 15,15 20,15"
          stroke={color}
          strokeWidth={1.9}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    );
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Polyline
        points="4,9 4,4 9,4"
        stroke={color}
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Polyline
        points="15,4 20,4 20,9"
        stroke={color}
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Polyline
        points="4,15 4,20 9,20"
        stroke={color}
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Polyline
        points="15,20 20,20 20,15"
        stroke={color}
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
