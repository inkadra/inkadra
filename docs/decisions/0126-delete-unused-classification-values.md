# 0126 — Delete a classification value nothing uses

Status: accepted (decided by the maintainer on 2026-11-13). Amends
[0025](0025-classification-catalogs.md) and [0071](0071-storyboard-catalogs.md), which said that
values are archived, never removed. Follows the capability pattern of
[0120](0120-board-writers.md) and [0122](0122-set-plan-sheet-from-the-server.md).

## Context

Settings → Classifications only archives. A value added by mistake (a typo, a test, a duplicate)
stays in the list forever, struck through. Removal was refused so that no project, card or frame
would ever hold an id that no catalog knows. A value that has never been used cannot leave such an
id behind, as long as "never used" is decided safely.

## Decision

**What can be deleted.** A value that was added on this instance (its id is a UUID) and that
nothing uses, active or archived. The defaults (the five project types, the storyboard codes such
as `cu` or `pan`) stay archive-only: their ids are codes that other instances, archives, the
document schema, older clients and the mobile app all know, and a storyboard code is also a word
people type, so its uses cannot be counted.

**What "used" means.** The number of:

- project rows whose `type` is the id, in any state (archived, in the trash);
- rows of `board_element_index` whose `tags` contain the tag's id or its original text (the
  `legacy` binding: free-text tags it adopted count as uses);
- frame rows of `board_element_index` whose `text` contains the storyboard value's UUID (the frame's
  shot, angle and movement are in it as stored; a UUID is never typed by chance).

The index (decision 0012) and the project table are the sources: nothing reads Yjs documents. The
count is one grouped query per catalog, on the GIN indexes of `tags` and `text`. Boards in the
trash keep their index rows until they are removed for good, so they count.

**Race safety.** A save that removes ids takes a new advisory lock, `classification-uses`,
exclusively, then the administration lock (10892) and the revision check as before. Under both it
counts the uses of the removed values and refuses with **409 `conflict`**, `details.reason`
`classification_in_use` and `details.values` (`catalog`, `id`, `uses`) if any is used. Every
write that may add a use holds the same lock shared, from before it reads the removed values until
its commit: the index write (collaboration store, backfill, import). Project creation and changes
already validate the type under 10892. So either the use commits first and the removal sees it, or
the removal commits first and the use sees the removed value.

**Tombstones and late uses.** Some uses reach the server after a removal: an edit not stored yet
(the collaboration server stores every 2–10 s), an undo, an offline copy, a restored board
version, an archive exported earlier. A removed value is therefore kept in `instance_setting`
`classifications_deleted` (catalog, id, label, legacy), never in the API. When an index write or
an import meets one of these ids, the value comes back **archived**, under its own id and name,
and the catalog revision moves on: no board ever keeps an id that no catalog knows. If its name
was taken meanwhile it comes back as "Name (2)"; if its original text was taken it comes back
without the `legacy` binding (the free text belongs to the other value now).

**Never reused.** A new value may not take a removed id (400). A new tag may take a removed tag's
name and so its original text: that is safe because the removed tag had no uses, so no free-text
tag was bound to it, and a late use of its UUID brings it back without the binding, as above.

**API (additive).** `ClassificationOption.uses` is optional. It is filled for administrators on
`GET /instance/classifications?uses=true` and in the `PUT` response, on every value that can be
counted (all project types and tags, storyboard values with a UUID). Plain `GET`, which every
client reads on focus, stays free of the count. Members never get it: counts say where private
projects use a value. It is ignored in a request body and never stored. `GET /instance/version`
advertises `classification-delete`: a client offers Delete only when the server lists it and the
value has `uses: 0`.

**Older clients and the mobile app** never remove ids, so nothing changes for them. A client that
did would get the 409 above for a used value, or the 400 it always got for a default. Tags and
storyboard values chosen offline from a catalog read before a removal come back as described.

**Exports, imports, backups.** `classifications.json` (decision 0037) lists only values in use, so
a removed value never appears in a new archive. An older archive brings it back: the project type
and the tags under their ids (archived), storyboard values as their text, as any value unknown to
the instance does (decision 0071). A backup holds both settings rows and restores them together.

## Consequences

- Settings → Classifications shows a Delete button with a confirmation on unused values added on
  the instance, and "Used N times" on used ones; the removal is saved with the other changes.
- The collaboration server reads one small settings row per stored board and takes a shared lock
  that only a removal ever waits on.
- Tombstones grow by one row entry per removal; removals are rare and entries are small.
- A version restore or undo can make a removed value reappear, archived. This is the price of
  never leaving an unknown id.
