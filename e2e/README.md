# End-to-end tests

Playwright against the built server in all-in-one mode: `pnpm build`, then `pnpm test:e2e`.
They need Postgres (`DATABASE_URL`, an empty database) and Valkey or Redis (`REDIS_URL`); see
`playwright.config.ts`. The load tests run on their own with `pnpm test:perf`.

**Service worker network events.** `playwright.config.ts` sets
`PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1` for every Chromium test, so that
`setOffline()` and `route()` also reach the requests of the service worker and of its script,
as a real outage or deploy would (`tests/pwa.spec.ts` relies on it). No other spec depends on
it. The flag is experimental: after a Playwright upgrade, check that `pwa.spec.ts` still
passes, and that its behaviour has not changed for the other specs.
