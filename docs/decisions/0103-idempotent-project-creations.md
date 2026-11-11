# 0103 — Remember offline project, crew member and shooting day creations

Status: accepted. Extends [0098](0098-idempotent-creations.md).

## Context

0098 made board and comment creation safe to retry. A queued client that replays
`POST /projects` after a lost response still creates two projects, and the same holds for
the other plain creations it queues while a project is being planned.

## Decision

The optional `Idempotency-Key` header, its table, scoping per user and endpoint, seven-day
retention, 409 on a changed payload, 400 on an invalid key, checks of authentication,
permissions and rate limits on every attempt, and the replay that reads the resource as it is
now (404 once it is gone) work as in 0098 for:

| Endpoint                                           | Scope                     |
| -------------------------------------------------- | ------------------------- |
| `POST /projects`                                   | `projects`                |
| `POST /projects/{projectId}/crew`                  | `crew:<projectId>`        |
| `POST /boards/{boardId}/schedule` (a shooting day) | `shooting-days:<boardId>` |

They are advertised as the capability `idempotent-project-creations`, covering exactly these
endpoints. The meaning of `idempotent-creations` (boards and comments) does not change, so a
client can tell which creations a server honours.

Checks that depend on the current state of something the new row links to run only when a row
is created, as the comment checks of 0098 do. A crew member linked to an account or a card
is validated in the creation, not before the key is looked up: if the account or card is gone
or the board is out of reach by the time the response-less request is retried, the retry still
answers 201 with the row it made, never 400 for a row that exists. Without a key nothing
changes.

Left out, each for a reason:

- the bulk crew paste skips names already present, so a replay creates nothing new;
- share links return a secret shown once;
- invitations send email and have their own resend;
- named versions and clips follow an outcome-unknown protocol and involve files and the
  collaboration server, not a plain row;
- uploads have tus resumption and `clientAssetId`;
- `POST …/schedule/edit` is a batch of edits with client ids;
- project groups, exports, backups and tokens are not something an offline client queues.

## Consequences

No migration. Old clients behave as before. Requests after expiry may create again. A client
that gets 404 on a retry drops the queued creation.
