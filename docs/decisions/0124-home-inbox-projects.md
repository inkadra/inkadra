# 0124 · One top bar, one row and one card for Home, Inbox and Projects

Accepted, 2026-11-12. The maintainer approved the mockup kept in
[0124/home-inbox-projects.html](0124/home-inbox-projects.html) (dark theme, desktop). It is the
reference for layout and copy; light theme and phones follow the same structure with the existing
tokens. Polishing under the 0.9 → 1.0 feature freeze: nothing new beyond what is listed here.

## Context

The three screens a person sees first had grown apart: a different top bar on each, a narrow
column in the middle of the Home, four kinds of rows for tasks and notifications, uppercase labels,
a project card that read "Dates to be confirmed" when nothing was planned and the same brown tint
for every project without a cover. "New board" sat on the Home without a project, although a
board always belongs to one.

## Decision

- **One top bar** on Home, Inbox and Projects: New project (primary), feedback, the bell. Boards
  are created inside a project (its menu, the sidebar, the search, the phone's New sheet); the
  Home no longer has New board.
- **One row** (`ListRow` in `packages/ui`) for a task and a notification: a lead (unread dot,
  checkbox, avatar), who and what, an optional preview, the project glyph with where, and the
  time or due date.
- **One card** (`CoverCard`) for a recent board and a project: cover with the element count, an
  optional menu, glyph and name, one meta line, a footer. Without a cover, the project's own
  colour and glyph.
- Section titles are sentence case (`.ink-section-title`), not uppercase labels.
- **Home** has two columns: Continue (the latest board large, three small) on the left, My tasks
  and the last 24 hours of activity on the right, under one summary line.
- **Inbox**: tabs All (with the unread count), Mentions, Approvals, Tasks; days with their weekday;
  Mark all as read heads the list. Several in-app reports of one day fold into one row that
  unfolds; only the view changes. The detail has one header row (breadcrumb, state, Refresh as an
  icon, Open in board, Mark as resolved in a quiet green, the `positive` button variant), the
  card's context, the conversation, and the reply pinned at the bottom.
- **Projects**: the storage note moves up into the subtitle; search, filters (the label inside the
  control), sort and the grid/list switch share one row.

## Consequences

- A reply keeps the visibility of its thread (API: `visibility` is ignored for replies), so the
  composer says it in a label ("Also guests" or "Internal note") instead of the switch drawn in
  the mockup: a switch that can never change would promise a choice that does not exist.
- The Home's tour points its last step at New project in the top bar.
- No API, schema or document change.
