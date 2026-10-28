import { expect, it } from 'vitest';
import { readPageMeta } from './link-previews.ts';

it('discards a meta tag cut at the response boundary', () => {
  const meta = readPageMeta('<title>Good</title><meta property="og:title" content="Partial', 'https://example.com');
  expect(meta.title).toBe('Good');
});
it('handles a multibyte UTF-8 character cut at the response boundary', () => {
  const html = Buffer.from('<title>Film 🎬');
  const meta = readPageMeta(html.subarray(0, html.length - 1).toString('utf8'), 'https://example.com');
  expect(meta.title).toBe('Film �');
});
it('reads an unclosed title', () => {
  expect(readPageMeta('<title>Unclosed', 'https://example.com').title).toBe('Unclosed');
});
