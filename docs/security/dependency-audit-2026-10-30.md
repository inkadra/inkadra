# Dependency audit — 2026-10-30

Part of #225. Baseline: main `1075207`, after Dependabot #243 and #246.

| Audit | Critical | High | Moderate | Low |
| --- | --- | --- | --- | --- |
| Production before / after | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| Full before / after | 0 / 0 | 2 / 1 | 4 / 2 | 0 / 0 |

Reproduce with `pnpm audit --prod --json` and `pnpm audit --json`.
The historical 20 production findings no longer reproduce on current main.

| Advisory | Package (installed) | Severity | Fixed version | Handling / production reachability |
| --- | --- | --- | --- | --- |
| [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) | esbuild 0.18.20 | moderate | >=0.25.0 | Deferred: 0.18 → 0.25 crosses pre-1.0 minor compatibility boundaries. Latest core-utils 3.3.2 still requires ~0.18.20; latest drizzle-kit 0.31.11 retains the legacy loader. Dev-only migration generation; vulnerable serve API is not used by production. |
| [GHSA-r5fr-rjxr-66jc](https://github.com/advisories/GHSA-r5fr-rjxr-66jc) | lodash 4.17.21 | high | >=4.18.0 | Fixed with scoped `postman-collection@4>lodash: 4.18.1` override. Postman 4.5.0 pins 4.17.21; no fixed 4.x parent release. Dev-only Prism mock CLI; absent from production dependencies. |
| [GHSA-f23m-r3pf-42rh](https://github.com/advisories/GHSA-f23m-r3pf-42rh) | lodash 4.17.21 | moderate | >=4.18.0 | Fixed with scoped `postman-collection@4>lodash: 4.18.1` override. Postman 4.5.0 pins 4.17.21; no fixed 4.x parent release. Dev-only Prism mock CLI; absent from production dependencies. |
| [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) | uuid 8.3.2 | moderate | >=11.1.1 | Deferred: 8 → 11 requires a major upgrade. Dev-only Prism/Postman tooling; absent from production dependencies. |
| [GHSA-xxjr-mmjv-4gpg](https://github.com/advisories/GHSA-xxjr-mmjv-4gpg) | lodash 4.17.21 | moderate | >=4.17.23 | Fixed with scoped `postman-collection@4>lodash: 4.18.1` override. Postman 4.5.0 pins 4.17.21; no fixed 4.x parent release. Dev-only Prism mock CLI; absent from production dependencies. |
| [GHSA-qxc2-j82w-r537](https://github.com/advisories/GHSA-qxc2-j82w-r537) | @faker-js/faker 5.5.3 | high | >=10.5.0 | Deferred: 5 → 10 requires a major upgrade. Dev-only Prism/Postman tooling; absent from production dependencies. |

## Dependency paths

- esbuild: `apps/server > drizzle-kit > @esbuild-kit/esm-loader > @esbuild-kit/core-utils > esbuild`.
- Lodash, uuid, Faker: `packages/shared > @stoplight/prism-cli > @stoplight/prism-http > @stoplight/http-spec > postman-collection > <package>`.

Reachability is based on manifests, source imports and the Dockerfile: Prism is used
only by the shared package's `mock` script, drizzle-kit by `db:generate`; the runtime
image uses `pnpm deploy --prod`. These dependencies are not shipped in production.
This is a dependency/source assessment, not a dynamic exploitability test.

No production dependency bump is needed. The direct parents are already at their
latest compatible releases; only Lodash can be safely patched without crossing
compatibility boundaries. PostgreSQL, @types/node and TypeScript are unchanged.
