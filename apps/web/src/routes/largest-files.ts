import type { StorageFiles } from '@inkadra/shared';

type Item = StorageFiles['items'][number];

/** The choices of the type filter: videos, images, and everything else together. */
export type FileFilter = 'all' | 'videos' | 'images' | 'other';

/** The filter a file falls under; files from older servers, without a kind, are "other". */
export const filterOf = (item: Pick<Item, 'kind'>): Exclude<FileFilter, 'all'> =>
  item.kind === 'videos' || item.kind === 'images' ? item.kind : 'other';

export function filterCounts(items: readonly Pick<Item, 'kind'>[]): Record<FileFilter, number> {
  const counts = { all: items.length, videos: 0, images: 0, other: 0 };
  for (const item of items) counts[filterOf(item)] += 1;
  return counts;
}

export const filterFiles = <T extends Pick<Item, 'kind'>>(items: readonly T[], filter: FileFilter) =>
  filter === 'all' ? [...items] : items.filter((item) => filterOf(item) === filter);

export interface FilesSummary {
  /** The largest files (up to three) and what they take together. */
  top: { count: number; bytes: number };
  /** The projects that take most among the listed files, largest first. */
  projects: Array<{
    id: string;
    name: string;
    color: Item['projectColor'];
    bytes: number;
  }>;
  /** The person's total less those projects: smaller files, hidden ones, other projects. */
  restBytes: number;
}

/**
 * Where the space of a person goes, from their largest files (listed biggest first) and their
 * total. shortcut: a project's bytes count its listed files only, so files below the 50th fall
 * into "everything else"; the server would need a per-project total to be exact.
 */
export function filesSummary(
  items: readonly Item[],
  totalBytes: number,
  maxProjects = 3,
): FilesSummary {
  const top = items.slice(0, 3);
  const byProject = new Map<string, FilesSummary['projects'][number]>();
  for (const item of items) {
    const entry = byProject.get(item.projectId) ?? {
      id: item.projectId,
      name: item.projectName,
      color: item.projectColor,
      bytes: 0,
    };
    entry.bytes += item.bytes;
    byProject.set(item.projectId, entry);
  }
  const projects = [...byProject.values()]
    .sort((a, b) => b.bytes - a.bytes || a.id.localeCompare(b.id))
    .slice(0, maxProjects);
  const shown = projects.reduce((sum, p) => sum + p.bytes, 0);
  return {
    top: { count: top.length, bytes: top.reduce((sum, f) => sum + f.bytes, 0) },
    projects,
    restBytes: Math.max(0, totalBytes - shown),
  };
}

/** The short type badge of a file without a preview: its extension, as GIF or PDF. */
export function typeBadge(filename: string): string | null {
  const dot = filename.lastIndexOf('.');
  const ext = dot > 0 ? filename.slice(dot + 1) : '';
  return /^[a-z0-9]{1,4}$/i.test(ext) ? ext.toUpperCase() : null;
}
