import { expect, it, vi } from 'vitest';
import { detectScreenplay, looksLikeScreenplay, parseScreenplay } from './parse.ts';

const script = (count: number) =>
  Array.from({ length: count }, (_, i) => `INT. ROOM ${i} - DAY\n\nA door opens.`).join('\n\n');
it('requires five actual headings, excluding the prelude', () => {
  expect(looksLikeScreenplay(parseScreenplay('x.txt', `Notes\n\n${script(4)}`))).toBe(false);
  expect(looksLikeScreenplay(parseScreenplay('x.txt', script(5)))).toBe(true);
});
it('ignores ordinary documents and rejects oversized inputs before reading', async () => {
  const text = vi.fn();
  expect(
    await detectScreenplay({ name: 'x.pdf', size: 5 * 1024 * 1024 + 1, text } as unknown as File),
  ).toBeNull();
  expect(await detectScreenplay({ name: 'x.docx', size: 1, text } as unknown as File)).toBeNull();
  expect(text).not.toHaveBeenCalled();
});
