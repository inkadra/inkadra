import {
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
});
