// SPDX-License-Identifier: MPL-2.0
import type * as Y from 'yjs';
import { createElement, DEFAULT_WIDTH, listElements } from '../board.ts';
import { addScenes, frameLetter, type NewScene } from '../film.ts';
import type { Script, ScriptBlock, ScriptScene } from './script.ts';

/** How many frames each scene gets: none, one, or one per action paragraph. */
export type FramesMode = 'none' | 'one' | 'action';
export const FRAME_CAPS = [4, 8, 12, 24] as const;
export type FrameCap = (typeof FRAME_CAPS)[number];
/** Bounds of one import, so a long script cannot bloat a board. */
export const MAX_IMPORT_SCENES = 500;
export const MAX_IMPORT_FRAMES = 1500;
/** Character cards one import creates; the names after these get none. */
export const MAX_IMPORT_CHARACTERS = 200;
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
  /** More than `MAX_IMPORT_CHARACTERS` speak: the others get no card. */
  charactersTruncated?: boolean;
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
        ? [characterLine(scene.characters.slice(0, MAX_IMPORT_CHARACTERS).map(castName))]
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
        const key = name.toLowerCase();
        if (!speakers.has(key) && speakers.size >= MAX_IMPORT_CHARACTERS) {
          plan.charactersTruncated = true;
          continue;
        }
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
  const name = scene.location ? placeName(scene.location.toUpperCase()) : '';
  const tail = extras.map((e) => placeName(e.toUpperCase())).join(', ');
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
  /** Per base, the first letter not tried yet: letters before it are taken, so never retried. */
  const next = new Map<string, number>();
  const free = (base: string, make: (letter: string) => string) => {
    const key = base.toUpperCase();
    for (let i = next.get(key) ?? 0; ; i++) {
      const candidate = make(frameLetter(i));
      if (!taken.has(candidate.toUpperCase())) {
        taken.add(candidate.toUpperCase());
        next.set(key, i + 1);
        return candidate;
      }
    }
  };
  const first = scenes.find((s) => s.number)?.number ?? '1';
  /** The script's own number before the scene, without its letters: after 2A comes 2B. */
  let base: string | undefined;
  const result: string[] = [];
  for (const scene of scenes) {
    if (scene.number) {
      result.push(scene.number);
      // Only a number the script wrote: one made here (XA) would grow by a letter each scene.
      base = scene.number.replace(/(\d)[A-Z]+$/i, '$1');
    } else if (base !== undefined) {
      const before = base;
      result.push(free(`${before}-`, (l) => `${before}${l}`));
    } else {
      // Scenes ahead of the first number go before it: A1, B1.
      result.push(free(`-${first}`, (l) => `${l}${first}`));
    }
  }
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
      el.type === 'character' ? [el.name.trim().toLowerCase()] : [],
    ),
  );
  const fresh = characters.filter((c) => !taken.has(c.name.toLowerCase()));
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
  /** At most `MAX_FRAME_CAST` names, kept in a set: a scene can have thousands of cues. */
  cast: Set<string>;
  notes: string[];
  /** Length of each list once joined: past what `cut` keeps, nothing more is added. */
  size: { action: number; dialogue: number; notes: number };
}
/** What a frame keeps of each text, and what joins its parts. */
const FRAME_TEXT = { action: 2000, dialogue: DIALOGUE_SNIPPET, notes: 4000 };
const JOIN = { action: '\n\n', dialogue: '\n', notes: '\n' };

/**
 * Adds a text to a frame's list while the join is no longer than the frame keeps: past that,
 * `cut` gives the same text whatever follows, and a scene of a million notes stays small.
 */
function gather(d: Draft, field: keyof Draft['size'], text: string) {
  if (d.size[field] > FRAME_TEXT[field]) return;
  d.size[field] += (d[field].length ? JOIN[field].length : 0) + text.length;
  d[field].push(text);
}
const MAX_FRAME_CAST = 30;

/** Every scene gets at least one frame to draw on, even one without action. */
function framesOf(scene: ScriptScene, options: ImportOptions): PlannedFrame[] {
  const drafts: Draft[] = [];
  const empty = (): Draft => ({
    action: [],
    dialogue: [],
    cast: new Set(),
    notes: [],
    size: { action: 0, dialogue: 0, notes: 0 },
  });
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
        if (last && last.action.length === 0 && drafts.length === 1)
          gather(last, 'action', block.text);
        else {
          const d = empty();
          gather(d, 'action', block.text);
          drafts.push(d);
        }
      } else gather(current(), 'action', block.text);
    } else if (block.kind === 'dialogue') {
      const d = current();
      if (d.size.dialogue <= FRAME_TEXT.dialogue) gather(d, 'dialogue', cue(block));
      if (block.character && d.cast.size < MAX_FRAME_CAST) d.cast.add(castName(block.character));
    } else if (block.kind === 'note') gather(current(), 'notes', block.text);
  }
  if (!drafts.length) drafts.push(empty());
  return drafts.map((d) => {
    const frame: PlannedFrame = {};
    if (d.action.length) frame.action = cut(d.action.join(JOIN.action), FRAME_TEXT.action);
    if (d.dialogue.length)
      frame.dialogue = cut(d.dialogue.join(JOIN.dialogue), FRAME_TEXT.dialogue);
    if (options.cast && d.cast.size) frame.cast = [...d.cast].map((c) => cut(c, 80));
    if (d.notes.length) frame.notes = cut(d.notes.join(JOIN.notes), FRAME_TEXT.notes);
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
  if (name !== name.toUpperCase()) return name;
  return name
    .toLowerCase()
    .replace(/(^|[\s\-'’.])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

/** Articles, prepositions and conjunctions of the interface languages, lower case in a name. */
const PARTICLES = new Set(
  (
    'a an and at by for in of on or the to with ' +
    'ai al agli alla alle allo col coi con da dai dal dalla dalle dallo de degli dei del della ' +
    'delle dello di e fra gli i il la le lo nei nel nella nelle nello per su sui sul sulla sulle ' +
    'sullo tra un una uno ' +
    'el las los y ' +
    'au aux des du en et les sur ' +
    'am das der die im und von zum zur ' +
    'as da das do dos em na no nos o os'
  ).split(' '),
);

/** FARO, SCALA A CHIOCCIOLA → Faro, Scala a Chiocciola: a scene name, no title-case "A". */
export function placeName(name: string): string {
  if (name !== name.toUpperCase()) return name;
  // Not the first word of the name or of a part after a comma, nor the last. No lookbehind
  // (decision 0116): the character before the spaces is checked in the whole name. It is taken
  // as a code point and tested without `$`: V8 14 (Node 26) fails `[\p{L}]$` on astral letters.
  return castName(name).replace(
    /(\s+)(\p{L}+)(?=\s)/gu,
    (all, space: string, word: string, at: number, text: string) => {
      const before = [...text.slice(Math.max(0, at - 2), at)].pop() ?? '';
      return /[\p{L}\p{N}]/u.test(before) && PARTICLES.has(word.toLowerCase())
        ? space + word.toLowerCase()
        : all;
    },
  );
}

function cut(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}
