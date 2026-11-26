# 0140 · Scenes live in storyboards

Accepted, 2026-11-26. Extends [0121](0121-board-types.md) (board types and modules). The
maintainer chose direction C of the design for in-app report 28 ("scenes live in the storyboard;
on the board stays the storyboard's card") and answered its four open questions.

## Context

Since 0121 a storyboard is not a board to draw on, and frames on an ordinary board no longer
bring the film views. A `scene` (0012) could still be made on an ordinary board, from the canvas
menu, the command palette or a screenplay import with Storyboard off. There it is a column that
grows by about 165 px for each frame, overlaps the scenes beside it and opens in none of the
film views: people asked why it is not a storyboard.

## Decision

1. **No loose scenes on an ordinary board.** "New scene in the storyboard…" in the canvas menu
   and in the command palette creates the scene in a storyboard of the project and opens it
   there: the only one, or the one picked when there are several. A project without one gets a
   new storyboard, its card where the menu was opened. A single frame stays a card of the board,
   as a reference. The old canvas of a storyboard ("Cards outside the storyboard") still adds
   scenes where it is, since that is the storyboard.
2. **Existing loose scenes move, never copy.** A board with scenes shows once per person a notice
   "N scenes are outside a storyboard" with "Move to a storyboard" and "Not now"; the board's ⋯
   menu keeps the same action. Moving copies each scene with its frames (drawings, pictures,
   fields), its set plans and its scene lists into the storyboard, after its last scene with
   their numbers as they are, then removes them from the board and puts the storyboard's card
   where they were, as one step that Undo in the notice takes back (Ctrl+Z does not: the two
   boards are two documents). The board's versions keep what was there.
3. **Which storyboard.** With several, the dialog lists them with the one this person opened last
   chosen, and "New storyboard", named after the section heading above the scenes. With one, or
   none (a new one), it does not ask.
4. **Screenplay import with Storyboard off** still puts the scenes on the board, and the one
   notice of 0121 offers Turn on; Turn on moves those scenes into a new storyboard named after
   the script. Otherwise they stay as today.

**What does not move, stays.** What the server keeps by board and card does not follow a card to
another board: comments, reactions, review decisions, guest picks and the shooting days that
point at a frame or a scene. A scene with any of these on it or on its frames, plans or lists, or
tied by an arrow or a plan link to a card that stays, or holding a card this version does not
fully understand (0101), stays on the board; the notice and the dialog say how many and why.

**Nothing is lost while it moves, or when it comes back** (decided in the reviews of the first
pull request, 2026-11-26):

- A scene leaves the board only once the server has its copy, and only as it was copied: each
  scene, with its frames, plans and lists, is compared with a print taken when it was copied, in
  the same transaction that removes it. A scene a colleague changed meanwhile, or added a frame
  to, stays on the board ("changed while moving: try again"), and its copy leaves the storyboard
  again unless that copy was changed there too, in which case both stay.
- A colleague's change still on its way when the scene left (Yjs cannot hold an update in
  flight) is not refused: the board is watched for ten seconds after the removal, and what
  reaches a removed card follows it to the storyboard (fields, drawn strokes and shapes, a frame
  added to the scene). The notice says so; a part that cannot follow (a new list of its own) is
  named, with the scene to check. The same holds for Undo, the other way round.
- Undo brings back a scene only while its copy in the storyboard is as the move left it and has
  no comments, reactions, reviews, picks or shooting days there; the others stay in the
  storyboard and the notice says how many. They come back where they were, or, when cards stand
  there now, together with their layout kept, in the nearest free space, above the other cards.
  The storyboard's card leaves the board only when every scene came back.
- Neither the move nor Undo deletes or trashes a board. A storyboard made for the move that ends
  up empty stays, and the notice says "“Name” is now empty: you can delete it".

**Known limit.** A colleague's change that reaches a removed card more than ten seconds after the
removal, or a change to a card deleted for any other reason, is lost as when any card is deleted
while someone edits it: the last writer wins.

**Modules.** All of this belongs to the Storyboard module: with it off there is no notice, no
menu entry and no new scene; the loose scenes stay visible and editable.

## Consequences

- `canvas-core` gains `planSceneMove` (which scenes move, which stay and why), `cardPrints` and
  `unitUnchanged` (what changed meanwhile), `copyCards` and `placesBack` (cards as stored, back
  where they were or in the nearest free space) and `watchRemoval` with `applyLateEdits` (a late
  change follows the card), so the mobile app can offer the same action; no schema change, no
  API change. `watchRemoval` reads Yjs internals, pinned by its tests.
- Moving the server-side data along (so that commented scenes can move too) needs an endpoint and
  a capability (0120, 0122): approved by the maintainer as the next step, in its own contract
  pull request.
- The "Storyboard" tour says where scenes are made and gains a card about moving them (0078).
