# Release checklist

What a version must pass before the Release workflow runs on it, release candidates included.
Most of it is automated: the **All checks** job of CI fails when any gate below failed, and the
Release workflow tags only a commit of `main` whose CI passed. The rest is done by hand on the
release candidate (`X.Y.Z-rc.N`) and recorded in the issue or discussion of the release.

## Automated (CI on every pull request, `main` and tag)

| Gate | Job | What it proves |
| --- | --- | --- |
| Lint, types, unit and server tests | `tests` | Code, migrations from an empty database, restores of a backup made by the same build |
| Migration locks | `tests` (`db/migration-locks.test.ts`) | No new migration blocks a table without a stated reason |
| Older database refused | `tests` (`db/client.test.ts`) | A server does not start on a database a newer version migrated |
| End-to-end, Chromium | `e2e` | The product in a browser |
| Firefox and WebKit smoke | `e2e-browsers` | The main paths in Firefox and WebKit (Safari's engine) |
| Upgrade from the last release | `release-upgrade` (`scripts/test-release-upgrade.sh`) | The last release's data (sample projects with files, schedule, a saved version) after the upgrade: rows, file bytes, every board opening in the collaboration server |
| Restore of the last release's backup | `release-upgrade` | A backup of the last release restored by this version, newer migrations applied on real rows |
| Rollback | `release-upgrade` | The last release restores its own backup into a new database (docs/self-hosting/upgrades.md#going-back-to-an-older-version) |
| PostgreSQL 16 to 18 | `postgres-upgrade` | The database upgrade of the guide, both ways, and its rollback |
| Reverse proxies, data folder owner | `proxy`, `data-dir` | The deployment files of the repository |
| Image vulnerabilities | `scan` | No fixable high or critical vulnerability |
| Every published image starts | `publish` (tags and `main`) | amd64 and arm64, standard and `-office`, each started and scanned before it is tagged |
| Release notes present | Release workflow | `docs/releases/X.Y.Z.en.md` exists; without it the workflow stops before tagging |

## By hand, on the release candidate

1. **Release notes** in every language of `docs/releases/` (at least `en` and `it`), with a
   "Read before upgrading" section for anything an administrator must do, and the matching
   section in `docs/self-hosting/upgrades.md`.
2. **A copy of a real instance**: restore a recent backup of a long-running instance on the
   previous release, upgrade it to the candidate, open a few large boards, play a video, download
   an original. Large tables are what the CI data does not have: note how long the migrations
   took in the log (`database migrations applied`).
3. **Its backup on the candidate**: restore that same backup with the candidate into an empty
   database and repeat the checks of step 2.
4. **Guest link on iOS Safari** (a real phone): open a client review link, comment, pick.
5. **Office preview** on the `-office` image: upload a `.docx` and a `.pptx`, check the preview.
6. **Mobile app**: the current store version signs in and opens a board on the candidate.

Write down in the release issue or discussion which candidate each step ran on and what was
found. A step skipped is written down as skipped, with the reason.
