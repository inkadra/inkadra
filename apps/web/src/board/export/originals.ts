// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The files of a selection exactly as they were uploaded (decision 0072): an exception to decision
 * 0038, by explicit choice and under the download permission the server enforces.
 */
import type { Element } from '@inkadra/doc-schema';
import type { Asset } from '@inkadra/shared';
import type { Audience, BoardSource } from './board-model.ts';
import { downloadBlob, flatten, selectedCards } from './engine.ts';
import { assetMeta, IMAGE_CONCURRENCY, pool } from './images.ts';
import { zipBlobs } from './zip.ts';

/** Bytes read before they move out of the JavaScript heap into a Blob. */
const HELD_BYTES = 8 * 1024 * 1024;

export interface OriginalFile {
  assetId: string;
  name: string;
  size: number;
  url: string;
  width: number | null;
  height: number | null;
}

export interface OriginalsPlan {
  /** Each file once, even when several cards show it. */
  files: OriginalFile[];
  /** The chosen cards with a file, in the order of their pictures, and the first file of each. */
  cards: { id: string; file: OriginalFile }[];
  /** Cards left out because they have no file. */
  noFile: number;
}

/** Holders of other cards: only what is inside them counts. */
const CONTAINERS: ReadonlySet<Element['type']> = new Set(['arrow', 'column', 'scene']);

function assetIdOf(el: Element): string | null {
  return el.type === 'image' || el.type === 'file' || el.type === 'frame'
    ? (el.assetId ?? null)
    : null;
}

function originalFile(asset: Asset): OriginalFile {
  return {
    assetId: asset.id,
    name: asset.filename,
    size: asset.size,
    url: `${asset.url}?download=1`,
    width: asset.width,
    height: asset.height,
  };
}

/** What "File originale" would download: for clients, cards hidden from guests stay out. */
export async function planOriginals(
  source: BoardSource,
  selection: ReadonlySet<string>,
  filter: { audience: Audience; hideGuestHidden: boolean },
): Promise<OriginalsPlan> {
  const cards = selectedCards(source, selection, filter).map((card) => ({
    id: card.el.id,
    elements: flatten(card).filter((el) => !CONTAINERS.has(el.type)),
  }));
  const ids = new Set(
    cards.flatMap((card) => card.elements.map(assetIdOf).filter((id) => id !== null)),
  );
  const assets = new Map<string, Asset>();
  await pool([...ids], IMAGE_CONCURRENCY, async (id) => {
    const asset = await assetMeta(id);
    // Until the upload ends the server has no file to give.
    if (asset && asset.status !== 'pending') assets.set(id, asset);
  });
  const files = new Map<string, OriginalFile>();
  const plan: OriginalsPlan = { files: [], cards: [], noFile: 0 };
  for (const card of cards) {
    let first: OriginalFile | null = null;
    for (const el of card.elements) {
      const asset = assets.get(assetIdOf(el) ?? '');
      if (!asset) {
        plan.noFile += 1;
        continue;
      }
      const file = files.get(asset.id) ?? originalFile(asset);
      files.set(asset.id, file);
      first ??= file;
    }
    if (first) plan.cards.push({ id: card.id, file: first });
  }
  plan.files = [...files.values()];
  return plan;
}

/** Names safe to unpack anywhere, and different even on a disk that ignores case. */
export function zipNames(names: readonly string[]): string[] {
  const taken = new Set<string>();
  return names.map((raw) => {
    const name = raw.replace(/[\\/:*?"<>|\p{Cc}]/gu, '_').trim();
    const safe = name === '' || /^\.+$/.test(name) ? 'file' : name;
    const dot = safe.lastIndexOf('.');
    const [stem, ext] = dot > 0 ? [safe.slice(0, dot), safe.slice(dot)] : [safe, ''];
    let unique = safe;
    for (let n = 2; taken.has(unique.toLowerCase()); n++) unique = `${stem} (${n})${ext}`;
    taken.add(unique.toLowerCase());
    return unique;
  });
}

const request = (url: string, method: 'GET' | 'HEAD', signal?: AbortSignal) =>
  // Past the browser's cache: the server decides, for a role that may have changed.
  fetch(url, { method, credentials: 'same-origin', cache: 'no-store', ...(signal && { signal }) });

/** One file as a Blob; its bytes leave the heap as they arrive. */
async function readFile(
  file: OriginalFile,
  signal: AbortSignal | undefined,
  onBytes: (bytes: number) => void,
): Promise<Blob> {
  const res = await request(file.url, 'GET', signal);
  if (!res.ok || !res.body) throw new Error(`${res.status}`);
  const reader = res.body.getReader();
  const parts: Blob[] = [];
  let chunks: Uint8Array<ArrayBuffer>[] = [];
  let held = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    held += value.length;
    onBytes(value.length);
    if (held >= HELD_BYTES) {
      parts.push(new Blob(chunks));
      chunks = [];
      held = 0;
    }
  }
  parts.push(new Blob(chunks));
  const blob = new Blob(parts);
  if (blob.size !== file.size) throw new Error('Truncated');
  return blob;
}

/**
 * Downloads the files and answers with the names of those it could not get. One file goes straight
 * to the browser's own download, which streams to disk and shows its progress, after asking the
 * server whether it would give it. Several go in one ZIP with whatever could be read, in sequence.
 */
export async function downloadOriginals(
  files: readonly OriginalFile[],
  base: string,
  {
    signal,
    onProgress,
  }: {
    signal?: AbortSignal;
    onProgress?: (progress: { phase: 'files'; done: number; total: number }) => void;
  } = {},
): Promise<string[]> {
  const [only] = files;
  if (only && files.length === 1) {
    try {
      const res = await request(only.url, 'HEAD', signal);
      if (!res.ok) return [only.name];
    } catch (err) {
      if (signal?.aborted) throw err;
      return [only.name];
    }
    const a = document.createElement('a');
    a.href = only.url;
    a.download = only.name;
    a.click();
    return [];
  }
  const total = files.reduce((sum, file) => sum + file.size, 0);
  const names = zipNames(files.map((file) => file.name));
  const entries: { name: string; blob: Blob }[] = [];
  const failed: string[] = [];
  let done = 0;
  onProgress?.({ phase: 'files', done, total });
  for (const [n, file] of files.entries()) {
    const before = done;
    try {
      const blob = await readFile(file, signal, (bytes) => {
        done += bytes;
        onProgress?.({ phase: 'files', done, total });
      });
      entries.push({ name: names[n] as string, blob });
    } catch (err) {
      if (signal?.aborted) throw err;
      failed.push(file.name);
    }
    // A file that failed halfway, or a size that was out of date, does not skew the bar.
    done = before + file.size;
    onProgress?.({ phase: 'files', done, total });
  }
  if (entries.length > 0) downloadBlob(await zipBlobs(entries), `${base}.zip`);
  return failed;
}
