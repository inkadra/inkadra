// SPDX-License-Identifier: MPL-2.0
import type * as Y from 'yjs';
import { keysAt, updateElements } from '../board.ts';
import { addScenes, type NewScene, type SceneElement } from '../film.ts';

/**
 * A new draft of the script laid over the storyboard made from an older one (decision 0082).
 * Pure: the dialog shows the same rows that `applyRevision` writes.
 */

/** The scene fields a draft can change. Frames, drawings and shot data are never touched. */
export const SCENE_FIELDS = ['number', 'title', 'setting', 'location', 'time', 'synopsis'] as const;
export type SceneField = (typeof SCENE_FIELDS)[number];
type SceneFields = Partial<Pick<SceneElement, SceneField>>;

export type RevisionStatus = 'same' | 'changed' | 'new' | 'omitted';

export interface RevisionRow {
  status: RevisionStatus;
  /** Index of the scene in the draft; null for an omitted scene, which the draft no longer has. */
  draft: number | null;
  /** The storyboard's scene it updates; null for a new scene. */
  sceneId: string | null;
  /** Fields of the storyboard's scene the draft changes. */
  changes: SceneField[];
  /** The scene was omitted and the draft has it again. */
  restored?: boolean;
  /** Neither the number nor the heading tell it is the same scene: the person checks it. */
  uncertain: boolean;
  /** A new scene: the draft index of the scene before it, null when it opens the script. */
  after?: number | null;
}

/** Draft index → storyboard scene id, or null for "a new scene": the person's own choice. */
export type MatchOverrides = ReadonlyMap<number, string | null>;

const fold = (s: string | undefined) =>
  (s ?? '')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const words = (s: string) =>
  new Set(
    fold(s)
      .split(' ')
      .filter((w) => w.length > 2),
  );

const wordsOf = (s: SceneFields) =>
  words([s.title, s.location, s.synopsis].filter(Boolean).join(' '));
const dice = (shared: number, x: number, y: number) => (x && y ? (2 * shared) / (x + y) : 0);

/** Dice coefficient of the words of two scenes' heading and synopsis, 0 to 1. */
export function similarity(a: SceneFields, b: SceneFields): number {
  const x = wordsOf(a);
  const y = wordsOf(b);
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return dice(shared, x.size, y.size);
}

/** What two scenes compare, folded once per scene rather than once per pair. */
const placeOf = (s: SceneFields) => fold(s.location || s.title);
const headingOf = (s: SceneFields) => `${placeOf(s)}\u0000${s.setting ?? ''}\u0000${s.time ?? ''}`;

/** Below this a number match whose place also changed is no match; text alone needs the next. */
const LOW = 0.2;
const TEXT_MATCH = 0.3;
const SURE = 0.6;

function changesOf(draft: SceneFields, scene: SceneElement): SceneField[] {
  return SCENE_FIELDS.filter((field) => {
    const a = draft[field] ?? '';
    const b = scene[field] ?? '';
    return field === 'synopsis'
      ? a.replace(/\s+/g, ' ').trim() !== b.replace(/\s+/g, ' ').trim()
      : a !== b;
  });
}

/**
 * Matches the draft's scenes to the storyboard's: by scene number, then by heading (setting,
 * location, time), then by the words of heading and synopsis. What is left of the draft is new;
 * what is left of the storyboard is omitted. Rows follow the draft, with each omitted scene after
 * the row of the scene it followed on the storyboard.
 */
