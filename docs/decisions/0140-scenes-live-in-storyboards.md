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
Nothing is deleted without its copy confirmed by the server first.

**Modules.** All of this belongs to the Storyboard module: with it off there is no notice, no
menu entry and no new scene; the loose scenes stay visible and editable.

## Consequences

- `canvas-core` gains `planSceneMove` (which scenes move, which stay and why) so the mobile app
  can offer the same action; no schema change, no API change.
- Moving the server-side data along (so that commented scenes can move too) needs an endpoint and
  a capability (0120, 0122): a later decision, in its own contract pull request.
- The "Storyboard" tour says where scenes are made and gains a card about moving them (0078).
