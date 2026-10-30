<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg">
    <img src="docs/assets/logo-light.svg" alt="Inkadra" width="280">
  </picture>
</p>

<p align="center">
  <strong>Self-hosted boards for film and photography. From idea to frame.</strong>
</p>

<p align="center">
  <a href="https://github.com/inkadra/inkadra/actions/workflows/ci.yml"><img src="https://github.com/inkadra/inkadra/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
  <a href="https://github.com/inkadra/inkadra/releases"><img src="https://img.shields.io/github/v/release/inkadra/inkadra?include_prereleases&label=release" alt="Latest release"></a>
  <a href="https://github.com/inkadra/inkadra/pkgs/container/inkadra"><img src="https://img.shields.io/badge/image-ghcr.io-2563EB" alt="Docker image on ghcr.io"></a>
  <a href="#licence"><img src="https://img.shields.io/badge/licence-AGPL--3.0%20%2F%20MPL--2.0-808086" alt="Licence: AGPL-3.0 and MPL-2.0"></a>
</p>

<p align="center">
  <a href="#run-it">Run it</a> ·
  <a href="docs/self-hosting">Self-hosting guide</a> ·
  <a href="#develop">Develop</a> ·
  <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="docs/decisions">Decisions</a>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/readme/board-dark.png">
    <img src="docs/screenshots/readme/board-light.png" alt="A moodboard in Inkadra: notes, film stills, a column of references, a colour palette and a checklist on an infinite canvas">
  </picture>
</p>

Inkadra is a free, open source visual workspace for people who make films and photographs:
moodboards, storyboards, shot lists and client review on an infinite canvas, running on your
own server.

> [!NOTE]
> **Early development.** Inkadra is moving fast towards 1.0 and is good for trying out, but
> not yet for work you cannot afford to lose. Releases before 1.0 may change things between
> minor versions: read the notes in [Upgrades](docs/self-hosting/upgrades.md) before updating.

## What it does

- **Boards on an infinite canvas.** Notes, images, files, links, to-do lists, colour swatches,
  columns, arrows and boards inside boards. Start from scratch or from a template. YouTube and
  Vimeo links show their preview, and YouTube videos play in the viewer.
- **Storyboards, shot lists and schedules.** Scenes and frames with shot size, angle, movement,
  lens, duration, cast and status. Draw on a frame with the pen, or start from a picture. The
  shot list is the same data as a table you can filter and export to CSV; the shooting
  schedule plans the days from the same shots.
- **A home for every project.** Home opens on your recent boards, today's shooting day and what
  changed. Each project has its own colour, shape or emoji, and every kind of canvas keeps one
  colour across the app: storyboards purple, shot lists green, moodboards orange, schedules
  teal, reviews pink. The tools that add cards have colours of their own, kept apart from those.
- **Together, live.** Everyone on a board sees changes as they happen. Roles per project and per
  board, invitations, comments with mentions, review status, and an inbox for notifications.
- **Client review.** Share a board through a link, with or without comments and picks, and keep
  some cards for the team only. Named versions let you go back to any earlier state, or bring
  back a single deleted element.
- **Capture from the web.** The [Inkadra Clipper](apps/clipper) extension saves images, quotes
  and links from Chrome, Edge, Brave and Arc straight onto a board.
- **Your server, your files.** One Docker image for amd64 and arm64. Files on a volume, a host
  folder or any S3 storage. Email, Google or your own OIDC provider for sign-in, with two-factor
  authentication on every method and sign-in limits that survive restarts. Installs as an app
  from the browser.
- **Take it with you.** Export a project as an open zip archive (boards, original files,
  comments, reviews, schedule) and import it on any Inkadra server. Nightly backups of the
  database, with a restore command that also carries data across upgrades.

<table>
  <tr>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/readme/storyboard-dark.png">
        <img src="docs/screenshots/readme/storyboard-light.png" alt="A storyboard: two scenes with their frames, shot sizes, durations and status">
      </picture>
      <p align="center"><sub>Storyboard: scenes, frames and the data of each shot</sub></p>
    </td>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/readme/shotlist-dark.png">
        <img src="docs/screenshots/readme/shotlist-light.png" alt="The shot list of the same storyboard, as a table">
      </picture>
      <p align="center"><sub>Shot list: the same frames as a table</sub></p>
    </td>
  </tr>
  <tr>
    <td colspan="2">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/readme/home-dark.png">
        <img src="docs/screenshots/readme/home-light.png" alt="Home: today's shooting day, the recent boards with their kind colours, activity and templates">
      </picture>
      <p align="center"><sub>Home: today's shoot, recent boards and what changed</sub></p>
    </td>
  </tr>
</table>

## Run it

You need Docker with Compose and a domain for Inkadra. A reverse proxy for HTTPS is included
if you do not have one.

```sh
mkdir inkadra && cd inkadra
curl -fsSLO https://raw.githubusercontent.com/inkadra/inkadra/main/compose.yaml
curl -fsSL -o .env https://raw.githubusercontent.com/inkadra/inkadra/main/.env.example
# edit .env: PUBLIC_URL, AUTH_SECRET, POSTGRES_PASSWORD
docker compose up -d
```

Open `PUBLIC_URL` in a browser: the first account you create becomes the administrator.

To pin a release instead of following `latest`, set `INKADRA_TAG=0.4.0` (or `0.4` for its patch
releases) in `.env`. Upgrading from 0.3? Read [Upgrading to 0.4](docs/self-hosting/upgrades.md#upgrading-to-04)
first: Valkey is now required by every role and allowed domains are checked more strictly.

The [self-hosting guide](docs/self-hosting) covers reverse proxies (Caddy, Traefik, Nginx,
Nginx Proxy Manager, Pangolin), sign-in, storage on host folders or S3, split mode, upgrades
and troubleshooting. Images are published for amd64 and arm64 as `ghcr.io/inkadra/inkadra`.

## Develop

Requirements: Node 22.18 or newer, pnpm 10 (`corepack enable`), Postgres 16 and Valkey or Redis.

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

| Path                   | What it is                                                             |
| ---------------------- | ---------------------------------------------------------------------- |
| `apps/web`             | Desktop web app (React, Vite)                                          |
| `apps/server`          | API, auth, collaboration and background jobs: one image, several roles |
| `apps/clipper`         | Browser extension for Chrome, Edge, Brave and Arc                      |
| `apps/mobile`          | Android and iOS app (planned)                                          |
| `packages/shared`      | API contract: Zod schemas and the generated OpenAPI document           |
| `packages/doc-schema`  | Versioned schema of the collaborative board documents (Yjs)            |
| `packages/canvas-core` | Canvas math shared by web and mobile                                   |
| `packages/ui`          | Design tokens and interface components                                 |
| `e2e`                  | End-to-end tests (Playwright)                                          |

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request, and
[docs/decisions](docs/decisions) for the reasoning behind the main choices. Security problems
go through [private advisories](SECURITY.md), not public issues.

## Licence

The server and web app are under the [GNU Affero General Public License v3.0](LICENSE): if you
run a modified Inkadra for other people over a network, you must offer them the source of your
version. The shared packages in `packages/`, the mobile app and the browser extension are
under the [Mozilla Public License 2.0](packages/shared/LICENSE). See
[decision 0008](docs/decisions/0008-licences-per-component.md).
