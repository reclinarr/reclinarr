# Legacy web pages (quarantined)

The old Vite DOM pages (`HomePage`, `DetailsPage`, `PlayerPage`, …) were removed from
`apps/web/src/pages`. The live web app is Expo RN-web via `App.tsx` → `screens.tsx` →
`@reclinarr/native-ui`.

Do not reintroduce DOM pages here without wiring them into the Expo stack.
