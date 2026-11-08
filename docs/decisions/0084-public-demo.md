# 0084 — A public demo, closed by default

## Context

People should try Inkadra before installing it, at demo.inkadra.com, without an account. A server
open to anyone on the internet is a different threat than a studio's own instance: bots that
open sandboxes by the thousand, a free file host or spam relay, injection through files, and
one visitor filling the memory or the disk of a small machine (2 ARM cores, 12 GB) for everyone.
A security audit of the demo listed the risks; this records what was done about them.

## Decision

- **One switch.** `DEMO_MODE=true` makes a server a demo; off by default, it changes nothing
  for anyone else. `DEMO_TTL` (1 hour), `DEMO_STORAGE` (100 MB) and `DEMO_MAX_SANDBOXES` (50)
  size it. The demo forces, whatever the environment says: no email, sign-in or registration,
  no feedback relay, maps or address search, no playable video copies or RAW, HEIC and PDF
  previews, the Content Security Policy enforced and files of 10 MB at most.
- **Sandboxes.** "Try the demo" makes an account without email or password, on the reserved
  domain `demo.invalid` (so the schema needs nothing new), imports the sample project
  "Last Train" from an archive kept in `apps/server/demo/` (decision 0037) and signs the
  visitor in. A sandbox is a member with no right to make projects; `DEMO_STORAGE` is everyone's
  storage limit (decision 0081). Cloudflare Turnstile guards the button when its keys are set,
  checked by the server through the guarded fetch of link previews; without them the server
  starts and logs an error at every start, so local runs and tests need no keys. One sandbox
  per address every ten minutes, refusals free; past `DEMO_MAX_SANDBOXES`, counted under a lock,
  the button says to come back later.
- **An allowlist, not a denylist.** In the demo the API answers only the routes a sandbox needs
  to work on its own project; every other route, routes added later included, answers 403.
  Sharing, members, invitations, guest and review links, calendar feeds, feedback, the clipper
  and app tokens, imports, avatars, maps, account deletion and the whole administration stay
  out. Of Better Auth only the session and sign-out pass. Isolation between sandboxes is the
  usual access control, tested for each kind of resource.
- **Files.** JPEG, PNG, WebP, GIF, PDF and plain text only, by type and extension when the
  upload starts and by their first bytes when it ends. Stored files keep being served as before:
  nothing but pictures, video, audio and PDF inline, everything else (SVG included) as a
  download, always with a sandboxing policy.
- **Boards.** In the demo a board past 500 cards or 5 MB becomes read-only and is not saved, and
  a live message is 2 MB at most. Elsewhere boards can grow much larger, so these caps are the
  demo's only.
- **Export once.** "Download the project" is the way from the demo to one's own Inkadra: one
  archive per sandbox.
- **The end.** Every minute, and at start, sandboxes past `DEMO_TTL` go with their projects,
  files, archives and sessions: the only data Inkadra deletes on its own. The page shows the
  end; a pill in the header shows the time and space left and warns once five minutes before.
- **For everyone.** Search is limited to 60 queries a minute per person. Spreadsheet cells that
  start with spaces before a formula sign, or with `|`, also get the apostrophe that keeps them
  from running.
- **Deployment.** `deploy/compose.demo.yaml` runs it behind a Cloudflare Tunnel with no open
  port, resource limits on every container, Valkey with a password and the database on an
  internal network.

## Consequences

- The rate limit per address lives in the process: a restart forgets it. Turnstile and the cap
  remain; Cloudflare's own rate limiting rule (docs/demo.md) adds a limit that survives.
- A sandbox can end slightly above its space, as in decision 0081.
- The sample archive must be rebuilt (`e2e/scripts/demo-seed.ts`) when the archive format moves
  past what older archives can be imported as.
- Exact-address user search stays as it is: the demo cannot reach it, and elsewhere it is how
  people share with someone they know.
