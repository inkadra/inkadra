import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { pipeline as pipelineCallback, Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import yazl from 'yazl';
import type { z } from 'zod';

/**
 * Zip files for project archives and backups (decision 0037). Writing streams one entry at a
 * time into a file; reading never trusts the archive: names are only looked up, never turned
 * into paths, and every size is checked before and while reading.
 */
export class ArchiveError extends Error {
  constructor(
    readonly reason: 'invalid_archive' | 'too_large' | 'unsupported_version' | 'too_new',
    message: string,
  ) {
    super(message);
  }
}

export interface ZipWriter {
  addBuffer(name: string, data: Buffer | string, compress?: boolean): Promise<void>;
  addJson(name: string, value: unknown): Promise<void>;
  /** Waits until the stream is in the archive, so only one source is open at a time. */
  addStream(
    name: string,
    stream: Readable,
    opts?: { compress?: boolean; size?: number },
  ): Promise<void>;
  /** Bytes written so far. */
  written(): number;
  close(): Promise<number>;
  /** Stops writing after a failure; the caller removes the file. */
  abort(): void;
}

/** Archives are readable by the server's user only (`mode` 0600): they hold whole projects. */
export function writeZip(path: string): ZipWriter {
  const zip = new yazl.ZipFile();
  const file = createWriteStream(path, { mode: 0o600 });
  let bytes = 0;
  const counter = new Transform({
    transform(chunk, _enc, done) {
      bytes += chunk.length;
      done(null, chunk);
    },
  });
  const finished = pipeline(zip.outputStream, counter, file);
  // An error of the file must reject the pending entry too.
  let failure: unknown;
  finished.catch((err) => {
    failure ??= err;
  });
  // yazl reports entries whose stream does not match the size given (a file that changed
  // or shrank in storage) on the ZipFile itself: fail the archive instead of hanging.
  zip.on('error', (err: Error) => {
    failure ??= err;
    (zip.outputStream as Readable).destroy(err);
  });
  const mtime = new Date();
  return {
    async addBuffer(name, data, compress = true) {
      if (failure) throw failure;
      zip.addBuffer(Buffer.isBuffer(data) ? data : Buffer.from(data), name, { mtime, compress });
    },
    async addJson(name, value) {
      await this.addBuffer(name, `${JSON.stringify(value, null, 2)}\n`);
    },
    async addStream(name, stream, opts = {}) {
      if (failure) throw failure;
      zip.addReadStream(stream, name, {
        mtime,
        compress: opts.compress ?? true,
        ...(opts.size === undefined ? {} : { size: opts.size }),
      });
      await Promise.race([once(stream, 'end'), once(stream, 'close'), finished]);
      if (stream.errored) throw stream.errored;
      if (failure) throw failure;
    },
    written: () => bytes,
    async close() {
      zip.end();
      await finished;
      return bytes;
    },
    abort() {
      failure ??= new Error('aborted');
      zip.outputStream.unpipe();
      file.destroy();
    },
  };
}

export interface ZipLimits {
  entries: number;
  /** Sum of uncompressed sizes. */
  totalBytes: number;
  compressionRatio: number;
}

export interface ZipEntryInfo {
  name: string;
  size: number;
}

export interface ZipReader {
  has(name: string): boolean;
  size(name: string): number | null;
  names(): string[];
  /** The entry as a stream that fails past `max` bytes or when sizes disagree. */
  stream(name: string, max: number): Promise<Readable>;
  buffer(name: string, max: number): Promise<Buffer>;
  json<T extends z.ZodType>(name: string, schema: T, max: number): Promise<z.infer<T>>;
  close(): void;
}

const openZip = (path: string) =>
  new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.open(
      path,
      {
        lazyEntries: true,
        autoClose: false,
        validateEntrySizes: true,
        strictFileNames: true,
        decodeStrings: true,
      },
      (err, zip) => (err || !zip ? reject(err) : resolve(zip)),
    ),
  );

