import { addScenes, type NewScene } from '@inkadra/canvas-core';
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
}

export interface ImportPlan {
  /** The script's title, for a new storyboard. */
  title?: string;
  scenes: NewScene[];
  frameCount: number;
  /** Scenes or frames were left out to stay within the bounds. */
  truncated: boolean;
}

export function defaultOptions(script: Script): ImportOptions {
  return {
    scenes: new Set(script.scenes.map((_, i) => i)),
    frames: 'action',
    maxFrames: 8,
    cast: true,
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
): ImportPlan {
  const plan: ImportPlan = { scenes: [], frameCount: 0, truncated: false };
  if (script.title) plan.title = cut(script.title, 200);
  const chosen = script.scenes.filter((_, i) => options.scenes.has(i));
  if (chosen.length > MAX_IMPORT_SCENES) plan.truncated = true;
  for (const scene of chosen.slice(0, MAX_IMPORT_SCENES)) {
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
      title: cut(scene.extra ?? (scene.setting ? '' : scene.heading), 200),
      frames,
    };
    if (scene.number) planned.number = scene.number.slice(0, 12);
    if (scene.setting) planned.setting = scene.setting;
    if (scene.time) planned.time = scene.time;
    if (scene.location) planned.location = cut(scene.location, 200);
    if (synopsis) planned.synopsis = cut(synopsis, 2000);
    plan.scenes.push(planned);
  }
  return plan;
}

/** Writes the plan after the existing scenes, as one undoable step. */
export function applyImport(
  doc: Y.Doc,
  plan: ImportPlan,
  opts: { userId: string | null; origin?: unknown },
) {
  return addScenes(doc, plan.scenes, opts);
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
