import type {
  GuestBoardSnapshot,
  GuestComment,
  GuestCommentThread,
  GuestElementReview,
  GuestPick,
  GuestSession,
  GuestSetElementReview,
  SetPick,
  ShareLinkPreview,
} from '@inkadra/shared';
import { API_PREFIX } from '@inkadra/shared/constants';
import { RequestError } from '../lib/api.ts';

/**
 * Requests of the guest page (decision 0013). Only paths under /api/v1/guest: the page of a
 * share link never asks for the account session nor calls any account endpoint. The guest
 * cookie is scoped by the server to /api/v1/guest/links/{linkId}, so the browser sends it only
 * here.
 */

/** A failed guest request, with the wait the server asked for when it sent `Retry-After`. */
export class GuestRequestError extends RequestError {
  constructor(
    status: number,
    code: string,
    message: string,
    details: unknown,
    readonly retryAfter: string | null,
  ) {
    super(status, code, message, details);
  }
}

async function send<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_PREFIX}/guest${path}`, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  if (res.status === 304) return null as T;
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string; details?: unknown } } | null)
      ?.error;
    throw new GuestRequestError(
      res.status,
      err?.code ?? 'unknown',
      err?.message ?? res.statusText,
      err?.details,
      res.headers.get('retry-after'),
    );
  }
  return body as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body),
});

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export const guestApi = {
  preview: (token: string) =>
    send<ShareLinkPreview>(`/by-token/${encodeURIComponent(token)}`, { method: 'GET' }),

  open: (linkId: string, body: { token: string; name?: string; password?: string }) =>
    send<GuestSession>(`/links/${linkId}/session`, json('POST', body)),

  session: (linkId: string, signal?: AbortSignal) =>
    send<GuestSession>(`/links/${linkId}/session`, signal ? { signal } : {}),

  setName: (linkId: string, name: string) =>
    send<GuestSession>(`/links/${linkId}/session`, json('PATCH', { name })),

  /** The snapshot, or null when it has not changed since `version` (304). */
  snapshot: (linkId: string, boardId: string, version?: string, signal?: AbortSignal) =>
    send<GuestBoardSnapshot | null>(`/links/${linkId}/boards/${boardId}`, {
      method: 'GET',
      headers: version ? { 'if-none-match': `"${version}"` } : {},
      ...(signal ? { signal } : {}),
    }),

  threads: (
    linkId: string,
    boardId: string,
    query: { elementId?: string; scope?: string },
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams({ status: 'all', limit: '100' });
    if (query.elementId) params.set('elementId', query.elementId);
    if (query.scope) params.set('scope', query.scope);
    return send<Page<GuestCommentThread>>(
      `/links/${linkId}/boards/${boardId}/comments?${params}`,
      signal ? { signal } : {},
    );
  },

  replies: (linkId: string, commentId: string, cursor?: string) => {
    const params = new URLSearchParams({ limit: '100' });
    if (cursor) params.set('cursor', cursor);
    return send<Page<GuestComment>>(`/links/${linkId}/comments/${commentId}/replies?${params}`);
  },

  comment: (
    linkId: string,
    boardId: string,
    body: { body: string; elementId?: string; parentId?: string },
  ) => send<GuestComment>(`/links/${linkId}/boards/${boardId}/comments`, json('POST', body)),

  editComment: (linkId: string, commentId: string, body: string) =>
    send<GuestComment>(`/links/${linkId}/comments/${commentId}`, json('PATCH', { body })),

  deleteComment: (linkId: string, commentId: string) =>
    send<null>(`/links/${linkId}/comments/${commentId}`, { method: 'DELETE' }),

  review: (linkId: string, boardId: string, elementId: string, body: GuestSetElementReview) =>
    send<GuestElementReview>(
      `/links/${linkId}/boards/${boardId}/elements/${elementId}/review`,
      json('PUT', body),
    ),

  pick: (linkId: string, boardId: string, elementId: string, body: SetPick) =>
    send<GuestPick>(
      `/links/${linkId}/boards/${boardId}/elements/${elementId}/pick`,
      json('PUT', body),
    ),
};
