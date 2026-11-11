# 0110 · Set plan: items locked on their own, a project kit across boards, Grip and crew

Proposed, 2026-11. Extends decision 0104 (set plan v2) after the parity decisions Matteo took on
the approved mockup: "Lock" in Properties locks one item, not its layer; the project kit lists the
lights and cameras of every plan of the project; Elements has its own "Grip and crew" group.

## Context

In the editor of decision 0104, Lock in Properties locked the whole layer of the selected item,
the project kit was derived from the plans of the open board only (a `shortcut:` in the code) and
Elements grouped by layer. The mockup (`Main`, `Inspectors`, `Elements`, `Library2`) shows a lock
per item, a kit "for every plan of the project" and the groups Lights, Camera, Actors, Grip and
crew, Set (with the background).

## Decision

**Schema version 24**: one optional field, `locked` (a boolean, true when locked), on every plan
item under the same name: icons, strokes, shapes, walls and openings. The migration changes only
the version; nothing is locked by it. `WRITER_SCHEMAS` gets `24: { min: 24 }`: no test proves
that a client of schema 23 keeps the lock through moves, paste and duplicate, and such a client
would move and delete locked items, so older clients stay read-only (decision 0102's default).
The strict card check and `readElement` know the field through the schema, as every other field.

**What a lock does.** A locked item:

- is drawn as before and can still be picked by a click or from Elements, so it can be unlocked;
  it shows a dashed outline without handles, and a lock in Elements. A box selection and Select
  all leave it out.
- is not moved, turned, resized or edited (its fields in Properties are shown disabled) and not
  deleted. `updatePlanItems` and `updatePlanWalls` leave a locked item as stored, whatever the
  caller sends, except for `locked` itself (`lockAllows`); `removePlanItems` and
  `removePlanWalls` keep locked items. So every write path of the editor respects it, and a
  multi-selection, a group or a nudge moves the free items and leaves the locked ones.
- **is no snap target**: nothing new attaches to it by drag or drop (`snapTarget`). What already
  sits on it stays attached and in place, and may still be moved, pulled off or edited: locking a
  base does not lock what is on it.
- **follows its own base**: an attached item always sits where its base says (decision 0104), so
  a locked modifier, person or camera on a free base is carried when the base moves or turns
  (its x, y and rotation only). Deleting that base leaves the locked item where it is; its `on`
  then points at nothing, which attaches nothing, and an undo of the delete attaches it again.
- is copied with its lock: duplicate, copy and paste keep `locked`, as every field.

The layer lock of decision 0062 stays as it is and wins: an item of a locked layer cannot be
picked at all. Lock in Properties (one item or several) and in the selection's menu toggles the
items' own lock; the layer lock stays in Elements. The editor had no shortcut for the layer lock,
so the item lock has none. Guests and read-only viewers do not edit, so nothing changes for them.

**Project kit across the project.** The kit stays derived, never stored. The open board's plans
give it live; `GET /api/v1/projects/{projectId}/plan-kit?excludeBoardId=` gives the rest: the
server reads the boards the caller can read with the rule of search and of `cast-appearances`
(`readableBoards`: project members see the project, a guest the boards their grant opens, trashed
boards never), the board index (decision 0100) picks the boards that hold a plan, and the same
`projectKit` of canvas-core (moved there from the web) derives each board's entries, merged with
`mergeProjectKits`. A guest of one board learns nothing of the plans of boards they cannot open.
No index column or table: like the cast, the kit is not in the index; the most recently edited 40
such boards are read on each request, and the web keeps the answer a minute (both `shortcut:` in
the code). While it loads, offline, or when the server refuses, the panel lists the open board's
kit and says so; back online it asks again. A share link's guest page asks nothing.

**Grip and crew** is a group of the Elements tab, not a layer of the document: the grip of the
library (cut, diffuse, stands and rigging, power and effects, a modifier on no light) and its
video, sound and crew icons, where they are on their kind's layer (a flag on Lights, the video
village on Camera, a crew member on Actors); an item moved to another layer by hand is listed
with that layer. Its items keep their layer, so exports, setups and the layer locks work as
before. Its eye hides them for the person editing only (as every eye does on a base plan; on a
setup, where the other eyes are stored, this one stays personal: the schema has no such layer to
store); its lock locks or unlocks each of its items on its own. A new layer would have changed
the layer, and so the hiding and locking, of every grip and crew icon of existing plans, and made
plans that hide it unreadable to older clients; a group over the layers gives the mockup's panel
without either.

## Consequences

- Clients of schema 23 and older are read-only on version 24 documents.
- The project kit needs the server: offline it shows the open board only. A project with more
  than 40 boards holding plans shows the kit of the 40 most recently edited until the kit is
  indexed.
- The walls and openings tools (in their own pull request) get `locked` from the model and the
  write functions; their properties panel adds the toggle when the two meet.
