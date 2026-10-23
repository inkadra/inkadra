# Contributing to Inkadra

Thanks for helping. This page is the set of conventions every change follows, whoever writes it.

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
- Keep the repository about the product: no personal notes, editor or tool-specific files.

## Setup

See the _Develop_ section of the [README](README.md). Useful commands:

| Command                     | What it does                                           |
| --------------------------- | ------------------------------------------------------ |
| `pnpm dev`                  | Server and web app with reload                         |
| `pnpm lint` / `pnpm format` | Biome lint and format check / fix                      |
| `pnpm typecheck`            | TypeScript in every package                            |
| `pnpm test`                 | Unit tests; server tests also need `DATABASE_URL`      |
| `pnpm test:e2e`             | Playwright against the built app (`pnpm build` first)  |
| `pnpm openapi`              | Regenerate `packages/shared/openapi.json`              |
| `pnpm mock`                 | Mock API server from the OpenAPI document, on :4010    |
| `pnpm db:generate`          | Generate a migration after editing the database schema |
| `pnpm licenses`             | Check licences of production dependencies              |

## Changing a contract

**API.** Edit the Zod schemas in `packages/shared/src`, register new paths in
`src/openapi.ts`, run `pnpm openapi` and commit `openapi.json`. CI fails if it is stale.
Endpoints live under `/api/v1`. Additive changes (new endpoint, new optional field) are fine
within v1; removing or renaming anything needs a new version or a deprecation period, because
installed mobile apps and extensions talk to servers of different ages.

**Database.** Edit `apps/server/src/db/schema.ts`, run `pnpm db:generate --name <what>` and
commit the generated SQL in `apps/server/drizzle`. Never edit a migration that has been
released; add a new one. Migrations run automatically when the server starts.

**Board documents.** Bump `CURRENT_SCHEMA_VERSION` in `packages/doc-schema/src/doc.ts` and add
a migration from the previous version, with a test that upgrades a document of the old shape.
Documents are migrated when the collaboration server loads them. The schema freezes at 1.0.

## Code

- TypeScript everywhere, `strict`. Biome formats and lints; CI runs `biome ci`.
- Imports between workspace packages go through the package name (`@inkadra/shared`), never
  relative paths across packages.
- Interface text is never hard-coded: add it to `apps/web/src/i18n/it.json` **and** `en.json`
  (a test checks the keys match). Italian is the reference language.
- Styling uses the tokens of `packages/ui` (`var(--ink-…)`). Colour carries meaning only:
  blue for selection, focus and the primary action; everything else stays neutral.
  To change a token edit `tokens.ts` and run `pnpm --filter @inkadra/ui tokens`.
- Tests sit next to the code (`*.test.ts`). Bug fixes come with a test that failed before.

## Pull requests

- One topic per pull request; branch from `main`.
- Fill in the template. For screens, attach before/after screenshots in dark and light theme.
- Every pull request needs green CI (lint, types, tests, end-to-end, secret scan, licences,
  image build) and an approving review from someone who did not write it.
- Commits: imperative mood, short subject (`Add project list endpoint`), body when the why is
  not obvious. Maintainers squash or merge; history on `main` stays linear.

## Decisions

`docs/decisions/NNNN-title.md`, one file per decision: context, decision, consequences.
Number them in order and never rewrite an accepted one; supersede it with a new file.

## Releases

Versions follow semver. Tags `vX.Y.Z` on `main` publish `ghcr.io/inkadra/inkadra:X.Y.Z` for
amd64 and arm64; every push to `main` publishes the `edge` tag.
