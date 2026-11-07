# 0077 — A stale assignee is corrected, not refused

## Context

[Decision 0054](0054-todo-assignments.md) validated new assignees against active project membership
before applying a collaboration update. A refused update closes the document for that client, and
the client resends the same update on every reconnection with all its other edits. Membership
changes while a tab is open or offline, so an ordinary client could assign someone who had just
left and never save anything again. Reloading then lost its unsent work.

## Decision

This supersedes the membership check of 0054. `beforeSync` refuses only what the sender may not do:
assigning as a guest or below editor, or writing a malformed assignee or due date. An item already
stored in that state no longer refuses anything, because the sender did not write it.

`beforeSync` can't change an update, so an assignee who is not a member is corrected once the update
is applied. The server puts back the assignee it replaced, if that person is still a member, or
clears the field, and every client receives the correction. Only updates from clients are corrected.

Read-only connections skip the check: Hocuspocus answers them without applying anything, and closing
them would also stop their live updates.

## Consequences

- No client is blocked by a membership change, and its other edits arrive.
- Other clients can see the assignee for a moment before the correction. Tasks and notifications
  check membership themselves, so a non-member is neither listed nor told.
- The person who picked the stale name sees the assignment revert, without an explanation.
- If the membership query fails, the assignee stays in the document until someone changes it. Tasks
  and notifications still leave that person out.
