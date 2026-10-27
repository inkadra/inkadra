# 0024 · Recover deleted elements from saved board versions

Issue #90 adds a desktop Trash tab to board history without new storage, document roots,
endpoints or migrations. The client scans existing versions newest first, across pages,
within the last 30 days. For each element id it retains the most recent saved state and
shows it only while the id is absent from the live document. Reload rescans history;
switching away or closing the dialog stops further requests. Requests are sequential.

This is snapshot recovery, not an audit log: elements created and deleted between saves
cannot be recovered, and snapshot dates are explicitly labelled “last saved”, never as
precise deletion times. Retention and manually removed versions limit recovery. A failed
read leaves a visibly partial list with retry; it never invents elements or dates.

Restore clones only the selected element's Y.Map (including nested rich text, to-do items,
and frame strokes) into the live document. It preserves the id, coordinates, ordering and
privacy fields, never overwrites an existing id, and preserves the parent when that parent
is a live container or the Unsorted column. Otherwise it places the element on the canvas.
Containers and children restore individually; restore the container first to preserve
child placement. Stop UndoManager capture before and after the LOCAL transaction so each
restore is one independent undo step, synchronized through the existing collaboration path.

Authenticated board viewers and commenters can now read version metadata and state using
GET /boards/:boardId/versions, GET /boards/:boardId/versions/:versionId, and the corresponding
/state route. This intentionally makes historical content readable to current board
members, under the same effective board grants as the live document. Guest share links
still have no access to these routes. All version mutations and live element restoration
continue to require editor. The UI also disables restoration when the connection is
read-only. Server-side collaboration authorization remains authoritative.

Deleted sub-boards are not restored: the current board API has deletion but no trash list
or restore endpoint. Restoring a board card restores its link only, not a deleted target
board. The UI explains this. Diff highlighting and creating copies remain separate work.
