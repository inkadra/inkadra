// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import {
  CommentQuery,
  CreateComment,
  CreateGuestSession,
  CreateShareLink,
  GuestElement,
  MarkAllRead,
  mentionedIds,
  SetElementReview,
  SetPick,
  UpdateShareLink,
} from './index.ts';
import { buildOpenApiDocument } from './openapi.ts';

const userId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';

describe('review and sharing contracts', () => {
  it('reads mentions from a comment body once each', () => {
    const body = `Ciao @{${userId}} e @{${userId.toUpperCase()}}, guarda @{non-un-id}`;
    expect(mentionedIds(body)).toEqual([userId]);
    expect(CreateComment.safeParse({ body: '   ' }).success).toBe(false);
    expect(CreateComment.safeParse({ body: 'x'.repeat(5001) }).success).toBe(false);
    expect(CreateComment.safeParse({ elementId: 'bad id!', body: 'ok' }).success).toBe(false);
    expect(
      CreateComment.safeParse({
        elementId: 'V1StGXR8_Z5jdHi6B-myT',
        body: 'ok',
        pin: { x: 2, y: 0 },
      }).success,
    ).toBe(false);
  });

  it('lists open threads by default', () => {
    expect(CommentQuery.parse({})).toMatchObject({ scope: 'all', status: 'open', limit: 30 });
  });

  it('knows only the four review statuses', () => {
    expect(SetElementReview.safeParse({ status: 'approved' }).success).toBe(true);
    expect(SetElementReview.safeParse({ status: 'maybe' }).success).toBe(false);
  });

  it('makes view-only links without expiry, downloads or proofing by default', () => {
    expect(CreateShareLink.parse({})).toEqual({
      role: 'guest_view',
      includeSubBoards: true,
      allowDownload: false,
      proofing: false,
    });
    expect(CreateShareLink.safeParse({ role: 'editor' }).success).toBe(false);
    expect(CreateShareLink.safeParse({ password: '123' }).success).toBe(false);
    expect(UpdateShareLink.parse({ password: null })).toEqual({ password: null });
  });

  it('lets guests come in without a name and needs something to pick', () => {
    expect(CreateGuestSession.parse({})).toEqual({});
    expect(CreateGuestSession.safeParse({ name: ' ' }).success).toBe(false);
    expect(SetPick.safeParse({}).success).toBe(false);
    expect(SetPick.safeParse({ pick: null }).success).toBe(true);
    expect(SetPick.safeParse({ stars: 6 }).success).toBe(false);
    expect(MarkAllRead.parse({})).toEqual({});
  });

  it('passes element fields through to guests', () => {
    const el = { id: 'V1StGXR8_Z5jdHi6B-myT', type: 'image', assetId: userId, x: 1 };
    expect(GuestElement.parse(el)).toEqual(el);
  });

  it('documents the new paths', () => {
    const paths = Object.keys(buildOpenApiDocument().paths ?? {});
    for (const p of [
      '/api/v1/boards/{boardId}/comments',
      '/api/v1/boards/{boardId}/elements/{elementId}/review',
      '/api/v1/me/notifications',
      '/api/v1/boards/{boardId}/share-links',
      '/api/v1/guest/links/{linkId}/boards/{boardId}',
      '/api/v1/guest/links/{linkId}/assets/{assetId}/variants/{size}',
      '/api/v1/boards/{boardId}/versions/{versionId}/restore',
    ]) {
      expect(paths).toContain(p);
    }
  });
});
