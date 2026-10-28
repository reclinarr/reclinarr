import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import Svg, { Circle } from "react-native-svg";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isWatchedByAvailability, pickNextUpEpisode } from "@reclinarr/shared";
import type { Acquisition, CreditPerson, EpisodeListItem, Media } from "@reclinarr/shared";
import {
  actionLabel,
  cancelAcquisition,
  canPlayMedia,
  formatCacheTtlRemaining,
  formatRuntime,
  getAcquisition,
  listAcquisitions,
  mediaAvailability,
  mediaByJellyfin,
  mediaByTmdb,
  mediaSimilar,
  myListHas,
  primaryAction,
  requestMedia,
  resolvePlaybackForPlay,
  seriesEpisodes,
  startAcquisition,
  toggleMyList,
} from "@reclinarr/client";
import { Artwork } from "../Artwork.js";
import { Button, PillButton } from "../Button.js";
import { isTvFocused, usePreferredFocusOnce } from "../focus.js";
import { HScroll } from "../HScroll.js";
import { useIsDemoUser, useMediaRequest } from "../hooks/useMediaRequest.js";
import { acquisitionProgressPercent, matchAcquisition, useTitleDownload } from "../hooks/useTitleDownload.js";
import { CheckIcon, DownloadIcon, PlayIcon } from "../icons.js";
import { MediaRail } from "../MediaRail.js";
import { NfBackIcon } from "../player/PlayerIcons.js";
import { DetailsModalSkeleton, DetailsSkeleton, EpisodeListSkeleton, SkeletonBlock } from "../Skeleton.js";
import { AccentFill } from "../AccentFill.js";
import { colors } from "../theme.js";
import type { NativeLayout } from "../layout.js";
import {
  detailsSeedFromMedia,
  mediaFromDetailsSeed,
  openMedia,
  type DetailsParams,
} from "../media-nav.js";
import { Shade } from "../Shade.js";
import type { Appearance, ScreenNav } from "./types.js";

function cardAvailabilityLabel(media: Media): string {
  const action = primaryAction(media);
  return action.hint || (action.kind === "none" ? action.label : "");
}

function namesList(people: CreditPerson[] | undefined, max = 3): string | undefined {
  if (!people?.length) return undefined;
  const names = people.map((p) => p.name).filter(Boolean);
  if (!names.length) return undefined;
  if (names.length <= max) return names.join(", ");
  return `${names.slice(0, max).join(", ")}, more`;
}

function MediaFacts({
  media,
  isTv,
  factStyle,
  labelStyle,
  style,
}: {
  media: Media;
  isTv: boolean;
  factStyle: StyleProp<TextStyle>;
  labelStyle: StyleProp<TextStyle>;
  style?: StyleProp<ViewStyle>;
}) {
  const cast = namesList(media.metadata.cast);
  const creators = namesList(media.metadata.creators, 4);
  const writers = namesList(media.metadata.writers, 3);
  const genres = media.metadata.genres?.length ? media.metadata.genres.join(", ") : undefined;
  const studios = media.metadata.studios?.length ? media.metadata.studios.join(", ") : undefined;
  const keywords = media.metadata.keywords?.length
    ? media.metadata.keywords.slice(0, 6).join(", ")
    : undefined;
  if (!cast && !creators && !writers && !genres && !studios && !keywords) return null;
  return (
    <View style={style}>
      {cast ? (
        <Text style={factStyle}>
          <Text style={labelStyle}>Cast: </Text>
          {cast}
        </Text>
      ) : null}
      {creators ? (
        <Text style={factStyle}>
          <Text style={labelStyle}>{isTv ? "Creators: " : "Director: "}</Text>
          {creators}
        </Text>
      ) : null}
      {writers ? (
        <Text style={factStyle}>
          <Text style={labelStyle}>Writers: </Text>
          {writers}
        </Text>
      ) : null}
      {genres ? (
        <Text style={factStyle}>
          <Text style={labelStyle}>Genres: </Text>
          {genres}
        </Text>
      ) : null}
      {studios ? (
        <Text style={factStyle}>
          <Text style={labelStyle}>Studios: </Text>
          {studios}
        </Text>
      ) : null}
      {keywords ? (
        <Text style={factStyle}>
          <Text style={labelStyle}>{isTv ? "This show is: " : "This movie is: "}</Text>
          {keywords}
        </Text>
      ) : null}
    </View>
  );
}

function CastCrewCarousel({
  cast,
  creators,
  isTv,
  titleStyle,
}: {
  cast?: CreditPerson[];
  creators?: CreditPerson[];
  isTv: boolean;
  titleStyle?: StyleProp<TextStyle>;
}) {
  if (!cast?.length && !creators?.length) return null;
  return (
    <View style={styles.castSection}>
      <Text style={titleStyle ?? styles.webSection}>Cast & Crew</Text>
      <HScroll>
        {(cast ?? []).map((person) => (
          <View
            key={`${person.tmdbId ?? person.name}-${person.role ?? ""}`}
            style={styles.castCard}
          >
            {person.profileUrl ? (
              <Artwork url={person.profileUrl} maxWidth={240} style={styles.castPhoto} />
            ) : (
              <View style={[styles.castPhoto, styles.castPhotoEmpty]}>
                <Text style={styles.castInitial}>
                  {(person.name.trim()[0] || "?").toUpperCase()}
                </Text>
              </View>
            )}
            <Text style={styles.castName} numberOfLines={2}>
              {person.name}
            </Text>
            {person.role ? (
              <Text style={styles.castRole} numberOfLines={2}>
                as {person.role}
              </Text>
            ) : null}
          </View>
        ))}
        {(creators ?? []).map((person) => (
          <View
            key={`crew-${person.tmdbId ?? person.name}-${person.role ?? ""}`}
            style={styles.castCard}
          >
            {person.profileUrl ? (
              <Artwork url={person.profileUrl} maxWidth={240} style={styles.castPhoto} />
            ) : (
              <View style={[styles.castPhoto, styles.castPhotoEmpty]}>
                <Text style={styles.castInitial}>
                  {(person.name.trim()[0] || "?").toUpperCase()}
                </Text>
              </View>
            )}
            <Text style={styles.castName} numberOfLines={2}>
              {person.name}
            </Text>
            <Text style={styles.castRole} numberOfLines={2}>
              {person.role || (isTv ? "Creator" : "Director")}
            </Text>
          </View>
        ))}
      </HScroll>
    </View>
  );
}

/** Episode/movie thumbnail — play icon on hover (web), press (touch), or parent-row TV focus. */
function EpisodeStillThumb({
  url,
  onPress,
  disabled = false,
  /** When the parent episode row is focused on TV — don't nest a second focus target. */
  forceHot = false,
  /** 0–1 watched fraction for a partially watched episode. */
  progress,
}: {
  url?: string;
  onPress: () => void;
  disabled?: boolean;
  forceHot?: boolean;
  progress?: number;
}) {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const hot = forceHot || hovered || pressed;
  return (
    <Pressable
      style={styles.epStillWrap}
      onPress={onPress}
      disabled={disabled}
      focusable={false}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
    >
      <Artwork url={url} maxWidth={320} style={styles.epStill} />
      {hot ? (
        <View style={styles.epStillOverlay}>
          <View style={styles.epPlayCircle}>
            <PlayIcon color="#fff" size={22} />
          </View>
        </View>
      ) : null}
      {progress != null ? (
        <View style={styles.epProgress}>
          <View style={[styles.epProgressFill, { width: `${Math.round(progress * 100)}%` }]}><AccentFill /></View>
        </View>
      ) : null}
    </Pressable>
  );
}

function watchProgressFraction(item: {
  watched?: boolean;
  availability: EpisodeListItem["availability"];
}): number | undefined {
  if (item.watched) return undefined;
  for (const a of item.availability) {
    if (
      "positionSeconds" in a &&
      "durationSeconds" in a &&
      typeof a.positionSeconds === "number" &&
      typeof a.durationSeconds === "number" &&
      a.durationSeconds > 0 &&
      a.positionSeconds > 30
    ) {
      return Math.min(1, a.positionSeconds / a.durationSeconds);
    }
  }
  return undefined;
}

type EpisodeDownloadKind = "acquire" | "request" | "pending" | "ready" | "downloading";

function cacheProgressPercent(
  availability: EpisodeListItem["availability"] | Media["availability"],
): number | null {
  const cache = availability.find((a) => a.provider === "cache");
  if (!cache || !("bytesDownloaded" in cache)) return null;
  if (cache.complete) return 100;
  if (cache.totalBytes && cache.totalBytes > 0 && typeof cache.bytesDownloaded === "number") {
    return Math.min(99, Math.round((cache.bytesDownloaded / cache.totalBytes) * 100));
  }
  return null;
}

