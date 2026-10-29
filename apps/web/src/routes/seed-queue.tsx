import { useSyncExternalStore } from 'react';
import { ProjectSetupSeed } from './ProjectSetupSeed.tsx';
import type { CreatedSetupBoard } from './project-setup.ts';

/** A board to lay out from a template, or to fill with cards for `links`, once it syncs. */
export interface SeedJob {
  boardId: string;
  seed?: CreatedSetupBoard['seed'];
  links?: CreatedSetupBoard[];
  userId: string;
}

let queue: Array<SeedJob & { id: number }> = [];
let nextId = 0;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
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

/** Mounted once by the app layout. A board that fails to seed stays empty, with its templates. */
export function SeedQueue() {
  const job = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => queue[0],
  );
  if (!job) return null;
  return (
    <ProjectSetupSeed
      key={job.id}
      boardId={job.boardId}
      seed={job.seed}
      links={job.links}
      userId={job.userId}
      done={next}
      failed={next}
    />
  );
}
