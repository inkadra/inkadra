# 0047 · Remove the Animatic and Sequence modes

Accepted, 2026-10. Supersedes the user interface of [0046](0046-animatic-sound-track.md); its
document, guest and archive contract stays.

**Context.** The storyboard had three modes: Grid, Sequence (the grid in one row) and
Animatic (a timeline player with a sound track). Neither extra mode earned its place: the
Sequence row repeats the grid, and the animatic is a second player next to Present that
needs its own timeline, sound and keyboard model. Both cost screen space in the header of
every storyboard, on phones most of all.

**Decision.**
- The Sequence and Animatic modes are removed with everything that only they used: the mode
  switch and its phone picker, the player, its timeline and sound controls, its Present
  button, the guest "Play animatic" button, styles, translations, shortcuts and tests. The
  storyboard is the grid; Present stays. Nothing stores the chosen mode, so a browser that
  last used Sequence or Animatic opens the Grid.
- **No data is removed.** `meta.animaticAudio` (document version 9) and its schema stay, so
  documents, versions, archives and the guest snapshot read and write as before and older
  documents keep their sound track. No migration, no schema version change.
- The sound track is still a reference to an asset. Nothing collects unused files today (see
  `purgeUploads`), and any cleanup added later must treat `meta.animaticAudio` as a
  reference, as it must for board versions.
- The guest endpoint that streams the sound track (0046) stays in the API contract for now;
  the web client no longer uses it.
- The duration shown for a storyboard (frames without a duration count one second) is kept,
  now in `duration.ts`.

**Consequences.** A later playback feature can read the same `meta.animaticAudio` without a
migration. Until then the field is carried along and not editable.
