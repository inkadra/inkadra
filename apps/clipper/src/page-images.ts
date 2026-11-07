// SPDX-License-Identifier: MPL-2.0
/*
 * Which pictures of a page the popup offers to save. The page only reports what its <img>
 * elements say (see collectImagesInPage); choosing, resolving and deduplicating happens here.
 */

/** One <img> as the page reports it. Sizes are 0 while the picture has not loaded. */
export interface RawImage {
  currentSrc: string;
  src: string;
  srcset: string;
  /** srcset of the <source> elements of its <picture>, in order. */
  sources: string[];
  naturalWidth: number;
  naturalHeight: number;
  alt: string;
}

export interface PageImageOption {
  /** The address saved: the largest the page offers. */
  url: string;
  /** What the page shows, light enough for a tile. */
  thumbUrl: string;
  alt: string;
  /** Of `url`; 0 when unknown (not loaded yet). */
  width: number;
  height: number;
}

interface Candidate {
  url: string;
  /** Width from a `w` descriptor, or the density from an `x` descriptor times 1000. */
  rank: number;
  width?: number;
}

const MIN_SIDE = 100;
/** Inline pictures travel through messages: bigger ones are usually not worth it anyway. */
const MAX_DATA_URL = 256 * 1024;

/**
 * Splits a srcset into its candidates. URLs may contain commas (`…/w_1,h_2/a.jpg`), so a
 * candidate ends at whitespace, as in the HTML parsing rules, and a trailing comma is cut.
 */
export function parseSrcset(srcset: string): Candidate[] {
  const out: Candidate[] = [];
  let i = 0;
  while (i < srcset.length) {
    while (i < srcset.length && /[\s,]/.test(srcset[i] ?? '')) i++;
    const start = i;
    while (i < srcset.length && !/\s/.test(srcset[i] ?? '')) i++;
    let url = srcset.slice(start, i);
    let descriptor = '';
    if (url.endsWith(',')) url = url.replace(/,+$/, '');
    else {
      const end = srcset.indexOf(',', i);
      descriptor = srcset.slice(i, end === -1 ? srcset.length : end).trim();
      i = end === -1 ? srcset.length : end + 1;
    }
    if (!url) continue;
    const w = /^(\d+)w$/.exec(descriptor);
    const x = /^(\d*\.?\d+)x$/.exec(descriptor);
    if (w) out.push({ url, rank: Number(w[1]), width: Number(w[1]) });
    else out.push({ url, rank: x ? Number(x[1]) * 1000 : 1000 });
  }
  return out;
}

function largest(srcsets: string[]): Candidate | undefined {
  let best: Candidate | undefined;
  for (const candidate of srcsets.flatMap(parseSrcset))
    if (!best || candidate.rank > best.rank) best = candidate;
  return best;
}

function resolve(url: string, baseUrl: string): string | undefined {
  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function usable(url: string): boolean {
  if (url.startsWith('data:'))
    return (
      url.startsWith('data:image/') &&
      !url.startsWith('data:image/svg') &&
      url.length <= MAX_DATA_URL
    );
  if (!/^https?:/.test(url)) return false; // blob: and the rest cannot be read from the extension.
  try {
    return !new URL(url).pathname.toLowerCase().endsWith('.svg'); // Icons and logos.
  } catch {
    return false;
  }
}

/**
 * The pictures worth offering, in document order and once per address. The saved address is the
 * largest srcset candidate (Pinterest shows 236 px thumbnails but lists the original), else what
 * the browser shows (`currentSrc`), else `src`; the tile shows what the browser shows.
 * Pictures smaller than 100 px on a side are left out; one not loaded yet stays only if its
 * srcset says it is wide enough.
 * shortcut: CSS background images are not found; read computed styles if pages need them.
 */
export function pickImages(images: RawImage[], baseUrl: string): PageImageOption[] {
  const seen = new Set<string>();
  const out: PageImageOption[] = [];
  for (const image of images) {
    const best = largest([image.srcset, ...image.sources]);
    const shown = image.currentSrc || image.src;
    const raw = best?.url || shown;
    const url = raw ? resolve(raw, baseUrl) : undefined;
    if (!url || seen.has(url) || !usable(url)) continue;
    const loaded = image.naturalWidth > 0 && image.naturalHeight > 0;
    if (loaded && (image.naturalWidth < MIN_SIDE || image.naturalHeight < MIN_SIDE)) continue;
    if (!loaded && (best?.width ?? 0) < MIN_SIDE) continue;
    seen.add(url);
    // A `w` descriptor wider than what loaded gives the saved size; the ratio stays the same.
    const scale =
      loaded && best?.width && best.width > image.naturalWidth
        ? best.width / image.naturalWidth
        : 1;
    out.push({
      url,
      thumbUrl: (loaded && shown && resolve(shown, baseUrl)) || url,
      alt: image.alt.trim(),
      width: loaded ? Math.round(image.naturalWidth * scale) : 0,
      height: loaded ? Math.round(image.naturalHeight * scale) : 0,
    });
  }
  return out;
}

/**
 * For a right-clicked picture: the largest srcset candidate of the <img> showing `srcUrl`, or
 * `srcUrl` itself when no element matches or nothing larger is listed.
 */
export function largestFor(images: RawImage[], baseUrl: string, srcUrl: string): string {
  const image = images.find(
    (i) =>
      (i.currentSrc && resolve(i.currentSrc, baseUrl) === srcUrl) ||
      (i.src && resolve(i.src, baseUrl) === srcUrl),
  );
  const best = image && largest([image.srcset, ...image.sources]);
  const url = best && resolve(best.url, baseUrl);
  return url && usable(url) ? url : srcUrl;
}

/** A name for a tile: its alt text, else the file name, else `fallback`; with the size when known. */
export function imageLabel(image: PageImageOption, fallback: string): string {
  let name = image.alt;
  if (!name && !image.url.startsWith('data:')) {
    try {
      name = decodeURIComponent(new URL(image.url).pathname.split('/').pop() ?? '');
    } catch {
      name = '';
    }
  }
  name ||= fallback;
  return image.width ? `${name}, ${image.width}×${image.height}` : name;
}
