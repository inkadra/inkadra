import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, open, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import multipart from '@fastify/multipart';
import { MAX_TAGS } from '@inkadra/doc-schema';
import { API_PREFIX, ClipRequest, type ClipResult } from '@inkadra/shared';
import { Upload } from '@tus/utils';
import { inArray } from 'drizzle-orm';
import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { type Actor, requireBoardRole } from '../access.ts';
import type { Auth } from '../auth.ts';
import type { BoardWriter, NewCard, NoteBlock } from '../board-writer.ts';
import type { Database } from '../db/client.ts';
import { asset } from '../db/schema.ts';
import type { Jobs } from '../jobs.ts';
import { sniffImage } from '../media/heic.ts';
import { CardOutcomeUnknown } from '../queues.ts';
import { FetchRefused, type SafeResponse, safeFetch } from '../safe-fetch.ts';
import { originalKey, type Storage } from '../storage.ts';
import { requireActor } from './auth-routes.ts';
import { HttpError } from './errors.ts';
import {
  type FetchDeps,
  PAGE_MAX_BYTES,
  pagePreview,
  RateLimiter,
  saveFetchedImage,
} from './link-previews.ts';
import { cleanMime, kindOf } from './uploads.ts';

interface Deps {
  db: Database;
  auth: Auth;
  storage: Storage;
  jobs: Jobs;
  /** Missing when no collaboration server can be reached: clips are refused. */
  boards?: BoardWriter;
  /** Bytes; 0 = no limit. */
  uploadMaxSize: number;
  /** Where files sent with a clip wait while they are checked. */
  tmpDir?: string;
  /** Tests only: addresses that may be fetched besides public ones. */
  allowAddresses?: string[];
}

export const CLIP_PATH = `${API_PREFIX}/clip`;

/** Largest image copied from an address: it is held in memory while it is stored. */
const FETCHED_IMAGE_MAX = 50 * 1024 * 1024;

/** The fields of ClipRequest, without its url-or-text rule: in a form, a file can stand in. */
const ClipFields = z.object(ClipRequest.shape);
type ClipFields = z.infer<typeof ClipFields>;

interface TempFile {
  path: string;
  filename: string;
  mime: string;
  size: number;
}

