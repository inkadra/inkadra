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

/** Video reference links supported by the viewer; Vimeo uses only its stored thumbnail. */
export function isVideoLink(url: string): boolean {
  if (isYoutubeUrl(url)) return true;
  try {
    const parsed = new URL(url);
    return (
      /^https?:$/.test(parsed.protocol) &&
      /^(www\.)?vimeo\.com$/.test(parsed.hostname) &&
      /^\/\d+\/?$/.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

/** Origin of the privacy-enhanced YouTube player. */
export const YOUTUBE_ORIGIN = 'https://www.youtube-nocookie.com';

/** Player address with autoplay, for the providers that play inside Inkadra. */
export function videoEmbedUrl(url: string): string | null {
  return youtubeEmbedUrl(url);
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
