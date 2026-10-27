import {
  ClassificationCatalogs,
  type ClassificationOption,
  DEFAULT_CLASSIFICATIONS,
} from '@inkadra/shared';
import { eq } from 'drizzle-orm';
import type { Database } from './db/client.ts';
import { instanceSetting } from './db/schema.ts';
import { HttpError } from './http/errors.ts';

export async function readClassifications(db: Pick<Database, 'select'>) {
  const [row] = await db
    .select()
    .from(instanceSetting)
    .where(eq(instanceSetting.key, 'classifications'));
  return ClassificationCatalogs.parse(row?.value ?? DEFAULT_CLASSIFICATIONS);
}

/** Updates may rename/reorder/archive, but never remove IDs or change legacy bindings. */
export function validateCatalogUpdate(
  current: ClassificationCatalogs,
  next: ClassificationCatalogs,
) {
  if (current.revision !== next.revision)
    throw new HttpError('conflict', 'Configuration changed. Reload and try again.');
  for (const key of ['projectTypes', 'tags'] as const) {
    const ids = new Set<string>();
    const labels = new Set<string>();
    for (const option of next[key]) {
      const label = option.label.toLowerCase();
      if (ids.has(option.id) || labels.has(label))
        throw new HttpError('bad_request', 'Option IDs and names must be unique.');
      ids.add(option.id);
      labels.add(label);
      const previous = current[key].find((o) => o.id === option.id);
      if (previous && previous.legacy !== option.legacy)
        throw new HttpError('bad_request', 'Legacy bindings are immutable.');
      if (!previous) {
        if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(option.id))
          throw new HttpError('bad_request', 'New options require UUID identifiers.');
        option.legacy =
          key === 'tags'
            ? option.label.trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, ' ')
            : undefined;
      }
    }
    if (current[key].some((o) => !ids.has(o.id)))
      throw new HttpError('bad_request', 'Archive options instead of removing them.');
    for (const option of next[key]) {
      if (
        next[key].some(
          (other) =>
            other.id !== option.id &&
            (other.id.toLowerCase() === option.label.toLowerCase() ||
              other.legacy === option.label.toLowerCase()),
        )
      )
        throw new HttpError('bad_request', 'Names cannot reuse another option’s original binding.');
    }
    const bindings = new Set<string>();
    for (const option of next[key]) {
      for (const value of [option.id, option.legacy].filter((v): v is string => !!v)) {
        if (bindings.has(value))
          throw new HttpError('bad_request', 'Option bindings must be unique.');
        bindings.add(value);
      }
    }
  }
  return { ...next, revision: next.revision + 1 };
}

export function validateProjectType(
  options: ClassificationOption[],
  value: string | null | undefined,
  previous?: string | null,
) {
  if (value == null || value === previous) return;
  if (!options.some((o) => o.id === value && !o.archived))
    throw new HttpError('bad_request', 'Choose an active project type.');
}
