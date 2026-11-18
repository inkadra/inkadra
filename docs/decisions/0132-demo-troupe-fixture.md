# 0132 — The demo's Troupe comes from a file next to each sample

## Context

Inkadra 0.10 puts the shooting days and the Troupe on a project's Production board (0123), and
the demo should show both. Project archives carry the days but, on purpose, neither the crew nor
the per-person day calls (0091, 0092): phone numbers and notes are private team data. The demo
also answered 403 to every crew route, so a sandbox showed an empty Troupe it could not fill.

## Decision

Each sample archive in `apps/server/demo/` may have a `<name>.crew.json` beside it: the crew rows
(no account, a character named by its board's title and its card's id) and the day calls (by the
day's date and call, and the row's name). `e2e/scripts/demo-seed.ts` writes it from the sample it
exports; the people in it are invented, with `example.com` addresses. The server reads it only in
`createSandbox`, after importing the archive and before the days move to today, and writes the
rows and calls into that sandbox's project. Archives and ordinary exports stay as 0091 says.

The demo allowlist opens the crew routes (read, add, paste, edit, merge, delete). They already
answer only project members, so a sandbox reaches its own projects only. In the demo:

- a row links only an account that is a member of its project, never another sandbox's;
- a project holds at most 200 crew rows (`DEMO_MAX_CREW`), counted after each write under the
  lock every crew insert takes, cast links from the schedule included (409, `demo_limit`).

## Consequences

A sandbox shows and edits the samples' Troupe, call sheets list the crew with their calls, and the
phone list works. Rebuilding the samples rewrites the crew files with the archives. Email stays off
in the demo and invitations stay closed, so a crew row reaches nobody.
