// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import {
  CommentQuery,
  CreateComment,
  CreateGuestSession,
  CreateShareLink,
  GuestComment,
  GuestCreateComment,
  GuestElement,
  GuestElementReview,
  GuestSetElementReview,
  MarkAllRead,
  mentionedIds,
  NotificationQuery,
  ReviewHistoryQuery,
  renderMentions,
  SetElementReview,
  SetPick,
  ShareLinkPreview,
  UpdateShareLink,
} from './index.ts';
import { buildOpenApiDocument } from './openapi.ts';

const userId = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a10';

describe('review and sharing contracts', () => {
  it('reads mentions from a comment body once each', () => {
    const body = `Ciao @{${userId}} e @{${userId.toUpperCase()}}, guarda @{non-un-id}`;
    expect(mentionedIds(body)).toEqual([userId]);
    const junk = Array.from({ length: 25 }, (_, i) => `@{${String(i).padStart(36, 'a')}}`).join(
      ' ',
    );
    expect(mentionedIds(`${junk} @{${userId}}`)).toEqual([userId]);
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

  it('writes mentions as names for guests', () => {
    const names = new Map([[userId, 'Giulia']]);
    const other = '0193f0a4-6c1e-7b9a-9c51-2b1f6f5f2a11';
    expect(renderMentions(`Ciao @{${userId.toUpperCase()}} e @{${other}}`, names)).toBe(
      'Ciao @Giulia e @…',
    );
  });

  it('lists open threads by default, with one page size for every new list', () => {
    expect(CommentQuery.parse({})).toMatchObject({ scope: 'all', status: 'open', limit: 30 });
    expect(ReviewHistoryQuery.parse({})).toEqual({ limit: 30 });
    expect(NotificationQuery.parse({})).toEqual({ limit: 30 });
    expect(CommentQuery.safeParse({ limit: 101 }).success).toBe(false);
  });

  it('gives guests no ids, avatars, notes or visibility', () => {
    const author = { kind: 'team' as const, name: 'Giulia', isYou: false };
    const comment = GuestComment.parse({
      id: userId,
      boardId: userId,
      elementId: null,
      parentId: null,
      author: { ...author, user: { id: userId, image: 'https://x/a.png' } },
      body: 'Ciao @Giulia',
      mentions: [{ id: userId }],
      visibility: 'team',
      shareLinkId: userId,
      pin: null,
      createdAt: '2026-11-02T09:30:00.000Z',
      editedAt: null,
      deletedAt: null,
      canEdit: false,
      canDelete: false,
    });
    expect(comment.author).toEqual(author);
    for (const key of ['mentions', 'visibility', 'shareLinkId'])
      expect(comment).not.toHaveProperty(key);
    const review = GuestElementReview.parse({
      elementId: 'V1StGXR8_Z5jdHi6B-myT',
      status: 'approved',
      note: null,
      changedBy: { kind: 'guest', name: 'Cliente', isYou: false },
      changedAt: '2026-11-02T09:30:00.000Z',
    });
    expect(review.changedBy).not.toHaveProperty('user');
    expect(GuestCreateComment.parse({ body: 'ok', visibility: 'team' })).toEqual({ body: 'ok' });
  });

  it('previews a link with a password without saying what it is', () => {
    const preview = {
      linkId: userId,
      instanceName: 'Studio',
      needsPassword: true,
      boardTitle: null,
      sharedBy: null,
      role: null,
      expiresAt: null,
    };
    expect(ShareLinkPreview.parse(preview)).toEqual(preview);
    expect(ShareLinkPreview.shape).not.toHaveProperty('status');
  });

  it('knows only the four review statuses', () => {
    expect(SetElementReview.safeParse({ status: 'approved' }).success).toBe(true);
    expect(SetElementReview.safeParse({ status: 'in_review' }).success).toBe(true);
    expect(SetElementReview.safeParse({ status: 'maybe' }).success).toBe(false);
  });

  it('lets guests decide or withdraw, never ask for review', () => {
    for (const status of ['approved', 'changes_requested', 'none'])
      expect(GuestSetElementReview.safeParse({ status }).success).toBe(true);
    for (const status of ['in_review', 'maybe'])
      expect(GuestSetElementReview.safeParse({ status }).success).toBe(false);
    expect(
      GuestSetElementReview.safeParse({ status: 'approved', note: 'x'.repeat(501) }).success,
    ).toBe(false);
    const doc = buildOpenApiDocument();
    const put =
      doc.paths?.['/api/v1/guest/links/{linkId}/boards/{boardId}/elements/{elementId}/review']?.put;
    expect(JSON.stringify(put?.requestBody)).toContain(
      '#/components/schemas/GuestSetElementReview',
    );
    expect(put?.responses).toHaveProperty('403');
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

  it('requires ten characters only when setting a share-link password', () => {
    for (const schema of [CreateShareLink, UpdateShareLink]) {
      expect(schema.safeParse({ password: '123456789' }).success).toBe(false);
      expect(schema.safeParse({ password: '1234567890' }).success).toBe(true);
    }
    const input = { token: 'k'.repeat(43), password: '123456' };
    expect(CreateGuestSession.parse(input)).toEqual(input);
    const schemas = buildOpenApiDocument().components?.schemas;
    for (const name of ['CreateShareLink', 'UpdateShareLink']) {
      expect(schemas?.[name]).toHaveProperty('properties.password.minLength', 10);
    }
  });

  it('lets guests come in with the token, without a name, and needs something to pick', () => {
    const token = 'k'.repeat(43);
    expect(CreateGuestSession.parse({ token })).toEqual({ token });
    expect(CreateGuestSession.safeParse({}).success).toBe(false);
    expect(CreateGuestSession.safeParse({ token, name: ' ' }).success).toBe(false);
    expect(SetPick.safeParse({}).success).toBe(false);
    expect(SetPick.safeParse({ pick: null }).success).toBe(true);
    expect(SetPick.safeParse({ stars: 6 }).success).toBe(false);
    expect(MarkAllRead.parse({})).toEqual({});
  });

  it('accepts guest elements as the server cuts them down', () => {
    const el = { id: 'V1StGXR8_Z5jdHi6B-myT', type: 'image', assetId: userId, x: 1 };
    expect(GuestElement.parse(el)).toEqual(el);
  });

  it('documents the new paths', () => {
    const doc = buildOpenApiDocument();
    const paths = Object.keys(doc.paths ?? {});
    expect(paths).not.toContain('/api/v1/guest/by-token/{token}/session');
    expect(doc.paths?.['/api/v1/guest/links/{linkId}/session']?.post).toBeDefined();
    for (const p of [
      '/api/v1/boards/{boardId}/comments',
      '/api/v1/comments/{commentId}/replies',
      '/api/v1/guest/links/{linkId}/comments/{commentId}/replies',
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
