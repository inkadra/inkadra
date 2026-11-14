import {
  type CreateProjectGroup,
  comparePosition,
  type Project,
  type ProjectGroup,
  type UpdateProjectGroup,
} from '@inkadra/shared';
import { useEffect, useSyncExternalStore } from 'react';
import { api } from '../lib/api.ts';
import {
  getCachedProjects,
  refreshProjects,
  setCachedProjects,
  subscribeProjects,
} from './projects.ts';

/** The person's own project groups (decision 0056), shared by the sidebar and the Projects page. */
let cache: ProjectGroup[] | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(groups: ProjectGroup[] | null) {
  cache = groups;
  for (const l of listeners) l();
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function refreshGroups(): Promise<void> {
  loading ??= api
    .get<{ items: ProjectGroup[] }>('/project-groups')
    .then((body) => set(body.items))
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** The groups, loaded on first use; empty until they arrive. */
export function useProjectGroups(enabled = true): ProjectGroup[] {
  const groups = useSyncExternalStore(subscribe, () => cache);
  useEffect(() => {
    if (enabled && !cache) void refreshGroups().catch(() => {});
  }, [enabled]);
  return groups ?? [];
}

// Signing out empties the project list: the last person's groups go with it.
subscribeProjects(() => {
  if (!getCachedProjects() && cache) set(null);
});

/**
 * A move into a group, or a reorder or fold, that could not be saved (#776). The shell says
 * so for a while, wherever the drop happened; the next save that works clears it.
 */
let saveFailed = false;
let saveFailedTimer: ReturnType<typeof setTimeout> | undefined;
function setSaveFailed(value: boolean) {
  clearTimeout(saveFailedTimer);
  if (value) saveFailedTimer = setTimeout(() => setSaveFailed(false), GROUP_ERROR_MS);
  if (saveFailed === value) return;
  saveFailed = value;
  for (const l of listeners) l();
}
export const GROUP_ERROR_MS = 8000;
export const reportGroupError = () => setSaveFailed(true);
export const useGroupSaveFailed = () => useSyncExternalStore(subscribe, () => saveFailed);

export async function createGroup(input: CreateProjectGroup): Promise<ProjectGroup> {
  const group = await api.post<ProjectGroup>('/project-groups', input);
  set([...(cache ?? []), group]);
  return group;
}

export async function updateGroup(id: string, patch: UpdateProjectGroup): Promise<void> {
  const before = cache;
  // Folding answers at once; a failed save puts the list back.
  if (patch.collapsed !== undefined)
    set(cache?.map((g) => (g.id === id ? { ...g, collapsed: !!patch.collapsed } : g)) ?? null);
  try {
    const group = await api.patch<ProjectGroup>(`/project-groups/${id}`, patch);
    if (patch.before !== undefined) await refreshGroups();
    else set(cache?.map((g) => (g.id === id ? group : g)) ?? null);
    setSaveFailed(false);
  } catch (error) {
    set(before);
    throw error;
  }
}

/** Dissolves the group: its projects stay, outside any group. */
export async function dissolveGroup(id: string): Promise<void> {
  await api.delete(`/project-groups/${id}`);
  set(cache?.filter((g) => g.id !== id) ?? null);
  await refreshProjects();
}

/** Puts the project in a group (before `before`, else last) or, with null, out of it. */
export async function moveToGroup(
  projectId: string,
  groupId: string | null,
  before?: string,
): Promise<Project> {
  const project = await api.put<Project>(`/projects/${projectId}/group`, { groupId, before });
  setSaveFailed(false);
  const projects = getCachedProjects();
  if (projects) setCachedProjects(projects.map((p) => (p.id === projectId ? project : p)));
  return project;
}

/** Fractional indexes compare as plain strings, never by locale. */
const byPosition = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export interface Grouped<T> {
  loose: T[];
  groups: { group: ProjectGroup; items: T[] }[];
}

/**
 * Splits a list into the projects outside any group, in the order given, and the groups in
 * their order with their projects in theirs. A group that is not known (yet) does not hide
 * its projects: they show as ungrouped.
 */
export function groupProjects<T>(
  items: T[],
  groups: ProjectGroup[],
  projectOf: (item: T) => Project,
  keepOrder = false,
): Grouped<T> {
  const known = new Set(groups.map((g) => g.id));
  const inGroup = (item: T) => {
    const id = projectOf(item).group?.id;
    return id && known.has(id) ? id : null;
  };
  return {
    loose: items.filter((item) => !inGroup(item)),
    groups: [...groups].sort(comparePosition).map((group) => {
      const mine = items.filter((item) => inGroup(item) === group.id);
      return {
        group,
        items: keepOrder
          ? mine
          : mine.sort((a, b) =>
              byPosition(projectOf(a).group?.position ?? '', projectOf(b).group?.position ?? ''),
            ),
      };
    }),
  };
}

/** The MIME type of a project dragged in the sidebar or on the Projects page. */
export const PROJECT_DRAG = 'application/x-inkadra-project';
export const GROUP_DRAG = 'application/x-inkadra-project-group';

/**
 * What a drag is over right now: a group, or `loose` for outside any group. The sidebar and
 * the page both show the same target, wherever the pointer is.
 */
let over: string | null = null;
let dragging: string | null = null;
const dragListeners = new Set<() => void>();
const emitDrag = () => {
  for (const l of dragListeners) l();
};
const subscribeDrag = (listener: () => void) => {
  dragListeners.add(listener);
  return () => {
    dragListeners.delete(listener);
  };
};
export function setDragOver(target: string | null) {
  if (over === target) return;
  over = target;
  emitDrag();
}
export function setDragging(projectId: string | null) {
  dragging = projectId;
  if (!projectId) over = null;
  emitDrag();
}
export const useDragOver = () => useSyncExternalStore(subscribeDrag, () => over);
export const useDragging = () => useSyncExternalStore(subscribeDrag, () => dragging);
