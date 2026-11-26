# 0141 · What the server keeps about a scene moves with it

Accepted, 2026-11-26. Extends [0140](0140-scenes-live-in-storyboards.md), which named this step:
the maintainer approved an endpoint and a capability so that scenes with comments move too.

## Context

Under 0140 a scene stays on its board when the server keeps something about it or its frames,
plans and lists, because that data is keyed by board and card and would not follow the cards to
the storyboard. On boards that were reviewed, that kept most scenes where they were.

## Decision

1. `POST /api/v1/boards/{boardId}/element-data/move` (`{ toBoardId, elementIds }`) re-keys, in
   one transaction, what the server keeps about those cards from the board to `toBoardId`:
   comments with their replies (and so their reactions and read marks), reactions on the cards,
   review statuses and their history, guest picks, notifications about the cards, and the
   shooting-day blocks that point at them. Nothing is copied or deleted. It needs editor on both
   boards of one project, and on the board of each shooting day it changes; it moves only what is
   still on the source board, so a retry is harmless, and refuses with 409, moving nothing, when
   the other board already keeps data about one of the cards. Servers advertise
   `element-data-move` (0120, 0122).
2. With the capability, comments, reactions, reviews, picks and shooting days no longer keep a
   scene on the board. The order keeps everything in one place at every step: the copies reach
   the storyboard; the data follows them; only then the scenes leave the board. If the data
   cannot follow, the board keeps the scenes and their copies leave the storyboard again (after
   asking the data back, in case only the answer was lost); if it cannot come back either, the
   copies stay with it. A scene that changed meanwhile and stays on the board takes its data
   back. Right after the removal the move is asked once more, for a comment written on the board
   while the scenes moved.
3. Undo is the same call the other way: the scenes are copied back onto the board, their data
   follows, then the copies leave the storyboard. A comment written in the storyboard after the
   move no longer keeps a scene there; a scene changed there still does.
4. What still keeps a scene on the board: an arrow or plan link to a card that stays, a plan
   whose sun follows a shooting day, a card this version does not fully understand. The notice
   names these.
5. Guests: their comments, decisions and picks follow the card. A guest whose link does not
   reach the storyboard no longer sees them, as they no longer see the card itself.

## Consequences

- `packages/shared` gains `MoveElementData`, `ElementDataMoved`, `ELEMENT_DATA_MOVE_CAPABILITY`
  and `ELEMENT_DATA_MOVE_MAX`; `canvas-core` gains `withChildren` (the cards and their frames,
  as the server keys them), so the mobile app can move commented scenes the same way.
- **Known limit**: a comment written on a scene's old card later than the second call stays on
  the board, about a card that is no longer there, as a comment on any deleted card does.
- No database migration: the rows only change board.
