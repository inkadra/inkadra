import type { Asset, GuestAsset } from '@inkadra/shared';

/**
 * Guest files in the shape the board's cards read. Pictures come only as the guest WebP
 * variants; `url` is the original only when the link allows downloads, else the largest
 * variant, so nothing on the page ever points at an account path.
 */
export function toAsset(g: GuestAsset): Asset {
  const largest = g.variants.at(-1)?.url ?? '';
  return {
    id: g.id,
    projectId: '',
    kind: g.kind,
    mime: g.mime,
    filename: g.filename ?? '',
    size: g.size ?? 0,
    sha256: null,
    width: g.width,
    height: g.height,
    durationMs: g.durationMs,
    status: 'ready',
    url: g.downloadUrl ?? largest,
    variants: g.variants.map((v) => ({ ...v })),
    exif: null,
    palette: null,
    sourceUrl: null,
    createdAt: new Date(0).toISOString(),
  };
}

/** Smallest variant at least `pixels` wide, else the largest; empty without variants. */
export function guestVariant(g: GuestAsset | undefined, pixels: number): string {
  if (!g) return '';
  const fit = g.variants.find((v) => v.width >= pixels) ?? g.variants.at(-1);
  return fit?.url ?? '';
}
