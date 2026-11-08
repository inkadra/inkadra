import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { API_PREFIX, type AssetKind, Id, UploadMetadata } from '@inkadra/shared';
import { Server as TusServer } from '@tus/server';
import type { DataStore } from '@tus/utils';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { type Actor, requireAssetRole, requireWriteAccess } from '../access.ts';
import type { Auth } from '../auth.ts';
import type { Config } from '../config.ts';
import type { Database } from '../db/client.ts';
import { asset } from '../db/schema.ts';
import type { Jobs } from '../jobs.ts';
import { designExtension } from '../media/design.ts';
import { sniffImage } from '../media/heic.ts';
import { rawTypeOf } from '../media/raw.ts';
import { originalKey, type Storage } from '../storage.ts';
import { reserveSpace, StorageFullError } from '../storage-limits.ts';
import { requireActor } from './auth-routes.ts';
import { HttpError, sendError } from './errors.ts';

interface Deps {
  config: Config;
  db: Database;
  auth: Auth;
  storage: Storage;
  jobs: Jobs;
  uploadMaxSize: number;
}

export const UPLOADS_PATH = `${API_PREFIX}/uploads`;
export const ASSET_ID_HEADER = 'Inkadra-Asset-Id';

/** Per-request state shared between the Fastify handler and the tus hooks. */
const context = new AsyncLocalStorage<{ actor: Actor; assetId: string }>();

const HEIC = /\.(heic|heif)$/i;
/** Audio files browsers often send without a type (#327). */
const AUDIO = /\.(mp3|m4a|aac|wav|flac|ogg|oga|opus|aif|aiff|caf)$/i;

/**
 * Asset kind from the declared type, falling back on the extension for HEIC from iPhones,
 * camera RAW files and audio files, which browsers often send without a type.
 */
export function kindOf(mime: string, filename: string): AssetKind {
  if (designExtension(filename)) return 'file';
  if (mime.startsWith('image/') || HEIC.test(filename) || rawTypeOf(filename)) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/') || (mime === 'application/octet-stream' && AUDIO.test(filename)))
    return 'audio';
  return 'file';
}

/** The declared type is a hint only: keep it to a plain `type/subtype`. */
export function cleanMime(mime: string, filename: string): string {
  const base = mime.split(';')[0]?.trim().toLowerCase() ?? '';
  if (/^[a-z]+\/[a-z0-9.+-]+$/.test(base) && base !== 'application/octet-stream') return base;
  if (HEIC.test(filename))
    return filename.toLowerCase().endsWith('.heif') ? 'image/heif' : 'image/heic';
  return rawTypeOf(filename) ?? 'application/octet-stream';
}

/** The files a demo sandbox may upload, by declared type, with their extensions. */
const DEMO_TYPES: Record<string, RegExp> = {
  'image/jpeg': /\.jpe?g$/i,
  'image/png': /\.png$/i,
  'image/webp': /\.webp$/i,
  'image/gif': /\.gif$/i,
  'application/pdf': /\.pdf$/i,
  'text/plain': /\.txt$/i,
};

export function demoTypeAllowed(mime: string, filename: string): boolean {
  return DEMO_TYPES[mime]?.test(filename) ?? false;
}

/** Control characters other than tab, line feed and carriage return, C1 controls included. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: finding control characters is the point.
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

/**
 * Whether the bytes of an uploaded file match its type: no HTML or SVG named .png. Pictures
 * and PDFs by their first bytes, a PDF with its header right at the start (stricter than
 * `isPdf`, which tolerates leading junk for files outside the demo); text as a whole, valid
 * UTF-8 without control characters.
 */
