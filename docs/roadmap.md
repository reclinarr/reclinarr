# Reclinarr Roadmap

## Phase 1 — Foundation

- Monorepo, docs, shared domain
- Provider capabilities and interfaces
- JellyfinProvider (real)
- SeerrProvider / DispatcharrProvider skeletons + health
- Mocks and resolver contract tests
- Auth/session, health, UI shell

**STOP** when shell/foundation works.

## Phase 2 — Jellyfin

Vertical slice:

```text
Login → Home → Continue Watching → Details → Play
```

- D-pad / TV-first navigation
- Jellyfin progress
- Playback resolution (`PlaybackDelivery`)
- TMDb-optional navigation via `jellyfinItemId`

**STOP** when Reclinarr is a usable Jellyfin client.

## Phase 3 — Seerr

- Discovery, trending, Movies, Series
- Unified search, media details, requests

Resolution: Jellyfin? → PLAY; else requestable? → REQUEST

**STOP** when discovery/search/request works.

## Phase 4 — Dispatcharr VOD

- Movie/series VOD catalogue
- TMDb/IMDB matching where available
- Availability, stream resolution, source ranking

Resolution: Jellyfin → Cache → Dispatcharr IPTV → Request

**STOP** when IPTV VOD can be discovered/resolved/played safely.

## Phase 5 — Reclinarr Acquisition

- AcquisitionManager + DownloadTransport
- Cache vs library modes
- Progress, cancel, resume, range
- Connection release after acquisition
- **Atomic cache→library promotion** and in-flight mode upgrade
- Add to Library + Jellyfin import/scan
- Explore progressive play-while-downloading later

**STOP** when IPTV → download → release connection → local play works; promote without re-download.

## Phase 6 — Live TV

- Channels, groups, EPG, now/next
- Guide grid, live playback, favourites
- Connection-aware live playback

**STOP** when Reclinarr can replace a normal IPTV Live TV frontend.

## Phase 7 — Unified TV / Episodes

- Episode-level availability across Jellyfin + Dispatcharr
- IPTV watch progress, merged Continue Watching / Next Up
- Source transitions and ranking

**STOP** when Movies + Series + Live TV feel like one application.

## Phase 8 — Android TV / Google TV

- React Native TV app (`apps/tv`) sharing `@reclinarr/client`
- ExoPlayer via `react-native-video`, session cookie on media requests
- Sideload APK (no Play Store)

See [android-tv.md](./android-tv.md).

## Phase 9 — iOS / Android (phones & tablets)

- React Native Expo app (`apps/mobile`) sharing `@reclinarr/client`
- Touch UI: bottom tabs, portrait browse, landscape player
- HLS / progressive playback; Android live MPEG-TS; iOS live deferred until API HLS remux
- Sideload / Simulator (no App Store / Play Store in this pass)

See [mobile.md](./mobile.md).
