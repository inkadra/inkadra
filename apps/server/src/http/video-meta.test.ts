import { beforeEach, describe, expect, it, vi } from 'vitest';
import { safeFetch } from '../safe-fetch.ts';
import { pagePreview, videoPageMeta } from './link-previews.ts';

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
