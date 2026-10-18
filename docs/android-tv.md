# Android TV / Google TV

Phase 8 is a React Native app in [`apps/tv`](../apps/tv) that shares [`@reclinarr/client`](../packages/client) and [`@reclinarr/native-ui`](../packages/native-ui) with mobile and the website. Playback uses ExoPlayer through `react-native-video`.

```text
apps/web    (Expo RN Web + @reclinarr/native-ui)
apps/tv     (React Native + Expo TV)
apps/mobile (React Native + Expo)
        │
        ├── @reclinarr/client → Reclinarr API
        └── @reclinarr/native-ui
```

See [native-unification.md](./native-unification.md). TV screens are written for the remote (D-pad `Chrome`).

## Features

| Feature | Notes |
|---------|-------|
| Launcher | Leanback banner, `LEANBACK_LAUNCHER` via `@react-native-tvos/config-tv` |
| Server URL | First-run screen; Change server from the profile control |
| Auth | Jellyfin login; session id stored on device and sent as `Cookie` |
| D-pad | React Native TV focus |
| Back | Stack pop; player exits first |
| Playback | HLS, progressive, live MPEG-TS; seek cap; sideloaded subtitles |
| Media keys | Play/pause, skip, live channel up/down |
| Live TV | Channels, favourites, zap |

Deep links and Play Store are out of this pass.

## Develop

From the repo root:

```bash
npm install
npm run build -w @reclinarr/shared && npm run build -w @reclinarr/client
cd apps/tv
EXPO_TV=1 npx expo prebuild --clean
EXPO_TV=1 npx expo run:android
```
