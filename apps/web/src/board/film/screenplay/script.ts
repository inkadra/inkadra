import type { SceneElement } from '@inkadra/canvas-core';

/**
 * A screenplay read from a Fountain or Final Draft file, reduced to what a storyboard uses.
 * Both parsers produce this shape; the mapping onto scenes and frames reads only this.
 */
export type ScriptBlock =
  | { kind: 'action'; text: string }
  /** One cue: `lines` alternate spoken text and parentheticals, in the script's order. */
  | { kind: 'dialogue'; character: string; extension?: string; lines: DialogueLine[] }
  | { kind: 'transition'; text: string }
  | { kind: 'note'; text: string }
  | { kind: 'synopsis'; text: string };

export interface DialogueLine {
  text: string;
  parenthetical?: boolean;
}

export interface ScriptScene {
  /** The heading as written, without the scene number. */
  heading: string;
  number?: string;
  setting?: NonNullable<SceneElement['setting']>;
  location?: string;
  time?: NonNullable<SceneElement['time']>;
  /** What follows the time of day or is not one: CONTINUOUS, LATER, FLASHBACK… */
  extra?: string;
  /** The section (Fountain `#`) or act the scene belongs to, if any. */
  section?: string;
  blocks: ScriptBlock[];
  /** Characters with a cue in the scene, by first appearance, without extensions. */
  characters: string[];
}

export interface Script {
  format: 'fountain' | 'fdx';
  /** Title page fields, keys in lower case (`title`, `credit`, `author`, `draft date`…). */
  titlePage: Record<string, string>;
  title?: string;
  scenes: ScriptScene[];
  /** Every character with a cue, by first appearance. */
  characters: string[];
}

export const MAX_SCRIPT_BYTES = 5 * 1024 * 1024;

export class ScriptError extends Error {
  constructor(
    readonly code: 'tooLarge' | 'unsupported' | 'unsafe' | 'invalid' | 'empty',
    message = code,
  ) {
    super(message);
  }
}

const SETTINGS: Array<[RegExp, NonNullable<SceneElement['setting']>]> = [
  // Longest first: INT./EXT. before INT.
  [
    /^(?:INT\.?\s*\/\s*EXT|EXT\.?\s*\/\s*INT|INT\.?\s*\/\s*EST|EST\.?\s*\/\s*INT|I\s*\/\s*E)\.?/i,
    'int-ext',
  ],
  [/^INT(?:ERIOR|ERNO)?\.?/i, 'int'],
  // EST. is "establishing" in Fountain and "esterno" in Italian scripts: both are exteriors.
  [/^(?:EXT(?:ERIOR)?|EST(?:ERNO)?)\.?/i, 'ext'],
];

/** A line that starts a scene without being forced: INT. / EXT. / EST. / INT./EXT. / I/E. */
export const HEADING =
  /^(?:INT\.?\s*\/\s*EXT|EXT\.?\s*\/\s*INT|INT\.?\s*\/\s*EST|EST\.?\s*\/\s*INT|I\s*\/\s*E|INT|EXT|EST)[.\s]/i;

const TIMES: Array<[RegExp, NonNullable<SceneElement['time']>]> = [
  [/^(?:DAWN|SUNRISE|ALBA|MATTINO PRESTO)$/i, 'dawn'],
  [/^(?:DUSK|SUNSET|TWILIGHT|EVENING|TRAMONTO|CREPUSCOLO|SERA)$/i, 'dusk'],
  [/^(?:NIGHT|NOTTE|LATE NIGHT)$/i, 'night'],
  [/^(?:DAY|MORNING|AFTERNOON|NOON|MIDDAY|GIORNO|MATTINA|MATTINO|POMERIGGIO)$/i, 'day'],
];

/** Words after a location that are not part of it. */
const LATER =
  /^(?:CONTINUOUS|LATER|MOMENTS LATER|SAME|SAME TIME|FLASHBACK|CONTINUA|PIÙ TARDI|POCO DOPO)\b/i;

/** `INT. CENTRAL STATION – NIGHT #4A#` → number, setting, location, time and the rest. */
export function parseHeading(raw: string): Omit<ScriptScene, 'blocks' | 'characters'> {
  let heading = clean(raw);
  let number: string | undefined;
  const num = /\s*#([^#\s]{1,12})#\s*$/.exec(heading);
  if (num) {
    number = num[1];
    heading = heading.slice(0, num.index).trim();
  }
  const scene: Omit<ScriptScene, 'blocks' | 'characters'> = { heading };
  if (number) scene.number = number;
  let rest = heading;
  for (const [re, setting] of SETTINGS) {
    const m = re.exec(rest);
    if (!m) continue;
    scene.setting = setting;
    rest = rest.slice(m[0].length).replace(/^[\s.]+/, '');
    break;
  }
  if (!scene.setting) {
    // A forced heading (".THE DREAM"): nothing to split, the whole text names the scene.
    return scene;
  }
  // Parts are separated by dashes; the first one that is a time of day ends the location.
  const location: string[] = [];
  const extra: string[] = [];
  for (const part of rest.split(/\s+[-–—]+\s+|\s*[–—]+\s*/)) {
    const text = part.trim().replace(/\.$/, '');
    if (!text) continue;
    // NIGHT (FLASHBACK): the time, and the rest as an extra.
    const paren = /^(.*?)\s*\(([^)]*)\)$/.exec(text);
    const time = !scene.time && TIMES.find(([re]) => re.test(paren?.[1] ?? text))?.[1];
    if (time) {
      scene.time = time;
      if (paren?.[2]) extra.push(paren[2]);
    } else if (scene.time || (location.length > 0 && LATER.test(text))) extra.push(text);
    else location.push(text);
  }
  if (location.length) scene.location = location.join(' – ');
  if (extra.length) scene.extra = extra.join(' – ');
  return scene;
}

/** Character name for the cast: without extensions, dual-dialogue mark or trailing spaces. */
export function splitCue(raw: string): { character: string; extension?: string } {
  const text = clean(raw).replace(/\s*\^$/, '');
  const m = /^(.*?)\s*((?:\([^)]*\)\s*)+)$/.exec(text);
  const character = (m ? m[1] : text)?.trim() ?? '';
  const extension = m?.[2]?.trim();
  return extension ? { character, extension } : { character };
}

/** Whitespace folded, invisible characters removed. */
export function clean(text: string): string {
  return text.replace(/[​-‍﻿]/g, '').replace(/[ \t]/g, ' ').replace(/ {2,}/g, ' ').trim();
}

/** Collects the characters of each scene and of the script, by first appearance. */
export function finishScript(
  format: Script['format'],
  titlePage: Record<string, string>,
  scenes: ScriptScene[],
): Script {
  const all = new Map<string, string>();
  for (const scene of scenes) {
    const own = new Map<string, string>();
    for (const b of scene.blocks) {
      if (b.kind !== 'dialogue' || !b.character) continue;
      const key = b.character.toLocaleUpperCase();
      if (!own.has(key)) own.set(key, b.character);
      if (!all.has(key)) all.set(key, b.character);
    }
    scene.characters = [...own.values()];
  }
  const title = titlePage.title?.split('\n').map(clean).filter(Boolean).join(' ');
  const script: Script = { format, titlePage, scenes, characters: [...all.values()] };
  if (title) script.title = title;
  return script;
}