export function matchRevision(
  draft: readonly SceneFields[],
  /** The storyboard's scenes, in order. */
  scenes: readonly SceneElement[],
  overrides: MatchOverrides = new Map(),
): RevisionRow[] {
  const pairs = new Map<number, { scene: SceneElement; uncertain: boolean }>();
  const taken = new Set<string>();
  const decided = new Set<number>();
  const pair = (d: number, scene: SceneElement, uncertain: boolean) => {
    pairs.set(d, { scene, uncertain });
    taken.add(scene.id);
    decided.add(d);
  };
  for (const [d, id] of overrides) {
    const scene = id ? scenes.find((s) => s.id === id) : undefined;
    if (d < 0 || d >= draft.length || (id && (!scene || taken.has(scene.id)))) continue;
    if (scene) pair(d, scene, false);
    else decided.add(d);
  }
  const open = () => draft.flatMap((s, d) => (decided.has(d) ? [] : [{ s, d }]));
  const isFree = (j: number) => !taken.has((scenes[j] as SceneElement).id);

  // Everything compared is read once per scene, in tables local to this call: comparing each
  // draft scene with each storyboard scene stays cheap for a long script on a long board.
  const indexBy = (key: (s: SceneElement) => string) => {
    const lists = new Map<string, number[]>();
    scenes.forEach((s, j) => {
      const list = lists.get(key(s));
      if (list) list.push(j);
      else lists.set(key(s), [j]);
    });
    return lists;
  };
  const byNumber = indexBy((s) => fold(s.number));
  const byHeading = indexBy(headingOf);
  const places = scenes.map(placeOf);
  const sceneWords = scenes.map(wordsOf);
  /** Word → storyboard scenes that have it: only scenes sharing a word are counted. */
  const byWord = new Map<string, number[]>();
  sceneWords.forEach((set, j) => {
    for (const w of set) {
      const list = byWord.get(w);
      if (list) list.push(j);
      else byWord.set(w, [j]);
    }
  });
  /** A draft scene's similarity to every storyboard scene, worked out when first needed. */
  const scores = new Map<number, Float64Array>();
  const scoreOf = (d: number) => {
    let row = scores.get(d);
    if (!row) {
      const own = wordsOf(draft[d] as SceneFields);
      const shared = new Uint32Array(scenes.length);
      for (const w of own) for (const j of byWord.get(w) ?? []) shared[j] = (shared[j] ?? 0) + 1;
      row = new Float64Array(scenes.length);
      for (let j = 0; j < scenes.length; j++)
        row[j] = dice(shared[j] ?? 0, own.size, sceneWords[j]?.size ?? 0);
      scores.set(d, row);
    }
    return row;
  };
  /** The most alike of these scenes, the first one on a tie. */
  const bestOf = (d: number, candidates: Iterable<number>) => {
    const row = scoreOf(d);
    let best: { j: number; score: number } | null = null;
    for (const j of candidates)
      if (!best || (row[j] ?? 0) > best.score) best = { j, score: row[j] ?? 0 };
    return best;
  };
  /** The first free scene with this number; taken scenes stay taken, so each is passed once. */
  const passed = new Map<string, number>();
  const sameNumber = (s: SceneFields) => {
    if (!s.number) return undefined;
    const key = fold(s.number);
    const list = byNumber.get(key) ?? [];
    let at = passed.get(key) ?? 0;
    while (at < list.length && !isFree(list[at] as number)) at++;
    passed.set(key, at);
    return list[at];
  };
  const freeScenes = function* () {
    for (let j = 0; j < scenes.length; j++) if (isFree(j)) yield j;
  };
  const scene = (j: number) => scenes[j] as SceneElement;

  // 1. Number. A number whose location changed and whose text is unlike waits: scenes renumbered.
  for (const { s, d } of open()) {
    const j = sameNumber(s);
    if (j === undefined) continue;
    if (placeOf(s) !== places[j] && (scoreOf(d)[j] ?? 0) < LOW) continue;
    pair(d, scene(j), false);
  }
  // 2. Heading, the most alike when several scenes share it; sure only when it is the only one.
  for (const { s, d } of open()) {
    if (!placeOf(s)) continue;
    const same = (byHeading.get(headingOf(s)) ?? []).filter(isFree);
    // The only scene with this heading needs no score.
    if (same.length === 1) pair(d, scene(same[0] as number), false);
    const best = same.length > 1 ? bestOf(d, same) : null;
    if (best) pair(d, scene(best.j), best.score < SURE);
  }
  // 3. Text alone: number and heading both changed, so the person checks it.
  for (const { d } of open()) {
    const best = bestOf(d, freeScenes());
    if (best && best.score >= TEXT_MATCH) pair(d, scene(best.j), true);
  }
  // 4. The same number, nothing else alike: still more likely the same scene than new + omitted.
  for (const { s, d } of open()) {
    const j = sameNumber(s);
    if (j !== undefined) pair(d, scene(j), true);
  }

  const rows: RevisionRow[] = draft.map((s, d) => {
    const match = pairs.get(d);
    if (!match) return { status: 'new', draft: d, sceneId: null, changes: [], uncertain: false };
    const changes = changesOf(s, match.scene);
    const restored = !!match.scene.omitted;
    return {
      status: changes.length || restored ? 'changed' : 'same',
      draft: d,
      sceneId: match.scene.id,
      changes,
      ...(restored ? { restored } : {}),
      uncertain: match.uncertain,
    };
  });
  // A new scene goes after the draft scene before it.
  for (const row of rows) if (row.status === 'new') row.after = row.draft ? row.draft - 1 : null;
  // Omitted scenes after the row of the nearest matched scene before them on the storyboard,
  // and after the new scenes that go in the same place.
  const rowOf = new Map(rows.flatMap((r, i) => (r.sceneId ? [[r.sceneId, i]] : [])));
  const inserts = new Map<number, RevisionRow[]>();
  scenes.forEach((scene, i) => {
    if (taken.has(scene.id)) return;
    let at = -1;
    for (let j = i - 1; j >= 0 && at < 0; j--) at = rowOf.get(scenes[j]?.id ?? '') ?? -1;
    while (rows[at + 1]?.status === 'new') at++;
    const list = inserts.get(at) ?? [];
    list.push({ status: 'omitted', draft: null, sceneId: scene.id, changes: [], uncertain: false });
    inserts.set(at, list);
  });
  return [-1, ...rows.keys()].flatMap((i) => [
    ...(i >= 0 ? [rows[i] as RevisionRow] : []),
    ...(inserts.get(i) ?? []),
  ]);
}

