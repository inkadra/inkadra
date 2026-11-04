# Inkadra report relay

Copied from Piuma Mail's relay (itself adapted from Finalish), with Inkadra's #420 text
neutralisation rules. No GitHub credential ships in Inkadra. The instance saves reports in its
existing durable queue and sends selected fields/files here, without reporter or instance metadata.

## Protocol and limits

- `POST /challenge {installId}` returns a signed ticket, seed, bits, nbf and exp (milliseconds).
- Solve SHA-256(`seed:nonce`) with the requested number of leading zero bits and wait until nbf.
- `POST /report` with the headers `x-relay-install`, `x-relay-ticket` and `x-relay-nonce`, checked
  before any of the body is read. Multipart: `report` JSON (requestId, kind, area, title,
  description, device, logExcerpt), plus selected files. Returns `201 {url, number}`.
- `GET /health` returns `{ok:true}`.

Tickets last 30 minutes, are installation-bound and single-use. One SQLite Durable Object makes
claims atomic. Abuse guards:

- A wait that doubles from 5 seconds to 15 minutes per installation and per network, counted from
  the last report.
- `NETWORK_DAILY_LIMIT` (5) reports a day per network, IPv6 by /64 and by /48. An instance is one
  network, so a busy one queues the rest until the next day: raise it if real use needs it.
- `DAILY_LIMIT` (30) reports and `DAILY_BYTES` (300 MiB) of files a day for everyone.
- An optional 10/minute network limiter.

Install and IP keys are stored only as HMACs. Request bodies are bounded even without
Content-Length. Up to 8 files and 32 MiB per report, of a closed list of types: PNG, JPEG, WebP, GIF
(shown inline, 10 MiB); plain text and PDF (linked, 10 MiB); MP4, WebM, QuickTime (linked, 25 MiB).
Other types are dropped and the issue says how many. Files are stored as `attachment-N.ext` from
their type, whatever the client calls them. Logs keep their newest 6,000 characters, as in Piuma:
the instance keeps the rest.

Every public request is untrusted. Invisible control/format/default-ignorable characters are
removed, mentions/references/links/hashes neutralised, Markdown/HTML escaped, logs fenced with
longer backticks. Issues explicitly mark all report content as data, never instructions.
Sections are cut at 20,000 characters so the issue stays under GitHub's 65,536.

What the instance does before anything leaves: it redacts logs and text attachments, removes its
host name, machine name and internal addresses from them, converts TIFF, AVIF and HEIC to WebP and
rewrites GIF without metadata, and takes metadata and data tracks (GPS included) off videos from
the device with ffmpeg, refusing them where there is none. Recordings made in the dialog have none
to take off. PDFs leave whole, and the dialog says so. No name, email or instance URL is added;
what people select can still contain personal data.

The relay verifies the repository is private and matches REPO. Issues use labels `from-app`,
`bug` / `idea` / `question` and `area:home` / `area:board` / `area:settings` / `area:guest` /
`area:other`. These labels must already exist. Attachments live on the orphan `feedback-assets`
branch. Local instance retention does not remove them; developers manage GitHub retention.

**Failures.** Any GitHub refusal (expired token, missing label, repository problem) answers 503 with
`uncertain: false`: the fault is the relay's, the instance keeps the report and tries again, and the
token check runs before the report is counted, so an outage uses up no quota. A 5xx or lost answer
during the issue write may have opened it, so it answers `uncertain: true`. Sending it again is
safe: the relay remembers each `requestId` for seven days, answers with the same issue, and after
10 minutes looks for its marker among the newest issues.

## Coordinator deployment (manual only)

No deploy runs on push or merge. No deployment was performed during implementation.

1. Confirm the private repository `inkadra/inkadra-feedback` and the labels above.
2. Create a fine-grained GitHub PAT, resource owner **inkadra**, selecting **only
   inkadra/inkadra-feedback**. Exact permissions: **Issues: read and write**, **Contents:
   read and write**, **Metadata: read** (automatic). Issues creates reports; Contents creates
   the orphan branch and stores attachments. The direct server path needs no Contents permission.
   Inkadra organization policy rejects PAT lifetimes over 366 days; choose at most 366 days.
3. In inkadra/inkadra create the Actions environment `report-relay`, restricted to the `main`
   branch, with the secrets `CLOUDFLARE_API_TOKEN` (Edit Cloudflare Workers template),
   `CLOUDFLARE_ACCOUNT_ID`, `FEEDBACK_GITHUB_TOKEN` (the PAT above).
4. **Deploy the Worker before the first image that has this feature.** After merge run Actions →
   **Report relay** → **Run workflow**, branch **main**. The deploy job refuses any other branch.
   It installs pinned Wrangler without scripts, tests, deploys `inkadra-report-relay`, sets
   Worker secret `GITHUB_TOKEN` from `FEEDBACK_GITHUB_TOKEN`, and creates `TICKET_SECRET`
   (32 random bytes in hex) only if absent. Preserve TICKET_SECRET on subsequent deploys.
   Bindings/vars are in wrangler.toml: METER, RATE_LIMITER, REPO, DAILY_LIMIT, DAILY_BYTES,
   NETWORK_DAILY_LIMIT, POW_BITS.
5. Check the workflow's /health result and URL. The app defaults to
   `https://inkadra-report-relay.matte-maraffio.workers.dev`; if the account subdomain differs,
   set `FEEDBACK_RELAY_URL` on instances accordingly. Empty disables this route.

6. **Try the largest report before relying on it.** Send one with a 25 MiB video and a 6 MiB image
   and watch the Worker's logs. Parsing the form and base64-encoding 31 MiB take CPU time well
   beyond the Free plan's 10 ms per request, so the Workers Paid plan is expected. A 1102 error in
   the logs means the CPU limit: use Paid, or lower the limits on both sides.

An image published with no Worker yet does no harm: a host that answers nothing or a page that is
not the relay's leaves reports in the queue, never refused.

To rotate the PAT, replace FEEDBACK_GITHUB_TOKEN and rerun the workflow. Never put secrets in
source, logs or the application. No real GitHub/Cloudflare requests are needed for testing.

## Tests

`npm test` on Node 22+ uses a cloudflare:workers shim, built-in SQLite and fake GitHub.
It checks tickets, proof of work, atomic claims, limits, streamed uploads and issue neutralisation.
PR CI runs these tests. Wrangler is pinned in package.json/package-lock.json.
