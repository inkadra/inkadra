/** Extracts the 11-character YouTube video ID from various YouTube URL formats. */
export function youtubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');

    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      if (parsed.pathname === '/watch') {
        const v = parsed.searchParams.get('v');
        return v && /^[a-zA-Z0-9_-]{11}$/.test(v) ? v : null;
      }
      if (parsed.pathname.startsWith('/shorts/') || parsed.pathname.startsWith('/embed/')) {
        const id = parsed.pathname.split('/')[2];
        return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
      }
    }

    if (host === 'youtu.be') {
      const id = parsed.pathname.slice(1).split('/')[0];
      return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }

    return null;
  } catch {
    return null;
  }
}

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
  const base = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;
  return start ? `${base}&start=${start}` : base;
}

export function isYoutubeUrl(url: string): boolean {
  return youtubeVideoId(url) !== null;
}