export interface RevisionOptions {
  /** Number, heading, location, time and synopsis of changed scenes. */
  details: boolean;
  /** Mark scenes the draft left out, and lift the mark from those it has again. */
  omit: boolean;
}

/** What the rows would do with these options, for the summary and the confirmation. */
export function revisionCounts(
  rows: readonly RevisionRow[],
  draft: readonly NewScene[],
  o: RevisionOptions,
) {
  let updated = 0;
  let added = 0;
  let frames = 0;
  let omitted = 0;
  for (const row of rows) {
    if (row.status === 'new') {
      added++;
      frames += draft[row.draft ?? -1]?.frames.length ?? 0;
    } else if (row.status === 'omitted' && o.omit) omitted++;
    else if (
      row.status === 'changed' &&
      ((o.details && row.changes.length > 0) || (o.omit && row.restored))
    )
      updated++;
  }
  return { updated, added, frames, omitted };
}

/**
 * Writes the rows as one undoable step: changed scenes take the draft's fields, new scenes come
 * with their frames after the scene before them, omitted scenes are marked. No frame is changed.
 * `draft` is the import plan of every scene of the draft, in its order.
 */
export function applyRevision(
  doc: Y.Doc,
  rows: readonly RevisionRow[],
  draft: readonly NewScene[],
  /** The storyboard's scenes, in order, before the update. */
  scenes: readonly SceneElement[],
  options: RevisionOptions,
  opts: { userId: string | null; origin?: unknown },
): void {
  doc.transact(() => {
    const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
    for (const row of rows) {
      if (!row.sceneId) continue;
      const patch: Record<string, unknown> = {};
      const from = draft[row.draft ?? -1];
      if (from && options.details) for (const field of row.changes) patch[field] = from[field];
      if (options.omit && row.status === 'omitted') patch.omitted = true;
      if (options.omit && row.restored) patch.omitted = undefined;
      if (Object.keys(patch).length) patches.push({ id: row.sceneId, patch });
    }
    updateElements(doc, patches, opts.origin);

    // New scenes by the gap of the storyboard they go into, in the draft's order.
    const index = new Map(scenes.map((s, i) => [s.id, i]));
    const sceneOf = new Map(rows.flatMap((r) => (r.draft !== null ? [[r.draft, r.sceneId]] : [])));
    const gaps = new Map<number, NewScene[]>();
    let gap = 0;
    for (const row of rows) {
      if (row.draft === null) continue;
      const id = sceneOf.get(row.draft);
      if (id) gap = (index.get(id) ?? scenes.length - 1) + 1;
      else if (row.status === 'new' && draft[row.draft]) {
        const list = gaps.get(gap) ?? [];
        list.push(draft[row.draft] as NewScene);
        gaps.set(gap, list);
      }
    }
    for (const [at, list] of gaps) {
      const created = addScenes(doc, list, opts);
      const keys = keysAt([...scenes], at, created.length);
      updateElements(
        doc,
        created.map((scene, i) => ({ id: scene.id, patch: { z: keys[i] ?? scene.z } })),
        opts.origin,
      );
    }
  }, opts.origin);
}
