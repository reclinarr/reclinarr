# Upstream: Seerr

Verified against [seerr-team/seerr](https://github.com/seerr-team/seerr) `seerr-api.yml` (develop) and source enums. Prefer source over incomplete OpenAPI descriptions.

## Role in Reclinarr

Discovery, TMDb-backed metadata, trending/popular, request state, movie/TV requests. Radarr/Sonarr orchestration stays behind Seerr — Reclinarr does not talk to *arr directly in Phase 1–7.

## Authentication

| Method | Details |
|--------|---------|
| API key | Header `X-Api-Key` |
| Cookie | `connect.sid` after Seerr auth |

**Caveat:** API key authenticates as admin (user id `1`) and typically auto-approves requests. For permission-respecting user requests, use cookie auth or careful `X-API-User` (present in source).

Base path: `{server}/api/v1`

## Key endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/status` | Public health |
| `GET` | `/discover/trending` | Trending (`mediaType`, `timeWindow`) |
| `GET` | `/discover/movies` | Popular ≈ default `popularity.desc` |
| `GET` | `/discover/tv` | Popular TV |
| `GET` | `/search?query=` | Unified search |
| `GET` | `/movie/{tmdbId}` | Movie details |
| `GET` | `/tv/{tmdbId}` | TV details |
| `GET` | `/tv/{tmdbId}/season/{n}` | Season |
| `GET` | `/request` | List requests |
| `POST` | `/request` | Create request |
| `POST` | `/request/{id}/approve` | Approve |
| `POST` | `/request/{id}/decline` | Decline |
| `POST` | `/media/{id}/available` | Mark available |

### Create request body

```json
{
  "mediaType": "movie" | "tv",
  "mediaId": 123,
  "seasons": [1, 2] | "all",
  "is4k": false
}
```

`mediaId` is the **TMDb ID**. Internal Seerr `media.id` ≠ TMDb ID.

## Status enums (source of truth)

### MediaRequestStatus

| Value | Name |
|-------|------|
| 1 | PENDING |
| 2 | APPROVED |
| 3 | DECLINED |
| 4 | FAILED |
| 5 | COMPLETED |

### MediaStatus

| Value | Name |
|-------|------|
| 1 | UNKNOWN |
| 2 | PENDING |
| 3 | PROCESSING |
| 4 | PARTIALLY_AVAILABLE |
| 5 | AVAILABLE |
| 6 | BLOCKLISTED |
| 7 | DELETED |

OpenAPI docs that claim `6 = DELETED` are **wrong**. Map Reclinarr UI states from these enums.

## Identifiers

Discover/search result `id` = TMDb ID. Details paths use TMDb IDs. Availability appears on `mediaInfo` when present.

## Limitations

- No dedicated `/popular` path — use discover defaults.
- OpenAPI incomplete for `status4k` and some media fields.
- API-key admin behaviour affects request UX design in Phase 3.

## Sources

- https://github.com/seerr-team/seerr/blob/develop/seerr-api.yml
- https://docs.seerr.dev/api/seerr-api/
- https://github.com/seerr-team/seerr/blob/develop/server/constants/media.ts
