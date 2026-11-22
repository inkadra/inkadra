# 0137 — The Clipper's token only clips

Status: accepted (decided by the maintainer on 2026-11-22). Amends
[0011](0011-collaboration-and-access.md) (app tokens); follows
[0096](0096-authenticated-client-compatibility.md) and [0099](0099-invalid-token-reasons.md).

## Context

App tokens are bearer tokens with the same reach as the account that allowed them: every route
that reads the person with `requireActor` accepts one, and only the few account-level routes that
use `requireSession` refuse tokens. That fits the Android app, which does nearly everything the
web app does. It does not fit the browser extension (Inkadra Clipper), which needs a handful of
routes to pick a board and add a card, but holds a token that could also change or delete
projects, boards and memberships. A token kept in a browser profile is worth less to whoever
copies it if it can do only what the extension does.

What a token row records today: `name` (the device name the person confirmed, or the app's
name), `client` (`clipper`, `mobile`, or null for a personal API token), the hash, the prefix and
dates. `client` is set only by the code exchange of the app authorization flow, from the
`clientId` the `/authorize` page allowed, and that `clientId` is accepted only with one of its
exact redirect addresses: `https://<extension id>.chromiumapp.org/auth` for `clipper` (the
official ids and `CLIPPER_EXTENSION_IDS`), `inkadra://auth` for `mobile`. The column and this rule
exist since the first release that shipped the flow (0.3.0); personal tokens made in Settings
never set it. No redirect address or user agent is stored on the token.

## Decision

`personal_token` gets a `scope`, `full` (the default) or `clip`.

- **At issue.** A token issued by the code exchange with `clientId: clipper` gets `clip`. Every
  other token (`mobile`, personal tokens) gets `full`. The extension does not ask for a scope and
  does not need an update: the server knows the client from the authorization it issued.
- **Tokens already issued.** The migration that adds the column sets `clip` on every row whose
  `client` is `clipper`, and leaves the rest `full`. This is reliable: `clipper` was only ever
  written by the exchange for a `chromiumapp.org` redirect address, so no Android or personal
  token is limited by mistake. Clipper tokens can't be told apart further (for example by
  extension id) because the redirect isn't stored, and they don't need to be.
- **What `clip` allows** (the routes every released Clipper, 0.3.0 to today, calls with its
  token; `GET /instance` and the code exchange need no token):

  | Route                                     | Used for                                     |
  | ----------------------------------------- | -------------------------------------------- |
  | `GET /api/v1/me/clip-boards`              | recent boards ([0036](0036-personal-clip-history.md)) |
  | `DELETE /api/v1/me/clip-boards/{boardId}` | forgetting a recent board                    |
  | `GET /api/v1/projects`                    | the board picker                             |
  | `GET /api/v1/projects/{projectId}/boards` | the board picker                             |
  | `GET /api/v1/shared-boards`               | boards shared with the person                |
  | `GET /api/v1/boards/{boardId}/columns`    | choosing a column                            |
  | `GET /api/v1/search`                      | finding a board                              |
  | `POST /api/v1/clip`                       | adding the card (JSON or multipart)          |
  | `DELETE /api/v1/me/tokens/{tokenId}`      | Disconnect: only the token's own id          |

  Roles and grants still decide what each of these returns or allows, as before.
- **Everything else is refused, by default.** `requireActor` compares the matched route
  (method and registered path) with the scope's list, so a route added later is closed to a
  `clip` token until it is listed. Uploads (`/api/v1/uploads`), the version endpoint, token proof
  ([0113](0113-token-proof.md)), `/me`, admin routes and the collaboration socket (`/collab`,
  which the Clipper never opens) are refused. Routes behind `requireSession` refuse every token
  as before.
- **The answer** is the existing `403` with code `forbidden` and the usual error body; no new
  code, no new `reason`. An installed Clipper never sees it, since it calls only listed routes.
- **No capability** in `GET /instance/version`: no client has to detect the behaviour. The
  Clipper's calls are unchanged and the Android app's tokens are `full`.
- The token list in Settings and its API are unchanged: `scope` is not exposed for now.

## Consequences

- A copied Clipper token can still read the boards the person can reach, search them and add
  cards, until it is revoked in Settings → Connected apps; it can no longer change or delete
  anything else.
- A new Clipper feature that needs another route has to list it here and in `SCOPE_ROUTES`
  (`apps/server/src/tokens.ts`) in the same pull request; older servers would refuse it with
  `403`, so the extension must treat that like any other refusal on an older server.
- Self-built clippers (`CLIPPER_EXTENSION_IDS`) are limited the same way.

## Not done

- Scopes for the Android app or for personal API tokens, and a scope parameter in the
  authorization request.
- Any interface to choose or show scopes.
