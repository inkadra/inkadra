# Contributing to Inkadra

Feedback and bug reports are contributions too: write in
[Discussions](https://github.com/inkadra/inkadra/discussions), open an
[issue](https://github.com/inkadra/inkadra/issues/new/choose), or use **Report a problem** in the
app. The rest of this page is the conventions every change follows, whoever writes it.

## Ground rules

- **Never commit secrets.** No tokens, passwords, private keys or real `.env` files. Use
  `.env.example` with empty values. CI scans every push with gitleaks.
- **Contracts first.** The API (`packages/shared`), the database schema
  (`apps/server/src/db/schema.ts` and its migrations) and the board document schema
  (`packages/doc-schema`) are shared by the web app, the server, the browser extension and the
  mobile app. A change to any of them goes in its own pull request, labelled `contract`,
  and needs a maintainer's review before anything is built on it.
- **Explain non-obvious choices** in `docs/decisions/` (see below), not in pull request threads
  that nobody will find later.
- Keep the repository about the product: no personal notes, working documents (checklists,
  one-off test protocols, dated audits), pull-request screenshots, or editor and tool-specific files.

## Setup

You need Node 26 or newer, pnpm 12 (`npm i -g pnpm@12.17.0`), PostgreSQL 16 or newer
(`compose.yaml` runs 18) and Valkey or Redis.

```sh
pnpm install
cat > apps/server/.env <<'ENV'
PUBLIC_URL=http://localhost:5173
DATABASE_URL=postgres://inkadra:inkadra@localhost:5432/inkadra
REDIS_URL=redis://localhost:6379
AUTH_SECRET=change-me-to-32-random-characters-or-more
ENV
pnpm dev     # API on :3000, web app on http://localhost:5173
```

| Path                   | What it is                                                              |
| ---------------------- | ----------------------------------------------------------------------- |
| `apps/web`             | Web app (React, Vite)                                                   |
| `apps/server`          | API, auth, collaboration and background jobs: one image, several roles  |
| `apps/clipper`         | Browser extension for Chrome, Edge, Brave and Arc                       |
| `relay`                | Worker that passes in-app reports to the developers' private repository |
| `packages/shared`      | API contract (Zod schemas, OpenAPI) and domain rules shared by clients  |
| `packages/doc-schema`  | Versioned schema of the collaborative board documents (Yjs)             |
| `packages/canvas-core` | Canvas math and board rules shared by web and mobile                    |
| `packages/ui`          | Design tokens, card measures and interface components                   |
| `packages/print`       | Printed pages as drawing operations: model, text, measure, layout, PDF  |
| `e2e`                  | End-to-end tests (Playwright)                                           |

The Android app is developed in a separate repository and is not released yet; it uses the
packages above and the server's `/api/v1`.

Useful commands:

| Command                     | What it does                                           |
| --------------------------- | ------------------------------------------------------ |
| `pnpm dev`                  | Server and web app with reload                         |
| `pnpm lint` / `pnpm format` | Biome lint and format check / fix                      |
| `pnpm typecheck`            | TypeScript in every package                            |
| `pnpm test`                 | Unit tests; server tests also need `DATABASE_URL`      |
| `pnpm test:e2e`             | Playwright against the built app (`pnpm build` first)  |
| `pnpm test:perf`            | Load tests (Playwright)                                |
| `pnpm openapi`              | Regenerate `packages/shared/openapi.json`              |
| `pnpm mock`                 | Mock API server from the OpenAPI document, on :4010    |
| `pnpm db:generate`          | Generate a migration after editing the database schema |
| `pnpm check:licenses`       | Check licences of production dependencies              |

## Changing a contract

**API.** Edit the Zod schemas in `packages/shared/src`, register new paths in
`src/openapi.ts`, run `pnpm openapi` and commit `openapi.json`. CI fails if it is stale.
Endpoints live under `/api/v1`. Additive changes (new endpoint, new optional field) are fine
within v1; removing or renaming anything needs a new version or a deprecation period, because
installed mobile apps and extensions talk to servers of different ages. CI compares
`openapi.json` with the last release, and the names each `packages/*` entry point exports with
the commit the change builds on (`scripts/contract-check.mjs`); a break decided on purpose is
listed in `scripts/contract-breaks.json` with its pull request.

**Database.** Edit `apps/server/src/db/schema.ts`, run `pnpm db:generate --name <what>` and
commit the generated SQL in `apps/server/drizzle`. Never edit a migration that has been
released; add a new one. Migrations run automatically when the server starts.

**Board documents.** Bump `CURRENT_SCHEMA_VERSION` in `packages/doc-schema/src/doc.ts` and add
a migration from the previous version, with a test that upgrades a document of the old shape.
Documents are migrated when the collaboration server loads them, and the web app migrates the
copies it keeps on the device on its own before merging them; so a step must be CRDT-idempotent:
only `Y.Map#set` with values that follow from the document, and deletions, never an insert into a
`Y.Array` or text, new shared types, random ids or timestamps (see the comment on `migrations`). Add the new version to
`WRITER_SCHEMAS` in the same file as `{ min: <the new version> }`; only a test like
`canvas-core/src/older-client.test.ts`, proving that clients of the older schema lose nothing of
the change, may lower `min`, and the entry names that test by its title, which starts with
`schema <version> from <min>:`
([decision 0102](docs/decisions/0102-min-writer-schema.md)).

## Code

- TypeScript everywhere, `strict`. Biome formats and lints; CI runs `biome ci`.
- Imports between workspace packages go through the package name (`@inkadra/shared`), never
  relative paths across packages.
- Interface text is never hard-coded: add it to `apps/web/src/i18n/it.json` (Italian is the
  reference language) and to every other catalogue in that folder (`en`, `es`, `de`, `fr`, `pt`).
  A test checks that keys, `{{placeholders}}` and markup match. If you cannot translate a new
  text, put the English one in `es`, `de`, `fr` and `pt`: English is what those users would see
  anyway. A count needs `_one` and `_other`; `_many` is optional and defaults to `_other`. The
  emails (`apps/server/src/mail-texts/`) and the clipper (`apps/clipper/public/_locales/`) follow
  the same rule. See [decision 0073](docs/decisions/0073-more-languages-english-fallback.md).
- Styling uses the tokens of `packages/ui` (`var(--ink-…)`). Colour carries meaning only:
  blue for selection, focus and the primary action; everything else stays neutral.
  To change a token edit `tokens.ts` and run `pnpm --filter @inkadra/ui tokens`.
- Tests sit next to the code (`*.test.ts`). Bug fixes come with a test that failed before.

## Pull requests

- One topic per pull request; branch from `main`.
- Fill in the template. For screens, attach before/after screenshots in dark and light theme.
  The screenshots of the README and the docs come from a sample project: rebuild them with
  `SHOTS_BASE_URL=… pnpm --filter @inkadra/e2e screenshots` against an empty instance on the
  standard image, with ffmpeg on your PATH, and look at each one before committing it.
- Every pull request needs green CI: the check **All checks** passes only when every gate in
  `.github/workflows/ci.yml` passed (lint, types and unit tests, end-to-end tests in Chromium,
  Firefox, WebKit and other time zones, the relay, performance, the secret scan, the workflow
  lint, the image and the jobs that try it). In CI the server suites fail instead of skipping
  when the database, Valkey or a media tool is missing.
- Sign off every commit (`git commit -s`) to certify the
  [Developer Certificate of Origin](https://developercertificate.org).
- Licences differ by folder: `apps/server`, `apps/web` and the rest of the repository are
  AGPL-3.0; `apps/clipper` and everything in `packages/` are MPL-2.0, and each of their files
  starts with `SPDX-License-Identifier: MPL-2.0`. A
  package never imports from an app ([decision 0008](docs/decisions/0008-licences-per-component.md)).
- Logic that two clients must apply alike (the same input gives the same result) lives once in a
  package and the web app imports it from there; it is never copied from an app into another
  client ([decision 0116](docs/decisions/0116-shared-client-logic-in-mpl-packages.md)).
- Commits: imperative mood, short subject (`Add project list endpoint`), body when the why is
  not obvious.

## Decisions

`docs/decisions/NNNN-title.md`, one file per decision: context, decision, consequences.
Number them in order and never rewrite an accepted one; supersede it with a new file.

## Releases

Versions follow semver. A maintainer runs the **Release** workflow on `main` with the version:
it tags `vX.Y.Z`, publishes the GitHub release and starts CI on the tag. The release notes are
`docs/releases/X.Y.Z.<lang>.md`: the English file is the body of the release, and every language
is attached for the Updates page of each instance
([decision 0080](docs/decisions/0080-update-check.md)); without them GitHub generates the notes.
CI runs in full, publishes `ghcr.io/inkadra/inkadra:X.Y.Z`, `X.Y` and `latest`, each also with the
suffix `-office`, for amd64 and arm64 with build provenance and an SBOM, and attaches the
deployment files to the release. `X.Y.Z-rc.N` makes a pre-release, which moves neither `latest`
nor `X.Y`. Every push to `main` publishes the `edge` tag. See
[decision 0010](docs/decisions/0010-images-and-releases.md).

## CI

Workflows pin third-party actions to a commit (`uses: owner/action@<sha> # vX.Y.Z`) and
download tools with a checked SHA-256; Dependabot updates both. A job gets only the
permissions it needs, declared on the job. `actionlint` and `zizmor` check every change to
`.github/workflows`. `scripts/test-proxy.sh <caddy|traefik|nginx> [all|split]` runs the reverse
proxy checks locally against a built image (`INKADRA_TAG=…`).
