# 0024 · Project setup and personal pins

Proposed, 2026-10.

**Context.** The Projects page needs archived projects, optional production metadata and
personal pins. First-run setup needs linked boards and invitations without a second sharing
or template implementation.

**Decision.** Keep project type and optional shooting dates on `project`. Store pins in
`project_pin`, keyed by project and user with a cascading membership foreign key, consistent
with decision 0004. `PUT /projects/{projectId}/pin` is idempotent and requires membership;
it never changes another person's pins. Metadata updates require editor, archive owner.
Existing list pagination and archived queries remain unchanged. An administrator-only
`GET /instance/storage` reports original asset bytes, explicitly excluding previews and DB.

The web setup uses existing project, board and invitation endpoints. It creates child boards,
then reuses decision 0021's empty-document seeds after editable collaboration sync and waits
for acknowledgement. Root board cards link the children. Storyboard and shot list share one
board/document; the film preset creates six boards including the root, not a second copy of
the frames. Client pitch starts as an empty presentation board and does not publish a guest
link automatically. Invitations are sent only after the board initialization finishes.

**Consequences.** No document format changes. Successful setup steps remain in the mounted
form for retry; the workflow is not an atomic server transaction. Reloading or closing a
partially completed form leaves accessible boards for manual completion; clients must not
claim rollback or guaranteed deduplication after an ambiguous network failure. Existing
projects have no type or dates until set. General project duplication as a reusable template
is deferred; this change does not copy customer content, grants or guest links.
