import { MOVING_THUMBNAIL_MAX_WIDTH } from '@inkadra/shared';
import { useEffect, useState, useSyncExternalStore } from 'react';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** Just enough of an asset to pick its moving thumbnail, for members and guests alike. */
export interface MovingAsset {
  /** The worker wrote moving thumbnails beside the posters (`Asset.animated`). */
  animated: boolean;
  variants: ReadonlyArray<{ width: number; url: string }>;
}

/**
 * The moving copy of the thumbnail nearest `pixels`, or null when the source cannot move.
 * The server says whether the worker made one (`Asset.animated`): asking for it on every
 * WebP would only fill the log with 404s. The moving copies stop at
 * `MOVING_THUMBNAIL_MAX_WIDTH`, so the chosen variant is never wider than that; the caller
 * still falls back to the poster when the request fails.
 */
export function movingVariantUrl(asset: MovingAsset, pixels: number): string | null {
  if (!asset.animated) return null;
  const variants = [...asset.variants].sort((a, b) => a.width - b.width);
  const want = Math.min(pixels, MOVING_THUMBNAIL_MAX_WIDTH);
  const fit = variants.find((v) => v.width >= want) ?? variants.at(-1);
  return fit && fit.width <= MOVING_THUMBNAIL_MAX_WIDTH ? `${fit.url}?animated=1` : null;
}

const canMatch = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function';

function subscribeReducedMotion(onChange: () => void) {
  if (!canMatch()) return () => {};
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

const prefersReducedMotion = () => (canMatch() ? window.matchMedia(REDUCED_MOTION).matches : false);
const noReducedMotion = () => false;

/** `prefers-reduced-motion: reduce`, reactive; false while rendering on the server. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, noReducedMotion);
}

/**
 * The moving variant once the browser has loaded it, else null. The poster shows while it
 * loads, so a picture without one (a still WebP, or a GIF past the worker caps) never
 * shows a broken frame and never reloads anything. When the wanted variant changes size
 * (zoom, viewer), the one already loaded keeps playing until the new one is ready, so the
 * picture does not fall back to its poster and flicker.
 */
function useMovingReady(moving: string | null): string | null {
  const [ready, setReady] = useState<{ url: string; asset: string } | null>(null);
  useEffect(() => {
    if (!moving) return;
    let alive = true;
    const probe = new Image();
    probe.onload = () => {
      if (alive) setReady({ url: moving, asset: movingAsset(moving) });
    };
    probe.src = moving;
    return () => {
      alive = false;
      probe.onload = null;
    };
  }, [moving]);
  if (!moving) return null;
  return ready?.asset === movingAsset(moving) ? ready.url : null;
}

/** The variants of one asset share their path, only the size differs. */
const movingAsset = (url: string) => url.slice(0, url.lastIndexOf('/'));

/**
 * A picture that shows its moving variant when it has one and motion is welcome, and the
 * poster otherwise.
 *
 * `moving` is null when motion is off for another reason too: on a large board the cards
 * pass it only once they are hovered or selected.
 */
export function MovingPicture({
  poster,
  moving,
  alt,
  className,
}: {
  poster: string;
  moving: string | null;
  alt: string;
  className?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const ready = useMovingReady(reduced ? null : moving);
  return (
    <img src={ready ?? poster} alt={alt} className={className} draggable={false} decoding="async" />
  );
}