function episodeDownloadKind(
  availability: EpisodeListItem["availability"] | Media["availability"],
  preferredAction: EpisodeListItem["preferredAction"] | Media["preferredAction"],
  activeAcquisition?: Acquisition | null,
): EpisodeDownloadKind {
  const seerr = availability.find((a) => a.provider === "seerr");
  const cache = availability.find((a) => a.provider === "cache");
  const iptv = availability.find((a) => a.provider === "dispatcharr");
  const jellyfin = availability.find((a) => a.provider === "jellyfin");

  if (jellyfin && "available" in jellyfin && jellyfin.available && jellyfin.canPlay) {
    return "ready";
  }
  if (cache && "complete" in cache && cache.complete) return "ready";
  if (
    activeAcquisition &&
    (activeAcquisition.state === "queued" ||
      activeAcquisition.state === "downloading" ||
      activeAcquisition.state === "playable")
  ) {
    return "downloading";
  }
  if (cache && "acquisitionId" in cache && cache.acquisitionId && !cache.complete) {
    return "downloading";
  }
  if (
    seerr?.mediaStatus === "PENDING" ||
    seerr?.mediaStatus === "PROCESSING" ||
    seerr?.requestStatus === "PENDING" ||
    seerr?.requestStatus === "APPROVED"
  ) {
    return "pending";
  }
  if (iptv?.available && iptv.canPlay && iptv.uuid) return "acquire";
  if (preferredAction === "REQUEST" || seerr?.requestable) return "request";
  if (preferredAction === "PLAY_IPTV" && iptv?.uuid) return "acquire";
  if (preferredAction === "PLAY_JELLYFIN" || preferredAction === "PLAY_CACHE") return "ready";
  // Mid-download cache is already playable — still show progress until complete.
  if (cache && "playbackAvailable" in cache && cache.playbackAvailable) return "ready";
  return "request";
}

/** Circular download progress — spinner until % known, then ring + number. */
function DownloadProgressRing({
  percent,
  size = 28,
}: {
  percent: number | null;
  size?: number;
}) {
  const stroke = 2.5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct =
    percent != null && Number.isFinite(percent)
      ? Math.max(0, Math.min(99, Math.round(percent)))
      : null;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="rgba(255,255,255,0.28)"
          strokeWidth={stroke}
          fill="none"
        />
        {pct != null ? (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke="#fff"
            strokeWidth={stroke}
            fill="none"
            strokeDasharray={`${c} ${c}`}
            strokeDashoffset={c * (1 - pct / 100)}
            strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ) : null}
      </Svg>
      {pct != null ? (
        <Text style={styles.epDownloadPct}>{pct}</Text>
      ) : (
        <ActivityIndicator size="small" color="#fff" />
      )}
    </View>
  );
}

/** Netflix-style download control to the right of episode title/overview. */
function EpisodeDownloadButton({
  kind,
  busy,
  progressPercent = null,
  showFocusRing = false,
  onPress,
}: {
  kind: EpisodeDownloadKind;
  busy?: boolean;
  progressPercent?: number | null;
  showFocusRing?: boolean;
  onPress: () => void;
}) {
  const downloading = busy || kind === "downloading";
  const disabled = downloading || kind === "ready" || kind === "pending";
  const label =
    kind === "ready"
      ? "Ready to play"
      : kind === "pending"
        ? "Requested"
        : downloading
          ? progressPercent != null
            ? `Caching ${progressPercent}%`
            : "Caching"
          : kind === "acquire"
            ? "Cache"
            : "Request";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      // Disabled downloads must not steal TV focus from the episode row.
      focusable={showFocusRing && !disabled ? true : !showFocusRing ? undefined : false}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={(state) => [
        styles.epDownloadBtn,
        showFocusRing && isTvFocused(state) && styles.epDownloadBtnFocused,
        disabled && !downloading && styles.epDownloadBtnDisabled,
      ]}
    >
      {downloading ? (
        <DownloadProgressRing percent={progressPercent} />
      ) : kind === "ready" || kind === "pending" ? (
        <Text style={styles.epDownloadCheck}>✓</Text>
      ) : (
        <DownloadIcon color="#fff" size={22} />
      )}
    </Pressable>
  );
}

function SeasonDownloadPicker({
  options,
  selected,
  tv,
  onToggle,
  onConfirm,
  onCancel,
}: {
  options: Array<{ seasonNumber: number; downloadable: number; onDevice: number }>;
  selected: number[];
  tv: boolean;
  onToggle: (seasonNumber: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const episodeCount = options
    .filter((o) => selected.includes(o.seasonNumber))
    .reduce((sum, o) => sum + o.downloadable, 0);
  return (
    <View style={styles.pickerPanel}>
      <Text style={styles.pickerTitle}>Cache seasons</Text>
      <View style={styles.pickerChips}>
        {options.map((o) => {
          const done = o.downloadable === 0;
          const on = selected.includes(o.seasonNumber);
          const name = o.seasonNumber === 0 ? "Specials" : `Season ${o.seasonNumber}`;
          return (
            <Pressable
              key={o.seasonNumber}
              onPress={() => {
                if (!done) onToggle(o.seasonNumber);
              }}
              focusable={tv ? !done : undefined}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on, disabled: done }}
              style={(state) => [
                styles.pickerChip,
                on && styles.pickerChipOn,
                done && styles.pickerChipDone,
                tv && isTvFocused(state) && styles.seasonPillFocused,
              ]}
            >
              {(state) => {
                const focused = tv && isTvFocused(state);
                return (
                  <>
                    <Text style={[styles.pickerChipText, (on || focused) && styles.pickerChipTextOn]}>
                      {on ? "✓ " : ""}
                      {name}
                    </Text>
                    <Text style={[styles.pickerChipMeta, (on || focused) && styles.pickerChipTextOn]}>
                      {done ? "Cached" : `${o.downloadable} ep${o.downloadable === 1 ? "" : "s"}`}
                    </Text>
                  </>
                );
              }}
            </Pressable>
          );
        })}
      </View>
      <View style={styles.pickerActions}>
        <PillButton
          icon="download"
          label={episodeCount ? `Cache ${episodeCount} episode${episodeCount === 1 ? "" : "s"}` : "Pick a season"}
          tone="light"
          onPress={() => {
            if (episodeCount) onConfirm();
          }}
          showFocusRing={tv}
        />
        <PillButton label="Cancel" tone="glass" onPress={onCancel} showFocusRing={tv} />
      </View>
    </View>
  );
}

