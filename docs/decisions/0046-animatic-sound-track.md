# 0046 · Animatic timeline and sound track

Proposed, 2026-10. Extends the storyboard (decisions 0003 and later), guest views (decision
0013) and project archives (decision 0037).

**Context.** The storyboard already plays its frames in order, each for its `durationMs`, in an
Animatic tab and in Present. Directors time an animatic against a temp track or a voice-over:
without sound, durations are guessed. Clients receiving a share link want to watch the cut,
not flip through cards.

**Decision.**
- Document version 9 adds `meta.animaticAudio`: `{ assetId, volume }`, one optional sound
  track per storyboard. The file is an ordinary `audio` asset of the board's project, uploaded
  as any other file; the track starts with the first frame of the storyboard and is not
  trimmed or offset. `volume` (0 to 1) is the level the team mixed and syncs like any edit;
  mute is a choice of each viewer, kept in the browser, never in the document. Migration from
  version 8 changes only the schema version.
- Timeline maths stay in the client: frames in storyboard order, a missing duration previews
  for one second and counts as such in the runtime, dragging a block edge snaps to 0.25 s.
  Reordering on the timeline is the existing frame move (same scene or across scenes), so the
  shot list and the grid follow. No new element field.
- **Guests** of a link to a storyboard can play the animatic read-only. The snapshot carries
  `board.animaticAudio` and the track's file in `assets` with a `streamUrl`
  (`/guest/links/{linkId}/assets/{assetId}/stream`). The stream answers byte ranges inline,
  with no filename and `Content-Disposition: inline`, whether or not the link allows downloads;
  it serves only the asset named by `meta.animaticAudio` of a storyboard of the link, nothing
  else. A determined guest can still record what they hear: streaming is not DRM, it only
  stops Inkadra from offering the file.
- Version restore brings back the sound track of the version with the frames (as `aspect`).
  Archives carry it in `elements.json` next to `aspect`; on import the asset id is remapped
  and a track whose file was skipped is removed, like an optional picture.
- Present plays the same player; MP4 export is out of scope.

**Consequences.** Older builds reject version 9 documents instead of dropping the track on
restore or copy. One new guest endpoint, no database change.
