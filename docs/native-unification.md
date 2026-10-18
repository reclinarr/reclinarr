# Native UI unification (React Native + RN Web)

Reclinarr shares **domain + API** via `@reclinarr/client` / `@reclinarr/shared` and **UI** via `@reclinarr/native-ui` across mobile, Android TV, and web (Expo + `react-native-web`).

```text
                    @reclinarr/client  (API / playback helpers)
                              │
                    @reclinarr/native-ui  (screens + PosterCard + player chrome)
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
   apps/mobile            apps/tv               apps/web
   tabs + touch           Leanback Chrome       Expo RN Web
   react-native-video     react-native-video    @reclinarr/player-web
                                                (hls.js / mpegts.js)
```

## Package roles

| Package | Role |
|---------|------|
| `@reclinarr/native-ui` | Theme, skeletons, PosterCard, Artwork, shared screens, shared `PlayerScreen` chrome |
| `@reclinarr/player-web` | Browser MSE attach (`hls.js` / `mpegts.js`) + `WebVideoSurface` |
| `apps/mobile` / `apps/tv` | Thin shells: chrome, layout metrics, `NativeVideoSurface` |
| `apps/web` | Expo web shell; static export to `apps/web/dist` for API/`fastifyStatic` |

## Player adapter

`VideoSurfaceProps` + shared `PlayerScreen` chrome live in `@reclinarr/native-ui`.
Platform surfaces implement seek/progress/load/error:

- Native: `react-native-video` (`NativeVideoSurface`)
- Web: `attachWebPlayback` in `@reclinarr/player-web`

## Netflix-style loading UX

- Skeleton geometry matches billboard / 16:9 rails / details hero
- Prefer skeletons over spinners for content areas
- Keep nav chrome mounted while rails load
- Respect `AccessibilityInfo` reduce-motion
