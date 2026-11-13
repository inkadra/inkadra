// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import { BackupManifest, BackupSettings, UpdateBackupSettings } from './backups.ts';
import { buildOpenApiDocument } from './openapi.ts';
import {
  ArchiveAsset,
  ArchiveComment,
  ArchiveGuests,
  ArchivePerson,
  type ArchiveStructure,
  checkArchiveStructure,
  PROJECT_ARCHIVE_FORMAT,
  ProjectArchiveManifest,
} from './project-archive.ts';
import {
  IDEMPOTENT_IMPORT_CAPABILITY,
  ImportIdempotencyKey,
  ProjectTransfer,
} from './transfers.ts';

const id = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
const at = '2026-11-02T09:30:00.000Z';

describe('project archive', () => {
  it('reads a version 1 manifest and refuses another format', () => {
    const manifest = {
      format: PROJECT_ARCHIVE_FORMAT,
      formatVersion: 1,
      appVersion: '0.5.0',
      exportedAt: at,
      docSchemaVersion: 4,
      counts: { boards: 2, assets: 1, comments: 0, versions: 0 },
    };
    expect(ProjectArchiveManifest.parse(manifest)).toEqual(manifest);
    expect(ProjectArchiveManifest.safeParse({ ...manifest, format: 'other' }).success).toBe(false);
  });

  it('bounds comment bodies like the API does', () => {
    const comment = {
      id,
      boardId: id,
      elementId: null,
      threadId: null,
      authorId: null,
      guestName: null,
      body: 'x'.repeat(5001),
      visibility: 'team',
      pin: null,
      resolvedAt: null,
      resolvedBy: null,
      createdAt: at,
      editedAt: null,
      deletedAt: null,
    };
    expect(ArchiveComment.safeParse(comment).success).toBe(false);
    expect(ArchiveComment.safeParse({ ...comment, body: 'ok' }).success).toBe(true);
  });
});

describe('archive content', () => {
  it('keeps names of people and drops anything else, emails included', () => {
    expect(ArchivePerson.parse({ id, name: 'Ada', email: 'ada@example.com' })).toEqual({
      id,
      name: 'Ada',
    });
  });

  it('accepts only web addresses as the source of a file', () => {
    const asset = {
      id,
      kind: 'image',
      mime: 'image/png',
      filename: 'still.png',
      size: 1,
      sha256: null,
      sourceUrl: 'https://example.com/a.png',
      createdBy: null,
      createdAt: at,
    };
    expect(ArchiveAsset.safeParse(asset).success).toBe(true);
    for (const sourceUrl of ['javascript:alert(1)', 'file:///etc/passwd', 'not a url'])
      expect(ArchiveAsset.safeParse({ ...asset, sourceUrl }).success).toBe(false);
  });
});

