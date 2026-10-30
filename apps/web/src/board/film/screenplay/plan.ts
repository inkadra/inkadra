import {
  addScenes,
  createElement,
  DEFAULT_WIDTH,
  frameLetter,
  listElements,
  type NewScene,
} from '@inkadra/canvas-core';
import type * as Y from 'yjs';
import type { Script, ScriptBlock, ScriptScene } from './script.ts';

/** How many frames each scene gets: none, one, or one per action paragraph. */
export type FramesMode = 'none' | 'one' | 'action';
export const FRAME_CAPS = [4, 8, 12, 24] as const;
export type FrameCap = (typeof FRAME_CAPS)[number];
/** Bounds of one import, so a long script cannot bloat a board. */
export const MAX_IMPORT_SCENES = 500;
export const MAX_IMPORT_FRAMES = 1500;
/** A frame's dialogue is a snippet to recognise the moment, not the whole page. */
const DIALOGUE_SNIPPET = 600;

export interface ImportOptions {
  /** Indexes of the script's scenes to import. */
  scenes: ReadonlySet<number>;
  frames: FramesMode;
  maxFrames: FrameCap;
  /** Characters who speak go into the frames' cast; otherwise they are listed in the synopsis. */
  cast: boolean;
  /** A character card for each character who speaks (decision 0044). */
  characterCards: boolean;
}

export interface ImportPlan {
  /** The script's title, for a new storyboard. */
  title?: string;
  scenes: NewScene[];
  frameCount: number;
  /** Scenes or frames were left out to stay within the bounds. */
  truncated: boolean;
  /** Character cards to create: names who speak, with the indexes of their planned scenes. */
  characters: Array<{ name: string; scenes: number[] }>;
}

export function defaultOptions(script: Script): ImportOptions {
  return {
    scenes: new Set(script.scenes.map((_, i) => i)),
    frames: 'action',
    maxFrames: 8,
    cast: true,
    characterCards: false,
  };
}

/**
 * Maps the script onto scenes and frames (decision 0040). Pure: the same plan is shown in
 * the preview counts and written into the document.
 */
export function planImport(
  script: Script,
  options: ImportOptions,
  characterLine: (names: string[]) => string,
  /** Name of the scene made of what comes before the first heading. */
  preludeTitle = '',
): ImportPlan {
  const plan: ImportPlan = { scenes: [], frameCount: 0, truncated: false, characters: [] };
  const speakers = new Map<string, { name: string; scenes: number[] }>();
  if (script.title) plan.title = cut(script.title, 200);
  const numbers = sceneNumbers(script.scenes);
  const chosen = script.scenes
    .map((scene, i) => ({ scene, number: numbers[i] }))
    .filter((_, i) => options.scenes.has(i));
  if (chosen.length > MAX_IMPORT_SCENES) plan.truncated = true;
  for (const { scene, number } of chosen.slice(0, MAX_IMPORT_SCENES)) {
    let frames = options.frames === 'none' ? [] : framesOf(scene, options);
    const room = MAX_IMPORT_FRAMES - plan.frameCount;
    if (frames.length > room) {
      frames = frames.slice(0, Math.max(0, room));
      plan.truncated = true;
    }
    plan.frameCount += frames.length;
    const castInFrames = options.cast && frames.length > 0;
    const synopsis = [
      ...scene.blocks.filter((b) => b.kind === 'synopsis').map((b) => b.text),
      ...(!castInFrames && scene.characters.length
        ? [characterLine(scene.characters.map(castName))]
        : []),
    ].join('\n');
    const planned: NewScene = {
      title: cut(sceneTitle(scene, preludeTitle), 200),
      frames,
    };
    if (number) planned.number = number.slice(0, 12);
    if (scene.setting) planned.setting = scene.setting;
    if (scene.time) planned.time = scene.time;
    if (scene.location) planned.location = cut(scene.location, 200);
    if (synopsis) planned.synopsis = cut(synopsis, 2000);
    if (options.characterCards) {
      for (const who of scene.characters) {
        const name = cut(castName(who), 120);
        const key = name.toLocaleLowerCase();
        const entry = speakers.get(key) ?? { name, scenes: [] };
        entry.scenes.push(plan.scenes.length);
        speakers.set(key, entry);
      }
    }
    plan.scenes.push(planned);
  }
  plan.characters = [...speakers.values()];
  return plan;
}

