# rc2 UI integration audit (#154)

This integration retains the independent commits from PRs #163–#179. It does not
merge or close those PRs. #164 precedes #167; #170 precedes the mobile navigation
and heading changes in #176/#177. #166 was already the checkout's starting head.

## Findings and decisions

| Surface                          | Finding and resulting behavior                                                                                                                                                                                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account / Notifications          | Email controls were duplicated. Account retains profile/security controls; email preferences live in Notifications.                                                                                                                                                                               |
| Settings classification catalogs | #170's admin-only desktop destination was missing from #176's mobile selector and #177's metadata. Both now identify Classifications, using the existing catalog description; members get no navigation/edit controls and direct access remains forbidden.                                        |
| Home project previews            | #172 passed only shape/color to the glyph, losing #171's emoji. Preserve the complete project icon in the preview fallback.                                                                                                                                                                       |
| Resize / card identity           | #168 duplicated `data-el` on the control layer, breaking card counts (original CI versions test expected 5, received 6). Resize controls now use `data-resize-el`; pointer, double-click and context-menu resolution still find their owning card. Four handles retain zoom-independent geometry. |
| Canvas toolbar / overflow        | #164 keeps the toolbar mounted with overflow. #167 removes only actions represented by toolbar controls. Single/multiple, arrow, locked and read-only branches retain their capability checks; standalone card menus and keyboard shortcuts retain alternative access.                            |
| Project / app context menus      | Local project handlers prevent the bubbling fallback for editors. Viewers/commenters get fallback navigation without appearance actions. Tests now mount the actual project menu inside the actual app fallback for mouse and keyboard precedence. Canvas retains its prevented local menu.       |
| Comments / resize                | Floating element discussions read the rendered card bounds every animation frame, so resize previews, movement and zoom remain their anchor. Board discussions/non-canvas/mobile retain the sidebar. Control layers no longer masquerade as cards.                                                |
| Presentation / film / inbox      | Theme-aware footer and inbox tokens coexist with localized shot/movement labels, single translated counts and responsive scene navigation. No alternative navigation was removed.                                                                                                                 |

The only merge conflicts were additive locale catalogs/appearance/storage keys and
an additive Drizzle import. Both sides were retained. Avatar and project glyph
changes coexist in the UI package. Shared schemas/OpenAPI include avatar,
classification, appearance, preview and storage additions. Migration 0008 retains
its focused SQL/default backfill and matching snapshot/journal; Drizzle generation
reports no schema changes.

## Validation boundaries

Local unit tests and type checks exercise the integrated tree with at most two
workers. No authenticated browser session, full e2e suite, real clipboard
permission check, PostgreSQL migration application or live service mutation was
performed. Database/Valkey-dependent tests skip when their environment is absent.
CI remains necessary before merge, as does the parent's planned independent review.

Original CI failures inspected before integration:
- PR #168, run 40501578591: versions test counted the extra resize wrapper. The
  integration fixes its concrete DOM identity cause and adds a regression test;
  the original e2e flow was not rerun locally.
- PR #165, run 40498435515: review-comments mention text arrived as
  `Schiarire @Giulia Bianchi er favorep`, instead of the expected phrase. This
  predates integration; its root cause is unconfirmed and no speculative fix is made.
- PR #173, run 40525640835: PWA test timed out waiting for `controllerchange`.
  This predates integration; the lifecycle correction below now covers the missed update notification.

## Independent review corrections

The independent review of 3c709ee found three P2 defects, corrected before merge:
- Project PATCH now takes advisory lock 10892 before any project-row lock, matching account deletion.
- Batch tags canonicalize legacy bindings and managed IDs for intersection, additions and removals; unmanaged labels remain intact.
- Avatars now live in a single account-owned `user_avatar` row, replaced transactionally and cascaded on account removal. Migration 0009 adds bounded normalized image ownership instead of writing untracked versioned files. Failed updates roll back image bytes and metadata together; removal clears both. This supersedes PR169's filesystem storage approach before any deployment.

Regression checks: seven avatar validation/lifecycle tests and four catalog UI tests pass; a Chromium touch-layout fixture verifies zoom stays above the two-row toolbar. Server/web types, changed-file Biome and Drizzle schema freshness pass. New lifecycle route tests use a transactional stand-in; actual FK/cascade/concurrency still need PostgreSQL CI.

The first integration CI passed database/unit checks but failed three browser tests: mobile zoom overlap, notification settings reached through the old Account route, and PWA controllerchange timeout. All three now have focused corrections; the new CI run remains a merge gate. The mention reorder failure did not recur in this integration run.


## PWA lifecycle diagnosis and independent P2 recheck

Run 40529755413 timed out in the quiet same-build activation. Its retained trace shows
HTTP 200 for the changed worker and every precache resource, no reload or update
prompt, and the listener installed before the explicit update request. Increasing the
30-second timeout would not repair the missing activation.

`updatefound` is a notification, not a snapshot of the installing worker's state.
By the time its callback runs, the worker can already be installed or moved from
`registration.installing` to `registration.waiting`. The old callback only followed
`installing` and only reacted to subsequent `statechange` events. Neither a past
statechange nor a past updatefound notification is replayed. Registration now observes
both slots and checks the state immediately, once per worker. The worker's caching
and explicit skip-waiting protocol are unchanged. The CI trace does not record these
internal lifecycle events, so it cannot independently prove their exact delivery order;
the isolated reproduction establishes a matching failure mechanism.

The new `pwa-lifecycle.spec.ts` serves real built public files over an ephemeral local
HTTP fixture, without database, credentials or the application server. It delays the
page's updatefound callback until the real Chromium worker is installed/waiting.
With the original registration implementation it times out waiting for controller
replacement; with the fix it passes (about 0.3 seconds). The fixture also runs in the
normal e2e suite. Run independently after `pnpm --filter @inkadra/web build` with
`pnpm --filter @inkadra/e2e exec playwright test --config pwa.config.ts`.
The integration test now captures the previous controller before deployment and waits
for its identity to change, avoiding reliance on observing a transient event.

Independent recheck of the three prior P2 fixes found no concrete remaining defect:
PATCH's advisory lock precedes lockMembers, consistent with account deletion;
batch tag intersection/add/remove canonicalize both legacy bindings and UUIDs while
preserving unmanaged labels; avatar replace/remove serialize on the user row and
atomically update bytes plus metadata, with one primary-keyed row and migration
0009's ON DELETE CASCADE. Route lifecycle/rollback coverage uses a transactional
stand-in, so real PostgreSQL concurrency/cascade remains a CI validation boundary.

Follow-up validation: 39 focused web PWA/catalog tests and seven server avatar tests
pass. A baseline Chromium fixture run fails at controller replacement; the corrected
build passes. The formatting failure in run 40530996849 was an extra Markdown blank
line, also corrected. No full local database/e2e stack, deployment or live migration.

Web, server and e2e TypeScript checks, repository-wide Biome CI and diff whitespace
checks pass on the follow-up. Run 40530996849 (head 1bbd122) subsequently completed:
e2e, canvas performance, image builds/scans and proxy smoke checks passed; lint/types/unit
stopped at the Markdown formatting error before types or unit tests ran. This is
previous-head evidence; new-head CI is pending after push. No GitHub review has yet
been submitted for this follow-up.
