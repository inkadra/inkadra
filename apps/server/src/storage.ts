import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
  UploadPartCommand,
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
 * moving copies of animated pictures at `variants/<assetId>/<size>-animated.webp`, and the
 * playable MP4 copy of a video at `variants/<assetId>/proxy.mp4` (decision 0048).
 * Files never change once written, so they can be cached forever.
 */
export interface Storage {
  /** Datastore for resumable uploads; file ids are storage keys. */
  readonly uploads: DataStore;
  /** `localCopy` downloads the file (a bucket) rather than giving its path on this disk. */
  readonly copiesToLocal?: boolean;
  size(key: string): Promise<number | null>;
  /** Byte range is inclusive, as in HTTP. */
  read(key: string, range?: { start: number; end: number }): Promise<Readable>;
  write(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Writes a file of unknown length from a stream (imports, backup copies). */
  writeStream(key: string, body: Readable, contentType: string): Promise<void>;
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

/** The playable H.264/AAC copy of a video browsers cannot play: the `proxy` variant row. */
export const proxyKey = (assetId: string) => `variants/${assetId}/proxy.mp4`;
/** The peaks of an audio file as JSON (#327): the `waveform` variant row. */
export const waveformKey = (assetId: string) => `variants/${assetId}/waveform.json`;

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
    async writeStream(key, body) {
      const target = path(key);
      await mkdir(dirname(target), { recursive: true });
      const partial = `${target}.partial`;
      try {
        await pipeline(body, createWriteStream(partial));
        await rename(partial, target);
      } finally {
        await rm(partial, { force: true });
      }
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
    copiesToLocal: true,
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
    async writeStream(key, body, contentType) {
      checkKey(key);
      // Parts of 16 MiB: S3 allows 10 000 parts, so up to 156 GiB per file.
      const PART = 16 * 1024 * 1024;
      const parts = chunks(body, PART);
      const first = await parts.next();
      const head = first.done ? Buffer.alloc(0) : first.value;
      if (head.length < PART) {
        await client.send(
          new PutObjectCommand({ Bucket: bucket, Key: key, Body: head, ContentType: contentType }),
        );
        return;
      }
      const { UploadId } = await client.send(
        new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
      );
      const done: Array<{ ETag: string | undefined; PartNumber: number }> = [];
      try {
        let part: Buffer | undefined = head;
        while (part) {
          const PartNumber = done.length + 1;
          const res = await client.send(
            new UploadPartCommand({ Bucket: bucket, Key: key, UploadId, PartNumber, Body: part }),
          );
          done.push({ ETag: res.ETag, PartNumber });
          const next = await parts.next();
          part = next.done ? undefined : next.value;
        }
        await client.send(
          new CompleteMultipartUploadCommand({
            Bucket: bucket,
            Key: key,
            UploadId,
            MultipartUpload: { Parts: done },
          }),
        );
      } catch (err) {
        await client
          .send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId }))
          .catch(() => {});
        throw err;
      }
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

/** The stream in pieces of `size` bytes (the last one shorter). */
async function* chunks(stream: Readable, size: number): AsyncGenerator<Buffer> {
  let pending: Buffer[] = [];
  let length = 0;
  for await (const chunk of stream) {
    pending.push(chunk as Buffer);
    length += (chunk as Buffer).length;
    while (length >= size) {
      const all = Buffer.concat(pending);
      yield all.subarray(0, size);
      pending = [all.subarray(size)];
      length -= size;
    }
  }
  if (length > 0 || pending.length === 0) yield Buffer.concat(pending);
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
