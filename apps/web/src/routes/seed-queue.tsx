import type { BoardCount } from '@inkadra/shared';
import { useSyncExternalStore } from 'react';
import type { ImportPlan } from '../board/film/screenplay/plan.ts';
import { ProjectSetupSeed } from './ProjectSetupSeed.tsx';
import type { CreatedSetupBoard } from './project-setup.ts';

/**
 * A board to lay out from a template or an imported screenplay, or to fill with cards for
 * `links`, once it syncs.
 */
export interface SeedJob {
  boardId: string;
  seed?: CreatedSetupBoard['seed'];
  screenplay?: ImportPlan;
  links?: CreatedSetupBoard[];
  userId: string;
}

export type SeededCounts = Omit<BoardCount, 'boardId'>;

let queue: Array<SeedJob & { id: number }> = [];
let nextId = 0;
// Counts of boards seeded here, for the navigation until the server has stored them.
let seeded: ReadonlyMap<string, SeededCounts> = new Map();
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
 * Boards inserted from the Canvas menu are seeded here, one connection at a time as in the
 * project setup, so the work continues when the person opens one of them straight away.
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

/**
 * The server stores a board a couple of seconds after its last edit, so counts fetched when
 * a seed finishes can still be empty: seeded boards keep their local counts until the server
 * reports elements on them.
 */
export function mergeSeededCounts(
  server: ReadonlyMap<string, BoardCount>,
  local: ReadonlyMap<string, SeededCounts>,
): Map<string, BoardCount> {
  const merged = new Map(server);
  for (const [boardId, counts] of local)
    if (!server.get(boardId)?.elementCount) merged.set(boardId, { boardId, ...counts });
  return merged;
}

/** Drops local counts the server has caught up with. */
export function forgetSeededCounts(server: ReadonlyMap<string, BoardCount>) {
  const stored = [...seeded.keys()].filter((id) => server.get(id)?.elementCount);
  if (stored.length === 0) return;
  const rest = new Map(seeded);
  for (const id of stored) rest.delete(id);
  seeded = rest;
  emit();
}

/** Mounted once by the app layout. A board that fails to seed stays empty, with its templates. */
export function SeedQueue() {
  const job = useSyncExternalStore(subscribe, () => queue[0]);
  if (!job) return null;
  return (
    <ProjectSetupSeed
      key={job.id}
      boardId={job.boardId}
      seed={job.seed}
      screenplay={job.screenplay}
      links={job.links}
      userId={job.userId}
      done={seededDone(job.boardId)}
      failed={next}
    />
  );
}
