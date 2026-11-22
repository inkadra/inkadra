# 0136 — Kinds of to-do lists in Settings → Classifications

Status: accepted (decided by the maintainer on 2026-11-22). Amends
[0058](0058-needed-items-by-shooting-day.md), which fixed the kinds at three, and extends
[0071](0071-storyboard-catalogs.md) and [0126](0126-delete-unused-classification-values.md) to a
new catalog.

## Context

A to-do list gathers wardrobe, props or equipment for a scene, and the shooting days that shoot
it list what to bring (decision 0058). The three kinds are a fixed enum of the document schema.
Productions need others (make-up, set dressing, catering), and an instance names them its own
way.

## Decision

**A catalog.** `todoLists` joins the classification catalogs, in a third group, Production. It
starts with the three defaults, whose ids stay the codes `wardrobe`, `props` and `equipment`;
like the storyboard values, a default is translated on every client until an administrator
renames it (`shotOptionLabel`, the shared words of decision 0116 now carry `board.todo.lists.*`).
Administrators add, rename, reorder, archive and restore kinds, and delete a kind added on the
instance that nothing uses (0126). The catalog's order is the order of the kinds everywhere: the
to-do card's menu, the scene's To bring, a day's To bring, the call sheet and the scene sheets.
An archived kind leaves the menus but stays, ticked, on the lists that have it.

**Document schema 28.** A to-do card's `list` is a default code or the UUID of a kind added to
the catalog. The migration writes nothing; older clients stay read-only (`WRITER_SCHEMAS[28]`
is 28), since their check would refuse such a card.

**Uses.** The search index puts a kind's UUID first in the to-do card's text, never cut off, so
uses are counted like those of a storyboard value (one grouped query on `board_element_index`
rows of type `todo`), and a late use of a removed kind brings it back archived (0126). The
defaults are never counted or removed.

**API (additive).** `ClassificationCatalogs` and the guests' `shotCatalogs` gain `todoLists`,
which reads as the three defaults when a server leaves it out. `GET /instance/version`
advertises `todo-list-catalog`: the server keeps the catalog, and a `PUT` that leaves
`todoLists` out, as every client before this decision does, leaves it as it is.

**Archives.** `classifications.json` lists the kinds added on the instance that the project
uses (`todoLists`, optional). On import, a kind this instance does not know becomes the kind of
the same name here, or else the list stays an ordinary one whose title, if it had none, is the
kind's name: no card holds a kind its instance does not know.

## Consequences

- The mobile app must read `todoLists` (with the shared `todoListLabel` and `todoListOrder`)
  and accept schema 28 before it can write boards of a server that has this change.
- New kinds take a colour from their id among five tag colours; the defaults keep theirs.
- Settings → Modules is per person (decision 0121): the catalog stays in Settings when the
  Production module is off.
