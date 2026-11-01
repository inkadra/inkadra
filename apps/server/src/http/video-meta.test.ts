import { beforeEach, describe, expect, it, vi } from 'vitest';
import { safeFetch } from '../safe-fetch.ts';
import { clockTime, instagramMeta, pagePreview, videoPageMeta } from './link-previews.ts';

vi.mock('../safe-fetch.ts', async (original) => ({
  ...(await original<object>()),
  safeFetch: vi.fn(),
}));
const fetch = vi.mocked(safeFetch);
beforeEach(() => vi.resetAllMocks());
describe('video metadata', () => {
  it('requests bounded YouTube oEmbed and uses the canonical thumbnail', async () => {
    fetch.mockResolvedValue({
      url: '',
      contentType: 'application/json',
      body: Buffer.from(JSON.stringify({ title: 'Film', author_name: 'Director' })),
    });
    expect(await videoPageMeta('https://youtu.be/yMnFHFf43Qg', [])).toEqual({
      title: 'Film',
      description: 'Director',
      siteName: 'YouTube',
      image: 'https://i.ytimg.com/vi/yMnFHFf43Qg/maxresdefault.jpg',
    });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('https://www.youtube.com/oembed?'),
      expect.objectContaining({
        accept: ['application/json'],
        maxBytes: 65536,
        allowAddresses: [],
      }),
    );
  });
  it('falls back to HTML metadata when oEmbed fails', async () => {
    fetch.mockRejectedValue(new Error('unavailable'));
    const result = await pagePreview(
      { db: {} as never, storage: {} as never, allowAddresses: [] },
      {
        url: 'https://youtu.be/yMnFHFf43Qg',
        contentType: 'text/html',
        body: Buffer.from('<title>HTML fallback</title>'),
      },
      { projectId: 'p', actorId: 'a' },
      { info: vi.fn() } as never,
    );
    expect(result.title).toBe('HTML fallback');
    expect(result.imageAssetId).toBeNull();
  });
  it('supports Vimeo and ignores unrelated hosts', async () => {
    fetch.mockResolvedValue({
      url: '',
      contentType: 'application/json',
      body: Buffer.from(
        '{"title":"Vimeo film","author_name":"Director","thumbnail_url":"https://example.com/image.jpg"}',
      ),
    });
    expect((await videoPageMeta('https://vimeo.com/123456', []))?.siteName).toBe('Vimeo');
    expect(await videoPageMeta('https://youtube.com.evil.test/watch?v=yMnFHFf43Qg', [])).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('Vimeo details', () => {
  it('adds the duration to the author and asks for a large thumbnail', async () => {
    fetch.mockResolvedValue({
      url: '',
      contentType: 'application/json',
      body: Buffer.from(
        '{"title":"Beyond the Grid","author_name":"Studio","duration":261,"thumbnail_url":"https://i.vimeocdn.com/video/1.jpg"}',
      ),
    });
    expect((await videoPageMeta('https://vimeo.com/123456', []))?.description).toBe(
      'Studio · 4:21',
    );
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('&width=1280'), expect.anything());
    expect(clockTime(3723)).toBe('1:02:03');
    expect(clockTime(0)).toBeNull();
    expect(clockTime('9')).toBeNull();
  });
});

describe('Instagram previews', () => {
  const page = (title: string, description: string) => ({
    title,
    description,
    siteName: 'Instagram',
    image: 'https://scontent.cdninstagram.com/1.jpg',
  });

  it('shows the caption as title and the handle as author', () => {
    const meta = instagramMeta(
      page(
        'Nike on Instagram: "Just do it. “Always”"',
        '12 likes, 1 comments - nike on May 3, 2025: "Just do it."',
      ),
      'https://www.instagram.com/reel/C1abc_-9/',
    );
    expect(meta).toMatchObject({
      title: 'Just do it. “Always”',
      description: '@nike',
      siteName: 'Instagram',
      image: 'https://scontent.cdninstagram.com/1.jpg',
    });
  });

  it('falls back to the display name, and leaves other pages and login walls alone', () => {
    expect(
      instagramMeta(page('Nike on Instagram', ''), 'https://instagram.com/p/C1abc/'),
    ).toMatchObject({ title: 'Nike on Instagram', description: 'Nike' });
    const other = page('Nike on Instagram: "x"', '');
    expect(instagramMeta(other, 'https://example.com/p/C1abc/')).toBe(other);
    expect(instagramMeta(other, 'https://www.instagram.com/nike/')).toBe(other);
    expect(instagramMeta(other, 'not a url')).toBe(other);
  });
});
