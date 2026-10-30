# 0036 — Personal clip destination history

Status: accepted. Implements #67.

## Decision

Confirmed JSON and multipart clips update `clip_board_use(user_id, board_id, used_at)`.
The composite primary key deduplicates destinations. After the collaboration writer confirms
success, a transaction locks the user row, upserts with database wall-clock time and trims
to 20 entries. The lock serializes concurrent clips across replicas. Equal timestamps sort
by board id. The Yjs write and SQL history cannot be one atomic transaction: history errors
are logged without changing a confirmed clip into a failure that might cause duplicates.
Unconfirmed or rejected clips do not update history.

`GET /api/v1/me/clip-boards?limit=1..20` defaults to 20 and returns `ClipBoards`:
`items` of `ClipBoard` (`id`, `projectId`, `title`, `projectName`, `myRole`, `usedAt`).
It checks current access with `boardRoles`, excludes deleted boards and archived projects,
and applies the requested limit after filtering. The first item is the last destination;
there is no separate last-board field. `DELETE /api/v1/me/clip-boards/:boardId` returns 204
idempotently, including after access is lost. Authentication and rate-limit policy match
other inexpensive `/me` board lists (no new route-specific limiter).

The existing Home `/me/recent-boards` remains unchanged: edits by anyone are a different
signal. History is private to the authenticated user, shared across their browsers and
future mobile clients. It retains at most 20 destinations with no time-based expiry;
inaccessible entries remain bounded and hidden, and may reappear if access returns.
Foreign keys cascade on physical user/board deletion. Soft-deleted boards are filtered.
Forgetting removes only the caller's entry and clipping there again records it anew.

## Extension

Use the existing granted instance origin; no new permissions. Refresh on popup/picker and
context-menu/shortcut events. Popup status reads the cache immediately, then adopts the
refreshed default when its picker loads, with a four-second network timeout and cache fallback for
offline and older servers. No polling or persistent worker assumption (MV3). A successful
server response replaces the local list, including an empty response after upgrade: old
browser history is not uploaded. Confirmed clips update the local cache immediately.
An in-flight refresh cannot overwrite a newer local mutation or disconnected account.
Forget removes the cached entry and sends DELETE; failures other than unsupported endpoints
propagate, so a failed remote deletion may reappear at the next successful refresh.
No new interface strings are introduced.