/** Reads the central directory, checking every entry against the limits. */
export async function readZip(path: string, limits: ZipLimits): Promise<ZipReader> {
  let zip: yauzl.ZipFile;
  try {
    zip = await openZip(path);
  } catch (err) {
    throw new ArchiveError('invalid_archive', `Not a zip file: ${(err as Error).message}`);
  }
  if (zip.entryCount > limits.entries) {
    zip.close();
    throw new ArchiveError('too_large', 'The archive has too many entries.');
  }
  const entries = new Map<string, yauzl.Entry>();
  let total = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      zip.on('error', reject);
      zip.on('end', resolve);
      zip.on('entry', (entry: yauzl.Entry) => {
        const name = entry.fileName;
        if (entries.has(name))
          return reject(new ArchiveError('invalid_archive', `Duplicate entry ${name}.`));
        if (entry.isEncrypted())
          return reject(new ArchiveError('invalid_archive', 'Encrypted entries are not read.'));
        // Unix mode in the high bits of the external attributes: a link is never a file here.
        if (((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000)
          return reject(new ArchiveError('invalid_archive', `Entry ${name} is a link.`));
        if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8)
          return reject(new ArchiveError('invalid_archive', 'Unknown compression method.'));
        const ratio = entry.uncompressedSize / Math.max(1, entry.compressedSize);
        if (entry.uncompressedSize > 1024 * 1024 && ratio > limits.compressionRatio)
          return reject(new ArchiveError('too_large', `Entry ${name} expands too much.`));
        total += entry.uncompressedSize;
        if (total > limits.totalBytes)
          return reject(new ArchiveError('too_large', 'The archive is too large.'));
        if (!name.endsWith('/')) entries.set(name, entry);
        zip.readEntry();
      });
      zip.readEntry();
    });
  } catch (err) {
    zip.close();
    if (err instanceof ArchiveError) throw err;
    throw new ArchiveError('invalid_archive', (err as Error).message);
  }

  const reader: ZipReader = {
    has: (name) => entries.has(name),
    size: (name) => entries.get(name)?.uncompressedSize ?? null,
    names: () => [...entries.keys()],
    async stream(name, max) {
      const entry = entries.get(name);
      if (!entry) throw new ArchiveError('invalid_archive', `Missing entry ${name}.`);
      if (entry.uncompressedSize > max)
        throw new ArchiveError('too_large', `Entry ${name} is too large.`);
      const source = await new Promise<Readable>((resolve, reject) =>
        zip.openReadStream(entry, (err, s) => (err || !s ? reject(err) : resolve(s))),
      );
      let seen = 0;
      const guard = new Transform({
        transform(chunk, _enc, done) {
          seen += chunk.length;
          if (seen > max) done(new ArchiveError('too_large', `Entry ${name} is too large.`));
          else done(null, chunk);
        },
      });
      source.on('error', (err) =>
        guard.destroy(
          err instanceof ArchiveError ? err : new ArchiveError('invalid_archive', err.message),
        ),
      );
      return source.pipe(guard);
    },
    async buffer(name, max) {
      const chunks: Buffer[] = [];
      for await (const chunk of await reader.stream(name, max)) chunks.push(chunk as Buffer);
      return Buffer.concat(chunks);
    },
    async json(name, schema, max) {
      const text = (await reader.buffer(name, max)).toString('utf8');
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        throw new ArchiveError('invalid_archive', `${name} is not JSON.`);
      }
      const parsed = schema.safeParse(value);
      if (!parsed.success)
        throw new ArchiveError(
          'invalid_archive',
          `${name}: ${parsed.error.issues
            .slice(0, 3)
            .map((i) => `${i.path.join('.')} ${i.message}`)
            .join('; ')}`,
        );
      return parsed.data;
    },
    close: () => zip.close(),
  };
  return reader;
}

/**
 * `source` through `transforms`, as one readable whose errors include those of every stage:
 * `a.pipe(b)` alone leaves an error of `a` unhandled and `b` waiting forever.
 */
export function piped(source: Readable, ...transforms: Transform[]): Readable {
  const last = transforms.at(-1);
  if (!last) return source;
  pipelineCallback([source, ...transforms], () => {});
  return last;
}

/** For tests: a stream of a buffer. */
export const streamOf = (data: Buffer) => Readable.from([data]);
