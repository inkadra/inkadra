import { randomUUID } from 'node:crypto';
import { API_PREFIX, CreateLinkPreview, type LinkPreview, youtubeVideoId } from '@inkadra/shared';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { Parser } from 'htmlparser2';
import { requireWriteAccess } from '../access.ts';
import type { Auth } from '../auth.ts';
import type { Database } from '../db/client.ts';
import { asset } from '../db/schema.ts';
import type { Jobs } from '../jobs.ts';
import { sniffImage } from '../media/heic.ts';
import { ENQUEUE_TIMEOUT_MS, within } from '../queues.ts';
import { RateLimiter } from '../rate-limits.ts';
import { FetchRefused, type SafeResponse, safeFetch } from '../safe-fetch.ts';
import { originalKey, type Storage } from '../storage.ts';
import { requireActor } from './auth-routes.ts';
import { HttpError } from './errors.ts';

export { RateLimiter } from '../rate-limits.ts';

interface Deps {
  db: Database;
  auth: Auth;
  storage: Storage;
  jobs: Jobs;
  /** Tests only: addresses link previews may fetch besides public ones. */
  allowAddresses?: string[];
}

export interface PageMeta {
  title: string | null;
  description: string | null;
  siteName: string | null;
  image: string | null;
}

const clip = (value: string | undefined, max: number) => {
  const clean = value?.replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, max) : null;
};

/** Open Graph, Twitter card and plain HTML metadata of a page, first match wins. */
export function readPageMeta(html: string, pageUrl: string): PageMeta {
  const meta = new Map<string, string>();
  let title = '';
  let inTitle = false;
  let done = false;
  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (name === 'title') inTitle = true;
        if (name === 'meta') {
          const key = (attrs.property ?? attrs.name ?? '').toLowerCase();
          if (key && attrs.content !== undefined && !meta.has(key)) meta.set(key, attrs.content);
        }
        if (name === 'body') done = true;
      },
      ontext(text) {
        if (inTitle) title += text;
      },
      onclosetag(name) {
        if (name === 'title') inTitle = false;
      },
    },
    { decodeEntities: true },
  );
  // Metadata lives in <head>: stop at <body> rather than parse a whole page.
  for (let i = 0; i < html.length && !done; i += 16_384) parser.write(html.slice(i, i + 16_384));
  parser.end();

  const first = (...keys: string[]) => keys.map((k) => meta.get(k)).find((v) => v?.trim());
  let image: string | null = null;
  const rawImage = first('og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image');
  if (rawImage) {
    try {
      const url = new URL(rawImage.trim(), pageUrl);
      if (url.protocol === 'https:' || url.protocol === 'http:') image = url.toString();
    } catch {}
  }
  return {
    title: clip(first('og:title', 'twitter:title') ?? title, 500),
    description: clip(first('og:description', 'twitter:description', 'description'), 2000),
    siteName: clip(first('og:site_name', 'application-name'), 200),
    image,
  };
}

/** 4:21 or 1:02:03 from a number of seconds; null for anything else. */
export function clockTime(seconds: unknown): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null;
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

const INSTAGRAM_POST = /^\/(?:[\w.]+\/)?(?:p|reel|reels|tv)\/[\w-]+\/?$/;

/**
 * Instagram serves Open Graph tags like `Name on Instagram: "caption"` and
 * `12 likes, 1 comments - handle on May 3, 2025: "caption"`. The card shows the caption as its
 * title and the author handle below. Without those shapes the page metadata stands as it is.
 * shortcut: no oEmbed, Instagram's needs an app token; when Instagram hides the tags behind a
 * login page the card is a plain link.
 */
export function instagramMeta(meta: PageMeta, pageUrl: string): PageMeta {
  let post = false;
  try {
    const url = new URL(pageUrl);
    post = /^(www\.)?instagram\.com$/.test(url.hostname) && INSTAGRAM_POST.test(url.pathname);
  } catch {}
  if (!post) return meta;
  const quote = /["“](.*)["”]\.?\s*$/s;
  const caption = quote.exec(meta.title ?? '')?.[1] ?? quote.exec(meta.description ?? '')?.[1];
  const handle = /^[^-]*- (\S+) on /.exec(meta.description ?? '')?.[1];
  const name = /^(.+?) on Instagram/.exec(meta.title ?? '')?.[1];
  const author = handle ? `@${handle}` : name;
  return {
    ...meta,
    title: clip(caption, 140) ?? (author ? `${author} on Instagram` : meta.title),
    description: author ? clip(author, 200) : meta.description,
    siteName: 'Instagram',
  };
}

