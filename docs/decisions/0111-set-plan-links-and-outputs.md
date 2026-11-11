# 0111 · Set plan: links in the interface, and its outputs

Proposed, 2026-11. Builds on decision 0104 (the model of set plan v2, its pure link helpers) and
the editor of its later pull requests. The mockup approved on 2026-11-11 (the camera's "Shot from
the storyboard", the actor's "Character", "Sun, for exteriors", the scene chip of the top bar) is
the reference.

## Context

Decision 0104 stored the links of a plan to the cards of the project (`characterId`, `frameId`,
`locationId`, `sceneIds`) and resolved them in pure functions, but nothing in the editor made a
link, the drawing on the board still showed the text typed on the icons, and the shot list and the
schedule did not know which setup a shot belongs to. Matteo asked for links, never copies: a value
that lives on a card is shown live wherever the plan is.

## Decision

**Resolved where it is drawn, never written.** `linkedPlan` (canvas-core) gives the plan as it is
shown: an actor takes the name of the character it plays, a camera without a lens of its own the
lens its frame names. Every drawing of a plan resolves it against the cards of its board as the
reader sees them (`useLinkedPlan` in the web app: the board's store, which for a guest already
holds only what a guest may see), and so do the lists of the editor and the search index. Edits
start from the stored plan, so nothing resolved is ever written: renaming a character renames the
icon on every plan, and the camera's lens is never written back to the frame (decision 0062).

**For each audience, what it may see.** A link resolves only against the cards its reader may
see (decisions 0013 and 0044): the board's store for the editor and the views (for a guest, the
document the server already cut, which also drops a plan's links to cards guests do not get);
for an export, the cards its audience may see (`audienceCards`), so an export for clients and
guests never reads a character, frame or location hidden from them. An actor linked to a card
its reader cannot see shows its own text, else the kind's name.

**Colour follows the character.** Character cards have no colour, so a linked actor takes one of
the eight tag colours by the order of the character cards (oldest first): the same character has
the same colour on every plan, and characters differ until there are more than eight. The tag
colour of a linked actor is not offered in Properties.

**The id only.** Linking stores the id and nothing else; the name is written into the label only
when the link breaks. **A card that goes leaves its text.** Deleting a character or a frame writes, in the same undo
step, the character's name as the label of the actors that played it and the frame's lens on the
cameras that had none of their own (`keptOnDelete`). Unlinking an actor keeps the name as its
label; unlinking a camera keeps its own lens.

**In the editor.** An actor's Properties link it to a character (the cast of the frames of the
plan's scenes proposed first, a typed name still allowed) and show the card: picture or initial,
who plays it, Open the character, Unlink. A camera links to a frame of the plan's scenes (any
frame of the board when the plan has none) and shows its picture, label, shot size, movement and
lens; "Use the frame's lens" drops the plan's own. With nothing selected, the plan links to a
location (proposed from the scenes' location), shown with its setting, address and light notes,
never its contact or notes; the base of a setup holds it. The top bar shows a chip per linked scene,
"Scene 2 · INT · Night", read from the scene card; it opens the scene.

**Sun, for exteriors.** A plan whose scenes are EXT or INT/EXT, or that has a sun icon or a time
set, shows the section; a selected sun shows it too. The plan stores `sun: { time, date? }`
(minutes after midnight, an optional date), optional and additive in schema 23, which is not
released yet. North is the plan's `north`, set by hand on the base. Changing the time, the date or
north turns the plan's sun icons so their beam comes from the sun, in the same step. With a map
link on the linked location the bearing and height are worked out on the device for that place and
date (as sunrise and sunset are in decision 0089); without one the bearing follows the clock alone
(east at six, south at noon, west at six in the evening) and no height is shown. Shortcut: no
position from an address until a geocoder exists; the device's time zone, not the project's.

**Setups and shots.** A setup knows the frames its cameras link to (`setupFrames`): the shot list
shows the setups of each shot as chips and groups by setup among its groupings; the schedule shows
the chips on the shots waiting for a day and on a shot's block. The schedule has no grouping to
choose, so it does not group by setup.

**Search** indexes a plan by the live names of the characters its actors play and of its
location.

## Consequences

- Plans keep their stored text: older builds and exports made before this show what was typed.
- An actor's colour changes when an older character card before it is deleted.
- Outputs (the export dialog and PDF sheet, the read-only view, the card on the board, power in
  the call sheet and the scene sheets) are recorded in the second part of this record.
