# 0079 — The server checks GitHub for new releases

## Context

Administrators had no way to learn that a new version was out without following GitHub, and no
place in the app that says which version runs and what changed (#515).

## Decision

- **Who asks.** The server, not the browsers: every 6 hours (a maintenance job, and on the first
  read of the Updates page after 6 hours on installs without a worker) it reads
  `api.github.com/repos/inkadra/inkadra/releases`. The request carries no instance data: no
  version, name, address or count. The answer is cached in `instance_setting` (key `updates`),
  so every administrator and every reload read the cache. "Check now" asks again at most once a
  minute.
- **Off switch.** `InstanceSettings.updateCheck` (on by default) stops the requests, the
  notification and the pop-up.
- **Channel.** `updateChannel` is `stable` (default, recommended) or `preview` (release
  candidates too). It only changes what is announced, never the running image: the image is the
  `INKADRA_TAG` of the deployment. Versions are compared with `newerRelease` (SemVer); a running
  version that is not SemVer (an edge build) is never told about updates.
- **Untrusted notes.** Release notes come from outside. The server reduces them to plain text
  (the "Highlights" section, or the merged pull request titles of older releases, and "Read before
  upgrading"), at most 5 and 10 lines of 280 characters, and builds the release link itself from
  the version. The web app renders them as text, never as Markdown or HTML.
- **Telling administrators.** Once per version and channel: an `update_available` notification
  (in-app only) for every active administrator, and a pop-up in the bottom right that does not
  block work, shown once per version per person (`updateSeen`). "Skip this version"
  (`updateSkipped`) also hides the "Available X.Y.Z" hint in the settings navigation for that
  version.

## Consequences

- An instance without internet access shows "Couldn't reach GitHub" on the page and nothing else.
- The texts of the release come in the language of the GitHub notes (English).
