# 0080 — The server checks GitHub for new releases

## Context

Administrators had no way to learn that a new version was out without following GitHub, and no
place in the app that says which version runs and what changed (#515).

## Decision

- **Who asks.** The server, not the browsers: every 6 hours (a maintenance job, and on the first
  read of the Updates page after 6 hours on installs without a worker) it reads
  `api.github.com/repos/inkadra/inkadra/releases`. The request carries no instance data: no
  version, name, address or count. The answer is cached in `instance_setting` (key `updates`),
  so every administrator and every reload read the cache. "Check now" asks again at most once a
  minute. A failed check is retried after 15 minutes (the job runs that often and does nothing
  while the answer is fresh). Web and worker processes take a database lock before asking and
  read the cache again under it, so one request goes out even in a split deployment.
- **Off switch.** `InstanceSettings.updateCheck` (on by default) stops the requests, the
  notification and the pop-up.
- **Channel.** `updateChannel` is `stable` (default, recommended) or `preview` (release
  candidates too). It only changes what is announced, never the running image: the image is the
  `INKADRA_TAG` of the deployment. Versions are compared with `newerRelease` (SemVer); a running
  version that is not SemVer (an edge build) is never told about updates, lists no earlier
  versions, and the page says it is an edge build (`InstanceUpdates.edge`).
- **Notes in the reader's language.** The release workflow makes `docs/releases/<version>.en.md`
  (those of `X.Y.Z` for an `X.Y.Z-rc.N`) the body of the GitHub release, and attaches every
  `docs/releases/<version>.<lang>.md` as the asset `release-notes.<lang>.md`. When it reads the
  releases, the server downloads the assets of the 10 newest ones for the languages it speaks
  (the email languages), from an address it builds itself on `github.com/inkadra/inkadra`
  (`safeFetch`, at most 256 KiB, redirects only to GitHub's storage), and caches them with the
  release (`InstanceRelease.notes`). Notes already cached for a version are not downloaded again;
  a language that fails is asked again at the next check. The web app shows the reader's
  language, then English, then the body.
- **Never pull request titles.** Their titles are written for developers. A release without
  notes shows no news: the page has only "Read all the news ↗", the pop-up no news lines.
- **Untrusted notes.** Release notes come from outside. The server reduces them to plain text
  (the "Highlights" / "Novità" section and "Read before upgrading" / "Da leggere prima di
  aggiornare"), at most 5 and 10 lines of 280 characters, and builds the release link itself from
  the version. The web app renders them as text, never as Markdown or HTML.
- **Telling administrators.** Once per version, only for a release newer than the last one
  announced (going back from previews to stable stays quiet): an `update_available` notification
  (in-app only) for every active administrator, and a pop-up in the bottom right that does not
  block work, shown once per version per person (`updateSeen`). "Skip this version"
  (`updateSkipped`) also hides the "Available X.Y.Z" hint in the settings navigation for that
  version.

## Consequences

- An instance without internet access shows "Couldn't reach GitHub" on the page and nothing else.
- The texts of the release come in the languages its notes are written in (Italian and English
  today); readers of other languages get the English ones.
- Releases published before this change have no assets: they show news only once the assets are
  uploaded by hand (`gh release upload`), otherwise just the link.
