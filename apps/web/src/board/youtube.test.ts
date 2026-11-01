import { describe, expect, it } from 'vitest';
import {
  isInstagramUrl,
  isVideoLink,
  isYoutubeUrl,
  parseYoutubeStartTime,
  videoEmbedUrl,
  vimeoVideoId,
  youtubeEmbedUrl,
  youtubeVideoId,
} from './youtube.ts';

describe('youtube utilities', () => {
  it('extracts video id from standard watch URLs', () => {
    expect(youtubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeVideoId('https://youtube.com/watch?v=dQw4w9WgXcQ&feature=shared')).toBe(
      'dQw4w9WgXcQ',
    );
    expect(youtubeVideoId('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts video id from short youtu.be URLs', () => {
    expect(youtubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeVideoId('https://youtu.be/dQw4w9WgXcQ?t=42')).toBe('dQw4w9WgXcQ');
  });

  it('extracts video id from shorts and embed URLs', () => {
    expect(youtubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('returns null for non-youtube URLs or invalid strings', () => {
    expect(youtubeVideoId('https://vimeo.com/123456')).toBeNull();
    expect(youtubeVideoId('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(youtubeVideoId('not-a-url')).toBeNull();
    expect(isYoutubeUrl('https://example.com')).toBe(false);
  });

  it('parses start time from seconds and formatted timestamps', () => {
    expect(parseYoutubeStartTime('https://youtu.be/abc?t=90')).toBe(90);
    expect(parseYoutubeStartTime('https://www.youtube.com/watch?v=abc&t=1m30s')).toBe(90);
    expect(parseYoutubeStartTime('https://www.youtube.com/watch?v=abc&t=1h2m3s')).toBe(3723);
    expect(parseYoutubeStartTime('https://youtu.be/abc')).toBeNull();
  });

  it('builds privacy-enhanced embed URL', () => {
    expect(youtubeEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0&playsinline=1',
    );
    expect(youtubeEmbedUrl('https://youtu.be/dQw4w9WgXcQ?t=45')).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0&playsinline=1&start=45',
    );
    expect(youtubeEmbedUrl('https://vimeo.com/12345')).toBeNull();
  });

  it('embeds Vimeo with do-not-track and rejects look-alike hosts', () => {
    expect(vimeoVideoId('https://vimeo.com/123456')).toBe('123456');
    expect(vimeoVideoId('https://vimeo.com.evil.test/123456')).toBeNull();
    expect(vimeoVideoId('https://vimeo.com/channels/staff')).toBeNull();
    expect(videoEmbedUrl('https://vimeo.com/123456')).toBe(
      'https://player.vimeo.com/video/123456?dnt=1&autoplay=1&playsinline=1',
    );
    expect(videoEmbedUrl('https://youtu.be/dQw4w9WgXcQ')).toContain('youtube-nocookie.com');
    expect(videoEmbedUrl('https://example.com/video')).toBeNull();
    expect(isVideoLink('https://vimeo.com/123456')).toBe(true);
    // Instagram plays on the card only: the viewer and the gallery stay with video files.
    expect(isVideoLink('https://www.instagram.com/reel/C1abc/')).toBe(false);
  });

  it('recognises Instagram posts and reels only', () => {
    expect(isInstagramUrl('https://www.instagram.com/p/C1abc_-9/')).toBe(true);
    expect(isInstagramUrl('https://instagram.com/someone/reel/C1abc/')).toBe(true);
    expect(isInstagramUrl('https://www.instagram.com/someone/')).toBe(false);
    expect(isInstagramUrl('https://instagram.com.evil.test/p/C1abc/')).toBe(false);
  });

  it('embeds Instagram through its official embed page, and nothing else on that host', () => {
    expect(videoEmbedUrl('https://www.instagram.com/p/C1abc_-9/?igsh=x')).toBe(
      'https://www.instagram.com/p/C1abc_-9/embed',
    );
    expect(videoEmbedUrl('https://instagram.com/someone/reels/C1abc/')).toBe(
      'https://www.instagram.com/reel/C1abc/embed',
    );
    expect(videoEmbedUrl('https://www.instagram.com/someone/')).toBeNull();
    expect(videoEmbedUrl('https://instagram.com.evil.test/p/C1abc/')).toBeNull();
  });
});
