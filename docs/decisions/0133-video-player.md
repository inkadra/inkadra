# 0133 — Inkadra's own video player replaces the browser's controls

Status: accepted, 2026-11-18. Amends [0128](0128-video-renditions.md): the Quality menu moves
from the corner of the viewer into the player's bar, and the card gets it too.

## Context

Videos played with `<video controls>` on cards, in the viewer and for guests. Each browser drew
its own bar, the Quality button of 0128 floated over it in the viewer only, a card could not
choose a quality, and nothing adapted to a card of 300 px on the board: Chrome hid its buttons
at random and showed a full-screen and download menu we could not shape. Keys were the browser's
and fought with the viewer's (the arrows turned the gallery, `,` `.` stepped frames).

## Decision

One player, `VideoPlayer` in `apps/web/src/board/`, everywhere a video plays: the inline card
player, the viewer and the guest viewer. The screen recording in the report form
(`feedback/Feedback.tsx`) keeps the browser's controls: it is a silent preview of a form
attachment, not footage, and has no copies to choose from.

- A dark bar always sits over the video, in both themes, with a gradient under it: the timeline
  (track, loaded part, played part in the accent colour, a thumb, the time under the pointer; no
  thumbnails, the server makes none), then play, mute, time, the Quality chip and, on a card,
  "Open in viewer". The viewer adds frame steps while paused, volume, a timecode it switches to
  m:ss on click, speed, picture in picture and full screen.
- The layout follows the player's own width, measured with a `ResizeObserver`, never the
  window's: under 360 px volume and the total time go and the chip names only the height; a
  viewer under 600 px gets the phone layout (−10 s, play, +10 s in the middle, a short row, the
  Quality menu as a sheet from the bottom).
- Position, buffer and time are painted straight into the page once a frame while playing;
  React state holds only what changes rarely (paused, muted, layout, controls shown), so a
  playing video renders neither its card nor the board again. Scrubbing captures the pointer and
  seeks at most once a frame while the bar follows the finger.
- Keys belong to the focused player: Space/K play, ←/→ 5 s, J/L 10 s, `,` `.` (and ⇧←/→) one frame
  while paused, M mute, F full screen, Q quality. The viewer leaves those to a focused player and
  keeps its own otherwise (G, Escape, the gallery arrows, frame steps when the player is not
  focused). Controls hide after 2 s of playback without the pointer moving, and stay while the
  keyboard is inside the player or the Quality menu is open.

## Consequences

- Picture in picture and full screen are ours to offer; on iPhone, full screen falls back to the
  system player of the video element.
- At far zoom a card's controls shrink with the board like the rest of the card; the layout is
  chosen by the card's own width.
- Browsers' own extras (download, cast, playback speed menus) are gone: guests without downloads
  no longer see a download item where the browser offered one.
