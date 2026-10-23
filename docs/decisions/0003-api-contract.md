# 0003 · API contract: Zod first, OpenAPI generated, `/api/v1`

Accepted, 2026-10.

**Context.** The server, the web app, the extension and the mobile app must agree on every
request and response, and the extension and app are developed before all endpoints exist.

**Decision.**
- Zod schemas in `packages/shared` are the source of truth. The server validates with them and
  clients import their types.
- `openapi.json` is generated from them (`pnpm openapi`), committed, and checked in CI. `pnpm mock`
  serves it with Prism so clients can work against a fake server.
- REST endpoints live under `/api/v1`. Authentication endpoints belong to Better Auth under
  `/api/auth` and keep its error shape (`{ code, message }`); every other error is
  `{ error: { code, message, details? } }` with a fixed list of codes.
- Ids are UUIDs, times are ISO 8601 with offset, lists are `{ items, nextCursor }`.
- Board content is not REST: it is a Yjs document synced over the WebSocket at `/collab`
  (see 0004). The clip endpoint is `/api/v1/clip` (the plan's `/api/clip`, versioned).

**Consequences.** Breaking changes need `/api/v2` or a deprecation period: installed apps
talk to servers of different ages.
