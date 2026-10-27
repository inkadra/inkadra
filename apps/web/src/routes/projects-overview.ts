import type { Board, Project, ProjectMember } from '@inkadra/shared';
import { api } from '../lib/api.ts';

export interface ProjectOverview {
  project: Project;
  boards: Board[];
  members: ProjectMember[];
  activity: string;
}

/** Keep archived pages separate from the active-project sidebar cache. */
export async function archivedProjects(): Promise<Project[]> {
  const items: Project[] = [];
  let cursor: string | null = null;
  do {
    const page: { items: Project[]; nextCursor: string | null } = await api.get(
      `/projects?archived=true${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    );
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

/** Load up to four project cards at a time, preserving list order. */
export async function projectOverviews(projects: Project[]): Promise<ProjectOverview[]> {
  const result: ProjectOverview[] = new Array(projects.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, projects.length) }, async () => {
      while (next < projects.length) {
        const index = next++;
        const project = projects[index];
        if (project) result[index] = await projectOverview(project);
      }
    }),
  );
  return result;
}

export async function projectOverview(project: Project): Promise<ProjectOverview> {
  const [boards, members] = await Promise.all([
    api.get<{ items: Board[] }>(`/projects/${project.id}/boards`),
    api.get<{ items: ProjectMember[] }>(`/projects/${project.id}/members`),
  ]);
  return {
    project,
    boards: boards.items,
    members: members.items,
    activity: boards.items.reduce(
      (date, board) => [date, board.editedAt ?? board.updatedAt].sort().at(-1) ?? date,
      project.updatedAt,
    ),
  };
}

export function filterProjects(
  items: ProjectOverview[],
  query: {
    search: string;
    status: string;
    type: string;
    person: string;
    sort: string;
  },
): ProjectOverview[] {
  return items
    .filter(
      ({ project: p, members }) =>
        p.name.toLocaleLowerCase().includes(query.search.trim().toLocaleLowerCase()) &&
        (query.status === 'all' || (query.status === 'archived') === !!p.archivedAt) &&
        (query.type === 'all' || p.type === query.type) &&
        (query.person === 'all' || members.some((m) => m.user.id === query.person)),
    )
    .sort(
      (a, b) =>
        Number(!!b.project.pinned) - Number(!!a.project.pinned) ||
        (query.sort === 'name'
          ? a.project.name.localeCompare(b.project.name)
          : query.sort === 'created'
            ? b.project.createdAt.localeCompare(a.project.createdAt)
            : b.activity.localeCompare(a.activity)) ||
        a.project.id.localeCompare(b.project.id),
    );
}
