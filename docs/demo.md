# The public demo

[demo.inkadra.com](https://demo.inkadra.com) lets anyone try Inkadra without an account. This
page has the rules of the demo, for visitors, and how to run one, for whoever hosts it
([decision 0084](decisions/0084-public-demo.md)).

## Rules of the demo

- **"Try the demo" opens a sandbox for one hour**, with a copy of the sample project "Last Train"
  (moodboard, storyboard, shot list, shooting schedule). When the hour is over the sandbox is
  deleted with every file in it. Nobody can bring it back.
- **Up to 100 MB of files, 10 MB each**: pictures (JPEG, PNG, WebP, GIF), PDFs and plain text.
- **Only you see your sandbox.** Sharing, invitations, guest and review links, calendar feeds
  and reports are off. Do not upload personal data or your clients' material.
- **Keep your work** with "Download the project" before the end: one archive per sandbox, which
  you can import into your own Inkadra.
- **No account, no email, no tracking cookies.** The demo sets the session cookie that keeps you
  signed in to your sandbox; Cloudflare Turnstile checks that you are a person.
- Opening many sandboxes, uploading what is not yours or using the demo to host files is not
  allowed: one sandbox per address every ten minutes, and the demo stops taking new ones past
  50 at once.

## Running a demo

`DEMO_MODE=true` turns an instance into a demo. It is off by default and changes nothing for a
server that does not set it. On, the server:

- shows "Try the demo" instead of any sign-in, and lets no one sign in or sign up otherwise:
  there is no administrator to reach from the web;
- answers only what a sandbox needs to work on its own project; everything else of the API
  answers 403 (sharing, members, invitations, guest pages, calendar feeds, feedback, the
  clipper and app tokens, imports, avatars, maps and the whole administration);
- forces what a stranger could abuse off, whatever the environment says: email, the feedback
  relay, maps and address search, playable video copies and RAW, HEIC and PDF previews; it
  enforces the Content Security Policy, caps files at 10 MB and gives each sandbox
  `DEMO_STORAGE` as its storage limit ([decision 0081](decisions/0081-storage-limits.md));
- takes only JPEG, PNG, WebP, GIF, PDF and plain text files, and checks their first bytes;
- caps each board at 500 cards and 5 MB, and live messages at 2 MB;
- deletes every sandbox past `DEMO_TTL` with its project, files and sessions, every minute and at
  start: the only data Inkadra ever deletes on its own.

| Variable             | Default | Meaning                                                                      |
| -------------------- | ------- | ---------------------------------------------------------------------------- |
| `DEMO_MODE`          | `false` | `true` makes this server a public demo                                       |
| `DEMO_TTL`           | `1h`    | How long a sandbox lives (`30m`, `2h`, or seconds)                           |
| `DEMO_STORAGE`       | `100MB` | Space of one sandbox, in powers of 1000                                      |
| `DEMO_MAX_SANDBOXES` | `50`    | Sandboxes open at once; past it, "Try the demo" asks to come back later      |
| `TURNSTILE_SITE_KEY` |         | Cloudflare Turnstile on "Try the demo", checked by the server; set both keys |
| `TURNSTILE_SECRET`   |         |                                                                              |

Without the Turnstile keys the demo starts, and logs an error at every start: anyone, bots
included, can open sandboxes up to the cap. Set them before the demo is public.

The sample project is `apps/server/demo/last-train.inkadra`. Rebuild it after a change to the
archive format or to the sample, against an empty instance that is not a demo:

```sh
SHOTS_BASE_URL=http://localhost:3100 pnpm --filter @inkadra/e2e exec tsx scripts/demo-seed.ts
```

### Behind a Cloudflare Tunnel

`deploy/compose.demo.yaml` runs the demo with no port open on the machine: `cloudflared`
connects out to Cloudflare and brings visitors to Inkadra over the stack's network. It is sized
for a small VM (2 ARM cores, 12 GB of RAM): every container has CPU, memory and process limits,
runs without capabilities it does not need and with a read-only file system, Valkey has a
password, and PostgreSQL and Valkey sit on a network that reaches nothing outside.

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

Inkadra trusts the address `cloudflared` forwards (`TRUST_PROXY=uniquelocal`, the stack's
network) for its own limits, and passes it to Turnstile.
