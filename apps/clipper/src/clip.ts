// SPDX-License-Identifier: MPL-2.0
import type { ClipResult } from '@inkadra/shared';
import type { InkadraApi } from './api.ts';
import { ClipperError } from './errors.ts';

/** What can be saved: a link card, a quote (note) or an image. */
export type ClipContent =
  | { kind: 'link'; url: string; title?: string; sourceUrl?: string }
  | { kind: 'text'; text: string; sourceUrl?: string }
  | { kind: 'image'; srcUrl: string; sourceUrl?: string };

export interface ClipTarget {
  boardId: string;
  /** Omitted: the server puts the card in "Non ordinati". */
  columnId?: string;
  note?: string;
  tags?: string[];
}

/** Ways to get the bytes of an image, tried in order until one answers. */
export type ImageFetcher = (srcUrl: string) => Promise<Blob | null>;

export interface ClipDeps {
  api: InkadraApi;
  imageFetchers: ImageFetcher[];
  /** 0 means no limit. */
  uploadMaxBytes: number;
}

const MAX_TEXT = 20_000;
const MAX_NOTE = 2_000;
const MAX_TAGS = 20;
const MAX_TAG = 40;

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'image/heic': 'heic',
  'image/bmp': 'bmp',
};

/** Splits "a, b,,c" into tags the API accepts: trimmed, unique, at most 20 of 40 characters. */
export function parseTags(input: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of input.split(',')) {
    const tag = raw.trim().slice(0, MAX_TAG);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length === MAX_TAGS) break;
  }
  return tags;
}

/** Only http(s) pages can be a sourceUrl or a link card; chrome:// and file:// are dropped. */
export function webUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function imageFilename(srcUrl: string, type: string): string {
  const ext = EXTENSIONS[type.split(';')[0]?.trim().toLowerCase() ?? ''] ?? 'jpg';
  try {
    const url = new URL(srcUrl);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      const last = decodeURIComponent(url.pathname.split('/').pop() ?? '');
      const clean = last.replace(/[^\w.\- ]+/g, '').slice(0, 120);
      if (/\.[a-z0-9]{2,5}$/i.test(clean)) return clean;
      if (clean) return `${clean}.${ext}`;
    }
  } catch {
    // Fall through to the generic name.
  }
  return `image.${ext}`;
}

function base(target: ClipTarget) {
  const note = target.note?.trim().slice(0, MAX_NOTE);
  return {
    boardId: target.boardId,
    ...(target.columnId ? { columnId: target.columnId } : {}),
    ...(note ? { note } : {}),
    ...(target.tags && target.tags.length > 0 ? { tags: target.tags } : {}),
  };
}

async function fetchImage(fetchers: ImageFetcher[], srcUrl: string): Promise<Blob | null> {
  for (const fetcher of fetchers) {
    try {
      const blob = await fetcher(srcUrl);
      if (blob && blob.size > 0) return blob;
    } catch (err) {
      if (err instanceof ClipperError) throw err;
      // Try the next way.
    }
  }
  return null;
}

export async function saveClip(
  deps: ClipDeps,
  target: ClipTarget,
  content: ClipContent,
): Promise<ClipResult> {
  const sourceUrl = webUrl(content.sourceUrl);
  const common = { ...base(target), ...(sourceUrl ? { sourceUrl } : {}) };

  if (content.kind === 'link') {
    const url = webUrl(content.url);
    if (!url) throw new ClipperError('bad_request', 'Only web pages can be saved as links.');
    // A link saved from its own page needs no sourceUrl.
    const { sourceUrl: _, ...rest } = common;
    const title = content.title?.trim().slice(0, 500);
    return deps.api.clip({
      ...(sourceUrl === url ? rest : common),
      url,
      ...(title ? { title } : {}),
    });
  }

  if (content.kind === 'text') {
    const text = content.text.trim().slice(0, MAX_TEXT);
    if (!text) throw new ClipperError('bad_request', 'The selection is empty.');
    return deps.api.clip({ ...common, text });
  }

  // Images: bytes first, because many are behind a login the server does not have.
  const blob = await fetchImage(deps.imageFetchers, content.srcUrl);
  if (blob) {
    if (deps.uploadMaxBytes > 0 && blob.size > deps.uploadMaxBytes)
      throw new ClipperError('too_large');
    const { tags: _, ...fields } = common;
    return deps.api.clipFile(fields, blob, imageFilename(content.srcUrl, blob.type));
  }
  const url = webUrl(content.srcUrl);
  if (!url) throw new ClipperError('bad_request', 'The image could not be read.');
  return deps.api.clip({ ...common, url });
}

/** Address of a board in the web app. */
export function boardUrl(serverUrl: string, board: { id: string; projectId: string }): string {
  return `${serverUrl}/p/${encodeURIComponent(board.projectId)}/b/${encodeURIComponent(board.id)}`;
}
