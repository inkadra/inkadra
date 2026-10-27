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
  This predates integration; service-worker behavior was not changed here.
