import type { Project } from '@inkadra/shared';
import { api } from '../lib/api.ts';

/** The sidebar and project landing must not mistake later pages for missing membership. */
export async function loadProjects(): Promise<Project[]> {
  const items: Project[] = [];
  let cursor: string | null = null;
  do {
    const page: { items: Project[]; nextCursor: string | null } = await api.get(
      `/projects${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
    );
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}
