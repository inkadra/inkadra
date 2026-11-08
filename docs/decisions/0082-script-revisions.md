# 0082 — Update a storyboard from a revised screenplay

Supersedes the last line of decision 0040 ("re-importing a revised script appends again rather than
merging"). Scripts change while the storyboard is being drawn: a new draft renumbers scenes, adds
some, drops others and rewrites headings and synopses. Appending it again doubled the scenes;
redoing the storyboard lost the drawings.

**Decision.** The screenplay import offers a third choice when the storyboard already has scenes,
_Update from revision_, preselected when the script's title is the storyboard's. It matches the
draft's scenes to the storyboard's ones, in this order:

1. **Scene number.** A number match whose location also changed and whose words are unlike (below
   0.2) waits, because drafts renumber.
2. **Heading**: setting, location and time all equal. When several scenes share it, the one whose
   words are most alike wins, and the person checks it unless it is clearly alike.
3. **Text**: the words of heading and synopsis (Dice coefficient, at least 0.3). Number and heading
   both changed, so the person always checks such a match.
4. **The same number, nothing else alike**, as a last resort and checked by the person.

What is left of the draft is new; what is left of the storyboard is omitted. The dialog lists every
scene as unchanged, changed (with what changed), new (after which scene), omitted or _Check
match_, where the person can pick another scene or "A new scene". The matcher is a pure function
(`revision.ts`), so the dialog and the write use the same rows.

Applying the update never touches frames, drawings or shot data:

- a changed scene takes the draft's number, title, setting, location, time and synopsis (option
  _Update scene details_);
- a new scene is inserted after the scene before it in the draft, with frames as the _Frames_
  option says, through the same `addScenes` as an import;
- an omitted scene gets `omitted: true` and keeps its place and frames (option _Mark omitted
  scenes_); a scene that comes back in a later draft loses the mark;
- before writing, a named version "Before <draft>" is saved with the versions of decision 0013
  (option _Save a version first_); if it cannot be saved, nothing is written;
- everything is one Yjs transaction, undone in one step.

The draft's name comes from the title page (`Draft`, `Revision` or `Draft date`), else the file
name.

**Omitted scenes.** Document version 22 adds an optional `omitted` on scenes, with a no-op
migration from version 21; as with decision 0071, older clients open version 22 documents read-only
and cannot drop the mark. Guests receive it. In the storyboard an omitted scene stays in place,
dimmed, struck through, with an _Omitted_ badge and a menu with _Restore scene_ and _Delete scene
and frames_, which saves a version first. A bar button _Omitted (N)_ shows or hides them for the
person, without saving the choice. Omitted scenes and their frames stay out of the shot list, the
queue of the shooting schedule and exports; frames already placed on a shooting day stay there
until someone moves them, and frame labels do not change.

**Left out.**

- The full text of the script is not stored, so there is no line-by-line comparison of drafts: the
  storyboard only keeps the synopsis, and a changed synopsis reads "synopsis rewritten".
- "Move to another scene…" in the menu of an omitted scene: the storyboard has no action that moves
  frames to a scene picked from a list (frames move by dragging), so it waits for one.
- Marking scenes "revised in Draft 3" until someone looks at them, and revision page colours.
- Including omitted scenes in exports on request.
- The Canvas menu's "Storyboard from screenplay…" still makes a new storyboard: updating one needs
  that storyboard open.
