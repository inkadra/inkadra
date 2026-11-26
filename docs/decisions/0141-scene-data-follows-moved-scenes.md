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
   `element-data-move` (0120, 0122). Only notifications about a card or its comments (mention,
   reply, comment, review, task assigned) follow it; a link opened or a review submitted stays
   with the board.
2. **Nothing lands where the card no longer is.** The move records each card as moved
   (`element_move`); from then on a comment, reaction, review or pick about it on the old board
   is refused as a card that is not there (404), even before the client removes the card from
   the document. Every such write takes the board row `FOR SHARE` first, so one sent during the
   move waits for it and is then refused, never left behind. Moving the data back lifts the
   refusal on the board the card returns to.
3. **Lock order.** The move takes the project's Production lock (as the adoption of days, 0123),
   the two board rows by id, then only the shooting days it changes, found first and locked by
   id, then the rows about the cards. Schedule saves lock only days, by id, and never wait for a
   board row in a mode the move holds, so the two cannot deadlock.
4. **Days of a board in the trash** are left as they are: their blocks still name the old board,
   where the card is gone, so once restored the day shows the frame or scene by its last seen
   label, as for any card deleted since (0123), until someone picks it again.
5. With the capability, comments, reactions, reviews, picks and shooting days no longer keep a
   scene on the board. The order keeps everything in one place at every step: the copies reach
   the storyboard; the data follows them; only then the scenes leave the board. If the data
   cannot follow, the board keeps the scenes and their copies leave the storyboard again (after
   asking the data back, in case only the answer was lost); if it cannot come back either, the
   copies stay with it. A scene that changed meanwhile and stays on the board takes its data
   back. Right after the removal the move is asked once more, for a comment written on the board
   while the scenes moved.
6. Undo is the same call the other way: the scenes are copied back onto the board, their data
   follows, then the copies leave the storyboard. A comment written in the storyboard after the
   move no longer keeps a scene there; a scene changed there still does. The copy is checked
   again right before its data comes back and once more when it leaves the storyboard: one
   changed meanwhile stays in the storyboard, its data sent back there before its copy leaves
   the board; if that fails, both copies stay, the data with the board's.
   **Every step after the data moved completes or is undone.** When a write to the storyboard
   cannot be confirmed after the data came back, what is still there gets its data sent back and
   its board copy goes; what left it is back. When that cannot be done either, both copies stay,
   and a failure never leaves a scene apart from its comments without saying so: the notice
   names how many scenes are in both places or apart, and whether their comments are with the
   copies here, with those in the storyboard, or (when the server could not answer) to check.
   The storyboard's card leaves the board only once all its scenes are confirmed back. A first
   write that is not confirmed (the copies into the storyboard on a move, or back onto the board
   on Undo) is taken back while the copies are still as written; a copy someone changed
   meanwhile stays, and the notice says where its comments are. A board copy brought back by
   Undo leaves the board again only while as it was put there; a copy kept in the storyboard
   counts by scene and is said, never "nothing changed". A refusal of the server (4xx but 408)
   means the data did not move: nothing is asked back. One move, its planning or its Undo runs
   at a time on a board, for the whole page (a view switch does not reset it); the ⋯ menu entry
   waits meanwhile. Whether a storyboard made for the move is now empty is read from the
   storyboard as the server has it, never from a write it did not confirm.
7. What still keeps a scene on the board: an arrow or plan link to a card that stays, a plan
   whose sun follows a shooting day, a card this version does not fully understand. The notice
   names these.
8. **Guests** (the maintainer's answer, 2026-11-26): their comments, decisions and picks follow
   the card. A guest whose active link does not reach the storyboard no longer sees them, as
   they no longer see the card itself; the notice says so: "N scenes have comments or picks from
   guests whose current link won't reach the storyboard" (the server names those cards in
   `guestsOutOfReach`).
9. **After the review of #1044.** When asking data back to undo a step fails, the notice names
   the side only on a refusal (the data stayed where it was); after no answer, a 408 or a 5xx it
   says to check where the comments are. A copy of a scene changed meanwhile that cannot be taken
   back out of the storyboard (the storyboard could not be read) is said as a scene in both
   places with its comments here, not as a copy changed there. A move of more than
   `ELEMENT_DATA_MOVE_MAX` cards (frames included) is sent in calls of at most that many, one
   after the other. A failed move reports exactly what moved or may have moved: the calls before
   the failing one, plus that one unless the server refused it. Only that is asked back, never a
   call not sent (which could carry data the other board already had, and is refused with 409
   both ways); the notice names the side only when nothing moved.

## Consequences

- `packages/shared` gains `MoveElementData`, `ElementDataMoved`, `ELEMENT_DATA_MOVE_CAPABILITY`
  and `ELEMENT_DATA_MOVE_MAX`; `canvas-core` gains `withChildren` (the cards and their frames,
  as the server keys them), so the mobile app can move commented scenes the same way.
- One new table, `element_move`, kept with the boards; the other rows only change board.
- **Known limit**: when a scene changed on the board during the move and its copy was changed
  in the storyboard too, both stay ("its copy stays there too") and the data goes back with the
  board's; the storyboard's copy then refuses new comments, as a card whose data left. Delete
  that copy, or move the scene again.
