import {
  CatalogScreen as SharedCatalog,
  DownloadsScreen as SharedDownloads,
  DetailsScreen as SharedDetails,
  HomeScreen as SharedHome,
  LiveScreen as SharedLive,
  LoginScreen as SharedLogin,
  RequestsScreen as SharedRequests,
  SearchScreen as SharedSearch,
  PlayerScreen as SharedPlayer,
} from "@reclinarr/native-ui";
import { WebVideoSurface } from "@reclinarr/player-web";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { logout, playLiveChannel } from "@reclinarr/client";
import { colors } from "@reclinarr/native-ui";
import { WebChrome } from "./components/WebChrome";
import { useWebLayout } from "./layout";
import type { PlayParams, RootStackParamList } from "./nav";
import {
  liveResumeKey,
  loadResumeSeconds,
  pickResumeSeconds,
  playResumeKey,
  resolvePlaybackForResume,
  resumeSecondsFromUrl,
  saveResumeSeconds,
  syncResumeToUrl,
} from "./play-resume";
import { useScreenNav } from "./useScreenNav";
import { clearSession, ensureClient } from "./session";
import { webStorage as storage } from "./storage";

type Nav = NativeStackNavigationProp<RootStackParamList>;

function PageHeading({ title }: { title: string }) {
  const layout = useWebLayout();
  return (
    <View style={{ paddingTop: layout.headerH + 28, paddingHorizontal: layout.pageX, paddingBottom: 8 }}>
      <Text style={styles.pageTitle}>{title}</Text>
    </View>
  );
}

export function HomeScreen({ username }: { username: string }) {
  const layout = useWebLayout();
  const nav = useScreenNav();
  const [scrolled, setScrolled] = useState(false);
  return (
    <WebChrome username={username} overlay scrolled={scrolled}>
      <SharedHome
        layout={layout}
        nav={nav}
        focusMode="touch"
        appearance="web"
        onScrollOffset={(y) => setScrolled(y > 24)}
      />
    </WebChrome>
  );
}

export function MoviesScreen({ username }: { username: string }) {
  const layout = useWebLayout();
  const nav = useScreenNav();
  return (
    <WebChrome username={username}>
      <SharedCatalog layout={layout} nav={nav} mediaType="movie" appearance="web" pageTitle="Movies" />
    </WebChrome>
  );
}

export function SeriesScreen({ username }: { username: string }) {
  const layout = useWebLayout();
  const nav = useScreenNav();
  return (
    <WebChrome username={username}>
      <SharedCatalog layout={layout} nav={nav} mediaType="tv" appearance="web" pageTitle="Series" />
    </WebChrome>
  );
}

export function SearchScreen({ username }: { username: string }) {
  const layout = useWebLayout();
  const nav = useScreenNav();
  const route = useRoute<RouteProp<RootStackParamList, "Search">>();
  return (
    <WebChrome username={username}>
      <SharedSearch layout={layout} nav={nav} appearance="web" initialQuery={route.params?.q ?? ""} />
    </WebChrome>
  );
}

export function LiveScreen({ username }: { username: string }) {
  const nav = useScreenNav();
  return (
    <WebChrome username={username}>
      <SharedLive nav={nav} header={<PageHeading title="Live TV" />} />
    </WebChrome>
  );
}

export function DownloadsScreen({ username }: { username: string }) {
  const nav = useScreenNav();
  return (
    <WebChrome username={username}>
      <SharedDownloads nav={nav} header={<PageHeading title="Downloads" />} />
    </WebChrome>
  );
}

export function RequestsScreen({ username }: { username: string }) {
  const nav = useScreenNav();
  return (
    <WebChrome username={username}>
      <SharedRequests nav={nav} header={<PageHeading title="Requests" />} />
    </WebChrome>
  );
}

