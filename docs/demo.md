# The public demo

[demo.inkadra.com](https://demo.inkadra.com) lets anyone try Inkadra without an account. This
page has the rules of the demo, for visitors, and how to run one, for whoever hosts it
([decision 0084](decisions/0084-public-demo.md)).

## Rules of the demo

- "Try the demo" opens a sandbox for one hour, with copies of two sample projects: the short film
  "Last Train" (moodboard, storyboard, shot list, shooting schedule) and the photo shoot
  "Low Tide" (moodboard, shot list by look, the day of the shoot, the selects). When the hour is
  over the sandbox is deleted with every file in it, for good.
- You can upload up to 100 MB of files, 10 MB each: pictures (JPEG, PNG, WebP, GIF), PDFs and
  plain text. Do not upload personal data or your clients' material.
- Only you see your sandbox. Sharing, invitations, guest and review links, calendar feeds and
  reports are off. The sample clients' decisions and picks are there to read, but their links no
  longer open.
- "Download the project" saves the project you have open as an archive, once per sandbox, which
  you can import into your own Inkadra. "Start over" deletes your sandbox at once, after asking.
- No account, no email, no tracking cookies. The demo sets a session cookie for your sandbox, and
  Cloudflare Turnstile checks that you are a person.
- Opening many sandboxes, uploading what is not yours or hosting files is not allowed. Each
  address opens one sandbox every ten minutes, the demo takes at most 50 at once, and a sandbox
  has at most 30 boards.

## Running a demo

`DEMO_MODE=true` turns an instance into a demo. It is off by default and changes nothing for a
server that does not set it. On, the server:

- shows "Try the demo" instead of any sign-in, and lets no one sign in or sign up otherwise:
  there is no administrator to reach from the web;
- answers only what a sandbox needs to work on its own project; everything else of the API
  answers 403 (sharing, members, invitations, guest pages, calendar feeds, feedback, the
  clipper and app tokens, imports, avatars, maps, link previews and the whole administration):
  a link card keeps its address without a title or picture, and the server fetches nothing for
  a sandbox;
- forces what a stranger could abuse off, whatever the environment says: email, the feedback
  relay, maps and address search, playable video copies and RAW, HEIC and PDF previews; it
  enforces the Content Security Policy, caps files at 10 MB and gives each sandbox
  `DEMO_STORAGE` as its storage limit ([decision 0081](decisions/0081-storage-limits.md));
- takes only JPEG, PNG, WebP, GIF, PDF and plain text files, and checks their bytes: pictures by
  their signature, a PDF by its header at the very start, text as valid UTF-8 without control
  characters; only pictures open in the page, with the video and sound of the sample project
  (a sandbox cannot upload them), any other file is a download;
- caps each board at 500 cards and 2 MB, checked as it changes, and live messages at 1 MB: a
  board past a cap turns read-only, is not saved and is not copied into a version; a sandbox
  makes at most 30 boards;
- deletes every sandbox past `DEMO_TTL` with its project, files and sessions, every minute and at
  start: the only data Inkadra ever deletes on its own.

| Variable             | Default | Meaning                                                                      |
| -------------------- | ------- | ---------------------------------------------------------------------------- |
| `DEMO_MODE`          | `false` | `true` makes this server a public demo                                       |
| `DEMO_TTL`           | `1h`    | How long a sandbox lives (`30m`, `2h`, or seconds)                           |
| `DEMO_STORAGE`       | `100MB` | Space of one sandbox, in powers of 1000                                      |
| `DEMO_MAX_SANDBOXES` | `50`    | Sandboxes open at once; past it, "Try the demo" asks to come back later      |
| `DEMO_SEED`          |         | Archives each sandbox imports, comma-separated; the two sample projects      |
| `TURNSTILE_SITE_KEY` |         | Cloudflare Turnstile on "Try the demo", checked by the server; set both keys |
| `TURNSTILE_SECRET`   |         |                                                                              |

In production (`NODE_ENV=production`, as in the image) the demo does not start without the
Turnstile keys. In development and tests it starts and logs an error: anyone, bots included,
could open sandboxes up to the cap. The server accepts a Turnstile answer only for the host of
`PUBLIC_URL` and the widget's own action. Each address (an IPv6 /64 counts as one) opens one
sandbox every ten minutes and has five refused attempts (a failed check, a full demo) in the
same time.

The sample projects are `apps/server/demo/last-train.inkadra` and `low-tide.inkadra`
([the demo projects](demo-project.md), [decision 0085](decisions/0085-two-demo-projects.md)),
imported in that order; "Try the demo" opens the first. Their shooting days keep the distance
from today they had when the archive was exported. Rebuild them after a change to the archive
format or to a sample, in the daytime, against an empty instance that is not a demo; add
`last-train` or `low-tide` to rebuild one:

```sh
SHOTS_BASE_URL=http://localhost:3100 pnpm --filter @inkadra/e2e exec tsx scripts/demo-seed.ts
```

### Behind a Cloudflare Tunnel

`deploy/compose.demo.yaml` runs the demo with no port open on the machine: `cloudflared`
connects out to Cloudflare and brings visitors to Inkadra over the stack's network. It is sized
for a small machine: every container has CPU, memory and process limits,
runs as an unprivileged user without capabilities and with a read-only file system, Valkey has a
password (given as configuration on standard input, never on a command line), and PostgreSQL and
Valkey sit on a network that reaches nothing outside. `cloudflared` is pinned to a release
(2026.10.7); move it on after reading its release notes.

1. In Cloudflare Zero Trust, create a tunnel (Networks → Tunnels → Create, "Cloudflared") and
   copy its token. Add a public hostname, `demo.example.com`, to the service
   `http://inkadra:3000`.
2. In Turnstile, add a widget for that hostname ("Managed") and copy its site key and secret.
3. In `.env`, next to the usual `PUBLIC_URL=https://demo.example.com`, `AUTH_SECRET` and
   `POSTGRES_PASSWORD`:

   ```sh
   CLOUDFLARE_TUNNEL_TOKEN=…
   VALKEY_PASSWORD=…        # openssl rand -hex 32
   TURNSTILE_SITE_KEY=…
   TURNSTILE_SECRET=…
   ```

4. Start it:

   ```sh
   docker compose -f compose.yaml -f deploy/compose.demo.yaml up -d
   ```

5. In the Cloudflare dashboard of the zone, worth turning on: Bot Fight Mode; a rate limiting
   rule on `/api/v1/demo/sandbox` (a few requests every ten minutes per address); a cache rule
   that bypasses the cache on `/api/` and `/collab`. WebSockets must stay on (Network).

Inkadra and `cloudflared` share the `edge` network, which also reaches the internet: Inkadra
uses it for Turnstile and the update check (it fetches nothing else for a sandbox). Inkadra
trusts proxy headers only from `cloudflared`, at a fixed address (`TRUST_PROXY=172.31.250.2`,
on the subnet `172.31.250.0/29`, with Inkadra fixed at `172.31.250.3` so it cannot take that
address; change them together if the subnet is taken). Cloudflare
appends the address it saw, the one it also sends as `CF-Connecting-IP`, to `X-Forwarded-For`,
and Inkadra takes that last entry: a visitor cannot pick their address by writing the header
themselves. Do not publish a port of the `inkadra` container or attach other containers to
`edge`. That address is what the limits count and what goes to Turnstile.
