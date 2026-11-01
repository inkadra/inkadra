# 0054 — To-do assignments and due dates

## Context

Board to-do items need optional project-member assignments, calendar due dates and a personal
list across projects (#304). The approved design uses existing people and date fields.

## Decision

Document schema 12 adds optional `assigneeId` and `dueDate` to each item. Dates are ISO calendar
dates, interpreted in the viewer's local calendar. Existing items remain unchanged. Collaboration
updates validate new assignees against active project membership before they are applied;
notification creation checks the actor's editor access and recipient membership again.

`GET /me/tasks` reads stored documents in active projects, checks board visibility and returns
open items assigned to the caller. Home and the Inbox task filter share the same list. The
list may lag live edits by the normal document storage debounce. There is no new database table
or migration: items remain in Yjs and notification types are stored as text.

Assignment notifications are Inbox only until per-type email settings (#302) exist. They use
the existing permission filtering and self-notification suppression. Export and backups retain
the document fields. Project import remaps assignees to the importer, like existing author ids;
it never matches people by email or assigns an unrelated local account.

## Consequences

No materialized task index or scheduled overdue emails are introduced. The initial personal
query decodes documents of the caller's active projects; introduce an index if measurements on
large projects justify one. Notifications are best effort after storage, as other notifications.