export function DetailsScreen({
  nav,
  params,
  paddingTop = 0,
  focusMode = "touch",
  appearance = "native",
  layout,
}: {
  nav: ScreenNav;
  params: DetailsParams;
  paddingTop?: number;
  focusMode?: "touch" | "tv";
  appearance?: Appearance;
  layout?: NativeLayout;
}) {
  const qc = useQueryClient();
  const jellyfinItemId = params.jellyfinItemId;
  const type = "type" in params ? params.type : undefined;
  const tmdbId = "tmdbId" in params ? params.tmdbId : undefined;
  const seed = "seed" in params ? params.seed : undefined;
  const focusEpisode = params.focusEpisode;
  const isJellyfin = Boolean(jellyfinItemId);
  const queryKey = isJellyfin
    ? (["media", "jellyfin", jellyfinItemId] as const)
    : (["media", type, tmdbId] as const);

  const seedMedia = useMemo(
    () => (seed && seed.tmdbId != null ? mediaFromDetailsSeed(seed) : undefined),
    [seed],
  );

  const details = useQuery({
    queryKey,
    queryFn: async () => {
      if (isJellyfin && jellyfinItemId) {
        const res = await mediaByJellyfin(jellyfinItemId);
        return { media: res.media, iptvResolvePending: false };
      }
      if ((type === "movie" || type === "tv") && tmdbId != null) return mediaByTmdb(type, tmdbId);
      throw new Error("Missing media id");
    },
    placeholderData: seedMedia
      ? {
          media: seedMedia,
          // Indexed hot titles already show Play on the card — don't flash Resolving.
          iptvResolvePending:
            seedMedia.preferredAction !== "PLAY_IPTV" &&
            seedMedia.preferredAction !== "PLAY_JELLYFIN" &&
            seedMedia.preferredAction !== "PLAY_CACHE",
        }
      : undefined,
  });

  const iptvResolvePending = details.data?.iptvResolvePending === true;
  const availabilityType = details.data?.media.identity.mediaType ?? type;
  const availabilityTmdbId = details.data?.media.identity.tmdbId ?? tmdbId;

  const availabilityQuery = useQuery({
    queryKey: ["media", "availability", availabilityType, availabilityTmdbId],
    queryFn: () => mediaAvailability(availabilityType as "movie" | "tv", availabilityTmdbId!),
    enabled:
      !isJellyfin &&
      iptvResolvePending &&
      (availabilityType === "movie" || availabilityType === "tv") &&
      availabilityTmdbId != null,
  });

  const requestFlow = useMediaRequest(availabilityQuery.data?.media ?? details.data?.media);
  const demo = useIsDemoUser();
  const media: Media | undefined = requestFlow.media ?? undefined;
  const iptvResolving =
    !isJellyfin &&
    iptvResolvePending &&
    !availabilityQuery.isFetched &&
    !availabilityQuery.isError;

  const cache = media?.availability.find((a) => a.provider === "cache");
  const isEpisode = media?.identity.mediaType === "episode";
  const isTv =
    media?.identity.mediaType === "tv" || isEpisode || type === "tv" || seed?.mediaType === "tv";
  const seriesTmdbId = media?.identity.tmdbId ?? tmdbId ?? seed?.tmdbId;
  const [season, setSeason] = useState<number | null>(null);
  const [bufferStatus, setBufferStatus] = useState<string | null>(null);
  const tv = focusMode === "tv";
  const web = appearance === "web" && layout != null;
  // Android re-runs requestFocus whenever hasTVPreferredFocus flips to true, so the
  // initial target is latched at mount and the episode flag is cleared once used.
  const [initialFocusEpisode] = useState(() => (tv ? focusEpisode ?? null : null));
  const [episodeFocusPending, setEpisodeFocusPending] = useState(initialFocusEpisode != null);
  const primaryFocus = usePreferredFocusOnce(tv && web && initialFocusEpisode == null);

  // Netflix jawbone: never stay on an episode details page — promote to series.
  useEffect(() => {
    if (!media || media.identity.mediaType !== "episode") return;
    const seriesId = media.identity.jellyfinSeriesId;
    if (seriesId && seriesId !== jellyfinItemId) {
      nav.openDetails({ jellyfinItemId: seriesId, focusEpisode: {
        seasonNumber: media.identity.seasonNumber ?? 1,
        episodeNumber: media.identity.episodeNumber ?? 1,
      } });
      return;
    }
    if (media.identity.tmdbId != null && type !== "tv") {
      nav.openDetails({
        type: "tv",
        tmdbId: media.identity.tmdbId,
        seed: detailsSeedFromMedia(media),
      });
    }
  }, [media, jellyfinItemId, type, nav]);

  // Load the guide as soon as we know it's a series — don't wait on IPTV resolve.
  const episodesQuery = useQuery({
    queryKey: ["media", "tv", seriesTmdbId, "episodes"],
    queryFn: () => seriesEpisodes(seriesTmdbId!),
    enabled: Boolean(isTv && seriesTmdbId && !isEpisode),
    // Series is on IPTV but its episode tree hadn't loaded yet (cold Dispatcharr fetch).
    refetchInterval: (query) => {
      const seriesOnIptv = media?.availability.some(
        (a) => a.provider === "dispatcharr" && a.canPlay,
      );
      const items = query.state.data?.items ?? [];
      const episodesOnIptv = items.some((ep) =>
        ep.availability.some((a) => a.provider === "dispatcharr"),
      );
      if (!seriesOnIptv || episodesOnIptv || items.length === 0) return false;
      return query.state.dataUpdateCount < 6 ? 5_000 : false;
    },
  });

  /** Live download jobs — drives episode/movie progress rings while Details is open. */
  const acquisitionsQuery = useQuery({
    queryKey: ["acquisitions"],
    queryFn: () => listAcquisitions(),
    enabled: !demo,
    refetchInterval: (result) =>
      (result.state.data?.items ?? []).some((item) =>
        ["queued", "downloading", "playable"].includes(item.state),
      )
        ? 1500
        : false,
  });
  const acquisitionItems = acquisitionsQuery.data?.items;
  const acquisitionStatesKey = (acquisitionItems ?? [])
    .map((item) => `${item.id}:${item.state}`)
    .join("|");
  const acquisitionStatesPrev = useRef<string | null>(null);
  useEffect(() => {
    if (!acquisitionsQuery.isSuccess) return;
    const prev = acquisitionStatesPrev.current;
    acquisitionStatesPrev.current = acquisitionStatesKey;
    // First load is a baseline — only refetch media when a job actually changes state.
    if (prev === null || prev === acquisitionStatesKey) return;
    void qc.invalidateQueries({ queryKey: ["media", "tv", seriesTmdbId, "episodes"] });
    void qc.invalidateQueries({ queryKey });
    void qc.invalidateQueries({
      queryKey: ["media", "availability", availabilityType, availabilityTmdbId],
    });
  }, [acquisitionStatesKey, availabilityTmdbId, availabilityType, qc, queryKey, seriesTmdbId]);

  const similarType: "movie" | "tv" | null =
    media?.identity.mediaType === "movie" || type === "movie"
      ? "movie"
      : media?.identity.mediaType === "tv" || type === "tv" || isTv
        ? "tv"
        : null;
  const similarTmdb = media?.identity.tmdbId ?? tmdbId ?? seed?.tmdbId;
  const similarQuery = useQuery({
    queryKey: ["media", "similar", similarType, similarTmdb],
    queryFn: () => mediaSimilar(similarType!, similarTmdb!),
    enabled: Boolean(web && similarType && similarTmdb),
  });

  const listType: "movie" | "tv" | null =
    media?.identity.mediaType === "movie"
      ? "movie"
      : media?.identity.mediaType === "tv" || isTv
        ? "tv"
        : similarType;
  const listTmdb = media?.identity.tmdbId ?? similarTmdb;
  const onListQuery = useQuery({
    queryKey: ["mylist", "has", listType, listTmdb],
    queryFn: () => myListHas(listType!, listTmdb!),
    enabled: Boolean(listType && listTmdb),
  });
  const toggleList = useMutation({
    mutationFn: () => toggleMyList(listType!, listTmdb!),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["mylist"] });
      void qc.invalidateQueries({ queryKey: ["home"] });
    },
  });

  const seasons = useMemo(() => {
    const raw = episodesQuery.data?.seasons ?? [];
    // Prefer regular seasons first; keep specials (0) at the end.
    return [...raw].sort((a, b) => {
      if (a === 0) return 1;
      if (b === 0) return -1;
      return a - b;
    });
  }, [episodesQuery.data?.seasons]);

  const seasonEpisodes = useMemo(() => {
    const items = episodesQuery.data?.items ?? [];
    const filtered = season === null ? items : items.filter((e) => e.seasonNumber === season);
    return [...filtered].sort((a, b) => a.episodeNumber - b.episodeNumber);
  }, [episodesQuery.data?.items, season]);

  function seasonLabel(s: number) {
    return s === 0 ? "Specials" : `Season ${s}`;
  }

  /** In-progress episode (IPTV or Jellyfin) — Netflix Resume under the series title. */
  const resumeEpisode = useMemo(() => {
    const hint = episodesQuery.data?.resumeEpisode;
    const items = episodesQuery.data?.items ?? [];
    const withProgress = (ep: EpisodeListItem) => {
      for (const a of ep.availability) {
        if (
          "positionSeconds" in a &&
          typeof a.positionSeconds === "number" &&
          a.positionSeconds > 30
        ) {
          return true;
        }
      }
      return false;
    };
    // Continue Watching / hero More Info — prefer the episode the user just opened.
    if (focusEpisode) {
      const focused = items.find(
        (ep) =>
          ep.seasonNumber === focusEpisode.seasonNumber &&
          ep.episodeNumber === focusEpisode.episodeNumber,
      );
      if (focused && withProgress(focused)) return focused;
    }
    if (hint) {
      const match = items.find(
        (ep) =>
          ep.seasonNumber === hint.seasonNumber && ep.episodeNumber === hint.episodeNumber,
      );
      if (match && withProgress(match)) return match;
    }
    // Among in-progress episodes, prefer the API hint order (most recent), not S/E order.
    if (hint) return null;
    return items.find(withProgress);
  }, [episodesQuery.data?.items, episodesQuery.data?.resumeEpisode, focusEpisode]);

  /** Nothing in progress: the episode the user opened, else the next unwatched one after their furthest watched. */
  const nextUpEpisode = useMemo(() => {
    if (resumeEpisode) return null;
    return pickNextUpEpisode(episodesQuery.data?.items ?? [], canPlayMedia, focusEpisode);
  }, [episodesQuery.data?.items, resumeEpisode, focusEpisode]);

  /** The episode Play acts on, and the row highlighted in the list. */
  const episodeTarget = resumeEpisode ?? nextUpEpisode;
  const selectedEpisode = useMemo(() => {
    if (focusEpisode) {
      const focused = (episodesQuery.data?.items ?? []).find(
        (ep) =>
          ep.seasonNumber === focusEpisode.seasonNumber &&
          ep.episodeNumber === focusEpisode.episodeNumber,
      );
      if (focused) return focused;
    }
    return episodeTarget;
  }, [episodesQuery.data?.items, focusEpisode, episodeTarget]);

  useEffect(() => {
    if (!seasons.length) return;
    if (season !== null && seasons.includes(season)) return;
    const initialSeason =
      selectedEpisode?.seasonNumber ??
      focusEpisode?.seasonNumber ??
      episodesQuery.data?.resumeEpisode?.seasonNumber;
    if (initialSeason != null && seasons.includes(initialSeason)) {
      setSeason(initialSeason);
      return;
    }
    // Default to the first regular season, not TMDb specials (season 0).
    setSeason(seasons.find((s) => s > 0) ?? seasons[0]!);
  }, [seasons, season, selectedEpisode, focusEpisode, episodesQuery.data?.resumeEpisode?.seasonNumber]);

  const detailsScrollRef = useRef<ScrollView>(null);
  const scrollContentRef = useRef<View>(null);
  const selectedRowRef = useRef<View>(null);
  const selectedRowKey = selectedEpisode
    ? `${selectedEpisode.seasonNumber}:${selectedEpisode.episodeNumber}`
    : null;
  const scrolledToKey = useRef<string | null>(null);
  useEffect(() => {
    if (tv || !selectedEpisode || selectedRowKey === scrolledToKey.current) return;
    if (season !== selectedEpisode.seasonNumber) return;
    const scroll = detailsScrollRef.current;
    const row = selectedRowRef.current;
    if (!scroll || !row) return;
    scrolledToKey.current = selectedRowKey;
    if (Platform.OS === "web") {
      const container = (scroll as unknown as { getScrollableNode(): HTMLElement }).getScrollableNode();
      const rowEl = row as unknown as HTMLElement;
      const top =
        rowEl.getBoundingClientRect().top -
        container.getBoundingClientRect().top +
        container.scrollTop;
      container.scrollTo({ top: Math.max(0, top - container.clientHeight / 3) });
      return;
    }
    const content = scrollContentRef.current;
    if (!content) return;
    row.measureLayout(content, (_x, y) => {
      scroll.scrollTo({ y: Math.max(0, y - 120), animated: false });
    });
  }, [tv, selectedEpisode, selectedRowKey, season]);

  const playTarget = episodeTarget ?? (isTv
    ? episodesQuery.data?.items.find((episode) => episode.seasonNumber > 0 && canPlayMedia(episode)) ??
      episodesQuery.data?.items.find(canPlayMedia)
    : null);
  const actionMedia = media && playTarget
    ? { ...media, availability: playTarget.availability, preferredAction: playTarget.preferredAction }
    : media;

  const play = useMutation({
    mutationFn: async () => {
      if (!media) throw new Error("No media");
      setBufferStatus("Resolving…");
      // Series Resume → continue the in-progress episode, not S1E1.
      const target = playTarget;
      const identity = target?.identity ?? media.identity;
      const meta = target
        ? { runtimeMinutes: target.runtimeMinutes }
        : media.metadata;
      const title = target
        ? `${media.metadata.title} S${target.seasonNumber}E${target.episodeNumber}`
        : media.metadata.title;
      const source = await resolvePlaybackForPlay(identity, {
        meta,
        onBuffering: ({ bytesDownloaded = 0, totalBytes }) => {
          if (totalBytes && totalBytes > 0) {
            setBufferStatus(
              `Buffering… ${Math.min(99, Math.round((bytesDownloaded / totalBytes) * 100))}%`,
            );
          } else {
            setBufferStatus(`Buffering… ${Math.round(bytesDownloaded / 1_000_000)} MB`);
          }
        },
      });
      return { source, title, identity: source.resolvedIdentity ?? identity };
    },
    onSuccess: ({ source, title, identity }) => {
      setBufferStatus(null);
      nav.openPlayer({
        source,
        title,
        identity,
      });
    },
    onError: () => setBufferStatus(null),
  });

  const playEpisode = useMutation({
    mutationFn: async (ep: EpisodeListItem) => {
      setBufferStatus("Resolving…");
      const source = await resolvePlaybackForPlay(ep.identity, {
        meta: { runtimeMinutes: ep.runtimeMinutes },
      });
      return { source, ep };
    },
    onSuccess: ({ source, ep }) => {
      setBufferStatus(null);
      nav.openPlayer({ source, title: ep.title, identity: ep.identity });
    },
    onError: () => setBufferStatus(null),
  });

  const downloadEpisode = useMutation({
    mutationFn: async (ep: EpisodeListItem) => {
      const kind = episodeDownloadKind(
        ep.availability,
        ep.preferredAction,
        matchAcquisition(acquisitionItems, ep.identity),
      );
      if (kind === "ready" || kind === "pending" || kind === "downloading") return kind;
      if (kind === "acquire") {
        const iptv = ep.availability.find((a) => a.provider === "dispatcharr");
        if (!iptv?.uuid) throw new Error("No IPTV source to cache");
        await startAcquisition({
          identity: ep.identity,
          mode: "cache",
          source: {
            provider: "dispatcharr",
            uuid: iptv.uuid,
            episodeId: iptv.episodeId,
            movieId: iptv.movieId,
            streamId: iptv.candidates[0]?.streamId,
            m3uAccountId: iptv.candidates[0]?.m3uAccountId,
          },
        });
        return kind;
      }
      // Request this season via Seerr (API accepts movie/tv only).
      const seriesId = media?.identity.tmdbId ?? ep.identity.tmdbId;
      if (typeof seriesId !== "number") throw new Error("Missing series id for request");
      await requestMedia(
        { tmdbId: seriesId, mediaType: "tv" },
        { seasons: ep.seasonNumber > 0 ? [ep.seasonNumber] : "all" },
      );
      return kind;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["media", "tv", seriesTmdbId, "episodes"] });
      void qc.invalidateQueries({ queryKey });
      void qc.invalidateQueries({ queryKey: ["acquisitions"] });
      void qc.invalidateQueries({ queryKey: ["requests"] });
      void qc.invalidateQueries({ queryKey: ["media", "availability", availabilityType, availabilityTmdbId] });
    },
  });

  const downloadTitle = useMutation({
    mutationFn: async () => {
      if (!media) throw new Error("No title");
      const kind = episodeDownloadKind(
        media.availability,
        media.preferredAction,
        matchAcquisition(acquisitionItems, media.identity),
      );
      if (kind === "ready" || kind === "pending" || kind === "downloading") return kind;
      if (kind === "acquire") {
        const iptv = media.availability.find((a) => a.provider === "dispatcharr");
        if (!iptv?.uuid) throw new Error("No IPTV source to cache");
        await startAcquisition({
          identity: media.identity,
          mode: "cache",
          source: {
            provider: "dispatcharr",
            uuid: iptv.uuid,
            episodeId: iptv.episodeId,
            movieId: iptv.movieId,
            streamId: iptv.candidates[0]?.streamId,
            m3uAccountId: iptv.candidates[0]?.m3uAccountId,
          },
        });
        return kind;
      }
      await requestMedia(media.identity);
      return kind;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey });
      void qc.invalidateQueries({
        queryKey: ["media", "availability", availabilityType, availabilityTmdbId],
      });
      void qc.invalidateQueries({ queryKey: ["acquisitions"] });
      void qc.invalidateQueries({ queryKey: ["requests"] });
    },
  });

  const acquisitionId = cache?.acquisitionId;
  const acquisition = useQuery({
    queryKey: ["acquisition", acquisitionId],
    queryFn: () => getAcquisition(acquisitionId!),
    enabled: Boolean(acquisitionId),
    refetchInterval: (q) => {
      const state = q.state.data?.item.state;
      if (state === "downloading" || state === "queued" || state === "playable") return 1500;
      return false;
    },
  });

  const ttl = formatCacheTtlRemaining(acquisition.data?.item.cacheExpiresAt);
  const showSkeleton = !media && details.isLoading;

  const canResume = Boolean(resumeEpisode) || (media != null && /Resume/i.test(actionLabel(media)));
  const resolvingEpisodes = Boolean(isTv && seriesTmdbId && !isEpisode && episodesQuery.isPending);
  /** Play vs Request isn't known yet: the primary button shows a skeleton. */
  const actionsResolving = iptvResolving || resolvingEpisodes;
  const primaryLabel = !media || iptvResolving || resolvingEpisodes
    ? "Resolving…"
    : play.isPending || playEpisode.isPending
      ? bufferStatus || "Resolving…"
      : demo && !canPlayMedia(actionMedia!)
        ? "Not available"
        : canResume
        ? actionMedia?.preferredAction === "PLAY_IPTV" ? "Resume on demand" : "Resume"
        : actionLabel(actionMedia!).replace(/^▶\s*/, "");
  const playable = Boolean(actionMedia && canPlayMedia(actionMedia));
  /** Request / Requested / Downloading n% — replaces Play when nothing can stream yet. */
  const requestAction =
    !playable && !iptvResolving && !resolvingEpisodes && requestFlow.action?.kind !== "none"
      ? requestFlow.action
      : null;
  const onRequestPress = () => {
    if (requestAction?.kind === "request") requestFlow.request();
  };
  const requestProgress =
    requestAction && requestAction.kind !== "request" ? requestAction.progress : undefined;
  const playbackDisabled = iptvResolving || resolvingEpisodes || play.isPending || playEpisode.isPending || !playable;
  // Series download per episode from the guide below.
  const titleDownload = useTitleDownload(isTv || iptvResolving ? null : media);

  /** Series: Download opens a season picker; selected seasons' IPTV episodes are queued server-side. */
  const [seasonPickerOpen, setSeasonPickerOpen] = useState(false);
  const [pickedSeasons, setPickedSeasons] = useState<number[]>([]);
  const [seriesBatch, setSeriesBatch] = useState<string[]>([]);
  const episodeKey = (ep: Pick<EpisodeListItem, "seasonNumber" | "episodeNumber">) =>
    `${ep.seasonNumber}:${ep.episodeNumber}`;
  const seriesEpisodeRows = useMemo(() => {
    if (!isTv || isEpisode) return [];
    return (episodesQuery.data?.items ?? []).map((ep) => {
      const acq = matchAcquisition(acquisitionItems, ep.identity);
      const kind = episodeDownloadKind(ep.availability, ep.preferredAction, acq);
      const active = Boolean(acq && ["queued", "downloading", "playable"].includes(acq.state));
      const iptv = ep.availability.find((a) => a.provider === "dispatcharr");
      const onIptv = iptv?.provider === "dispatcharr" && Boolean(iptv.uuid) && iptv.canPlay;
      // A stale partial cache file (no live job) still needs downloading — the server resumes it.
      const needsDownload = onIptv && (kind === "acquire" || (kind === "downloading" && !active));
      return { ep, acq, kind, active, onIptv, needsDownload };
    });
  }, [isTv, isEpisode, episodesQuery.data?.items, acquisitionItems]);
  const seasonDownloadOptions = useMemo(() => {
    const bySeason = new Map<number, { downloadable: number; onDevice: number; iptv: number }>();
    for (const row of seriesEpisodeRows) {
      if (!row.onIptv) continue;
      const entry = bySeason.get(row.ep.seasonNumber) ?? { downloadable: 0, onDevice: 0, iptv: 0 };
      entry.iptv += 1;
      if (row.needsDownload) entry.downloadable += 1;
      else entry.onDevice += 1;
      bySeason.set(row.ep.seasonNumber, entry);
    }
    return [...bySeason.entries()]
      .sort(([a], [b]) => (a === 0 ? 1 : b === 0 ? -1 : a - b))
      .map(([seasonNumber, counts]) => ({ seasonNumber, ...counts }));
  }, [seriesEpisodeRows]);
  const activeSeriesKeys = seriesEpisodeRows
    .filter((row) => row.active)
    .map((row) => episodeKey(row.ep));
  const batchKeys = seriesBatch.length ? seriesBatch : activeSeriesKeys;
  const seriesDownloadPill = (() => {
    if (demo || !isTv || isEpisode || iptvResolving || !seasonDownloadOptions.length) return null;
    if (batchKeys.length) {
      const rows = seriesEpisodeRows.filter((row) => batchKeys.includes(episodeKey(row.ep)));
      const percents = rows.map((row) =>
        row.kind === "ready" ? 100 : row.acq ? (acquisitionProgressPercent(row.acq) ?? 0) : 0,
      );
      const done = rows.filter((row) => row.kind === "ready").length;
      if (rows.length && done === rows.length) {
        return { kind: "downloaded" as const, label: "✓ Cached" };
      }
      const progress = percents.length
        ? Math.round(percents.reduce((sum, p) => sum + p, 0) / percents.length)
        : 0;
      return {
        kind: "downloading" as const,
        label: `Caching ${done}/${rows.length}`,
        progress,
      };
    }
    if (seasonDownloadOptions.every((s) => s.downloadable === 0)) {
      return { kind: "downloaded" as const, label: "✓ Cached" };
    }
    return { kind: "download" as const, label: "Cache" };
  })();

  const downloadSeasons = useMutation({
    mutationFn: async (seasonNumbers: number[]) => {
      const rows = seriesEpisodeRows
        .filter((row) => seasonNumbers.includes(row.ep.seasonNumber) && row.needsDownload)
        .sort((a, b) => a.ep.seasonNumber - b.ep.seasonNumber || a.ep.episodeNumber - b.ep.episodeNumber);
      for (const { ep } of rows) {
        const iptv = ep.availability.find((a) => a.provider === "dispatcharr");
        if (iptv?.provider !== "dispatcharr" || !iptv.uuid) continue;
        await startAcquisition({
          identity: ep.identity,
          mode: "cache",
          source: {
            provider: "dispatcharr",
            uuid: iptv.uuid,
            episodeId: iptv.episodeId,
            movieId: iptv.movieId,
            streamId: iptv.candidates[0]?.streamId,
            m3uAccountId: iptv.candidates[0]?.m3uAccountId,
          },
        });
      }
      return rows.map((row) => episodeKey(row.ep));
    },
    onMutate: () => setSeasonPickerOpen(false),
    onSuccess: (keys) => {
      setSeriesBatch(keys);
      setPickedSeasons([]);
      void qc.invalidateQueries({ queryKey: ["acquisitions"] });
      void qc.invalidateQueries({ queryKey: ["media", "tv", seriesTmdbId, "episodes"] });
    },
  });

  const downloadPill = isTv
    ? downloadSeasons.isPending
      ? { kind: "downloading" as const, label: "Queuing…", progress: null }
      : seriesDownloadPill
    : titleDownload.state;
  /** Whether a Download pill applies (and its state) isn't known yet: its slot shows a skeleton. */
  const downloadLoading = isTv
    ? !demo && !isEpisode && (actionsResolving || (seasonDownloadOptions.length > 0 && acquisitionsQuery.isPending))
    : iptvResolving || titleDownload.loading;
  const downloadBusy = downloadSeasons.isPending || titleDownload.pending;
  const onDownloadPillPress = () => {
    if (!isTv) return titleDownload.start();
    if (downloadPill?.kind !== "download") return;
    setPickedSeasons((cur) =>
      cur.length ? cur : seasonDownloadOptions.filter((s) => s.downloadable > 0).map((s) => s.seasonNumber).slice(0, 1),
    );
    setSeasonPickerOpen((open) => !open);
  };

  const seasonPicker = seasonPickerOpen ? (
    <SeasonDownloadPicker
      options={seasonDownloadOptions}
      selected={pickedSeasons}
      tv={tv}
      onToggle={(s) =>
        setPickedSeasons((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]))
      }
      onConfirm={() => downloadSeasons.mutate(pickedSeasons)}
      onCancel={() => setSeasonPickerOpen(false)}
    />
  ) : null;
  const actionError = play.error ?? playEpisode.error ?? requestFlow.error ?? titleDownload.error ??
    downloadSeasons.error ??
    downloadTitle.error ?? downloadEpisode.error ?? toggleList.error;
  const actionErrorText = actionError instanceof Error ? actionError.message : null;
  const availabilityLabel =
    actionMedia && !iptvResolving && !resolvingEpisodes ? cardAvailabilityLabel(actionMedia) : null;

  useEffect(() => {
    if (!web || Platform.OS !== "web") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") nav.goBack?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [web, nav]);

  function episodeRuntime(minutes?: number) {
    if (minutes == null || !(minutes > 0)) return null;
    return formatRuntime(minutes);
  }

  /** Netflix: series get a season picker + episode rows; movies get one episode-style row. */
  const episodesBlock = (() => {
    if (!media) return null;

    if (!isTv) {
      const runtime = episodeRuntime(media.metadata.runtimeMinutes);
      const stillUrl = media.metadata.backdropUrl || media.metadata.posterUrl;
      const movieWatched = Boolean(media.watched) || isWatchedByAvailability(media.availability);
      const movieAcq = matchAcquisition(acquisitionItems, media.identity);
      const movieDl = episodeDownloadKind(media.availability, media.preferredAction, movieAcq);
      const moviePct =
        movieAcq && movieDl === "downloading"
          ? acquisitionProgressPercent(movieAcq)
          : movieDl === "downloading"
            ? cacheProgressPercent(media.availability)
            : null;
      return (
        <View style={styles.seasons}>
          {!web ? <Text style={styles.title}>Play</Text> : null}
          <View style={styles.epRow} collapsable={false}>
            <Pressable
              onPress={() => {
                if (playbackDisabled) return;
                play.mutate();
              }}
              // Never `disabled` on TV — Android skips disabled views and focus jumps elsewhere.
              focusable={tv ? true : undefined}
              style={(state) => [
                styles.epPlayArea,
                playbackDisabled && styles.epPlayAreaMuted,
                state.pressed && !playbackDisabled && styles.episodePressed,
                tv && isTvFocused(state) && styles.epRowFocused,
              ]}
            >
              {(state) => (
                <>
                  <EpisodeStillThumb
                    url={stillUrl}
                    onPress={() => {
                      if (playbackDisabled) return;
                      play.mutate();
                    }}
                    disabled={playbackDisabled}
                    forceHot={tv && isTvFocused(state)}
                    progress={watchProgressFraction({
                      watched: movieWatched,
                      availability: media.availability,
                    })}
                  />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={styles.epTitleRow}>
                      <Text style={[styles.episodeTitle, { flex: 1 }]} numberOfLines={1}>
                        {media.metadata.title}
                      </Text>
                      {movieWatched ? (
                        <View style={styles.epWatched} accessibilityLabel="Watched">
                          <CheckIcon color="#a3a3a3" size={14} />
                        </View>
                      ) : null}
                      {runtime ? <Text style={styles.epRuntime}>{runtime}</Text> : null}
                    </View>
                    {media.metadata.overview ? (
                      <Text style={styles.epOverview} numberOfLines={3}>
                        {media.metadata.overview}
                      </Text>
                    ) : null}
                  </View>
                </>
              )}
            </Pressable>
            {demo ? null : (
              <EpisodeDownloadButton
                kind={movieDl}
                busy={downloadTitle.isPending}
                progressPercent={moviePct}
                showFocusRing={tv}
                onPress={() => downloadTitle.mutate()}
              />
            )}
          </View>
        </View>
      );
    }

    return (
      <View style={styles.seasons}>
        <Text style={web ? styles.webSection : styles.title}>Episodes</Text>
        {episodesQuery.isPending ? (
          <>
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
              {[0, 1, 2].map((i) => <SkeletonBlock key={i} width={64} height={36} radius={18} />)}
            </View>
            <EpisodeListSkeleton rows={3} />
          </>
        ) : null}
        {episodesQuery.isError ? (
          <Text style={styles.error}>
            {(episodesQuery.error as Error).message || "Could not load episodes."}
          </Text>
        ) : null}
        {episodesQuery.isSuccess && seasons.length === 0 ? (
          <Text style={web ? styles.epOverview : styles.meta}>No episodes found for this series.</Text>
        ) : null}
        {seasons.length > 0 ? (
          <HScroll style={styles.seasonRow}>
            {seasons.map((s) =>
              web ? (
                <Pressable
                  key={s}
                  onPress={() => setSeason(s)}
                  style={(state) => [
                    styles.seasonPill,
                    season === s && styles.seasonPillOn,
                    tv && state.focused && styles.seasonPillFocused,
                  ]}
                >
                  {(state) => (
                    <Text
                      style={[
                        styles.seasonPillText,
                        season === s && styles.seasonPillTextOn,
                        tv && state.focused && styles.seasonPillTextFocused,
                      ]}
                    >
                      {seasonLabel(s)}
                    </Text>
                  )}
                </Pressable>
              ) : (
                <Button
                  key={s}
                  label={s === 0 ? "Specials" : `S${s}`}
                  variant={season === s ? "primary" : "ghost"}
                  showFocusRing={tv}
                  onPress={() => setSeason(s)}
                  style={{ marginRight: 8 }}
                />
              ),
            )}
          </HScroll>
        ) : null}
        {seasonEpisodes.map((ep) => {
          const runtime = episodeRuntime(ep.runtimeMinutes);
          const epAcq = matchAcquisition(acquisitionItems, ep.identity);
          const dlKind = episodeDownloadKind(ep.availability, ep.preferredAction, epAcq);
          const dlPct =
            epAcq && dlKind === "downloading"
              ? acquisitionProgressPercent(epAcq)
              : dlKind === "downloading"
                ? cacheProgressPercent(ep.availability)
                : null;
          const isPreferredRow =
            episodeFocusPending &&
            initialFocusEpisode != null &&
            ep.seasonNumber === initialFocusEpisode.seasonNumber &&
            ep.episodeNumber === initialFocusEpisode.episodeNumber;
          const playBlocked =
            !canPlayMedia(ep) || playEpisode.isPending || play.isPending;
          const isSelectedRow = selectedRowKey === `${ep.seasonNumber}:${ep.episodeNumber}`;
          return (
            <View
              key={`${ep.seasonNumber}-${ep.episodeNumber}`}
              ref={isSelectedRow ? selectedRowRef : undefined}
              style={[styles.epRow, isSelectedRow && styles.epRowSelected]}
              collapsable={false}
            >
              <Pressable
                onPress={() => {
                  if (playBlocked) return;
                  playEpisode.mutate(ep);
                }}
                // Never `disabled` on TV — Android skips disabled views and focus jumps elsewhere.
                focusable={tv ? true : undefined}
                hasTVPreferredFocus={isPreferredRow ? true : undefined}
                onFocus={isPreferredRow ? () => setEpisodeFocusPending(false) : undefined}
                style={(state) => [
                  styles.epPlayArea,
                  playBlocked && styles.epPlayAreaMuted,
                  state.pressed && !playBlocked && styles.episodePressed,
                  tv && isTvFocused(state) && styles.epRowFocused,
                ]}
              >
                {(state) => (
                  <>
                    <EpisodeStillThumb
                      url={ep.stillUrl}
                      onPress={() => {
                        if (playBlocked) return;
                        playEpisode.mutate(ep);
                      }}
                      disabled={playBlocked}
                      forceHot={tv && isTvFocused(state)}
                      progress={watchProgressFraction(ep)}
                    />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={styles.epTitleRow}>
                        <Text style={[styles.episodeTitle, { flex: 1 }]} numberOfLines={1}>
                          {ep.episodeNumber}. {ep.title}
                        </Text>
                        {ep.watched ? (
                          <View style={styles.epWatched} accessibilityLabel="Watched">
                            <CheckIcon color="#a3a3a3" size={14} />
                          </View>
                        ) : null}
                        {runtime ? <Text style={styles.epRuntime}>{runtime}</Text> : null}
                      </View>
                      {ep.overview ? (
                        <Text style={styles.epOverview} numberOfLines={2}>
                          {ep.overview}
                        </Text>
                      ) : null}
                    </View>
                  </>
                )}
              </Pressable>
              {demo ? null : (
                <EpisodeDownloadButton
                  kind={dlKind}
                  busy={
                    downloadEpisode.isPending &&
                    downloadEpisode.variables?.seasonNumber === ep.seasonNumber &&
                    downloadEpisode.variables?.episodeNumber === ep.episodeNumber
                  }
                  progressPercent={dlPct}
                  showFocusRing={tv}
                  onPress={() => downloadEpisode.mutate(ep)}
                />
              )}
            </View>
          );
        })}
      </View>
    );
  })();

  if (web && layout) {
    const vw = layout.width ?? 1200;
    const vh = layout.height ?? 800;
    // Netflix-style floating card: ~980px wide, ~90% tall, even gutters, centered.
    const marginX = Math.round(Math.max(24, Math.min(56, vw * 0.045)));
    const marginY = Math.round(Math.max(20, Math.min(40, vh * 0.045)));
    const modalW = Math.min(980, vw - marginX * 2);
    const modalH = Math.min(vh - marginY * 2, Math.round(vh * 0.9));
    const heroH = Math.min(Math.round(modalW * 0.4), Math.round(modalH * 0.4), 380);
    const close = () => nav.goBack?.();
    return (
      <View style={[styles.modalRoot, { paddingHorizontal: marginX, paddingVertical: marginY }]}>
        <Pressable
          style={styles.modalDim}
          onPress={close}
          accessibilityLabel="Dismiss"
          // TV: keep D-pad inside the card — dim is click-to-dismiss on pointer only.
          focusable={!tv}
        />
        <View style={[styles.modalCard, { width: modalW, height: modalH }]}>
          <ScrollView
            ref={detailsScrollRef}
            style={styles.modalScroll}
            contentContainerStyle={{ paddingBottom: 48 }}
            showsVerticalScrollIndicator
          >
            {showSkeleton ? <DetailsModalSkeleton backdropH={heroH} /> : null}
            {details.isError ? (
              <Text style={[styles.error, { paddingHorizontal: 28, marginTop: 48 }]}>
                {(details.error as Error).message}
              </Text>
            ) : null}
            {media ? (
              <>
                <View style={{ height: heroH, justifyContent: "flex-end" }}>
                  <Artwork
                    url={media.metadata.backdropUrl || media.metadata.posterUrl}
                    maxWidth={1200}
                    style={styles.webBackdrop}
                  />
                  <Shade kind="details-bottom" style={styles.webShade} />
                  <View style={{ paddingHorizontal: 28, paddingBottom: 18, maxWidth: 640, zIndex: 2 }}>
                    <Text style={styles.modalTitle}>{media.metadata.title}</Text>
                    <View style={styles.webActions}>
                      {requestAction ? (
                        <PillButton
                          icon={requestAction.kind === "request" ? "download" : undefined}
                          label={requestAction.label}
                          tone="light"
                          progress={requestProgress}
                          busy={requestFlow.pending}
                          onPress={onRequestPress}
                          showFocusRing
                          hasTVPreferredFocus={primaryFocus.prefer}
                          focusRef={primaryFocus.ref}
                          forceFocused={primaryFocus.reclaimed}
                          onFocus={primaryFocus.onFocus}
                          onBlur={primaryFocus.onBlur}
                        />
                      ) : (
                        <PillButton
                          icon="play"
                          label={primaryLabel}
                          tone="light"
                          loading={actionsResolving}
                          onPress={() => play.mutate()}
                          disabled={playbackDisabled}
                          showFocusRing
                          hasTVPreferredFocus={primaryFocus.prefer}
                          focusRef={primaryFocus.ref}
                          forceFocused={primaryFocus.reclaimed}
                          onFocus={primaryFocus.onFocus}
                          onBlur={primaryFocus.onBlur}
                        />
                      )}
                      {downloadLoading ? (
                        <PillButton
                          icon="download"
                          label="Cache"
                          tone="glass"
                          loading
                          disabled
                          onPress={onDownloadPillPress}
                          showFocusRing={tv}
                        />
                      ) : downloadPill ? (
                        <PillButton
                          icon={downloadPill.kind === "download" ? "download" : undefined}
                          label={downloadPill.kind === "downloaded" ? "✓ Cached" : downloadPill.label}
                          tone="glass"
                          progress={downloadPill.kind === "downloading" ? downloadPill.progress : undefined}
                          busy={downloadBusy}
                          onPress={onDownloadPillPress}
                          showFocusRing={tv}
                        />
                      ) : null}
                      {listType && listTmdb ? (
                        <PillButton
                          label={
                            toggleList.isPending
                              ? "…"
                              : onListQuery.data?.onList
                                ? "✓ My List"
                                : "+ My List"
                          }
                          tone="glass"
                          onPress={() => toggleList.mutate()}
                          disabled={toggleList.isPending}
                          showFocusRing={tv}
                        />
                      ) : null}
                    </View>
                  </View>
                </View>
                <View style={[styles.webBody, { paddingHorizontal: 28 }]}>
                  {seasonPicker}
                  <View style={styles.webColumns}>
                    <View style={{ flex: 1.45, maxWidth: 640 }}>
                      <Text style={styles.webMeta}>
                        {[
                          media.metadata.year,
                          formatRuntime(media.metadata.runtimeMinutes),
                          media.identity.mediaType === "tv" || isTv ? "Series" : "Movie",
                        ]
                          .filter(Boolean)
                          .join("   ·   ")}
                      </Text>
                      {media.metadata.tagline ? (
                        <Text style={styles.webTagline}>{media.metadata.tagline}</Text>
                      ) : null}
                      {/* Netflix: Resume stays plain; S1:E2 "Title" sits under the meta. */}
                      {episodeTarget ? (
                        <Text style={styles.webResumeEp}>
                          <Text style={styles.webResumeEpCode}>
                            {`S${episodeTarget.seasonNumber}:E${episodeTarget.episodeNumber}`}
                          </Text>
                          {episodeTarget.title ? (
                            <Text style={styles.webResumeEpTitle}>{` "${episodeTarget.title}"`}</Text>
                          ) : null}
                        </Text>
                      ) : null}
                      {/* Movies put the synopsis on the episode-style row below (Netflix). */}
                      {isTv && (episodeTarget?.overview || media.metadata.overview) ? (
                        <Text style={styles.webOverview} numberOfLines={4}>
                          {episodeTarget?.overview || media.metadata.overview}
                        </Text>
                      ) : null}
                      {bufferStatus ? <Text style={styles.buffer}>{bufferStatus}</Text> : null}
                      {ttl ? <Text style={styles.webMeta}>Cache {ttl}</Text> : null}
                      {availabilityLabel ? <Text style={styles.webMeta}>{availabilityLabel}</Text> : null}
                      {actionErrorText ? <Text accessibilityRole="alert" style={styles.error}>{actionErrorText}</Text> : null}
                      <View style={[styles.actions, { marginTop: 14 }]}>
                        {!demo && acquisitionId &&
                        (acquisition.data?.item.state === "downloading" ||
                          acquisition.data?.item.state === "queued") ? (
                          <Button
                            label="Stop caching"
                            variant="ghost"
                            onPress={() => cancelAcquisition(acquisitionId)}
                          />
                        ) : null}
                      </View>
                    </View>
                    <MediaFacts
                      media={media}
                      isTv={isTv}
                      factStyle={styles.webFact}
                      labelStyle={styles.webFactLabel}
                      style={{ flex: 0.9, minWidth: 180, gap: 6 }}
                    />
                  </View>
                  {episodesBlock}
                  <CastCrewCarousel
                    cast={media.metadata.cast}
                    creators={media.metadata.creators}
                    isTv={isTv}
                  />
                  {similarQuery.isPending ? (
                    <View style={{ marginTop: 28, marginHorizontal: -28, paddingLeft: 28, gap: 10 }}>
                      <SkeletonBlock width={150} height={20} />
                      <View style={{ flexDirection: "row", gap: 10 }}>
                        {[0, 1, 2, 3, 4].map((i) => <SkeletonBlock key={i} width={140} height={190} />)}
                      </View>
                    </View>
                  ) : (similarQuery.data?.items?.length ?? 0) > 0 ? (
                    <View style={{ marginTop: 28, marginHorizontal: -28 }}>
                      <MediaRail
                        title="More Like This"
                        items={similarQuery.data!.items}
                        layout={layout}
                        appearance="web"
                        railIndex={0}
                        onOpen={(item) => {
                          close();
                          openMedia(
                            {
                              navigate: (_: "Details", params) => nav.openDetails(params),
                            },
                            item,
                          );
                        }}
                      />
                    </View>
                  ) : null}
                </View>
              </>
            ) : null}
          </ScrollView>
          <Pressable
            onPress={close}
            style={(state) => [
              styles.modalClose,
              tv && isTvFocused(state) && styles.modalCloseFocused,
            ]}
            accessibilityLabel="Close"
          >
            {(state) => (
              <View style={styles.modalCloseIcon}>
                <View
                  style={[
                    styles.modalCloseBar,
                    styles.modalCloseBarA,
                    tv && isTvFocused(state) && styles.modalCloseBarFocused,
                  ]}
                />
                <View
                  style={[
                    styles.modalCloseBar,
                    styles.modalCloseBarB,
                    tv && isTvFocused(state) && styles.modalCloseBarFocused,
                  ]}
                />
              </View>
            )}
          </Pressable>
        </View>
      </View>
    );
  }

  const back = (
    <Pressable
      accessibilityLabel="Back"
      onPress={() => nav.goBack?.()}
      style={({ pressed, focused }) => [
        styles.backBtn,
        pressed && styles.backBtnPressed,
        tv && focused ? styles.backBtnFocused : null,
      ]}
    >
      <NfBackIcon size={28} color="#fff" />
    </Pressable>
  );

  return (
    <View style={[styles.root, { paddingTop }]}>
      <ScrollView ref={detailsScrollRef} contentContainerStyle={styles.content}>
        <View ref={scrollContentRef} collapsable={false}>
        {showSkeleton ? (
          <View style={styles.hero}>
            <DetailsSkeleton backdropH={220} />
            <View style={styles.backOverlay}>{back}</View>
          </View>
        ) : null}
        {details.isError ? (
          <>
            <View style={styles.backRow}>{back}</View>
            <Text style={styles.error}>{(details.error as Error).message}</Text>
          </>
        ) : null}
        {media ? (
          <>
            <View style={styles.hero}>
              <Artwork url={media.metadata.backdropUrl} maxWidth={1280} style={styles.backdrop} />
              <View style={styles.backOverlay}>{back}</View>
            </View>
            <Text style={styles.title}>{media.metadata.title}</Text>
            <Text style={styles.meta}>
              {[
                media.metadata.year,
                formatRuntime(media.metadata.runtimeMinutes),
                media.identity.mediaType === "tv" || isTv ? "Series" : "Movie",
              ]
                .filter(Boolean)
                .join("  ·  ")}
            </Text>
            {media.metadata.tagline ? (
              <Text style={styles.tagline}>{media.metadata.tagline}</Text>
            ) : null}
            {bufferStatus ? <Text style={styles.buffer}>{bufferStatus}</Text> : null}
            {ttl ? <Text style={styles.meta}>Cache {ttl}</Text> : null}
            {availabilityLabel ? <Text style={styles.meta}>{availabilityLabel}</Text> : null}
            {actionErrorText ? <Text accessibilityRole="alert" style={styles.error}>{actionErrorText}</Text> : null}
            <View style={styles.actions}>
              {requestAction ? (
                <Button
                  label={requestAction.label}
                  progress={requestProgress}
                  busy={requestFlow.pending}
                  showFocusRing={tv}
                  hasTVPreferredFocus={tv && initialFocusEpisode == null ? true : undefined}
                  onPress={onRequestPress}
                />
              ) : (
                <Button
                  label={primaryLabel}
                  loading={actionsResolving}
                  showFocusRing={tv}
                  hasTVPreferredFocus={tv && initialFocusEpisode == null ? true : undefined}
                  onPress={() => play.mutate()}
                  disabled={playbackDisabled}
                />
              )}
              {downloadLoading ? (
                <Button
                  label="Cache"
                  variant="ghost"
                  loading
                  disabled
                  showFocusRing={tv}
                  onPress={onDownloadPillPress}
                />
              ) : downloadPill ? (
                <Button
                  label={downloadPill.kind === "downloaded" ? "✓ Cached" : downloadPill.label}
                  variant="ghost"
                  progress={downloadPill.kind === "downloading" ? downloadPill.progress : undefined}
                  busy={downloadBusy}
                  showFocusRing={tv}
                  onPress={onDownloadPillPress}
                />
              ) : null}
              {!demo && acquisitionId &&
              (acquisition.data?.item.state === "downloading" || acquisition.data?.item.state === "queued") ? (
                <Button
                  label="Stop caching"
                  variant="ghost"
                  showFocusRing={tv}
                  onPress={() => cancelAcquisition(acquisitionId)}
                />
              ) : null}
            </View>
            {seasonPicker}
            {episodeTarget ? (
              <Text style={styles.resumeEp}>
                <Text style={styles.resumeEpCode}>
                  {`S${episodeTarget.seasonNumber}:E${episodeTarget.episodeNumber}`}
                </Text>
                {episodeTarget.title ? (
                  <Text style={styles.resumeEpTitle}>{` "${episodeTarget.title}"`}</Text>
                ) : null}
              </Text>
            ) : null}
            {(episodeTarget?.overview || media.metadata.overview) ? (
              <Text style={styles.overview}>
                {episodeTarget?.overview || media.metadata.overview}
              </Text>
            ) : null}
            <MediaFacts
              media={media}
              isTv={isTv}
              factStyle={styles.fact}
              labelStyle={styles.factLabel}
              style={styles.facts}
            />
            {episodesBlock}
            <CastCrewCarousel
              cast={media.metadata.cast}
              creators={media.metadata.creators}
              isTv={isTv}
              titleStyle={styles.castSectionTitle}
            />
          </>
        ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingBottom: 48, paddingTop: 12 },
  hero: {
    position: "relative",
    marginBottom: 16,
    borderRadius: 8,
    overflow: "hidden",
  },
  backRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  backOverlay: {
    position: "absolute",
    top: 10,
    left: 10,
    zIndex: 2,
  },
  backBtn: {
    alignSelf: "flex-start",
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(20,20,20,0.72)",
    borderWidth: 2,
    borderColor: "transparent",
  },
  backBtnPressed: { opacity: 0.85 },
  backBtnFocused: {
    borderColor: colors.focus,
    borderWidth: 3,
    backgroundColor: "rgba(255,255,255,0.22)",
    transform: [{ scale: 1.12 }],
  },
  backdrop: { height: 220, borderRadius: 8, opacity: 0.85, width: "100%" },
  title: { color: colors.text, fontSize: 28, fontWeight: "800" },
  meta: { color: colors.muted, marginTop: 8, fontSize: 15 },
  resumeEp: { color: colors.text, fontSize: 15, lineHeight: 22, marginTop: 12 },
  resumeEpCode: { color: colors.text, fontWeight: "700" },
  resumeEpTitle: { color: colors.text, fontWeight: "400" },
  tagline: {
    color: colors.muted,
    fontSize: 14,
    fontStyle: "italic",
    marginTop: 8,
  },
  overview: { color: colors.text, marginTop: 14, fontSize: 15, lineHeight: 22 },
  buffer: { color: colors.text, marginTop: 12 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 18 },
  facts: { marginTop: 12, gap: 6 },
  fact: { color: colors.text, fontSize: 13, lineHeight: 19 },
  factLabel: { color: "#777" },
  error: { color: colors.danger, marginTop: 8 },
  seasons: { marginTop: 24 },
  seasonRow: { marginBottom: 12 },
  episode: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.bg2,
  },
  episodePressed: { opacity: 0.85 },
  episodeTitle: { color: colors.text, fontSize: 15, fontWeight: "700" },
  epTitleRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 12,
  },
  epRuntime: { color: "#a3a3a3", fontSize: 14, fontWeight: "500" },
  epPlayAreaNative: { flex: 1, minWidth: 0 },
  modalRoot: {
    flex: 1,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  modalDim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.72)",
  },
  modalCard: {
    backgroundColor: "#181818",
    borderRadius: 8,
    overflow: "hidden",
    zIndex: 2,
    boxShadow: "0 24px 80px rgba(0,0,0,0.85)",
  },
  modalScroll: { flex: 1 },
  modalTitle: {
    color: "#fff",
    fontSize: 34,
    lineHeight: 38,
    fontWeight: "800",
    letterSpacing: -0.4,
  },
  modalClose: {
    position: "absolute",
    top: 14,
    right: 14,
    zIndex: 5,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#181818",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  modalCloseFocused: {
    backgroundColor: "#fff",
    borderColor: "#fff",
    transform: [{ scale: 1.12 }],
  },
  modalCloseIcon: {
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  modalCloseBar: {
    position: "absolute",
    width: 16,
    height: 2,
    borderRadius: 1,
    backgroundColor: "#fff",
  },
  modalCloseBarA: { transform: [{ rotate: "45deg" }] },
  modalCloseBarB: { transform: [{ rotate: "-45deg" }] },
  modalCloseBarFocused: { backgroundColor: "#000" },
  webBackdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  webShade: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, pointerEvents: "none" },
  webActions: { flexDirection: "row", gap: 10, marginTop: 14 },
  webBody: { marginTop: 4, backgroundColor: "#181818" },
  webColumns: { flexDirection: "row", gap: 28, flexWrap: "wrap" },
  webMeta: { color: "#fff", fontWeight: "600", fontSize: 15 },
  webTagline: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 14,
    fontStyle: "italic",
    marginTop: 8,
  },
  webResumeEp: { color: "#fff", fontSize: 15, lineHeight: 22, marginTop: 12 },
  webResumeEpCode: { color: "#fff", fontWeight: "700" },
  webResumeEpTitle: { color: "#fff", fontWeight: "400" },
  webOverview: { color: "#fff", fontSize: 15, lineHeight: 22, marginTop: 10 },
  webFact: { color: "#fff", fontSize: 13, lineHeight: 19 },
  webFactLabel: { color: "#777" },
  webSection: { color: "#fff", fontSize: 22, fontWeight: "700", marginBottom: 12 },
  castSection: { marginTop: 28 },
  castSectionTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 12,
  },
  castCard: { width: 110, marginRight: 12 },
  castPhoto: {
    width: 110,
    height: 150,
    borderRadius: 4,
    backgroundColor: "#2a2a2a",
  },
  castPhotoEmpty: { alignItems: "center", justifyContent: "center" },
  castInitial: { color: "#888", fontSize: 28, fontWeight: "700" },
  castName: { color: colors.text, fontSize: 12, fontWeight: "600", marginTop: 8 },
  castRole: { color: colors.muted, fontSize: 11, marginTop: 2 },
  seasonPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    marginRight: 8,
    borderWidth: 2,
    borderColor: "transparent",
  },
  seasonPillOn: { backgroundColor: "rgba(255,255,255,0.16)" },
  seasonPillFocused: {
    backgroundColor: "#fff",
    borderColor: "#fff",
    transform: [{ scale: 1.08 }],
  },
  pickerPanel: {
    marginTop: 16,
    marginBottom: 8,
    padding: 16,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.06)",
    gap: 12,
  },
  pickerTitle: { color: "#fff", fontSize: 17, fontWeight: "700" },
  pickerChips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pickerChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.25)",
    minWidth: 104,
  },
  pickerChipOn: { backgroundColor: "#fff", borderColor: "#fff" },
  pickerChipDone: { opacity: 0.45 },
  pickerChipText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  pickerChipMeta: { color: "rgba(255,255,255,0.7)", fontSize: 12, marginTop: 2 },
  pickerChipTextOn: { color: "#000" },
  pickerActions: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  seasonPillText: { color: "rgba(255,255,255,0.7)", fontSize: 15 },
  seasonPillTextOn: { color: "#fff", fontWeight: "700" },
  seasonPillTextFocused: { color: "#000", fontWeight: "700" },
  epRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 6,
    marginBottom: 2,
  },
  epRowSelected: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    borderRadius: 4,
  },
  epPlayArea: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    minWidth: 0,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "transparent",
    padding: 6,
  },
  epPlayAreaMuted: {
    opacity: 0.55,
  },
  epRowFocused: {
    backgroundColor: "rgba(255,255,255,0.16)",
    borderColor: colors.focus,
    transform: [{ scale: 1.02 }],
  },
  epDownloadBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    flexShrink: 0,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: "transparent",
  },
  epDownloadBtnFocused: {
    opacity: 1,
    borderColor: "#fff",
    transform: [{ scale: 1.12 }],
  },
  epDownloadBtnDisabled: {
    opacity: 0.45,
  },
  epDownloadCheck: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
    lineHeight: 20,
  },
  epDownloadPct: {
    color: "#fff",
    fontSize: 9,
    fontWeight: "700",
    lineHeight: 11,
  },
  epStillWrap: {
    width: 140,
    height: 78,
    borderRadius: 4,
    overflow: "hidden",
    backgroundColor: "#222",
  },
  epProgress: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: "rgba(255,255,255,0.25)",
    pointerEvents: "none",
  },
  epProgressFill: { height: 3, backgroundColor: colors.accent, overflow: "hidden" },
  epWatched: { marginLeft: 8 },
  epStill: { width: 140, height: 78, borderRadius: 4, backgroundColor: "#222" },
  epStillOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
    pointerEvents: "none",
  },
  epPlayCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.9)",
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
    paddingLeft: 2,
  },
  epOverview: { color: "#b3b3b3", fontSize: 13, lineHeight: 18, marginTop: 4 },
});