describe('archive structure', () => {
  const ids = Array.from({ length: 6 }, (_, i) => `0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a1${i}`);
  const [root, child, assetId, start, reply, other] = ids as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const ok = (): ArchiveStructure => ({
    boards: [
      { id: root, parentId: null, coverAssetId: null },
      { id: child, parentId: root, coverAssetId: assetId },
    ],
    assets: [{ id: assetId }],
    comments: [
      { id: start, boardId: child, threadId: null },
      { id: reply, boardId: child, threadId: start },
    ],
    versions: [{ id: other, boardId: root }],
    reviews: { current: [], history: [] },
    schedule: [],
  });

  it('accepts a tree with every reference inside the archive', () => {
    expect(checkArchiveStructure(ok())).toBeNull();
  });

  it('refuses two roots, a missing parent, a cycle and duplicate ids', () => {
    const a = ok();
    a.boards[1] = { id: child, parentId: null, coverAssetId: null };
    expect(checkArchiveStructure(a)).toMatch(/root/);
    const b = ok();
    b.boards[1] = { id: child, parentId: other, coverAssetId: null };
    expect(checkArchiveStructure(b)).toMatch(/missing parent/);
    const c = ok();
    c.boards.push({ id: other, parentId: reply, coverAssetId: null });
    c.boards.push({ id: reply, parentId: other, coverAssetId: null });
    expect(checkArchiveStructure(c)).toMatch(/cycle/);
    const d = ok();
    d.assets.push({ id: assetId });
    expect(checkArchiveStructure(d)).toMatch(/duplicate asset/);
  });

  it('refuses replies to a thread on another board or to a reply, and loose references', () => {
    const a = ok();
    a.comments[1] = { id: reply, boardId: root, threadId: start };
    expect(checkArchiveStructure(a)).toMatch(/bad thread/);
    const b = ok();
    b.comments.push({ id: other, boardId: child, threadId: reply });
    expect(checkArchiveStructure(b)).toMatch(/bad thread/);
    const c = ok();
    c.assets = [];
    expect(checkArchiveStructure(c)).toMatch(/cover/);
    const d = ok();
    d.versions = [{ id: other, boardId: other }];
    expect(checkArchiveStructure(d)).toMatch(/version/);
    expect(checkArchiveStructure({ ...ok(), logoAssetId: other })).toMatch(/logo/);
    expect(checkArchiveStructure({ ...ok(), logoAssetId: assetId })).toBeNull();
  });

  it('checks that guest decisions and picks name a listed guest, link, board and file', () => {
    const guests = () => ({
      links: [{ id: other, boardId: root, includeSubBoards: true }],
      guests: [{ id: start, linkId: other }],
      reviews: [{ guestId: start, boardId: child }],
      history: [{ guestId: start, boardId: child }],
      picks: [{ guestId: start, boardId: child, assetId }],
    });
    expect(checkArchiveStructure({ ...ok(), guests: guests() })).toBeNull();
    const a = guests();
    a.guests[0] = { id: start, linkId: reply };
    expect(checkArchiveStructure({ ...ok(), guests: a })).toMatch(/guest: missing link/);
    const b = guests();
    b.picks[0] = { guestId: reply, boardId: child, assetId };
    expect(checkArchiveStructure({ ...ok(), guests: b })).toMatch(/pick: missing guest/);
    const c = guests();
    c.picks[0] = { guestId: start, boardId: child, assetId: other };
    expect(checkArchiveStructure({ ...ok(), guests: c })).toMatch(/pick: missing file/);
    const d = guests();
    d.links[0] = { id: other, boardId: reply, includeSubBoards: true };
    expect(checkArchiveStructure({ ...ok(), guests: d })).toMatch(/guest link: missing board/);
    const e = guests();
    e.history[0] = { guestId: start, boardId: other };
    expect(checkArchiveStructure({ ...ok(), guests: e })).toMatch(/history: missing board/);
  });

  it('refuses guest data on a board the link did not show, and duplicate guest ids', () => {
    const guests = () => ({
      links: [{ id: other, boardId: root, includeSubBoards: false }],
      guests: [{ id: start, linkId: other }],
      reviews: [{ guestId: start, boardId: root }],
      history: [{ guestId: start, boardId: root }],
      picks: [{ guestId: start, boardId: root, assetId }],
    });
    expect(checkArchiveStructure({ ...ok(), guests: guests() })).toBeNull();
    const a = guests();
    a.picks[0] = { guestId: start, boardId: child, assetId };
    expect(checkArchiveStructure({ ...ok(), guests: a })).toMatch(/pick: board outside its link/);
    const b = guests();
    b.reviews[0] = { guestId: start, boardId: child };
    expect(checkArchiveStructure({ ...ok(), guests: b })).toMatch(
      /guest review: board outside its link/,
    );
    const c = guests();
    c.links[0] = { id: other, boardId: child, includeSubBoards: true };
    expect(checkArchiveStructure({ ...ok(), guests: c })).toMatch(/board outside its link/);
    const d = guests();
    d.links.push({ id: other, boardId: root, includeSubBoards: false });
    expect(checkArchiveStructure({ ...ok(), guests: d })).toMatch(/duplicate guest link/);
    const e = guests();
    e.guests.push({ id: start, linkId: other });
    expect(checkArchiveStructure({ ...ok(), guests: e })).toMatch(/duplicate guest/);
  });

  it('keeps guest names and link labels as the live routes do', () => {
    const guest = (name: string | null) =>
      ArchiveGuests.shape.guests.element.parse({ id, linkId: id, name, createdAt: at }).name;
    expect(guest('  Elena Marino  ')).toBe('Elena Marino');
    expect(guest('   ')).toBeNull();
    expect(guest('')).toBeNull();
    expect(guest(null)).toBeNull();
    expect([...(guest('é'.repeat(150)) ?? '')]).toHaveLength(80);
    expect(
      ArchiveGuests.shape.guests.element.safeParse({
        id,
        linkId: id,
        name: 'x'.repeat(201),
        createdAt: at,
      }).success,
    ).toBe(false);
    const label = ArchiveGuests.shape.links.element.parse({
      id,
      boardId: id,
      label: '  Studio Maree ',
      role: 'guest_view',
      proofing: true,
      includeSubBoards: false,
      createdAt: at,
    }).label;
    expect(label).toBe('Studio Maree');
  });
});

