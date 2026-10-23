# 0001 · One repository, pnpm workspaces and Turborepo

Accepted, 2026-10.

**Context.** Web app, server, browser extension and mobile app share the API types, the board
document schema, canvas logic and design tokens. Several people (and agents) work on them in
parallel.

**Decision.** A single repository with pnpm workspaces (`apps/*`, `packages/*`, `e2e`) and
Turborepo to run tasks in dependency order with caching. Internal packages export TypeScript
source directly (no build step); apps bundle what they import (Vite for the web app, esbuild for
the server). Biome is the only linter and formatter.

**Consequences.** A contract change and its uses land in one pull request. Packages must stay
free of Node-only APIs when the browser or React Native imports them; `@inkadra/shared/constants`
exists so that browser bundles can avoid pulling in Zod.