export function demoBytesMatch(mime: string, bytes: Uint8Array): boolean {
  if (mime.startsWith('image/')) return sniffImage(bytes) === mime;
  if (mime === 'application/pdf')
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      .subarray(0, 5)
      .equals(Buffer.from('%PDF-'));
  if (mime === 'text/plain') {
    try {
      return !CONTROL.test(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      return false;
    }
  }
  return false;
}

async function demoContentMatches(storage: Storage, key: string, assetId: string, db: Database) {
  const [row] = await db.select({ mime: asset.mime }).from(asset).where(eq(asset.id, assetId));
  if (!row) return false;
  // Text is read whole (10 MB at most in the demo): binary after a page of text is refused.
  const range = row.mime === 'text/plain' ? undefined : { start: 0, end: 4095 };
  const chunks: Buffer[] = [];
  for await (const chunk of await storage.read(key, range)) chunks.push(chunk as Buffer);
  return demoBytesMatch(row.mime, Buffer.concat(chunks));
}

function tusError(status: number, message: string) {
  return { status_code: status, body: message };
}

/**
 * The upload store, with the pending asset of a cancelled upload removed in the same step.
 * tus writes the 204 right after `remove` returns, so deleting the row any later would let a
 * client that asks for the asset straight away still find it.
 */
function removingAssets(store: DataStore, db: Database): DataStore {
  return new Proxy(store, {
    get(target, prop) {
      if (prop === 'remove')
        return async (id: string) => {
          await target.remove(id);
          await db.delete(asset).where(eq(asset.id, id.slice('originals/'.length)));
        };
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export function registerUploads(app: FastifyInstance, deps: Deps) {
  const { config, db, auth, storage, jobs } = deps;
  const datastore = removingAssets(storage.uploads, db);

  /** A refusal for lack of space, as the client reads it (StorageFull). */
  const full = (err: unknown) =>
    err instanceof StorageFullError ? tusError(413, JSON.stringify(err.refused)) : err;

  const tus = new TusServer({
    path: UPLOADS_PATH,
    datastore,
    relativeLocation: true,
    // Finished uploads are assets: they are deleted with their board or project, not here.
    disableTerminationForFinishedUploads: true,
    maxSize: deps.uploadMaxSize > 0 ? deps.uploadMaxSize : undefined,
    exposedHeaders: [ASSET_ID_HEADER],
    // The id in the URL is the asset id; the file id is its storage key.
    namingFunction: () => {
      const ctx = context.getStore();
      if (!ctx) throw new Error('Upload outside a request');
      return originalKey(ctx.assetId);
    },
    generateUrl: (_req, { path, id }) => `${path}/${id.slice('originals/'.length)}`,
    getFileIdFromRequest: (_req, lastPath) =>
      lastPath && Id.safeParse(lastPath).success ? originalKey(lastPath) : undefined,
    async onUploadCreate(_req, upload) {
      const ctx = context.getStore();
      if (!ctx) throw tusError(500, 'Upload outside a request');
      if (upload.size === undefined) throw tusError(400, 'Upload-Length is required.');
      const meta = UploadMetadata.safeParse(upload.metadata ?? {});
      if (!meta.success)
        throw tusError(400, 'Upload-Metadata needs projectId, filename and filetype.');
      try {
        await requireWriteAccess(db, ctx.actor, meta.data.projectId, meta.data.boardId);
      } catch (err) {
        if (err instanceof HttpError)
          throw tusError(
            err.code === 'forbidden' ? 403 : err.code === 'bad_request' ? 400 : 404,
            err.message,
          );
        throw err;
      }
      const { filename, filetype, projectId } = meta.data;
      const mime = cleanMime(filetype, filename);
      if (config.DEMO_MODE && !demoTypeAllowed(mime, filename))
        throw tusError(415, 'The demo takes JPEG, PNG, WebP, GIF, PDF and plain text files.');
      const size = upload.size;
      // The declared size holds its place from now on: see reserveSpace (decision 0081).
      await reserveSpace(db, config, ctx.actor.id, size, async (tx) => {
        await tx.insert(asset).values({
          id: ctx.assetId,
          projectId,
          kind: kindOf(mime, filename),
          mime,
          filename,
          size,
          storageKey: originalKey(ctx.assetId),
          createdBy: ctx.actor.id,
        });
      }).catch((err) => {
        throw full(err);
      });
      return {};
    },
    async onUploadFinish(_req, upload) {
      const assetId = upload.id.slice('originals/'.length);
      // Checked again with the last byte: a limit lowered meanwhile still applies.
      const [row] = await db
        .select({ createdBy: asset.createdBy })
        .from(asset)
        .where(eq(asset.id, assetId));
      if (row?.createdBy && upload.size !== undefined)
        try {
          await reserveSpace(db, config, row.createdBy, upload.size, async () => {}, assetId);
        } catch (err) {
          if (err instanceof StorageFullError) await datastore.remove(upload.id);
          throw full(err);
        }
      // The demo checks what the file is, not only what it says (decision 0084).
      if (config.DEMO_MODE && !(await demoContentMatches(storage, upload.id, assetId, db))) {
        await datastore.remove(upload.id);
        throw tusError(415, 'The file is not what its type says.');
      }
      await jobs.processAsset(assetId);
      return {};
    },
  });

  // tus reads the request body itself: keep Fastify from parsing it.
  app.addContentTypeParser('application/offset+octet-stream', (_req, _payload, done) => done(null));

  async function handle(req: FastifyRequest, reply: import('fastify').FastifyReply) {
    if (req.method === 'OPTIONS') {
      reply.hijack();
      return tus.handle(req.raw, reply.raw);
    }
    const actor = await requireActor(auth, req, db);
    let assetId: string;
    if (req.method === 'POST') {
      assetId = randomUUID();
    } else {
      const { uploadId } = req.params as { uploadId?: string };
      if (!uploadId || !Id.safeParse(uploadId).success)
        return sendError(reply, 'not_found', 'Upload not found.');
      // Only the person who started an upload may resume, read or cancel it, while they can
      // still add files to the project.
      const { asset: row } = await requireAssetRole(db, actor, uploadId, 'editor');
      if (row.createdBy !== actor.id) return sendError(reply, 'not_found', 'Upload not found.');
      assetId = uploadId;
    }
    reply.raw.setHeader(ASSET_ID_HEADER, assetId);
    reply.hijack();
    await context.run({ actor, assetId }, () => tus.handle(req.raw, reply.raw));
  }

  const methods = ['POST', 'OPTIONS'] as const;
  app.route({ method: [...methods], url: UPLOADS_PATH, handler: handle });
  app.route({
    method: ['HEAD', 'PATCH', 'DELETE', 'OPTIONS'],
    url: `${UPLOADS_PATH}/:uploadId`,
    // The tus HEAD response is not a GET without body: let tus answer it.
    exposeHeadRoute: false,
    handler: handle,
  });

  return tus;
}
