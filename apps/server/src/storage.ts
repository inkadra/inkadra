import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { FileStore } from '@tus/file-store';
import { S3Store } from '@tus/s3-store';
import type { DataStore } from '@tus/utils';
import type { Config } from './config.ts';

/**
 * File storage, on a local volume or an S3-compatible bucket.
 *
 * Keys are relative paths: originals at `originals/<assetId>` (written by the tus store, which
 * names files after the upload id), thumbnails at `variants/<assetId>/<size>.webp`, and the
 * moving copies of animated pictures at `variants/<assetId>/<size>-animated.webp`.
 * Files never change once written, so they can be cached forever.
 */
export interface Storage {
  /** Datastore for resumable uploads; file ids are storage keys. */
  readonly uploads: DataStore;
  size(key: string): Promise<number | null>;
  /** Byte range is inclusive, as in HTTP. */
  read(key: string, range?: { start: number; end: number }): Promise<Readable>;
  write(key: string, body: Buffer, contentType: string): Promise<void>;
  /** A local path to the file, downloading it first when needed. Call `done` afterwards. */
  localCopy(key: string, tmpDir: string): Promise<{ path: string; done: () => Promise<void> }>;
  remove(keys: string[]): Promise<void>;
}

/** Hours before an unfinished upload is removed. */
export const UPLOAD_EXPIRY_MS = 24 * 60 * 60 * 1000;

export const originalKey = (assetId: string) => `originals/${assetId}`;
export const variantKey = (assetId: string, size: string) => `variants/${assetId}/${size}.webp`;
/** The moving copy of a thumbnail, for GIF and animated WebP sources. Served with `?animated=1`. */
export const animatedVariantKey = (assetId: string, size: string) =>
  `variants/${assetId}/${size}-animated.webp`;

const SAFE_KEY = /^[a-z]+(\/[A-Za-z0-9._-]+)+$/;
function checkKey(key: string) {
  if (!SAFE_KEY.test(key) || key.includes('..')) throw new Error(`Invalid storage key ${key}`);
}

export function createStorage(config: Config): Storage {
  return config.STORAGE_DRIVER === 's3'
    ? s3Storage(config)
    : localStorage(join(config.DATA_DIR, 'files'));
}

export function localStorage(root: string): Storage {
  const base = resolve(root);
  const path = (key: string) => {
    checkKey(key);
    const full = resolve(base, key);
    if (!full.startsWith(base + sep)) throw new Error(`Invalid storage key ${key}`);
    return full;
  };
  // FileStore only creates its own directory: the originals/ prefix must exist.
  const uploads = new FileStore({
    directory: base,
    expirationPeriodInMilliseconds: UPLOAD_EXPIRY_MS,
  });
  const ready = mkdir(join(base, 'originals'), { recursive: true });

  return {
    uploads,
    async size(key) {
      try {
        return (await stat(path(key))).size;
      } catch {
        return null;
      }
    },
    async read(key, range) {
      await ready;
      return createReadStream(path(key), range);
    },
    async write(key, body) {
      const target = path(key);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, body);
    },
    async localCopy(key) {
      return { path: path(key), done: async () => {} };
    },
    async remove(keys) {
      for (const key of keys) {
        await rm(path(key), { force: true });
        // The tus store keeps upload state next to the file.
        if (key.startsWith('originals/')) await rm(`${path(key)}.json`, { force: true });
      }
    },
  };
}

function s3Storage(config: Config): Storage {
  const bucket = config.S3_BUCKET as string;
  const clientConfig: S3ClientConfig = {
    region: config.S3_REGION,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    ...(config.S3_ENDPOINT ? { endpoint: config.S3_ENDPOINT } : {}),
    ...(config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY
      ? {
          credentials: {
            accessKeyId: config.S3_ACCESS_KEY_ID,
            secretAccessKey: config.S3_SECRET_ACCESS_KEY,
          },
        }
      : {}),
  };
  const client = new S3Client(clientConfig);
  const uploads = new S3Store({
    s3ClientConfig: { ...clientConfig, bucket },
    expirationPeriodInMilliseconds: UPLOAD_EXPIRY_MS,
    // Tags would let a bucket lifecycle rule expire parts, but MinIO and Garage differ: skip.
    useTags: false,
  });

  const read = async (key: string, range?: { start: number; end: number }) => {
    checkKey(key);
    const res = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
      }),
    );
    if (!res.Body) throw new Error(`Empty body for ${key}`);
    return res.Body as Readable;
  };

  return {
    uploads,
    async size(key) {
      checkKey(key);
      try {
        const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return head.ContentLength ?? null;
      } catch {
        return null;
      }
    },
    read,
    async write(key, body, contentType) {
      checkKey(key);
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
      );
    },
    async localCopy(key, tmpDir) {
      const target = join(tmpDir, key.replaceAll('/', '_'));
      await mkdir(tmpDir, { recursive: true });
      await pipeline(await read(key), createWriteStream(target));
      return { path: target, done: () => rm(target, { force: true }) };
    },
    async remove(keys) {
      for (const key of keys) checkKey(key);
      const all = keys.flatMap((k) => (k.startsWith('originals/') ? [k, `${k}.info`] : [k]));
      for (let i = 0; i < all.length; i += 1000) {
        await client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: all.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true },
          }),
        );
      }
    },
  };
}

/** Reads a whole stream; for small files only (thumbnails, page snippets). */
export async function readAll(stream: Readable, limit = 64 * 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > limit) {
      stream.destroy();
      throw new Error('File too large');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
