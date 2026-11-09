# 0085 — Two sample projects in the demo

## Context

The demo (decision 0084) imported one sample project, the short film "Last Train". Inkadra is
also for photographers, and the website's page for them shows a photo shoot, "Low Tide": a
visitor who comes from that page should find it in the demo. The sample's shooting days moved
so that the first one was always today, which suits a film about to shoot but not a photo shoot
whose client is already choosing the pictures.

## Decision

- **Two archives.** A sandbox imports "Last Train", then "Low Tide" (`apps/server/demo/`), both
  rebuilt by `e2e/scripts/demo-seed.ts` and described in `docs/demo-project.md`. `DEMO_SEED`,
  which an operator could already point at another archive, takes a comma-separated list; one
  path works as before. If any import fails, the sandbox goes, as before.
- **Dates.** Every shooting day moves by the days since the archive was exported, from its
  manifest: they stay as far from today as they were then. Last Train, exported on its first
  shooting day, still shoots today; Low Tide was shot two days ago.
- **"Try the demo"** opens the first project. The one export of a sandbox is the project the
  visitor has open, from "Download the project" in the header as from the project's menu.
- Nothing else changes: the same 100 MB, 30 boards, file types and single export per sandbox.
  Both archives together are about 4 MB, inside the sandbox's space.

## Consequences

- Archives carry no share links or guest picks (decision 0037), so the client's proofing of Low
  Tide, made by the seed, does not reach the demo, as Last Train's client review does not;
  the client's comment does, under her name.
- Rebuilding an archive is done in the daytime: the export date is in UTC and the seed's dates
  are local, so near midnight they could differ by a day.
