import { describe, expect, it } from 'vitest';
import { fileCategory, storageUsage } from './storage-usage.ts';

describe('original storage usage', () => {
  it.each([
    ['image/jpeg', 'images'],
    ['IMAGE/HEIC', 'images'],
    ['video/quicktime', 'videos'],
    ['audio/wav', 'audio'],
    ['application/pdf', 'documents'],
    ['text/plain; charset=utf-8', 'documents'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'documents'],
    ['application/vnd.oasis.opendocument.text', 'documents'],
    ['application/zip', 'other'],
    ['application/octet-stream', 'other'],
    ['', 'other'],
  ])('categorizes %s as %s', (mime, category) => expect(fileCategory(mime)).toBe(category));
  it('keeps totals equal, combines restricted projects anonymously and attributes once per owner', () => {
    const result = storageUsage([
      { mime: 'image/jpeg', bytes: 300, projectId: 'visible', projectName: 'Shoot', visible: true },
      {
        mime: 'video/mp4',
        bytes: 500,
        projectId: 'secret-one',
        projectName: 'Secret one',
        visible: false,
      },
      {
        mime: 'audio/wav',
        bytes: 200,
        projectId: 'secret-two',
        projectName: 'Secret two',
        visible: false,
      },
      {
        mime: 'application/pdf',
        bytes: 100,
        projectId: 'visible',
        projectName: 'Shoot',
        visible: true,
      },
      { mime: 'application/zip', bytes: 50, projectId: null, projectName: null, visible: false },
    ]);
    expect(result.originalBytes).toBe(1150);
    expect(result.byType.reduce((n, row) => n + row.bytes, 0)).toBe(1150);
    expect(result.byProject.reduce((n, row) => n + row.bytes, 0)).toBe(1150);
    expect(result.byProject).toEqual([
      { projectId: null, name: null, scope: 'restricted', bytes: 700 },
      { projectId: 'visible', name: 'Shoot', scope: 'project', bytes: 400 },
      { projectId: null, name: null, scope: 'unassigned', bytes: 50 },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/secret/i);
  });
  it('handles empty storage and deterministic ties', () => {
    const empty = storageUsage([]);
    expect(empty.originalBytes).toBe(0);
    expect(empty.byType.every((row) => row.bytes === 0)).toBe(true);
    expect(empty.byProject).toEqual([]);
    const groups = ['b', 'a'].map((projectId) => ({
      projectId,
      projectName: projectId,
      visible: true,
      bytes: 100,
      mime: 'image/png',
    }));
    expect(storageUsage(groups).byProject).toEqual(storageUsage(groups.reverse()).byProject);
  });
});
