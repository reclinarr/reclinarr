# Contributing to Reclinarr

Thanks for helping improve Reclinarr. This guide covers how to set up a local
environment, make changes, and open a pull request.

## Code of conduct

Be respectful and constructive. Assume good intent, keep discussion focused on
the change, and avoid personal attacks.

## Where to contribute

Canonical repository: [reclinarr/reclinarr](https://github.com/reclinarr/reclinarr).

Reclinarr is a monorepo:

| Path | Role |
|------|------|
| `apps/api` | Fastify BFF (auth, catalog, playback, acquisition, live) |
| `apps/web` | Expo web client |
| `apps/mobile` | iOS / Android phone client |
| `apps/tv` | Android TV client |
| `packages/native-ui` | Shared React Native screens and chrome |
| `packages/client` | Typed HTTP client |
| `packages/providers` | Jellyfin / Seerr / Dispatcharr / Bazarr adapters |
| `packages/shared` | Shared types and helpers |
| `packages/player-web` | Web video surface |

Prefer fixing or extending shared UI in `@reclinarr/native-ui` when the change
applies to more than one shell.

## Prerequisites

- Node.js ≥ 24
- `ffmpeg` / `ffprobe` on `PATH` (or set `FFMPEG_PATH`) for IPTV cache packaging
- Optional: Docker, Maestro (UI e2e), Android emulator / iOS Simulator

## Local setup

```bash
git clone https://github.com/reclinarr/reclinarr.git
cd reclinarr
make setup
```

Configure Jellyfin, Seerr, and Dispatcharr in the setup wizard, or in a root
`.env` (see `.env.example`; its values override the wizard). Run `make dev-mock`
for UI-only work without backends. `make` lists every target.

Start the local stack:

```bash
make dev
```

- Web UI: http://localhost:5173
- API: http://127.0.0.1:8787 (`/api/health`)

Use this local stack for routine verification. Do not hit a production deploy
unless you are explicitly testing production.

### Native shells

```bash
make mobile
make tv
```

When both Metro servers run together, reverse the TV emulator port as described
in the [README](./README.md#development).

## Checks before opening a PR

Run what applies to your change:

```bash
make check
make build
```

Opt-in live Dispatcharr ranking tests (needs real credentials in `.env`):

```bash
make test-live
```

UI e2e (Maestro) — keep API + web (and Metro for native) running:

```bash
make e2e-web
make e2e-ios UDID=<IOS_SIMULATOR_UDID>
make e2e-tv UDID=<TV_EMULATOR_UDID>
```

Web e2e uses `RECLINARR_TEST_USERNAME` / `RECLINARR_TEST_PASSWORD` (and optional
`RECLINARR_WEB_URL`, default `http://localhost:5173`).

## Pull requests

1. Fork (or branch from `main` if you have write access).
2. Keep the change focused — one concern per PR when practical.
3. Match existing TypeScript / React Native patterns; avoid drive-by refactors.
4. Update docs when behavior or env vars change (README, `.env.example`, or
   `docs/`).
5. Describe **why** the change exists and how you verified it (commands, devices,
   mock vs real backends).
6. Do not commit secrets (`.env`, API keys, tokens). Keep `.env.example` as the
   documented template.

## Reporting issues

Open an issue with:

- What you expected vs what happened
- Reclinarr version / commit, Node version, OS
- Whether you used mocks or real Jellyfin / Seerr / Dispatcharr
- Relevant logs (API console, browser network for `/api/*`) — redact secrets

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](./LICENSE).
