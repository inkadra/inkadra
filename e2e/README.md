# End-to-end tests

Playwright against the built server in all-in-one mode: `pnpm build`, then `pnpm test:e2e`.
They need Postgres (`DATABASE_URL`, an empty database) and Valkey or Redis (`REDIS_URL`); see
`playwright.config.ts`. The load tests run on their own with `pnpm test:perf`.

**Shards.** CI assigns whole spec files to six runners by recorded duration (longest first,
then the lightest runner), using `node scripts/e2e-shards.mjs 1 6` to produce the exact-path
CLI filters for `pnpm test:e2e`. `scripts/e2e-durations.mjs` records seconds per file from CI
logs; new files use the median duration. See its comment to refresh the table. Perf specs stay
excluded. Playwright's `chromium` project dependency runs all of `first-run.spec.ts` first on
each empty database, even with CLI file filters. Specs may rely on its administrator Giulia
Bianchi (`giulia@example.com`), the project "Ultima corsa" and its board story (including the
notes "Sopralluogo al porto" and "Casting comparse"), never on another spec. Independent shell and upload regressions
live in `shell-and-uploads.spec.ts` and run once.

**Service worker network events.** `playwright.config.ts` sets
`PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1` for every Chromium test, so that
`setOffline()` and `route()` also reach the requests of the service worker and of its script,
as a real outage or deploy would (`tests/pwa.spec.ts` relies on it). No other spec depends on
it. The flag is experimental: after a Playwright upgrade, check that `pwa.spec.ts` still
passes, and that its behaviour has not changed for the other specs.

## Review screenshots

Review captures go to `e2e/test-results/screenshots/` (already ignored by Git), never to
`docs/screenshots/`. Playwright clears `test-results` at the start of a run; keep any captures
you need privately before running it again. Documentation captures in `docs/screenshots/readme`
and `docs/screenshots/guide` still come from `pnpm --filter @inkadra/e2e screenshots`.

- Frame grab: `pnpm --filter @inkadra/e2e exec playwright test --config frame-grab.config.ts
  --project chromium`, on the workstation with a unique `E2E_PORT`, disposable Postgres/Valkey
  URLs and `CSP_ENFORCE=true`.
- Choice controls: run `ui-controls.spec.ts` after `first-run.spec.ts`.
- Select controls: set `SELECT_SCREENSHOTS=1` when running `storyboard.spec.ts` and
  `pdf-export.spec.ts` after `first-run.spec.ts` on a fresh e2e instance.
