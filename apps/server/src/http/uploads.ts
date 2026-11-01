import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { API_PREFIX, type AssetKind, Id, UploadMetadata } from '@inkadra/shared';
import { Server as TusServer } from '@tus/server';
import type { DataStore } from '@tus/utils';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { type Actor, requireAssetRole, requireWriteAccess } from '../access.ts';
import type { Auth } from '../auth.ts';
import type { Database } from '../db/client.ts';
import { asset } from '../db/schema.ts';
import type { Jobs } from '../jobs.ts';
import { rawTypeOf } from '../media/raw.ts';
import { originalKey, type Storage } from '../storage.ts';
import { requireActor } from './auth-routes.ts';
import { HttpError, sendError } from './errors.ts';

interface Deps {
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
  const { db, auth, storage, jobs } = deps;

  const tus = new TusServer({
    path: UPLOADS_PATH,
    datastore: removingAssets(storage.uploads, db),
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
      await db.insert(asset).values({
        id: ctx.assetId,
        projectId,
        kind: kindOf(mime, filename),
        mime,
        filename,
        size: upload.size,
        storageKey: originalKey(ctx.assetId),
        createdBy: ctx.actor.id,
      });
      return {};
    },
    async onUploadFinish(_req, upload) {
      const assetId = upload.id.slice('originals/'.length);
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
