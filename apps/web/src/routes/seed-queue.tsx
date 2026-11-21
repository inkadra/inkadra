import type { BoardCount } from '@inkadra/shared';
import { lazy, Suspense, useSyncExternalStore } from 'react';
import type { ImportPlan } from '../board/film/screenplay/plan.ts';

/**
 * A board to fill from an imported screenplay once it syncs.
 */
export interface SeedJob {
  boardId: string;
  screenplay?: ImportPlan;
  userId: string;
}

export type SeededCounts = Omit<BoardCount, 'boardId'>;

let queue: Array<SeedJob & { id: number }> = [];
let nextId = 0;
// Counts of boards seeded here, for the navigation until the server has stored them.
let seeded: ReadonlyMap<string, SeededCounts> = new Map();
// Boards open in a Canvas, whose synced doc is newer than anything the server has stored.
const live = new Set<string>();
// Boards closed since, by when: their local counts hold until the server has stored them.
const released = new Map<string, number>();

/**
 * How long a closed board's counts may differ from the server's before the server's win. The
 * collaboration server stores a board within 10 s of its last edit (`maxDebounce` in apps/server
 * collab.ts), but a store that fails is retried, up to a minute apart: only counts that match
 * ours say the board was stored. Past this, someone else most likely changed it since.
 * shortcut: a store still failing after this shows the server's older counts until it succeeds;
 * upgrade to a notice when a board is stored if that matters.
 */
export const RELEASED_HOLD_MS = 120_000;

/** The board closed and its local counts still stand in for the server's. */
export const holdsReleasedCounts = (boardId: string) => released.has(boardId);
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/**
 * Screenplay imports run one connection at a time, so the work continues when the person
 * opens the storyboard straight away.
 */
export function queueSeeds(jobs: SeedJob[]) {
  if (jobs.length === 0) return;
  queue = [...queue, ...jobs.map((job) => ({ ...job, id: nextId++ }))];
  emit();
}

const next = () => {
  queue = queue.slice(1);
  emit();
};

const seededDone = (boardId: string) => (counts?: SeededCounts) => {
  if (counts) seeded = new Map(seeded).set(boardId, counts);
  next();
};

/** Counts of the boards seeded in this session, by board. */
export function useSeededCounts(): ReadonlyMap<string, SeededCounts> {
  return useSyncExternalStore(subscribe, () => seeded);
}

const sameCounts = (a: SeededCounts, b: SeededCounts) =>
  (Object.keys(b) as (keyof SeededCounts)[]).every((key) => a[key] === b[key]);

/**
 * Counts of the board open in a Canvas, taken from its synced doc: imports, grabbed frames and
 * added or deleted frames show in the navigation at once, not when the server has stored them.
 */
export function setLiveCounts(boardId: string, counts: SeededCounts) {
  const previous = seeded.get(boardId);
  live.add(boardId);
  released.delete(boardId);
  if (previous && sameCounts(previous, counts)) return;
  seeded = new Map(seeded).set(boardId, counts);
  emit();
}

/**
 * The Canvas closed: the local counts last until counts from the server match them, or were
 * asked for once it must have stored the edits (forgetSeededCounts).
 */
export function releaseLiveCounts(boardId: string) {
  live.delete(boardId);
  if (seeded.has(boardId)) released.set(boardId, Date.now());
}

/**
 * The server stores a board a couple of seconds after its last edit, so counts fetched when
 * a seed finishes can still be empty: seeded boards keep their local counts until the server
 * reports elements on them. Boards open in a Canvas, and closed ones until the server has
 * caught up (forgetSeededCounts), show the counts of their doc.
 */
export function mergeSeededCounts(
  server: ReadonlyMap<string, BoardCount>,
  local: ReadonlyMap<string, SeededCounts>,
): Map<string, BoardCount> {
  const merged = new Map(server);
  for (const [boardId, counts] of local)
    if (live.has(boardId) || released.has(boardId) || !server.get(boardId)?.elementCount)
      merged.set(boardId, { ...server.get(boardId), boardId, ...counts });
  return merged;
}

/**
 * Drops local counts the server has caught up with: a seeded board once it has elements there,
 * a closed one once its counts there match, or once they were asked for (`askedAt`) past
 * `RELEASED_HOLD_MS` after it closed. Only boards in `server` are judged: counts of another
 * project say nothing about them. True when it dropped any.
 */
export function forgetSeededCounts(
  server: ReadonlyMap<string, BoardCount>,
  askedAt: number = Date.now(),
) {
  const caughtUp = (id: string, counts: SeededCounts) => {
    const there = server.get(id);
    const closedAt = released.get(id);
    if (closedAt === undefined) return !!there?.elementCount;
    if (!there) return false;
    // Counts stored by an older server may lack the newer kinds: only those it has compare.
    const matches = (Object.keys(counts) as (keyof SeededCounts)[]).every(
      (key) => there[key] === undefined || there[key] === counts[key],
    );
    return matches || askedAt >= closedAt + RELEASED_HOLD_MS;
  };
  const stored = [...seeded].filter(([id, counts]) => !live.has(id) && caughtUp(id, counts));
  if (stored.length === 0) return false;
  const rest = new Map(seeded);
  for (const [id] of stored) {
    rest.delete(id);
    released.delete(id);
  }
  seeded = rest;
  emit();
  return true;
}

// The board connection and store load with the first seed, not with every page (#774).
const ProjectSetupSeed = lazy(async () => ({
  default: (await import('./ProjectSetupSeed.tsx')).ProjectSetupSeed,
}));

/** Mounted once by the app layout. A board that fails to import stays empty. */
export function SeedQueue() {
  const job = useSyncExternalStore(subscribe, () => queue[0]);
  if (!job) return null;
  return (
    <Suspense fallback={null}>
      <ProjectSetupSeed
        key={job.id}
        boardId={job.boardId}
        screenplay={job.screenplay}
        userId={job.userId}
        done={seededDone(job.boardId)}
        failed={next}
      />
    </Suspense>
  );
}
