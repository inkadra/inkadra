import { youtubeVideoId } from '@inkadra/shared';

export { youtubeVideoId } from '@inkadra/shared';

/** Parses YouTube start time parameter like "120", "2m15s", "80s". */
export function parseYoutubeStartTime(url: string): number | null {
  try {
    const parsed = new URL(url.trim());
    const t = parsed.searchParams.get('t') ?? parsed.searchParams.get('start');
    if (!t) return null;

    if (/^\d+$/.test(t)) return parseInt(t, 10);

    const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
    if (!match) return null;
    const hours = parseInt(match[1] || '0', 10);
    const minutes = parseInt(match[2] || '0', 10);
    const seconds = parseInt(match[3] || '0', 10);
    const total = hours * 3600 + minutes * 60 + seconds;
    return total > 0 ? total : null;
  } catch {
    return null;
  }
}

/** Returns the privacy-enhanced YouTube embed URL (youtube-nocookie.com) with autoplay. */
export function youtubeEmbedUrl(url: string): string | null {
  const id = youtubeVideoId(url);
  if (!id) return null;
  const start = parseYoutubeStartTime(url);
  const base = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&playsinline=1`;
  return start ? `${base}&start=${start}` : base;
}

export function isYoutubeUrl(url: string): boolean {
  return youtubeVideoId(url) !== null;
}

/** Numeric id of a public Vimeo video link (`vimeo.com/123456`). */
export function vimeoVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol) &&
      /^(www\.)?vimeo\.com$/.test(parsed.hostname) &&
      /^\/\d+\/?$/.test(parsed.pathname)
      ? parsed.pathname.replaceAll('/', '')
      : null;
  } catch {
    return null;
  }
}

/** Video reference links supported by the viewer and the inline player. */
export function isVideoLink(url: string): boolean {
  return isYoutubeUrl(url) || vimeoVideoId(url) !== null;
}

/** Origin of the privacy-enhanced YouTube player. */
export const YOUTUBE_ORIGIN = 'https://www.youtube-nocookie.com';

/** Kind and code of an Instagram post, reel or IGTV link; `reels` is the same page as `reel`. */
function instagramPost(url: string): { kind: string; code: string } | null {
  try {
    const parsed = new URL(url);
    const match = /^\/(?:[\w.]+\/)?(p|reel|reels|tv)\/([\w-]+)\/?$/.exec(parsed.pathname);
    return match &&
      /^https?:$/.test(parsed.protocol) &&
      /^(www\.)?instagram\.com$/.test(parsed.hostname)
      ? { kind: match[1] === 'reels' ? 'reel' : (match[1] as string), code: match[2] as string }
      : null;
  } catch {
    return null;
  }
}

/** Instagram post or reel: previewed on the board, played in the card only after a click. */
export function isInstagramUrl(url: string): boolean {
  return instagramPost(url) !== null;
}

/**
 * Player address with autoplay where the provider has it: youtube-nocookie, Vimeo with
 * `dnt=1`, or Instagram's official embed (it cannot autoplay: its own play button follows).
 */
export function videoEmbedUrl(url: string): string | null {
  const vimeo = vimeoVideoId(url);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo}?dnt=1&autoplay=1&playsinline=1`;
  const post = instagramPost(url);
  return post ? `https://www.instagram.com/${post.kind}/${post.code}/embed` : youtubeEmbedUrl(url);
}

/** Accept playback updates only from this viewer's privacy-enhanced YouTube player. */
export function youtubePlayerTime(
  event: Pick<MessageEvent, 'origin' | 'source' | 'data'>,
  player: Window | null,
): number | null {
  if (!player || event.origin !== YOUTUBE_ORIGIN || event.source !== player) return null;
  try {
    const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
    const time = data?.info?.currentTime;
    return data?.event === 'infoDelivery' &&
      typeof time === 'number' &&
      Number.isFinite(time) &&
      time >= 0
      ? time
      : null;
  } catch {
    return null;
  }
}
