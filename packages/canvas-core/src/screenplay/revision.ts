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
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const words = (s: string) =>
  new Set(
    fold(s)
      .split(' ')
      .filter((w) => w.length > 2),
  );

/** Dice coefficient of the words of two scenes' heading and synopsis, 0 to 1. */
export function similarity(a: SceneFields, b: SceneFields): number {
  const text = (s: SceneFields) => [s.title, s.location, s.synopsis].filter(Boolean).join(' ');
  const x = words(text(a));
  const y = words(text(b));
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return (2 * shared) / (x.size + y.size);
}

const sameNumber = (a: SceneFields, b: SceneFields) =>
  !!a.number && fold(a.number) === fold(b.number);
const sameHeading = (a: SceneFields, b: SceneFields) =>
  !!fold(a.location || a.title) &&
  fold(a.location || a.title) === fold(b.location || b.title) &&
  (a.setting ?? '') === (b.setting ?? '') &&
  (a.time ?? '') === (b.time ?? '');
const sameLocation = (a: SceneFields, b: SceneFields) =>
  fold(a.location || a.title) === fold(b.location || b.title);

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
  const free = () => scenes.filter((s) => !taken.has(s.id));

  // 1. Number. A number whose location changed and whose text is unlike waits: scenes renumbered.
  for (const { s, d } of open()) {
    const scene = free().find((e) => sameNumber(s, e));
    if (!scene) continue;
    if (!sameLocation(s, scene) && similarity(s, scene) < LOW) continue;
    pair(d, scene, false);
  }
  // 2. Heading, the most alike when several scenes share it; sure only when it is the only one.
  for (const { s, d } of open()) {
    const same = free().filter((e) => sameHeading(s, e));
    const best = bestOf(s, same);
    if (best) pair(d, best.scene, same.length > 1 && best.score < SURE);
  }
  // 3. Text alone: number and heading both changed, so the person checks it.
  for (const { s, d } of open()) {
    const best = bestOf(s, free());
    if (best && best.score >= TEXT_MATCH) pair(d, best.scene, true);
  }
  // 4. The same number, nothing else alike: still more likely the same scene than new + omitted.
  for (const { s, d } of open()) {
    const scene = free().find((e) => sameNumber(s, e));
    if (scene) pair(d, scene, true);
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

function bestOf(s: SceneFields, candidates: readonly SceneElement[]) {
  let best: { scene: SceneElement; score: number } | null = null;
  for (const scene of candidates) {
    const score = similarity(s, scene);
    if (!best || score > best.score) best = { scene, score };
  }
  return best;
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
