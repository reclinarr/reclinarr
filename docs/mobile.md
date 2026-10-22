# iOS / Android (phones & tablets)

Phase 9 is a React Native app in [`apps/mobile`](../apps/mobile) that shares [`@reclinarr/client`](../packages/client) and [`@reclinarr/native-ui`](../packages/native-ui) with Android TV and the website. Screens are touch-first (bottom tabs). Playback uses `react-native-video` (ExoPlayer on Android, AVPlayer on iOS).

```text
apps/web    (Expo + react-native-web + @reclinarr/native-ui)
apps/tv     (React Native + Expo TV / Leanback)
apps/mobile (React Native + Expo / phones & tablets)
        │
        ├── @reclinarr/client → Reclinarr API
        └── @reclinarr/native-ui (shared screens + primitives)
```

See [native-unification.md](./native-unification.md). The TV app stays D-pad / landscape Leanback. Mobile does **not** import TV chrome components and does **not** set `EXPO_TV`.

## Runtime

The monorepo pins `react-native` to `react-native-tvos` (same as Android TV). That fork builds phone and tablet binaries. Mobile omits `@react-native-tvos/config-tv`, so prebuild produces a normal launcher (`app.reclinarr.mobile`), not Leanback.

## Features

| Feature | Notes |
|---------|-------|
| Server URL | First-run screen; Change server from Profile |
| Auth | Jellyfin login; session id on device as `Cookie` / header |
| Tabs | Home, Movies, Series, Live TV, Search |
| Profile | Downloads, Requests, Change server, Sign out |
| Playback | HLS, progressive; seek cap; sideloaded subtitles |
| Live TV | Android: MPEG-TS via ExoPlayer. iOS: unavailable until API live HLS remux |

## Develop

From the repo root:

```bash
npm install
npm run build -w @reclinarr/shared && npm run build -w @reclinarr/client
cd apps/mobile
npx expo prebuild --clean
npx expo run:ios
# or
npx expo run:android
```

Do **not** set `EXPO_TV`. Needs Xcode (iOS Simulator or device) and/or Android Studio with `ANDROID_HOME` set.

## Live MPEG-TS on iOS

Live channels stream as raw `video/mp2t`. ExoPlayer plays that; AVPlayer does not. Until Reclinarr exposes a live HLS remux, the Live tab on iOS shows an unavailable state.