/** As the web app's tag editor writes them: no leading #, single spaces, lower case. */
export function normaliseTags(tags: readonly string[] | undefined): string[] | undefined {
  const out = new Set<string>();
  for (const tag of tags ?? []) {
    const clean = tag.trim().replace(/^#/, '').replace(/\s+/g, ' ').toLowerCase().slice(0, 40);
    if (clean) out.add(clean);
  }
  return out.size > 0 ? [...out].slice(0, MAX_TAGS) : undefined;
}

const isWebUrl = (url: string) => /^https?:\/\//i.test(url);

/** A text clip: the quote, the person's note below it, then a link to where it came from. */
export function textNote(text: string, note?: string, source?: string): NoteBlock[] {
  const blocks: NoteBlock[] = [{ kind: 'quote', text }];
  if (note?.trim()) blocks.push({ kind: 'paragraph', text: note });
  if (source && isWebUrl(source)) {
    blocks.push({ kind: 'link', text: new URL(source).host, href: source });
  }
  return blocks;
}

async function readHead(path: string): Promise<Buffer> {
  const handle = await open(path, 'r');
  try {
    const head = Buffer.alloc(256);
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    return head.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * Reads a multipart clip: fields, and at most one file into the folder `dir()` makes.
 * `boardId` must come before the file, and `check` runs before a byte of it is written, so a
 * file nobody may add to the board is never stored.
 */
async function readForm(
  req: FastifyRequest,
  dir: () => Promise<string>,
  check: (boardId: string) => Promise<unknown>,
): Promise<{ input: ClipFields; file: TempFile | null }> {
  const fields: Record<string, string> = {};
  const tags: string[] = [];
  let file: TempFile | null = null;
  for await (const part of req.parts()) {
    if (part.type === 'file') {
      if (part.fieldname !== 'file' || file) {
        part.file.resume();
        throw new HttpError('bad_request', 'Send one file, in the "file" part.');
      }
      if (!fields.boardId) {
        part.file.resume();
        throw new HttpError('bad_request', 'Send the boardId field before the file.');
      }
      await check(fields.boardId);
      const path = join(await dir(), 'file');
      // Over UPLOAD_MAX_SIZE the stream fails with a 413.
      await pipeline(part.file, createWriteStream(path));
      const size = (await stat(path)).size;
      if (size === 0) throw new HttpError('bad_request', 'The file is empty.');
      file = { path, filename: (part.filename || 'file').slice(0, 255), mime: part.mimetype, size };
      continue;
    }
    const value = typeof part.value === 'string' ? part.value : '';
    if (part.fieldname === 'tags' || part.fieldname === 'tags[]') tags.push(value);
    // Forms send empty fields for inputs left blank: they count as missing.
    else if (value !== '' && !(part.fieldname in fields)) fields[part.fieldname] = value;
  }
  const input = ClipFields.parse({ ...fields, ...(tags.length > 0 ? { tags } : {}) });
  return { input, file };
}

export async function registerClipRoutes(app: FastifyInstance, deps: Deps) {
  const { db, auth, storage, jobs } = deps;
  const fetchDeps: FetchDeps = { db, storage, allowAddresses: deps.allowAddresses ?? [] };
  // Each clip can fetch two addresses or store a large file.
  const limiter = new RateLimiter(30, 60_000);
  const imageMax =
    deps.uploadMaxSize > 0 ? Math.min(deps.uploadMaxSize, FETCHED_IMAGE_MAX) : FETCHED_IMAGE_MAX;

  /** A file sent with the clip, stored as the upload pipeline stores one. */
  async function storeFile(
    file: TempFile,
    ctx: {
      projectId: string;
      actor: Actor;
      sourceUrl?: string;
      created: string[];
      log: FastifyBaseLogger;
    },
  ) {
    // Like an upload, the declared type is a hint; the first bytes tell images apart.
    const sniffed = sniffImage(await readHead(file.path));
    const mime = sniffed ?? cleanMime(file.mime, file.filename);
    const kind = sniffed ? 'image' : kindOf(mime, file.filename);
    const id = randomUUID();
    const key = originalKey(id);
    ctx.created.push(id);
    // Through the upload store, which streams large files to the bucket in parts.
    try {
      await storage.uploads.create(
        new Upload({
          id: key,
          size: file.size,
          offset: 0,
          metadata: { filename: file.filename, filetype: mime },
        }),
      );
      const offset = await storage.uploads.write(createReadStream(file.path), key, 0);
      if (offset !== file.size) throw new Error(`Stored ${offset} of ${file.size} bytes`);
    } catch (err) {
      // Aborts the bucket's multipart upload too, whose parts deleting the key would leave.
      await storage.uploads
        .remove(key)
        .catch((e) => ctx.log.warn({ err: e, key }, 'unfinished clip file not removed'));
      throw err;
    }
    await db.insert(asset).values({
      id,
      projectId: ctx.projectId,
      kind,
      mime,
      filename: file.filename,
      size: file.size,
      storageKey: key,
      sourceUrl: ctx.sourceUrl ?? null,
      createdBy: ctx.actor.id,
    });
    return { id, kind };
  }

  /** An image at the address becomes an image card; anything else a link card with a preview. */
  async function fromUrl(
    url: string,
    input: ClipFields,
    ctx: { projectId: string; actor: Actor; created: string[]; log: FastifyBaseLogger },
  ): Promise<{ card: NewCard; assetId: string | null }> {
    const owner = { projectId: ctx.projectId, actorId: ctx.actor.id };
    let fetched: SafeResponse | null = null;
    try {
      fetched = await safeFetch(url, {
        accept: ['image/', 'text/html', 'application/xhtml+xml'],
        // Pages are read whole and parsed: as small as for link previews.
        maxBytes: (type) => (type.startsWith('image/') ? imageMax : PAGE_MAX_BYTES),
        allowAddresses: fetchDeps.allowAddresses,
      });
    } catch (err) {
      // Refused, unreachable, cut off: the link is worth keeping even when it cannot be read.
      ctx.log.info({ err, url }, 'clip saved without a preview');
    }
    if (fetched?.contentType.startsWith('image/')) {
      try {
        const id = await saveFetchedImage(fetchDeps, fetched, {
          ...owner,
          sourceUrl: input.sourceUrl ?? url,
        });
        ctx.created.push(id);
        return {
          card: { type: 'image', fields: { assetId: id, caption: input.note } },
          assetId: id,
        };
      } catch (err) {
        // Not an image after all (its first bytes say so): a plain link card.
        if (!(err instanceof FetchRefused)) throw err;
        ctx.log.info({ err, url }, 'clipped address is not an image');
        fetched = null;
      }
    }
    const preview = fetched ? await pagePreview(fetchDeps, fetched, owner, ctx.log) : null;
    if (preview?.imageAssetId) ctx.created.push(preview.imageAssetId);
    return {
      card: {
        type: 'link',
        fields: {
          url,
          title: preview?.title ?? undefined,
          // The person's own words come first: they say why the link was saved.
          description: input.note ?? preview?.description ?? undefined,
          imageAssetId: preview?.imageAssetId ?? undefined,
        },
      },
      assetId: null,
    };
  }

  /**
   * Assets of a clip whose card is (or may be) on the board. Never fails: if the queue is
   * down, the upload purge queues assets still pending a day later.
   */
  async function process(ids: string[], log: FastifyBaseLogger) {
    for (const id of ids)
      await jobs.processAsset(id).catch((err) => log.error({ err, id }, 'clip asset not queued'));
  }

  /** Assets of a clip that did not make it onto the board. */
  async function discard(ids: string[], log: FastifyBaseLogger) {
    try {
      await db.delete(asset).where(inArray(asset.id, ids));
      await jobs.deleteFiles(ids.map(originalKey));
    } catch (err) {
      log.error({ err, ids }, 'clip files not removed');
    }
  }

  await app.register(async (scope) => {
    // Only this route takes forms.
    await scope.register(multipart, {
      limits: {
        // One more than allowed, so a second file gets the 400 below rather than a 413.
        files: 2,
        fields: 40,
        fieldSize: 25_000,
        // Left out, the limit would default to Fastify's 1 MiB bodyLimit.
        fileSize: deps.uploadMaxSize > 0 ? deps.uploadMaxSize : Number.POSITIVE_INFINITY,
      },
    });

    scope.post(CLIP_PATH, async (req, reply) => {
      const actor = await requireActor(auth, req, db);
      const boards = deps.boards;
      if (!boards)
        throw new HttpError('internal', 'Clips need the collaboration server: set REDIS_URL.');
      if (!limiter.take(actor.id))
        throw new HttpError('rate_limited', 'Too many clips: wait a minute.');

      const checked = new Map<string, ReturnType<typeof requireBoardRole>>();
      const check = (boardId: string) => {
        let access = checked.get(boardId);
        if (!access) {
          access = requireBoardRole(db, actor, boardId, 'editor');
          checked.set(boardId, access);
        }
        return access;
      };

      // Made only when a file arrives.
      let dir: Promise<string> | undefined;
      const makeDir = () => {
        dir ??= mkdtemp(join(deps.tmpDir ?? tmpdir(), 'clip-'));
        return dir;
      };
      const created: string[] = [];
      try {
        const { input, file } = req.isMultipart()
          ? await readForm(req, makeDir, (id) => check(ClipFields.shape.boardId.parse(id)))
          : { input: ClipRequest.parse(req.body), file: null };
        const text = input.text?.trim() ? input.text : undefined;
        if (!file && !input.url && !text)
          throw new HttpError('bad_request', 'Send a url, a text or a file.');
        // Kept on the asset and shown as a link: nothing but web addresses.
        if (input.sourceUrl && !isWebUrl(input.sourceUrl))
          throw new HttpError('bad_request', 'sourceUrl must be an http or https address.');
        const access = await check(input.boardId);
        const ctx = { projectId: access.board.projectId, actor, created, log: req.log };

        let card: NewCard;
        let assetId: string | null = null;
        if (file) {
          const stored = await storeFile(file, { ...ctx, sourceUrl: input.sourceUrl });
          assetId = stored.id;
          card =
            stored.kind === 'image'
              ? { type: 'image', fields: { assetId, caption: input.note } }
              : { type: 'file', fields: { assetId } };
        } else if (text) {
          card = {
            type: 'note',
            fields: {},
            body: textNote(text, input.note, input.sourceUrl ?? input.url),
          };
        } else {
          const url = input.url as string;
          if (!isWebUrl(url))
            throw new HttpError('bad_request', 'Only http and https addresses can be clipped.');
          ({ card, assetId } = await fromUrl(url, input, ctx));
        }
        card.fields.tags = normaliseTags(input.tags);

        let placed: Awaited<ReturnType<BoardWriter['addCard']>>;
        try {
          placed = await boards.addCard({
            boardId: input.boardId,
            columnId: input.columnId,
            userId: actor.id,
            card,
          });
        } catch (err) {
          if (!(err instanceof CardOutcomeUnknown)) throw err;
          // The card may be on the board: its assets must stay. Unused, they cost only space.
          await process(created.splice(0), req.log);
          req.log.error({ err, boardId: input.boardId }, 'clip outcome unknown');
          throw new HttpError(
            'internal',
            'The board did not confirm the clip in time: check it before trying again.',
          );
        }
        if (!placed.ok)
          throw placed.reason === 'column'
            ? new HttpError('bad_request', 'The column is not on this board.')
            : new HttpError('internal', 'The board could not be reached in time: try again.');
        // On the board now: from here the assets are the card's, and the clip has succeeded.
        await process(created.splice(0), req.log);
        const body: ClipResult = { boardId: input.boardId, elementId: placed.elementId, assetId };
        return reply.status(201).send(body);
      } finally {
        if (created.length > 0) await discard(created, req.log);
        if (dir)
          await dir.then(
            (d) => rm(d, { recursive: true, force: true }),
            () => {},
          );
      }
    });
  });
}