/** Continuity words of a heading: they say how the scene follows the last, not what it is. */
const CONTINUITY =
  /^(?:CONTINUOUS|CONT(?:'|’)?D|LATER|MOMENTS LATER|A MOMENT LATER|SAME|SAME TIME|CONTINUA|CONTINUAZIONE|PIÙ TARDI|POCO DOPO|STESSO MOMENTO)$/i;

/**
 * The visible name of an imported scene: its location, as a manual scene would be named
 * ("Central Station"). Continuity words are dropped (the board has no field for them); other
 * words after the location (FLASHBACK, DREAM) follow in brackets. A forced heading without
 * INT/EXT is the name itself.
 */
function sceneTitle(scene: ScriptScene, prelude: string): string {
  if (scene.prelude) return prelude;
  if (!scene.setting) return scene.heading;
  const extras = (scene.extra ?? '')
    .split(/\s+[-–—]\s+|\s*[–—]\s*/)
    .map((e) => e.trim())
    .filter((e) => e && !CONTINUITY.test(e));
  const name = scene.location ? castName(scene.location.toLocaleUpperCase()) : '';
  const tail = extras.map((e) => castName(e.toLocaleUpperCase())).join(', ');
  return name && tail ? `${name} (${tail})` : name || tail;
}

/**
 * Scene numbers when the script numbers some of its scenes: theirs are kept, and a scene
 * without one takes the industry's numbering for inserted scenes, the number before it plus a
 * letter (2 → 2A, or 2B when the script has a 2A), or a letter before the next number for a
 * scene ahead of the first one (A1). A script without numbers gets none here: the scenes
 * continue from the board's last scene, as new scenes do.
 */
export function sceneNumbers(scenes: readonly ScriptScene[]): Array<string | undefined> {
  if (!scenes.some((s) => s.number)) return scenes.map(() => undefined);
  const taken = new Set(scenes.flatMap((s) => (s.number ? [s.number.toUpperCase()] : [])));
  const free = (make: (letter: string) => string) => {
    for (let i = 0; ; i++) {
      const candidate = make(frameLetter(i));
      if (!taken.has(candidate.toUpperCase())) {
        taken.add(candidate.toUpperCase());
        return candidate;
      }
    }
  };
  const result: Array<string | undefined> = [];
  scenes.forEach((scene, i) => {
    if (scene.number) {
      result.push(scene.number);
      return;
    }
    // After 2A comes 2B, not 2AA.
    const before = result
      .slice(0, i)
      .findLast(Boolean)
      ?.replace(/(\d)[A-Z]+$/i, '$1');
    const after = scenes.slice(i + 1).find((s) => s.number)?.number;
    result.push(before ? free((l) => `${before}${l}`) : free((l) => `${l}${after ?? '1'}`));
  });
  return result;
}

/** Writes the plan after the existing scenes, as one undoable step. */
export function applyImport(
  doc: Y.Doc,
  plan: ImportPlan,
  opts: { userId: string | null; origin?: unknown },
) {
  let created: ReturnType<typeof addScenes> = [];
  doc.transact(() => {
    created = addScenes(doc, plan.scenes, opts);
    addCharacterCards(doc, plan.characters, created, opts);
  }, opts.origin);
  return created;
}

const CHARACTER_GAP = 20;

/**
 * Character cards in a row above the new scenes, linked to them by scene number. A name that
 * a character card on the board already has, ignoring case, is skipped.
 */
function addCharacterCards(
  doc: Y.Doc,
  characters: ImportPlan['characters'],
  scenes: ReadonlyArray<{ number: string; x: number }>,
  opts: { userId: string | null; origin?: unknown },
) {
  const taken = new Set(
    listElements(doc).flatMap((el) =>
      el.type === 'character' ? [el.name.trim().toLocaleLowerCase()] : [],
    ),
  );
  const fresh = characters.filter((c) => !taken.has(c.name.toLocaleLowerCase()));
  const left = scenes[0]?.x ?? 0;
  fresh.forEach((character, i) => {
    const numbers = [
      ...new Set(character.scenes.flatMap((j) => (scenes[j] ? [scenes[j].number] : []))),
    ].slice(0, 200);
    createElement(
      doc,
      'character',
      { x: left + i * (DEFAULT_WIDTH.character + CHARACTER_GAP), y: -140 },
      { name: character.name, ...(numbers.length ? { scenes: numbers } : {}) },
      opts,
    );
  });
}

type PlannedFrame = NewScene['frames'][number];
interface Draft {
  action: string[];
  dialogue: string[];
  cast: string[];
  notes: string[];
}

/** Every scene gets at least one frame to draw on, even one without action. */
function framesOf(scene: ScriptScene, options: ImportOptions): PlannedFrame[] {
  const drafts: Draft[] = [];
  const empty = (): Draft => ({ action: [], dialogue: [], cast: [], notes: [] });
  const current = () => {
    if (!drafts.length) drafts.push(empty());
    return drafts.at(-1) as Draft;
  };
  for (const block of scene.blocks) {
    if (block.kind === 'action') {
      // Past the cap, the action joins the last frame instead of being dropped.
      if (options.frames === 'action' && drafts.length < options.maxFrames) {
        const last = drafts.at(-1);
        // Dialogue before the first action stays on that frame, which the action describes.
        if (last && last.action.length === 0 && drafts.length === 1) last.action.push(block.text);
        else drafts.push({ ...empty(), action: [block.text] });
      } else current().action.push(block.text);
    } else if (block.kind === 'dialogue') {
      const d = current();
      d.dialogue.push(cue(block));
      if (block.character && !d.cast.includes(castName(block.character)))
        d.cast.push(castName(block.character));
    } else if (block.kind === 'note') current().notes.push(block.text);
  }
  if (!drafts.length) drafts.push(empty());
  return drafts.map((d) => {
    const frame: PlannedFrame = {};
    if (d.action.length) frame.action = cut(d.action.join('\n\n'), 2000);
    if (d.dialogue.length) frame.dialogue = cut(d.dialogue.join('\n'), DIALOGUE_SNIPPET);
    if (options.cast && d.cast.length) frame.cast = d.cast.slice(0, 30).map((c) => cut(c, 80));
    if (d.notes.length) frame.notes = cut(d.notes.join('\n'), 4000);
    return frame;
  });
}

/** `MARA (V.O.): (quietly) We missed it.` */
function cue(block: Extract<ScriptBlock, { kind: 'dialogue' }>): string {
  const who = [block.character, block.extension].filter(Boolean).join(' ');
  return `${who}: ${block.lines.map((l) => l.text).join(' ')}`.trim();
}

/** MARA → Mara, DR. O'NEIL → Dr. O'Neil; names written in mixed case stay as they are. */
export function castName(name: string): string {
  if (name !== name.toLocaleUpperCase()) return name;
  return name
    .toLocaleLowerCase()
    .replace(
      /(^|[\s\-'’.])(\p{L})/gu,
      (_, sep: string, ch: string) => sep + ch.toLocaleUpperCase(),
    );
}

function cut(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}
