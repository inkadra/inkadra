# 0083 — Scene sheets by department

## Context

On set each department reads the same scene for different things: camera wants the frames and
the set plan, costume the characters and their looks, production the place, the day and what to
bring. The export had the storyboard, the shot list and the call sheets, but nothing that puts one
scene on one page for one department.

## Decision

- **A new content, not a new dialog.** The export's content list (decision 0038) gains _Scene
  sheets_ on film boards, next to Storyboard and Shot list. Two choices appear with it: the
  department (Everything, Camera, Lighting & grip, Costume & make-up, Production) and the scenes
  (all, a shooting day, or the selected scenes when frames or scenes are selected). Format, paper,
  title page, comments, kickoff summary, call sheets and the audience work as before. The
  production book preset keeps its other options when its content is the scene sheets.
- **Only data the board already has.** A department is a filter over the same sheet, nothing is
  stored for it and there is no schema or API change:
  - camera: the scene's frames (picture, number, size, angle, movement, lens, notes) and the set
    plans linked to the scene (decision 0062), a variant drawn over its base's Set;
  - lighting & grip: the set plans, INT/EXT and time of day, the light notes of the location card
    and the notes of the frames;
  - costume & make-up: the characters in the scene (names in the cast of its frames, and character
    cards that list its number), with the actor, the costume and the references of their card,
    and the previous and next scene each of them is in on this storyboard;
  - production: the location (and the address and notes of its card), the cast with actors, the
    first shooting day that shoots the scene (its call time and the scenes of that day), the typed
    to-do items linked to the scene (decision 0058) and the department entries of its shot blocks.
    An empty field is left out, never printed as a placeholder.
- **One scene per sheet.** A scene starts a page; a long one flows onto more pages under the
  same header. The sheet keeps the light paper of every export and draws its own header (project,
  shooting day, scene, department) and footer (`Inkadra · <audience>` and the page number).
- **Clients.** A client export leaves out what guests do not see (decision 0013) and the whole
  schedule: no call time, no shooting day, no department notes. Choosing a shooting day still
  picks its scenes.

## Consequences

Characters are read from the cards of the storyboard's own board: a character card on another
board shows its name, from the cast of the frames, but not its actor or costume, because the
export reads only the open board's document. The script revision of a scene and the choice to
leave out omitted scenes depend on the script revisions work and are added with it. The department
and the scenes are not remembered with the project's export preferences.

**Omitted scenes** (decision 0082): when the board has some, the dialog shows _Leave out omitted
scenes_ under Scenes, on by default; on, they get no sheet and no continuity line names them.
