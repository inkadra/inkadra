# 0084 — A public demo, closed by default

## Context

People should try Inkadra before installing it, at demo.inkadra.com, without an account. A server
open to anyone on the internet is a different threat than a studio's own instance: bots that
open sandboxes by the thousand, a free file host or spam relay, injection through files, and
one visitor filling the memory or the disk of a small machine for everyone.
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
  storage limit (decision 0081). Cloudflare Turnstile guards the button, checked by the server
  through the guarded fetch of link previews, for the host of `PUBLIC_URL` and the widget's own
  action only. In production a demo without its keys does not start (fail closed); in
  development and tests it starts and logs an error, so local runs need no keys. One sandbox
  per address (an IPv6 /64 as one) every ten minutes; a refusal does not spend that turn but
  counts against five refusals per address in the same time, so nobody hammers Turnstile
  through the server. Past `DEMO_MAX_SANDBOXES`, counted under a lock, the button says to come
  back later. "Start over" asks before it deletes the sandbox; it first cancels an export under
  way, which stops at its next step and removes its own archive.
- **An allowlist, not a denylist.** In the demo the API answers only the routes a sandbox needs
  to work on its own project; every other route, routes added later included, answers 403.
  Sharing, members, invitations, guest and review links, calendar feeds, feedback, the clipper
  and app tokens, imports, avatars, maps, link previews (the server would fetch any address and
  keep its picture past the upload rules), account deletion and the whole administration stay
  out. Of Better Auth only the session and sign-out pass. Isolation between sandboxes is the
  usual access control, tested for each kind of resource.
- **Files.** JPEG, PNG, WebP, GIF, PDF and plain text only, by type and extension when the
  upload starts and by their bytes when it ends: a picture's signature, a PDF's header at the
  very start, text whole as UTF-8 without control characters. In the demo only pictures open
  in the page, and the video and sound of the sample project, which a sandbox cannot upload
  (Safari plays nothing sent as a download); every other file, PDF included, is a download,
  always with a sandboxing policy and `nosniff`.
- **Boards.** In the demo a board past 500 cards or 2 MB becomes read-only, is not saved and is
  not copied into a version or a restore backup; its size is checked as clients change it, not
  only when it is stored. A live message is 1 MB at most and a sandbox makes at most 30 boards,
  so what one sandbox can put in the database is bounded. Elsewhere boards can grow much larger,
  so these caps are the demo's only.
- **Export once.** "Download the project" is the way from the demo to one's own Inkadra: one
  archive per sandbox.
- **The end.** Every minute, and at start, sandboxes past `DEMO_TTL` go with their projects,
  files, archives and sessions: the only data Inkadra deletes on its own. The page shows the
  end; a pill in the header shows the time and space left and warns once five minutes before.
- **For everyone.** Search is limited to 60 queries a minute per person. Spreadsheet cells that
  start with spaces before a formula sign, or with `|`, also get the apostrophe that keeps them
  from running.
- **Deployment.** `deploy/compose.demo.yaml` runs it behind a Cloudflare Tunnel with no open
  port, resource limits on every container, unprivileged users without capabilities, a pinned
  `cloudflared`, Valkey with a password kept off the command line, the database on an internal
  network, and proxy headers trusted only from `cloudflared`'s fixed address.

## Consequences

- The rate limit per address lives in the process: a restart forgets it. Turnstile and the cap
  remain; Cloudflare's own rate limiting rule (docs/demo.md) adds a limit that survives.
- A sandbox can end slightly above its space, as in decision 0081.
- The sample archive must be rebuilt (`e2e/scripts/demo-seed.ts`) when the archive format moves
  past what older archives can be imported as.
- Exact-address user search stays as it is: the demo cannot reach it, and elsewhere it is how
  people share with someone they know.
