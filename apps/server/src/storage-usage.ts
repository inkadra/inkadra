import type { StorageUsage } from '@inkadra/shared';

export function fileCategory(mime: string): StorageUsage['byType'][number]['type'] {
  const value = mime.toLowerCase().split(';')[0]?.trim() ?? '';
  if (value.startsWith('image/')) return 'images';
  if (value.startsWith('video/')) return 'videos';
  if (value.startsWith('audio/')) return 'audio';
  if (
    value.startsWith('text/') ||
    value === 'application/pdf' ||
    /^(application\/(msword|rtf|vnd\.(openxmlformats-officedocument\.|oasis\.opendocument\.|ms-(excel|powerpoint)))).*/.test(
      value,
    )
  )
    return 'documents';
  return 'other';
}

export interface UsageGroup {
  mime: string;
  bytes: number;
  projectId: string | null;
  projectName: string | null;
  visible: boolean;
  userId: string | null;
  userName: string | null;
  derivedBytes: number;
}

/** Aggregated originals, attributed to their owning project, never to card references. */
export function storageUsage(
  groups: UsageGroup[],
  /** Everyone to list, with no files too. */
  people: { id: string; name: string }[] = [],
): StorageUsage {
  const types: StorageUsage['byType'] = ['images', 'videos', 'audio', 'documents', 'other'].map(
    (type) => ({ type: type as StorageUsage['byType'][number]['type'], bytes: 0 }),
  );
  const projects = new Map<string, StorageUsage['byProject'][number]>();
  const users = new Map<string | null, NonNullable<StorageUsage['byUser']>[number]>(
    people.map((p) => [p.id, { userId: p.id, name: p.name, bytes: 0, derivedBytes: 0 }]),
  );
  let originalBytes = 0;
  let derivedBytes = 0;
  for (const row of groups) {
    originalBytes += row.bytes;
    derivedBytes += row.derivedBytes;
    const type = types.find((t) => t.type === fileCategory(row.mime));
    if (type) type.bytes += row.bytes;
    const key = !row.projectId ? 'unassigned' : row.visible ? row.projectId : 'restricted';
    const entry = projects.get(key) ?? {
      projectId: row.visible ? row.projectId : null,
      name: row.visible ? row.projectName : null,
      scope: !row.projectId
        ? ('unassigned' as const)
        : row.visible
          ? ('project' as const)
          : ('restricted' as const),
      bytes: 0,
    };
    entry.bytes += row.bytes;
    projects.set(key, entry);
    const uploader = users.get(row.userId) ?? {
      userId: row.userId,
      name: row.userName,
      bytes: 0,
      derivedBytes: 0,
    };
    uploader.bytes += row.bytes;
    uploader.derivedBytes = (uploader.derivedBytes ?? 0) + row.derivedBytes;
    users.set(row.userId, uploader);
  }
  return {
    originalBytes,
    derivedBytes,
    byType: types,
    byProject: [...projects.values()].sort(
      (a, b) => b.bytes - a.bytes || (a.projectId ?? a.scope).localeCompare(b.projectId ?? b.scope),
    ),
    byUser: [...users.values()].sort(
      (a, b) =>
        b.bytes + (b.derivedBytes ?? 0) - a.bytes - (a.derivedBytes ?? 0) ||
        (a.userId ?? '').localeCompare(b.userId ?? ''),
    ),
  };
}