/** Provider metadata never bypasses safeFetch's network and response limits. */
export async function videoPageMeta(
  url: string,
  allowAddresses: string[],
): Promise<PageMeta | null> {
  const id = youtubeVideoId(url);
  let endpoint: string;
  if (id)
    endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`;
  else {
    const parsed = new URL(url);
    if (!/^(www\.)?vimeo\.com$/.test(parsed.hostname) || !/^\/\d+\/?$/.test(parsed.pathname))
      return null;
    endpoint = `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}&width=1280`;
  }
  try {
    const response = await safeFetch(endpoint, {
      accept: ['application/json'],
      maxBytes: 64 * 1024,
      allowAddresses,
    });
    const data = JSON.parse(response.body.toString('utf8'));
    if (typeof data.title !== 'string' || !data.title.trim()) return null;
    return {
      title: clip(data.title, 500),
      description:
        [
          typeof data.author_name === 'string' ? clip(data.author_name, 2000) : null,
          id ? null : clockTime(data.duration),
        ]
          .filter(Boolean)
          .join(' · ') || null,
      siteName: id ? 'YouTube' : 'Vimeo',
      image: id
        ? `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`
        : typeof data.thumbnail_url === 'string'
          ? data.thumbnail_url
          : null,
    };
  } catch {
    return null;
  }
}

/** Largest page read for a preview: its head is all that is needed. */
export const PAGE_MAX_BYTES = 1024 * 1024;

export interface FetchDeps {
  db: Database;
  storage: Storage;
  allowAddresses: string[];
}

/** Last part of the path of an address, decoded, for the name of a fetched file. */
export function nameFromUrl(url: string, fallback: string): string {
  const last = new URL(url).pathname.split('/').pop() ?? '';
  try {
    return (decodeURIComponent(last) || fallback).slice(0, 255);
  } catch {
    return (last || fallback).slice(0, 255);
  }
}

/**
 * Copies a fetched image into the project as a new asset. The caller queues its processing.
 * Like an upload, the declared type is a hint: a body whose first bytes are not an image is
 * refused with FetchRefused.
 */
export async function saveFetchedImage(
  deps: Pick<FetchDeps, 'db' | 'storage'>,
  image: SafeResponse,
  opts: { projectId: string; actorId: string; sourceUrl: string; filename?: string },
): Promise<string> {
  const mime = sniffImage(image.body.subarray(0, 256));
  if (!mime) throw new FetchRefused('The address does not hold an image.');
  const id = randomUUID();
  const filename = opts.filename ?? nameFromUrl(image.url, 'image');
  await deps.storage.write(originalKey(id), image.body, mime);
  try {
    await deps.db.insert(asset).values({
      id,
      projectId: opts.projectId,
      kind: 'image',
      mime,
      filename,
      size: image.body.length,
      storageKey: originalKey(id),
      sourceUrl: opts.sourceUrl,
      createdBy: opts.actorId,
    });
  } catch (err) {
    // Without its row nothing would ever find the file.
    await deps.storage.remove([originalKey(id)]).catch(() => {});
    throw err;
  }
  return id;
}

/**
 * Title, description and site of a fetched page, with a copy of its image when it has one.
 * The caller queues the processing of `imageAssetId`.
 */
export async function pagePreview(
  deps: FetchDeps,
  page: SafeResponse,
  opts: { projectId: string; actorId: string },
  log: FastifyBaseLogger,
): Promise<LinkPreview> {
  const meta =
    (await videoPageMeta(page.url, deps.allowAddresses)) ??
    instagramMeta(readPageMeta(page.body.toString('utf8'), page.url), page.url);
  let imageAssetId: string | null = null;
  const videoId = youtubeVideoId(page.url);
  const images = [
    meta.image,
    ...(videoId ? [`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`] : []),
  ];
  for (const imageUrl of images) {
    if (!imageUrl || imageAssetId) continue;
    try {
      const image = await safeFetch(imageUrl, {
        accept: ['image/'],
        maxBytes: 10 * 1024 * 1024,
        allowAddresses: deps.allowAddresses,
      });
      imageAssetId = await saveFetchedImage(deps, image, { ...opts, sourceUrl: page.url });
    } catch (err) {
      // A preview without its image is still useful.
      log.info({ err, image: meta.image }, 'link preview image skipped');
    }
  }
  return {
    url: page.url,
    title: meta.title,
    description: meta.description,
    siteName: meta.siteName,
    imageAssetId,
  };
}

export function registerLinkPreviews(app: FastifyInstance, deps: Deps) {
  const { db, auth, storage, jobs } = deps;
  // A few previews a minute per person: each one makes the server fetch two URLs.
  const limiter = new RateLimiter(20, 60_000);
  const allowAddresses = deps.allowAddresses ?? [];

  app.post(`${API_PREFIX}/link-previews`, async (req) => {
    const actor = await requireActor(auth, req, db);
    const input = CreateLinkPreview.parse(req.body);
    await requireWriteAccess(db, actor, input.projectId, input.boardId);
    if (!limiter.take(actor.id))
      throw new HttpError('rate_limited', 'Too many link previews: wait a minute.');

    let page: Awaited<ReturnType<typeof safeFetch>>;
    try {
      page = await safeFetch(input.url, {
        accept: ['text/html', 'application/xhtml+xml'],
        maxBytes: PAGE_MAX_BYTES,
        truncate: true,
        allowAddresses,
      });
    } catch (err) {
      if (err instanceof FetchRefused) throw new HttpError('bad_request', err.message);
      throw err;
    }
    const body = await pagePreview(
      { db, storage, allowAddresses },
      page,
      { projectId: input.projectId, actorId: actor.id },
      req.log,
    );
    // The preview stands without thumbnails: the upload purge queues the image later.
    if (body.imageAssetId)
      await within(
        jobs.processAsset(body.imageAssetId),
        ENQUEUE_TIMEOUT_MS,
        'The job queue did not answer.',
      ).catch((err) =>
        req.log.error({ err, id: body.imageAssetId }, 'link preview image not queued'),
      );
    return body;
  });
}
