import type { Project } from '@inkadra/shared';
import { refreshBoards, syncRootBoardTitle } from '../board/boards.ts';
import { api } from '../lib/api.ts';

let cache: Project[] | null = null;
let revision = 0;
const listeners = new Set<() => void>();
let loading: Promise<Project[]> | null = null;

function emit() {
  for (const l of listeners) l();
}

export function subscribeProjects(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getCachedProjects(): Project[] | null {
  return cache;
}

export function setCachedProjects(projects: Project[] | null): void {
  revision++;
  loading = null;
  cache = projects;
  emit();
}

/** The sidebar and project landing must not mistake later pages for missing membership. */
export async function loadProjects(): Promise<Project[]> {
  const startedAt = revision;
  const items: Project[] = [];
  let cursor: string | null = null;
  do {
    const page: { items: Project[]; nextCursor: string | null } = await api.get(
      `/projects${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
    );
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  // A rename or session reset must win over an older list response.
  if (revision === startedAt) {
    cache = items;
    emit();
  }
  return items;
}

export async function refreshProjects(): Promise<Project[]> {
  if (loading) return loading;
  const request = loadProjects().finally(() => {
    if (loading === request) loading = null;
  });
  loading = request;
  return request;
}

export async function renameProject(projectId: string, name: string): Promise<Project> {
  const project = await api.patch<Project>(`/projects/${projectId}`, { name });
  revision++;
  if (cache) {
    cache = cache.map((p) => (p.id === projectId ? { ...p, ...project } : p));
  } else {
    cache = [project];
  }
  emit();
  syncRootBoardTitle(projectId, project.name);
  void refreshBoards(projectId);
  return project;
}
