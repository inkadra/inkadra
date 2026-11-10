# 0091 — Project crew (Troupe)

## Context

Accounts and free-text cast names do not describe a production crew. Projects need a private,
ordered roster with departments, roles, contact details, default pick-up and optional links.
The approved Troupe mockup defines a grouped list, inspector and sheet-paste preview.

## Decision

Store crew in `crew_member`, separate from collaborative board documents. The API lives under
`/projects/{projectId}/crew`. Active project viewers can read; editors can write. Board-only
grants do not disclose the project roster. Outsiders receive 404. Guest sessions and share
links have no crew endpoint. Guest documents, project archives and client PDFs do not include
this table. Phone numbers and notes remain private team data.

Use whole-row optimistic revisions: updates and deletes require the version read, and stale
writes receive 409. The inspector preserves the draft and offers reload or keep mine. Bulk
pastes validate every row before one transaction, skipping case-insensitive duplicate names.
Departments and roles are free text; existing project departments are suggestions only.
Character references retain a board and element id; actor and contact are read from the live
board document, never copied into the roster.

## Consequences

The contract and database additions are additive. Per-day crew calls, call-sheet crew output and
phone buttons belong to the next feature ([0092](0092-day-calls.md)).

**Cast links merged into the crew** (follow-up). A crew row is the single link from a person to an
account: the board-scoped `cast_link` table is no longer read. Each old link is merged once, when
the database migrations run, under an advisory lock: into the project's row with that name or
character (the stored key is lower case, so a new row takes the name as the day's blocks write
it, or the card's actor), else into a new row in Cast. A row already linked to somebody else
keeps its link and the old link gets a row of its own, so no link is lost; conflicting links of
one name on several boards become several rows to tidy in Troupe. Merged links are marked
(`merged_at`), not deleted. Personal calls, presence answers, the reset of answers when a call
moves and the presence panel all read the cast names of crew rows: the row's name and its
character card's, on any board of the project. `PUT …/schedule/cast-links` stays for older
clients and the presence panel; it now links (or adds) the crew row and needs a project editor.
`GET …/schedule/attendance` returns the links derived from the crew: every link to project
members who edit the schedule, only the caller's own to anyone else, since a grant on one board
does not disclose the roster.
