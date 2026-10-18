# Upstream: Jellyfin

Verified against Jellyfin OpenAPI **12.1.0** and operational notes from sibling integrations. Do not invent endpoints.

## Role in Reclinarr

Primary media server: library, playback, progress, transcoding, Continue Watching, Next Up, user identity (MVP login).

## Authentication

### User login

`POST /Users/AuthenticateByName`

Body: `{ "Username": "...", "Pw": "..." }`

Header (no token yet):

```http
Authorization: MediaBrowser Client="Reclinarr", Device="...", DeviceId="...", Version="..."
```

Response includes `AccessToken`, `User.Id`, `SessionInfo`.

### Subsequent requests

```http
Authorization: MediaBrowser Client="Reclinarr", Device="...", DeviceId="...", Version="...", Token="<AccessToken>"
```

Jellyfin 12 rejects legacy `X-Emby-Token` / `X-Emby-Authorization` as primary auth.

### DeviceId

One access token per `DeviceId`. Reclinarr generates a random persistent client device UUID and combines it with user identity server-side. No browser fingerprinting.

### API keys

Admin API keys use the same `MediaBrowser Token="..."` scheme. End-user flows use per-user session tokens, not a shared admin key.

## Key endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/Users/AuthenticateByName` | Login |
| `GET` | `/Users/Me` | Current user |
| `POST` | `/Sessions/Logout` | Invalidate token |
| `GET` | `/UserItems/Resume` | Continue Watching |
| `GET` | `/Shows/NextUp` | Next Up |
| `GET` | `/Items/Latest` | Recently added |
| `GET` | `/Items` | Library query |
| `GET` | `/Items/{itemId}` | Item details |
| `GET` | `/Search/Hints` | Search hints |
| `GET` | `/Shows/{seriesId}/Seasons` | Seasons |
| `GET` | `/Shows/{seriesId}/Episodes` | Episodes |
| `POST` | `/Items/{itemId}/PlaybackInfo` | Resolve streams |
| `GET` | `/Videos/{itemId}/stream` | Video stream |
| `POST` | `/Sessions/Playing` | Playback start |
| `POST` | `/Sessions/Playing/Progress` | Progress |
| `POST` | `/Sessions/Playing/Stopped` | Stop |
| `GET` | `/Items/{itemId}/Images/{imageType}` | Artwork |
| `GET` | `/System/Info` | Health/version |
| `POST` | `/Library/Refresh` | Library scan |

## Identifiers

`BaseItemDto.ProviderIds` is a string map. Common keys: `Tmdb`, `Imdb`, `Tvdb`.

**TMDb lookup:** OpenAPI 12.1.0 has **no** provider-id query filter. Practical approach:

1. Index `jellyfin_item_id ↔ tmdb_id` while browsing.
2. Query with `fields=ProviderIds` and match locally (`ProviderIds.Tmdb === String(tmdbId)`).
3. Optionally probe undocumented `AnyProviderIdEquals` — never treat as sole identity proof.
4. Prefer playable evidence (`Path` / `MediaSources`) over metadata-only stubs.

Items without TMDb remain first-class via `jellyfinItemId`.

## Playback

1. `POST /Items/{itemId}/PlaybackInfo` with `DeviceProfile` / bitrate options.
2. Choose DirectPlay, DirectStream, or `TranscodingUrl` (often HLS).
3. Report `/Sessions/Playing*` with `PositionTicks` (10,000,000 ticks = 1 second).

Browsers often cannot attach `Authorization` on `<video>`/`<img>` — Reclinarr proxies or tokenizes media URLs.

### Reclinarr seek behaviour

- **DirectPlay** (browser-safe codecs): progressive `/Videos/{id}/stream?static=true` via the media plane. Native `<video>` seek.
- **Transcode HLS** (AC3/DTS/TrueHD audio, etc.): Jellyfin HLS through `/api/playback/jellyfin/stream` + playlist rewrite. Scrub uses plain `currentTime`; Continue Watching is applied once via hls.js `startPosition`.
- Do **not** send `StartTimeTicks` on PlaybackInfo / transcoding URLs together with client-side resume — the playlist is full VOD from t=0 and the player seeks.

The player must **not** apply IPTV cache download caps (`knownDuration * 0.05`) to Jellyfin titles. That incorrectly limited scrub on a ~2h movie to ~7 minutes (Continue Watching territory).

### Audio track switching

DirectPlay delivers the whole container; Chromium ignores `AudioStreamIndex` on static URLs. When the user picks a non-default audio track, Reclinarr re-calls PlaybackInfo with `AudioStreamIndex` and forces **Transcode HLS** (or DirectStream remux) so Jellyfin emits only that track. The `transcodingPath` is also patched with `AudioStreamIndex` defensively.

### Jellyfin transcoding settings (if scrub still fails after the above)

In Jellyfin Dashboard → Playback:

- Prefer **not** deleting temporary transcoded segments while a session is active (otherwise seeking back re-encodes and can stall).
- Avoid aggressive throttle that stops encoding far ahead of the playhead if you expect large scrub jumps on Transcode titles.
- Confirm the media playlist for a Transcode title includes `#EXT-X-ENDLIST` and segment durations summing to the runtime (VOD). Reclinarr’s rewrite only remaps URIs; it must preserve `ENDLIST`.

## Error behaviour

- `401` invalid credentials / expired token
- Playback `ErrorCode` on PlaybackInfo: `NotAllowed`, `NoCompatibleStream`, `RateLimitExceeded`

## Limitations

- No official query-by-TMDb-ID filter.
- Path renames across versions (Resume is `/UserItems/Resume` in 12.x).
- CORS if browser talks to Jellyfin directly — BFF avoids this.

## Sources

- https://api.jellyfin.org/openapi/
- https://gist.github.com/nielsvanvelzen/ea047d9028f676185832e51ffaf12a6f
