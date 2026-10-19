# Performance and usage metrics

Reclinarr can send opt-in, pseudonymous performance and feature usage metrics to the Reclinarr PostHog project in the EU region. Metrics are disabled unless the API has a PostHog project key configured. Users choose separately on each device, and can change their choice from Profile. The server administrator can disable collection for the whole installation with `RECLINARR_TELEMETRY_DISABLED=true`.

Configure the PostHog project write-only token in the API environment:

```dotenv
RECLINARR_POSTHOG_PROJECT_KEY=your-project-token
RECLINARR_TELEMETRY_DISABLED=false
```

Restart the API after changing these settings. The setup wizard does not collect or store the PostHog token. Docker deployments load these values from the root `.env` file.

Client builds bundle the same public PostHog project token using `EXPO_PUBLIC_POSTHOG_PROJECT_KEY`. The local Expo scripts read `RECLINARR_POSTHOG_PROJECT_KEY` from the root `.env`; CI/EAS builds should set `EXPO_PUBLIC_POSTHOG_PROJECT_KEY` in their build environment. The token only permits event ingestion. The API status endpoint still enforces the installation-wide telemetry disable setting.

The app records broad operation names, elapsed time, result category, app version, platform, and coarse playback milestones. It does not record account identifiers, titles, search text, media IDs, request URLs or parameters, credentials, or raw errors. Each opted-in user/device receives a random identifier used to group their events. Client events are sent directly to PostHog in small batches using the public project token; server events are sent by the Reclinarr API. Events disable person profile creation and GeoIP enrichment. Session replay and automatic capture are not enabled.

Instrumentation covers high-cost Reclinarr API routes, provider HTTP calls made during opted-in requests, client API operations, screen views, sampled artwork loads, playback source resolution, and first playback progress. Health checks, auth requests, progress polling, media segments, and stream bytes are excluded. Metrics are best effort and do not affect application operations.