export function DetailsScreen() {
  const layout = useWebLayout();
  const nav = useScreenNav();
  const route = useRoute<RouteProp<RootStackParamList, "Details">>();
  const params = route.params;
  // No WebChrome — browse stays underneath this transparent modal (Netflix-style).
  if (params?.jellyfinItemId) {
    return (
      <SharedDetails
        nav={nav}
        params={{ jellyfinItemId: params.jellyfinItemId, seed: params.seed, focusEpisode: params.focusEpisode }}
        appearance="web"
        layout={layout}
      />
    );
  }
  if (params?.type && params.tmdbId != null) {
    return (
      <SharedDetails
        nav={nav}
        params={{ type: params.type, tmdbId: params.tmdbId, seed: params.seed, focusEpisode: params.focusEpisode }}
        appearance="web"
        layout={layout}
      />
    );
  }
  return <SharedDetails nav={nav} params={{ type: "movie", tmdbId: 0 }} appearance="web" layout={layout} />;
}

export function LoginScreen() {
  const nav = useScreenNav();
  return (
    <SharedLogin
      nav={nav}
      storage={storage}
      deviceName="Reclinarr Web"
      appearance="web"
      ensureApi={ensureClient}
      paddingTop={64}
      paddingBottom={48}
    />
  );
}