describe('backups', () => {
  it('accepts clock times only and bounded retention', () => {
    const ok = { enabled: true, time: '03:00', retention: 7 };
    expect(BackupSettings.parse(ok)).toEqual(ok);
    for (const time of ['3:00', '24:00', '12:60', '03:00:00'])
      expect(BackupSettings.safeParse({ ...ok, time }).success).toBe(false);
    expect(BackupSettings.safeParse({ ...ok, retention: 0 }).success).toBe(false);
    expect(BackupSettings.safeParse({ ...ok, retention: 91 }).success).toBe(false);
    expect(UpdateBackupSettings.safeParse({ retention: 3, other: 1 }).success).toBe(false);
  });

  it('only names safe tables and entries in a backup manifest', () => {
    const manifest = {
      format: 'inkadra-backup',
      formatVersion: 1,
      appVersion: '0.5.0',
      createdAt: at,
      migrations: ['0000_init'],
      tables: [{ name: 'user', columns: ['id'], rows: 1, entry: 'db/user.copy' }],
      rebuilt: ['board_element_index'],
      files: { count: 0, bytes: 0, entry: 'files.jsonl' },
    };
    expect(BackupManifest.safeParse(manifest).success).toBe(true);
    const bad = { ...manifest.tables[0], name: 'user"; drop table x;--' };
    expect(BackupManifest.safeParse({ ...manifest, tables: [bad] }).success).toBe(false);
    const slip = { ...manifest.tables[0], entry: 'db/../../etc.copy' };
    expect(BackupManifest.safeParse({ ...manifest, tables: [slip] }).success).toBe(false);
  });
});

it('documents transfers and backups in OpenAPI', () => {
  const doc = buildOpenApiDocument();
  expect(Object.keys(doc.paths ?? {})).toEqual(
    expect.arrayContaining([
      '/api/v1/projects/{projectId}/exports',
      '/api/v1/projects/import',
      '/api/v1/transfers/{transferId}/download',
      '/api/v1/instance/backups',
    ]),
  );
  expect(
    ProjectTransfer.safeParse({
      id,
      kind: 'export',
      status: 'ready',
      progress: 1,
      projectId: id,
      projectName: 'Last Train',
      size: 10,
      failure: null,
      summary: null,
      createdAt: at,
      finishedAt: at,
      expiresAt: at,
    }).success,
  ).toBe(true);
});

it('takes an import Idempotency-Key in the form of the other creations (decision 0127)', () => {
  expect(IDEMPOTENT_IMPORT_CAPABILITY).toBe('idempotent-import');
  expect(ImportIdempotencyKey.safeParse(id).success).toBe(true);
  expect(ImportIdempotencyKey.safeParse('k'.repeat(128)).success).toBe(true);
  for (const bad of ['', 'k'.repeat(129), 'two words', 'caffè'])
    expect(ImportIdempotencyKey.safeParse(bad).success).toBe(false);
  const doc = buildOpenApiDocument();
  const header = doc.paths?.['/api/v1/projects/import']?.post?.parameters?.find(
    (p) => 'name' in p && p.name === 'Idempotency-Key',
  );
  expect(header).toMatchObject({ in: 'header', required: false });
  const lookup = doc.paths?.['/api/v1/transfers/import-requests/{idempotencyKey}']?.get;
  expect(lookup?.parameters).toEqual([
    expect.objectContaining({ name: 'idempotencyKey', in: 'path', required: true }),
  ]);
  expect(Object.keys(lookup?.responses ?? {})).toEqual(expect.arrayContaining(['200', '404']));
});
