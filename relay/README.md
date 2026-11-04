# Inkadra report relay

Copied from Piuma Mail's relay (itself adapted from Finalish), with Inkadra's #420 text
neutralisation rules. No GitHub credential ships in Inkadra. The instance saves reports in its
existing durable queue and sends selected fields/files here, without reporter or instance metadata.

## Protocol and limits

- `POST /challenge {installId}` returns a signed ticket, seed, bits, nbf and exp (milliseconds).
- Solve SHA-256(`seed:nonce`) with the requested number of leading zero bits and wait until nbf.
- `POST /report` multipart: `report` JSON (installId, ticket, powNonce, kind, area, title,
  description, device, logExcerpt), plus selected files. Returns `201 {url, number}`.
- `GET /health` returns `{ok:true}`.

Tickets last 30 minutes, are installation-bound and single-use. One SQLite Durable Object makes
claims atomic. Per-install/network waits double from 5 seconds to 15 minutes, a daily global cap
(default 30) and optional 10/minute network limiter slow abuse. Install and IP keys are stored
only as HMACs; IPv6 uses /64. Request bodies are bounded even without Content-Length.
Files/videos: 25 MiB each, 32 MiB total, eight files maximum. Unsupported types are dropped.
Supported types: PNG, JPEG, WebP, GIF, MP4, WebM, QuickTime, plain text and PDF.

Every public request is untrusted. Invisible control/format/default-ignorable characters are
removed, mentions/references/links/hashes neutralised, Markdown/HTML escaped, logs fenced with
longer backticks. Issues explicitly mark all report content as data, never instructions.
The instance redacts diagnostic logs and text attachments before forwarding. No name, email or
instance URL is added; user-selected text/media can still contain personal data.

The relay verifies the repository is private and matches REPO. Issues use labels `from-app`,
`bug` / `idea` / `question` and `area:home` / `area:board` / `area:settings` / `area:guest` /
`area:other`. These labels must already exist. Attachments live on the orphan `feedback-assets`
branch. Local instance retention does not remove them; developers manage GitHub retention.
Error responses from the Worker include `uncertain: false` on 5xx failures before an issue
write, so the server can retry them (including daily caps). Missing confirmation, transport
errors or a failure during the issue write remain ambiguous: the server marks it uncertain for admin reconciliation.
Permanent refusals stop until the administrator saves Settings again.

## Coordinator deployment (manual only)

No deploy runs on push or merge. No deployment was performed during implementation.

1. Confirm the private repository `inkadra/inkadra-feedback` and the labels above.
2. Create a fine-grained GitHub PAT, resource owner **inkadra**, selecting **only
   inkadra/inkadra-feedback**. Exact permissions: **Issues: read and write**, **Contents:
   read and write**, **Metadata: read** (automatic). Issues creates reports; Contents creates
   the orphan branch and stores attachments. The direct server path needs no Contents permission.
   Inkadra organization policy rejects PAT lifetimes over 366 days; choose at most 366 days.
3. Add Actions secrets to inkadra/inkadra: `CLOUDFLARE_API_TOKEN` (Edit Cloudflare Workers
   template), `CLOUDFLARE_ACCOUNT_ID`, `FEEDBACK_GITHUB_TOKEN` (the PAT above).
4. After merge run Actions → **Report relay** → **Run workflow**, branch **main**.
   It installs pinned Wrangler without scripts, tests, deploys `inkadra-report-relay`, sets
   Worker secret `GITHUB_TOKEN` from `FEEDBACK_GITHUB_TOKEN`, and creates `TICKET_SECRET`
   (32 random bytes in hex) only if absent. Preserve TICKET_SECRET on subsequent deploys.
   Bindings/vars are in wrangler.toml: METER, RATE_LIMITER, REPO, DAILY_LIMIT, POW_BITS.
5. Check the workflow's /health result and URL. The app defaults to
   `https://inkadra-report-relay.matte-maraffio.workers.dev`; if the account subdomain differs,
   set `FEEDBACK_RELAY_URL` on instances accordingly. Empty disables this route.

To rotate the PAT, replace FEEDBACK_GITHUB_TOKEN and rerun the workflow. Never put secrets in
source, logs or the application. No real GitHub/Cloudflare requests are needed for testing.

## Tests

`npm test` on Node 22+ uses a cloudflare:workers shim, built-in SQLite and fake GitHub.
It checks tickets, proof of work, atomic claims, limits, streamed uploads and issue neutralisation.
PR CI runs these tests. Wrangler is pinned in package.json/package-lock.json.
