import { randomUUID } from 'node:crypto';
import { API_PREFIX, CreateLinkPreview, type LinkPreview } from '@inkadra/shared';
import type { FastifyInstance } from 'fastify';
import { Parser } from 'htmlparser2';
import { requireProjectRole } from '../access.ts';
import type { Auth } from '../auth.ts';
import type { Database } from '../db/client.ts';
import { asset } from '../db/schema.ts';
import type { Jobs } from '../jobs.ts';
import { FetchRefused, safeFetch } from '../safe-fetch.ts';
import { originalKey, type Storage } from '../storage.ts';
import { requireActor } from './auth-routes.ts';
import { HttpError } from './errors.ts';
import { cleanMime } from './uploads.ts';

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

/** At most `max` calls per key in a sliding window. */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}
  take(key: string) {
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) return false;
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.hits.clear();
    return true;
  }
}

export function registerLinkPreviews(app: FastifyInstance, deps: Deps) {
  const { db, auth, storage, jobs } = deps;
  // A few previews a minute per person: each one makes the server fetch two URLs.
  const limiter = new RateLimiter(20, 60_000);
  const allowAddresses = deps.allowAddresses ?? [];

  app.post(`${API_PREFIX}/link-previews`, async (req) => {
    const actor = await requireActor(auth, req);
    const input = CreateLinkPreview.parse(req.body);
    await requireProjectRole(db, actor, input.projectId, 'editor');
    if (!limiter.take(actor.id))
      throw new HttpError('rate_limited', 'Too many link previews: wait a minute.');

    let page: Awaited<ReturnType<typeof safeFetch>>;
    try {
      page = await safeFetch(input.url, {
        accept: ['text/html', 'application/xhtml+xml'],
        maxBytes: 1024 * 1024,
        allowAddresses,
      });
    } catch (err) {
      if (err instanceof FetchRefused) throw new HttpError('bad_request', err.message);
      throw err;
    }
    const meta = readPageMeta(page.body.toString('utf8'), page.url);

    let imageAssetId: string | null = null;
    if (meta.image) {
      try {
        const image = await safeFetch(meta.image, {
          accept: ['image/'],
          maxBytes: 10 * 1024 * 1024,
          allowAddresses,
        });
        const id = randomUUID();
        const filename = decodeURIComponent(
          new URL(image.url).pathname.split('/').pop() || 'preview',
        );
        await storage.write(originalKey(id), image.body, image.contentType);
        await db.insert(asset).values({
          id,
          projectId: input.projectId,
          kind: 'image',
          mime: cleanMime(image.contentType, filename),
          filename: filename.slice(0, 255),
          size: image.body.length,
          storageKey: originalKey(id),
          sourceUrl: page.url,
          createdBy: actor.id,
        });
        await jobs.processAsset(id);
        imageAssetId = id;
      } catch (err) {
        // A preview without its image is still useful.
        req.log.info({ err, image: meta.image }, 'link preview image skipped');
      }
    }

    const body: LinkPreview = {
      url: page.url,
      title: meta.title,
      description: meta.description,
      siteName: meta.siteName,
      imageAssetId,
    };
    return body;
  });
}
