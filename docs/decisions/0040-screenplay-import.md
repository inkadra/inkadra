# 0040 · Screenplay import: own parsers, read in the browser, mapped onto scenes and frames

Accepted, 2026-10.

**Context.** A storyboard usually starts from a script. Typing every scene heading by hand is
slow and error-prone, and the two formats writers hand over are plain: Fountain (a text
convention, `.fountain`, `.spmd` or `.txt`) and Final Draft's `.fdx` (XML). The research for
0.6 asked for a storyboard laid out from the script without AI. The board document already has
what a script provides: scenes with number, INT/EXT, location, time of day and synopsis, and
frames with action, dialogue, notes and cast (decision 0012).

**Decision.**
- **Our own parsers**, in `apps/web/src/board/film/screenplay`, with no dependency. The
  Fountain libraries we looked at are unmaintained, render HTML (which we would have to
  sanitise and then take apart again) or carry licences we would have to check per release;
  what a storyboard needs is a small subset that is easier to read and test as our own code.
- **Read in the browser only.** The file is never uploaded and the API does not change. The
  client writes the result into the board document like a template (decision 0012), so the
  import works offline and needs nothing from the server.
- **Fountain**: title page keys, scene headings (`INT.`, `EXT.`, `EST.`, `INT./EXT.`, `I/E`,
  in any case, and forced `.HEADING`), scene numbers `#4A#`, action, character cues with
  extensions and dual dialogue `^`, parentheticals, transitions (`TO:`, `>`), sections `#`,
  synopses `=`, notes `[[ ]]`, boneyard `/* */` (dropped), emphasis marks (removed). It is
  lenient where real files are: Windows line endings, a BOM, indentation, a heading without a
  blank line after it. A script without headings becomes one scene. Italian headings
  (`EST.`, `INT./EST.`, `GIORNO`, `NOTTE`…) are read too.
- **Final Draft**: `DOMParser` on the XML, after refusing any `<!DOCTYPE` or `<!ENTITY`, so
  nothing is expanded or fetched; a parser error or another root element is refused. Paragraph
  types map onto the same blocks (`Shot` and `General` count as action), text runs are joined,
  dual dialogue is read in order, the scene summary becomes the synopsis. The title page is free
  text: the first paragraph is the title, the one after "by" / "written by" the author.
- **Bounds**: files up to 5 MB; one import writes at most 500 scenes and 1500 frames, and the
  dialog says when a script was cut.
- **Mapping**, pure and tested (`plan.ts`), so the preview shows exactly what is written:
  - one scene element per selected scene, after the existing scenes and to their right on the
    canvas. Number from the script, or continuing from the last scene. INT/EXT, location and
    time from the heading (MORNING and AFTERNOON count as day, EVENING as dusk); what follows
    (CONTINUOUS, LATER, FLASHBACK) or a forced heading becomes the scene title. Synopsis from
    Fountain synopses or the Final Draft summary.
  - frames, chosen in the dialog: **none**, **one per scene** (all its action, a dialogue
    snippet, every speaker), or **one per action paragraph** (default) with the dialogue and
    notes that follow it, at most 4–24 per scene: past the cap the action joins the last frame
    rather than being dropped. Each scene gets at least one frame to draw on. Dialogue is kept
    as `NAME (EXT.): (parenthetical) line`, cut at 600 characters.
  - **characters**: the board has no cast list, so speakers go into each frame's `cast`, written
    in title case (MARA → Mara). Without frames, or with that option off, they are listed in
    the scene synopsis.
  - transitions and sections are not stored: there is no field for them.
  - the **title page** names a new storyboard, and an unnamed project in the setup. Credit,
    author and dates are only shown in the dialog.
- **One undo step**: appending writes every scene and frame in one Yjs transaction with the
  local origin, between two `stopCapturing()` calls; `addScenes` in `@inkadra/canvas-core`
  reads the document once instead of once per card.
- **Entry points**: the storyboard toolbar and its empty state (append, or a new storyboard
  beside it), the Canvas menu's "Storyboard from screenplay…" (a new storyboard card) and the
  project setup when its template has a storyboard. New storyboards are filled by the seed queue
  once they sync, like templates, and never over existing cards.

**Consequences.** No contract changes: the document schema already had every field. Formats
other than Fountain and FDX (PDF, Celtx, Highland archives) are left out; a writer can export
one of the two from any screenwriting tool. Re-importing a revised script appends again rather
than merging; matching scenes across drafts is a later decision.
