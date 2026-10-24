// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import {
  ApiError,
  Author,
  BoardColumns,
  BoardVersionConflict,
  ClipRequest,
  Comment,
  GuestSession,
  Notification,
  OutcomeUnknown,
  PickSummary,
  SearchHit,
} from './index.ts';
import { buildOpenApiDocument } from './openapi.ts';

const id = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';
const at = '2026-11-02T09:30:00.000Z';
const elementId = 'V1StGXR8_Z5jdHi6B-myT';

/** Answers of a 0.4.0 server must still parse, and the new optional fields must survive. */
function both<T>(schema: { parse: (v: unknown) => T }, old: object, extra: object) {
  expect(schema.parse(old)).toEqual(old);
  expect(schema.parse({ ...old, ...extra })).toEqual({ ...old, ...extra });
}

describe('contract additions of API 0.5.0', () => {
  it('reads search hits with and without myRole', () => {
    const hit = {
      kind: 'board',
      projectId: id,
      projectName: 'Spot',
      boardId: id,
      boardTitle: 'Moodboard',
      boardKind: 'board',
      elementId: null,
      elementType: null,
      title: 'Moodboard',
      snippet: null,
      assetId: null,
      tags: [],
    };
    both(SearchHit, hit, { myRole: 'viewer' });
    expect(SearchHit.safeParse({ ...hit, myRole: 'guest' }).success).toBe(false);
  });

  it('reads notifications with and without threadId', () => {
    const notification = {
      id,
      type: 'reply',
      actor: null,
      projectId: id,
      projectName: 'Spot',
      boardId: id,
      boardTitle: 'Moodboard',
      elementId,
      commentId: id,
      excerpt: 'Ok',
      reviewStatus: null,
      readAt: null,
      createdAt: at,
    };
    both(Notification, notification, { threadId: id });
    both(Notification, { ...notification, commentId: null }, { threadId: null });
  });

  it('reads link labels on comments and guest authors, when sent', () => {
    const guest = { kind: 'guest', guestId: id, name: 'Anna', shareLinkId: id };
    both(Author, guest, { shareLinkLabel: 'Cliente' });
    both(Author, guest, { shareLinkLabel: null });
    const comment = {
      id,
      boardId: id,
      elementId: null,
      parentId: null,
      pin: null,
      createdAt: at,
      editedAt: null,
      deletedAt: null,
      author: guest,
      body: 'Bello',
      mentions: [],
      visibility: 'everyone',
      shareLinkId: id,
      canEdit: false,
      canDelete: true,
    };
    both(Comment, comment, { shareLinkLabel: 'Cliente' });
  });

  it('reads guest sessions with and without sharedBy', () => {
    const session = {
      linkId: id,
      guest: { id, name: null },
      role: 'guest_view',
      boardId: id,
      boards: [],
      allowDownload: false,
      proofing: true,
      linkExpiresAt: null,
      sessionExpiresAt: at,
    };
    both(GuestSession, session, { sharedBy: 'Giulia' });
    both(GuestSession, session, { sharedBy: null });
  });

  it('reads pick summaries with and without thumbnails', () => {
    const pick = {
      boardId: id,
      elementId,
      assetId: id,
      filename: 'IMG_0001.jpg',
      picked: 1,
      rejected: 0,
      starsAverage: null,
      starsCount: 0,
      byGuest: [{ guestId: id, pick: 'picked', stars: null }],
    };
    const variant = {
      size: '256',
      width: 256,
      height: 171,
      url: `/api/v1/assets/${id}/variants/256`,
    };
    both(PickSummary, pick, { variants: [variant] });
    both(PickSummary, pick, { variants: [] });
  });

  it('takes an optional title for links, and clips without one as before', () => {
    expect(ClipRequest.parse({ boardId: id, url: 'https://example.com' })).toEqual({
      boardId: id,
      url: 'https://example.com',
    });
    expect(
      ClipRequest.parse({ boardId: id, url: 'https://example.com', title: 'Esempio' }).title,
    ).toBe('Esempio');
    expect(ClipRequest.safeParse({ boardId: id, title: 'Solo titolo' }).success).toBe(false);
  });

  it('lists columns by element id', () => {
    expect(BoardColumns.parse({ items: [{ id: elementId, title: '' }] }).items).toHaveLength(1);
    expect(BoardColumns.safeParse({ items: [{ id: 'bad id!', title: 'x' }] }).success).toBe(false);
  });

  it('tells conflicts and unknown outcomes apart in details, with the same codes', () => {
    const conflict = {
      error: { code: 'conflict', message: 'Full', details: { reason: 'named_versions_limit' } },
    };
    expect(ApiError.parse(conflict)).toEqual(conflict);
    expect(BoardVersionConflict.parse(conflict.error.details).reason).toBe('named_versions_limit');
    expect(BoardVersionConflict.safeParse({ reason: 'newer_schema' }).success).toBe(true);
    const unknown = {
      error: { code: 'internal', message: 'Check', details: { reason: 'outcome_unknown' } },
    };
    expect(ApiError.parse(unknown)).toEqual(unknown);
    expect(OutcomeUnknown.safeParse(unknown.error.details).success).toBe(true);
    expect(OutcomeUnknown.safeParse(undefined).success).toBe(false);
  });

  it('documents the new paths and answers', () => {
    const doc = buildOpenApiDocument();
    expect(doc.info.version).toBe('0.5.0');
    const paths = doc.paths ?? {};
    expect(paths['/api/v1/boards/{boardId}/columns']?.get).toBeDefined();
    expect(paths['/api/v1/boards/{boardId}/versions/{versionId}']?.get).toBeDefined();
    const clip = paths['/api/v1/clip']?.post;
    expect(Object.keys(clip?.responses ?? {})).toEqual(
      expect.arrayContaining(['413', '429', '500']),
    );
    const form = clip?.requestBody;
    expect(JSON.stringify(form)).toContain('"tags":{"style":"form","explode":true}');
    for (const [path, method] of [
      ['/api/v1/boards/{boardId}/versions', 'post'],
      ['/api/v1/boards/{boardId}/versions/{versionId}', 'patch'],
      ['/api/v1/boards/{boardId}/versions/{versionId}/state', 'get'],
      ['/api/v1/boards/{boardId}/versions/{versionId}/restore', 'post'],
    ] as const) {
      expect(paths[path]?.[method]?.responses).toHaveProperty('409');
    }
    expect(doc.components?.schemas).toHaveProperty('OutcomeUnknown');
    expect(doc.components?.schemas).toHaveProperty('BoardVersionConflict');
  });
});
