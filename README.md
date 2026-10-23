# Inkadra

Self-hosted boards for film and photography. From idea to frame.

Inkadra is a free, open source workspace in the spirit of Milanote, built for people who make
films and photographs: moodboards, storyboards, shot lists and client review on an infinite
canvas, running on your own server.

> **Status: early development (0.1).** The foundations are in place: sign-in, the app shell,
> the API and data contracts, and the Docker image. The canvas arrives in 0.2. Not ready for
> real work yet.

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
[docs/self-hosting](docs/self-hosting) covers reverse proxies (Caddy, Traefik, Nginx, Nginx
Proxy Manager, Pangolin), storage on host folders or S3, split mode, upgrades and
troubleshooting. Images are published for amd64 and arm64 as `ghcr.io/inkadra/inkadra`.

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
[docs/decisions](docs/decisions) for the reasoning behind the main choices.

## Licence

The server and web app are under the [GNU Affero General Public License v3.0](LICENSE): if you
run a modified Inkadra for other people over a network, you must offer them the source of your
version. The shared packages in `packages/`, the mobile app and the browser extension are
under the [Mozilla Public License 2.0](packages/shared/LICENSE). See
[decision 0008](docs/decisions/0008-licences-per-component.md).
