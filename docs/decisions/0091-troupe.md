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

The contract and database additions are additive. Existing cast-link and attendance contracts
remain unchanged. Unifying those links requires coordinating board-scoped legacy links with
project-scoped crew (including conflicting links across boards). This is deliberately deferred
as a complete follow-up: no cast-link backfill or attendance source switch is performed here.
Per-day crew calls, call-sheet crew output and phone buttons belong to the next feature.