export function PlayerScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProp<RootStackParamList, "Player">>();
  const params = route.params;
  const sourceUrl = params?.source?.delivery?.url;
  const [ready, setReady] = useState<PlayParams | null>(sourceUrl ? params : null);
  const [status, setStatus] = useState<string | null>(sourceUrl ? null : "Resuming playback…");
  const [error, setError] = useState<string | null>(null);
  const navigationRef = useRef(navigation);
  navigationRef.current = navigation;
  const lastSavedPos = useRef(0);

  const identityKey = params?.identity
    ? [
        params.identity.mediaType,
        params.identity.tmdbId ?? "",
        params.identity.jellyfinItemId ?? "",
        params.identity.seasonNumber ?? "",
        params.identity.episodeNumber ?? "",
      ].join(":")
    : "";

  useEffect(() => {
    if (sourceUrl && params) {
      setReady(params);
      setStatus(null);
      setError(null);
      return;
    }

    const channelUuid = params?.channelUuid;
    const live = Boolean(params?.live && channelUuid);
    const identity = params?.identity;
    if (!live && !identity) {
      const nav = navigationRef.current;
      if (nav.canGoBack()) nav.goBack();
      else nav.reset({ index: 0, routes: [{ name: "Home" }] });
      return;
    }

    // In-flight resolves are deduped in play-resume.ts — do not abort on remount
    // (that was leaving the UI stuck on "Resuming…" after a slow /resolve).
    void (async () => {
      try {
        setStatus("Resuming playback…");
        setError(null);

        if (live && channelUuid) {
          const data = await playLiveChannel(channelUuid);
          const next: PlayParams = {
            ...params,
            source: data.source,
            title: params?.title ?? data.title,
            live: true,
            channelUuid,
          };
          setReady(next);
          navigationRef.current.setParams(next);
          setStatus(null);
          return;
        }

        if (identity) {
          const resumeKey = playResumeKey(identity);
          const startPositionSeconds = pickResumeSeconds(
            params?.resumeSeconds,
            resumeSecondsFromUrl(),
            await loadResumeSeconds(storage, resumeKey),
          );
          if (startPositionSeconds) {
            setStatus(`Resuming at ${formatResumeClock(startPositionSeconds)}…`);
            syncResumeToUrl(startPositionSeconds);
          }

          const source = await resolvePlaybackForResume(identityKey, identity, {
            startPositionSeconds,
            onBuffering: ({ bytesDownloaded = 0, totalBytes }) => {
              if (totalBytes && totalBytes > 0) {
                setStatus(
                  `Buffering… ${Math.min(99, Math.round((bytesDownloaded / totalBytes) * 100))}%`,
                );
              } else {
                setStatus(`Buffering… ${Math.round(bytesDownloaded / 1_000_000)} MB`);
              }
            },
          });
          const next: PlayParams = {
            ...params,
            source,
            identity: source.resolvedIdentity ?? identity,
            resumeSeconds: source.startPositionSeconds ?? startPositionSeconds,
          };
          setReady(next);
          navigationRef.current.setParams(next);
          setStatus(null);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not resume playback";
        if (/401|unauthor|sign in|session/i.test(message)) {
          navigationRef.current.reset({ index: 0, routes: [{ name: "Login" }] });
          return;
        }
        setError(message);
        setStatus(null);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceUrl, identityKey, params?.live, params?.channelUuid]);

  const leave = () => {
    const nav = navigationRef.current;
    if (nav.canGoBack()) nav.goBack();
    else nav.reset({ index: 0, routes: [{ name: "Home" }] });
  };

  const resumePersistKey = ready?.identity
    ? playResumeKey(ready.identity)
    : ready?.channelUuid
      ? liveResumeKey(ready.channelUuid)
      : params?.identity
        ? playResumeKey(params.identity)
        : params?.channelUuid
          ? liveResumeKey(params.channelUuid)
          : null;

  // Flush position on tab close / refresh (Netflix-style durability).
  useEffect(() => {
    if (!resumePersistKey || ready?.live || params?.live) return;
    const flush = () => {
      const seconds = lastSavedPos.current;
      if (!(seconds > 30)) return;
      void saveResumeSeconds(storage, resumePersistKey, seconds);
      syncResumeToUrl(seconds);
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    return () => {
      flush();
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
    };
  }, [resumePersistKey, ready?.live, params?.live]);

  if (error) {
    return (
      <View style={styles.playerFallback}>
        <Text style={styles.copy}>{error}</Text>
        <Pressable style={styles.btn} onPress={leave}>
          <Text style={styles.btnText}>Back</Text>
        </Pressable>
      </View>
    );
  }

  if (!ready?.source) {
    return (
      <View style={styles.playerFallback}>
        {params?.title ? <Text style={styles.h1}>{params.title}</Text> : null}
        <Text style={styles.copy}>{status ?? "Loading…"}</Text>
      </View>
    );
  }

  return (
    <SharedPlayer
      params={{
        source: ready.source,
        title: ready.title,
        live: ready.live,
        identity: ready.identity,
        channelUuid: ready.channelUuid,
        liveChannels: ready.liveChannels,
      }}
      storage={storage}
      VideoSurface={WebVideoSurface}
      onClose={leave}
      onReplaceParams={(next) => navigationRef.current.setParams(next)}
      onPositionSeconds={(seconds) => {
        if (!resumePersistKey || ready.live) return;
        // Netflix ~4–5s cadence: persist locally + mirror into ?p=.
        if (Math.abs(seconds - lastSavedPos.current) < 4) return;
        lastSavedPos.current = seconds;
        void saveResumeSeconds(storage, resumePersistKey, seconds);
        syncResumeToUrl(seconds);
      }}
      liveZapEnabled
      userAgent="ReclinarrWeb/1.0"
    />
  );
}

function formatResumeClock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function ProfileScreen({ username }: { username: string }) {
  const navigation = useNavigation<Nav>();
  const queryClient = useQueryClient();
  return (
    <WebChrome username={username}>
      <View style={[styles.profile, { paddingTop: 68 + 36 }]}>
        <Text style={styles.h1}>Profile</Text>
        <Text style={styles.copy}>Signed in as {username}</Text>
        <Pressable
          style={styles.btn}
          onPress={() => navigation.navigate("Downloads")}
        >
          <Text style={styles.btnText}>Downloads</Text>
        </Pressable>
        <Pressable style={styles.btn} onPress={() => navigation.navigate("Requests")}>
          <Text style={styles.btnText}>Requests</Text>
        </Pressable>
        <Pressable
          style={[styles.btn, styles.danger]}
          onPress={async () => {
            try {
              await logout();
            } catch {
              /* ignore */
            }
            await clearSession();
            await queryClient.cancelQueries();
            queryClient.clear();
            navigation.reset({ index: 0, routes: [{ name: "Login" }] });
          }}
        >
          <Text style={styles.btnText}>Sign out</Text>
        </Pressable>
      </View>
    </WebChrome>
  );
}

const styles = StyleSheet.create({
  pageTitle: { color: "#fff", fontSize: 32, fontWeight: "700", letterSpacing: -0.4 },
  profile: { padding: 32, gap: 12, maxWidth: 480 },
  h1: { color: colors.text, fontSize: 28, fontWeight: "800", marginBottom: 8 },
  copy: { color: colors.muted, marginBottom: 16 },
  playerFallback: {
    flex: 1,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
  },
  btn: {
    backgroundColor: colors.bg2,
    padding: 14,
    borderRadius: 8,
  },
  danger: { backgroundColor: colors.danger },
  btnText: { color: colors.text, fontWeight: "700", fontSize: 15 },
});
