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
      {
        mime: 'image/jpeg',
        bytes: 300,
        projectId: 'visible',
        projectName: 'Shoot',
        projectColor: 'teal',
        visible: true,
        userId: null,
        userName: null,
        userImage: null,
        derivedBytes: 70,
      },
      {
        mime: 'video/mp4',
        bytes: 500,
        projectId: 'secret-one',
        projectName: 'Secret one',
        projectColor: 'red',
        visible: false,
        userId: null,
        userName: null,
        userImage: null,
        derivedBytes: 0,
      },
      {
        mime: 'audio/wav',
        bytes: 200,
        projectId: 'secret-two',
        projectName: 'Secret two',
        projectColor: 'pink',
        visible: false,
        userId: null,
        userName: null,
        userImage: null,
        derivedBytes: 0,
      },
      {
        mime: 'application/pdf',
        bytes: 100,
        projectId: 'visible',
        projectName: 'Shoot',
        projectColor: 'teal',
        visible: true,
        userId: null,
        userName: null,
        userImage: null,
        derivedBytes: 0,
      },
      {
        mime: 'application/zip',
        bytes: 50,
        projectId: null,
        projectName: null,
        projectColor: null,
        visible: false,
        userId: null,
        userName: null,
        userImage: null,
        derivedBytes: 0,
      },
    ]);
    expect(result.originalBytes).toBe(1150);
    expect(result.byType.reduce((n, row) => n + row.bytes, 0)).toBe(1150);
    expect(result.byProject.reduce((n, row) => n + row.bytes, 0)).toBe(1150);
    expect(result.byProject).toEqual([
      { projectId: null, name: null, scope: 'restricted', bytes: 700, derivedBytes: 0 },
      // Derived bytes metered per project too (#841), renditions included.
      {
        projectId: 'visible',
        name: 'Shoot',
        scope: 'project',
        bytes: 400,
        derivedBytes: 70,
        color: 'teal',
      },
      { projectId: null, name: null, scope: 'unassigned', bytes: 50, derivedBytes: 0 },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/secret|"red"|"pink"/i);
  });
  it('handles empty storage and deterministic ties', () => {
    const empty = storageUsage([]);
    expect(empty.originalBytes).toBe(0);
    expect(empty.byType.every((row) => row.bytes === 0)).toBe(true);
    expect(empty.byProject).toEqual([]);
    const groups = ['b', 'a'].map((projectId) => ({
      projectId,
      projectName: projectId,
      projectColor: null,
      visible: true,
      userId: null,
      userName: null,
      userImage: null,
      derivedBytes: 0,
      bytes: 100,
      mime: 'image/png',
    }));
    expect(storageUsage(groups).byProject).toEqual(storageUsage(groups.reverse()).byProject);
  });
  it('adds up each uploader across projects, including those the reader cannot see', () => {
    const group = (bytes: number, userId: string | null, visible = true) => ({
      mime: 'image/png',
      bytes,
      projectId: visible ? 'open' : 'secret',
      projectName: visible ? 'Open' : 'Secret',
      projectColor: null,
      visible,
      userId,
      userName: userId && `Name of ${userId}`,
      userImage: userId === 'a' ? 'https://example.com/a.webp' : null,
      derivedBytes: bytes / 10,
    });
    const result = storageUsage(
      [
        group(100, 'a'),
        group(50, 'b'),
        group(200, 'a', false),
        group(10, null),
        group(5, null, false),
      ],
      [
        { id: 'a', name: 'Name of a', image: 'https://example.com/a.webp' },
        { id: 'idle', name: 'Idle', image: null },
      ],
    );
    expect(result.byUser).toEqual([
      {
        userId: 'a',
        name: 'Name of a',
        image: 'https://example.com/a.webp',
        bytes: 300,
        derivedBytes: 30,
      },
      { userId: 'b', name: 'Name of b', image: null, bytes: 50, derivedBytes: 5 },
      { userId: null, name: null, image: null, bytes: 15, derivedBytes: 1.5 },
      { userId: 'idle', name: 'Idle', image: null, bytes: 0, derivedBytes: 0 },
    ]);
    expect(result.derivedBytes).toBe(36.5);
    expect(JSON.stringify(result.byUser)).not.toContain('Secret');
  });
});
