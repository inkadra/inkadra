import { updateElement } from '@inkadra/canvas-core';
import type { LinkPreview } from '@inkadra/shared';
import type * as Y from 'yjs';
import { api } from '../lib/api.ts';
import { LOCAL } from './store.ts';

/**
 * The address as a web link, or null. Link cards come from the shared document, which any
 * editor writes without going through the server: only http and https become links.
 */
export function webUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

/**
 * Normalizes and validates a link for note rich text.
 * Prepends https:// when no scheme is present (e.g. example.com -> https://example.com).
 * Validates protocol: allows http, https, mailto; rejects javascript:, data:, etc.
 */
export function normalizeNoteLink(raw: string | undefined): string | null {
  if (!raw) return null;
  const text = raw.trim();
  if (!text) return null;
  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(text) ? text : `https://${text}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      if (!parsed.hostname) return null;
      if (!candidate.endsWith('/') && parsed.pathname === '/') {
        return `${parsed.protocol}//${parsed.host}${parsed.search}${parsed.hash}`;
      }
      return parsed.href;
    }
    if (parsed.protocol === 'mailto:') {
      return parsed.pathname ? parsed.href : null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Asks the server for the title, description and image of a link and fills in the card.
 * A failure leaves the card as it is: it still shows the address.
 */
export async function fillLinkPreview(
  doc: Y.Doc,
  elementId: string,
  projectId: string,
  boardId: string,
  url: string,
) {
  let preview: LinkPreview;
  try {
    preview = await api.post<LinkPreview>('/link-previews', { projectId, boardId, url });
  } catch {
    return false;
  }
  updateElement(
    doc,
    elementId,
    {
      ...(preview.title?.trim() ? { title: preview.title.slice(0, 500) } : {}),
      ...(preview.description?.trim() ? { description: preview.description.slice(0, 2000) } : {}),
      ...(preview.imageAssetId ? { imageAssetId: preview.imageAssetId } : {}),
    },
    LOCAL,
  );
  return true;
}
