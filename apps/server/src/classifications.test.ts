import {
  ClassificationCatalogs,
  classificationLabel,
  classificationOption,
  DEFAULT_CLASSIFICATIONS,
} from '@inkadra/shared';
import { describe, expect, it } from 'vitest';
import { validateCatalogUpdate, validateProjectType } from './classifications.ts';

const copy = () => structuredClone(DEFAULT_CLASSIFICATIONS);
describe('shared classification catalogs', () => {
  it('preserves IDs across rename, reorder and retirement', () => {
    const before = copy();
    const draft = copy();
    draft.projectTypes.reverse();
    const first = draft.projectTypes[0]!;
    first.label = 'Renamed';
    first.archived = true;
    const next = validateCatalogUpdate(before, draft);
    expect(next.revision).toBe(1);
    expect(classificationLabel(next.projectTypes, first.id)).toBe('Renamed');
    expect(() => validateProjectType(next.projectTypes, first.id)).toThrow();
    expect(() => validateProjectType(next.projectTypes, first.id, first.id)).not.toThrow();
  });
  it('prevents lost writes, deleting IDs, duplicate names and ID replacement', () => {
    const before = copy();
    for (const mutate of [
      (d: ReturnType<typeof copy>) => {
        d.revision++;
      },
      (d: ReturnType<typeof copy>) => {
        d.projectTypes.pop();
      },
      (d: ReturnType<typeof copy>) => {
        d.projectTypes[0]!.label = d.projectTypes[1]!.label;
      },
      (d: ReturnType<typeof copy>) => {
        d.projectTypes[0]!.id = 'replaced';
      },
    ]) {
      const draft = copy();
      mutate(draft);
      expect(() => validateCatalogUpdate(before, draft)).toThrow();
    }
  });
  it('protects the storyboard lists like the others, and adds them to older stored settings', () => {
    const stored = { revision: 3, projectTypes: copy().projectTypes, tags: [] };
    const read = ClassificationCatalogs.parse(stored);
    expect(read.shotMovements.map((o) => o.id)).toContain('handheld');

    const removed = copy();
    removed.shotSizes.pop();
    expect(() => validateCatalogUpdate(copy(), removed)).toThrow();
    const repeated = copy();
    repeated.shotAngles[0]!.label = repeated.shotAngles[1]!.label;
    expect(() => validateCatalogUpdate(copy(), repeated)).toThrow();

    const renamed = copy();
    renamed.shotSizes[0]!.label = 'Campo totale';
    renamed.shotSizes[1]!.archived = true;
    renamed.shotSizes.push({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      label: 'Piano americano',
      archived: false,
    });
    const next = validateCatalogUpdate(copy(), renamed);
    expect(next.shotSizes.at(-1)?.legacy).toBeUndefined();
    expect(next.shotSizes[0]?.id).toBe('ews');
  });
  it('binds original text tags once and keeps them readable after renaming/archive', () => {
    const draft = copy();
    draft.tags.push({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      label: 'Night',
      archived: false,
    });
    const current = validateCatalogUpdate(copy(), draft);
    const renamed = structuredClone(current);
    renamed.tags[0]!.label = 'Evening';
    renamed.tags[0]!.archived = true;
    const next = validateCatalogUpdate(current, renamed);
    expect(classificationLabel(next.tags, 'NIGHT')).toBe('Evening');
    expect(classificationOption(next.tags, current.tags[0]!.id)?.archived).toBe(true);
    expect(classificationLabel(next.tags, 'unmanaged legacy')).toBe('unmanaged legacy');
    const rebind = structuredClone(next);
    rebind.tags[0]!.legacy = 'other';
    expect(() => validateCatalogUpdate(next, rebind)).toThrow();
  });
  it('accepts new stable IDs, validates active project choices and permits clearing', () => {
    const draft = copy();
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    draft.projectTypes.push({ id, label: 'Feature', archived: false });
    const next = validateCatalogUpdate(copy(), draft);
    expect(() => validateProjectType(next.projectTypes, id)).not.toThrow();
    expect(() => validateProjectType(next.projectTypes, 'unknown')).toThrow();
    expect(() => validateProjectType(next.projectTypes, null)).not.toThrow();
  });
  it('lets a value added here leave the catalog, never a default, and never takes its id again', () => {
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const draft = copy();
    draft.tags.push({ id, label: 'Night', archived: true });
    const current = validateCatalogUpdate(copy(), draft);
    const removed = structuredClone(current);
    removed.tags = [];
    // Whether it is used is checked when saving, under the lock (saveCatalogs).
    expect(validateCatalogUpdate(current, removed).tags).toEqual([]);
    const back = structuredClone(removed);
    back.revision = current.revision;
    back.tags.push({ id, label: 'Night', archived: false });
    expect(() => validateCatalogUpdate(current, { ...back, tags: [] }, new Set([id]))).not.toThrow();
    expect(() => validateCatalogUpdate(copy(), { ...copy(), tags: back.tags }, new Set([id]))).toThrow(
      'deleted value',
    );
    const defaults = copy();
    defaults.shotMovements.shift();
    expect(() => validateCatalogUpdate(copy(), defaults)).toThrow('Archive');
  });
});
