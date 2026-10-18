# Upstream: Dispatcharr

Verified against [Dispatcharr/Dispatcharr](https://github.com/Dispatcharr/Dispatcharr) (~v0.31.0), official docs, and source. Mintlify wiki has known inaccuracies — prefer source.

## Role in Reclinarr

IPTV integration boundary: M3U/XC sources, VOD/series catalogue, live channels, EPG, safe stream proxy. **Reclinarr owns acquisition/download** — Dispatcharr does not download VOD to disk.

## What it is

Open-source IPTV/EPG/VOD manager and stream proxy. Aggregates M3U and Xtream Codes sources. Catalog + proxy, not a Radarr-style grabber.

## Authentication

### JWT

`POST /api/accounts/token/` with `{ "username", "password" }` → `{ "access", "refresh" }`

Header: `Authorization: Bearer <access>`

Refresh: `POST /api/accounts/token/refresh/` with `{ "refresh" }`

Alt login: `POST /api/accounts/auth/login/`

Typical TTL: access ~30 minutes, refresh ~1 day.

### API keys (v0.20+)

| Header | Format |
|--------|--------|
| Preferred | `Authorization: ApiKey <key>` |
| Alternate | `X-API-Key: <key>` |

Management: `GET /api/accounts/api-keys/`, `POST .../generate/`, `POST .../revoke/` (not generic DELETE-by-id CRUD).

### Media auth

VOD proxy accepts JWT via `?token=` for `<video>` elements that cannot set Authorization.

### Reclinarr config

```ts
type DispatcharrAuth =
  | { type: "apiKey"; apiKey: string }
  | { type: "credentials"; username: string; password: string };
```

Prefer API key for BFF automation. Never expose credentials to the browser.

## Key REST modules

| Area | Prefix / paths |
|------|----------------|
| Accounts | `/api/accounts/` |
| Channels | `/api/channels/channels/`, `/groups/`, `/streams/` |
| EPG | `/api/epg/programs/`, `/grid/`, `/current-programs/`, `/sources/` |
| M3U sources | `/api/m3u/accounts/`, profiles, filters, refresh |
| VOD | `/api/vod/movies/`, `/series/`, `/episodes/`, `/categories/`, `/all/` |
| Schema | `/api/schema/`, `/api/swagger/` |

VOD movie/series/episode/category viewsets are **ReadOnly** (synced from providers). Do not invent create/update/delete for VOD catalog.

## Playback / proxy

| Path | Purpose |
|------|---------|
| `/proxy/vod/movie/{uuid}` | Movie proxy |
| `/proxy/vod/episode/{uuid}` | Episode proxy |
| `/proxy/ts/stream/{channel.uuid}` | Live TS proxy |
| `/proxy/stats/` | Live+VOD+catchup stats (**admin**) |
| `/proxy/vod/stats/` | VOD connections (**admin**) |

UI constructs: `/proxy/vod/movie/{uuid}?stream_id=…&token=<jwt>`

Upstream IPTV credentials stay inside Dispatcharr. There is **no** REST `/api/vod/movies/{id}/stream/` action in source.

## Identifiers

| Entity | REST id | Playback | External |
|--------|---------|----------|----------|
| Movie/Series/Episode | int PK | `uuid` | `tmdb_id`, `imdb_id` (strings) |
| Channel | int | `uuid` | `tvg_id`, etc. |
| M3U account | int | — | STD/XC |

**No TVDB** fields found on VOD models.

## Pagination

Per-viewset `PageNumberPagination`. VOD default `page_size` 20 (max 100). Shape: `count`, `next`, `previous`, `results`.

## Connection limits

- User `stream_limit` (0 = unlimited)
- M3U account/profile `max_streams`; profile `current_viewers`
- XC `max_connections` / `active_cons` may appear in profile `custom_properties`
- Admin `/proxy/stats/`

Reclinarr’s future `IptvConnectionManager` combines these signals with Reclinarr acquisition slots. Do not assume a full scheduling API.

## Confirmed gaps

| Need | Status |
|------|--------|
| Filter `?tmdb_id=` / `?imdb_id=` | **Missing** — page + local match or Reclinarr index |
| TVDB on VOD | **Missing** |
| REST get-playable-URL action | **Missing** — construct `/proxy/vod/...` |
| VOD download-to-disk / cart | **Missing** — Reclinarr AcquisitionManager |
| Progressive download API | **Missing** |
| Public hosted OpenAPI without instance | Use `/api/schema/` on a deploy |

## Error behaviour

- `401` missing/invalid auth
- `403` authenticated but forbidden
- `429` when stream limits exceeded (proxy)

## Limitations for Reclinarr

- No TMDb search filter → maintain index or scan pages carefully.
- Acquisition must download via Dispatcharr proxy URLs using Reclinarr’s trusted auth — never client-supplied arbitrary URLs.
- Capture real response fixtures from a running instance before hardening Zod schemas.

## Sources

- https://github.com/Dispatcharr/Dispatcharr
- https://dispatcharr.github.io/Dispatcharr-Docs/
- https://dispatcharr.github.io/Dispatcharr-Docs/api/
