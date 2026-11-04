import { expect, it, vi } from 'vitest';
import { runTool } from './tools.ts';
import { extractVideoFrame } from './video.ts';

vi.mock('./tools.ts', async (original) => ({
  ...(await original<typeof import('./tools.ts')>()),
  runTool: vi.fn(),
}));
vi.mock('node:fs/promises', () => ({ stat: async () => ({ size: 123 }) }));
it('extracts from the supplied original without scaling and validates seek time', async () => {
  await extractVideoFrame('ffmpeg', 'original.mkv', 'frame.png', 12.345, 'video/webm');
  const args = vi.mocked(runTool).mock.calls[0]?.[1];
  expect(args).toContain('original.mkv');
  expect(args).toContain('12.345000');
  expect(args).toContain('file');
  expect(args).not.toContain('-vf');
  for (const time of [-1, Infinity, NaN, 86401])
    await expect(extractVideoFrame('ffmpeg', 'original', 'out', time, null)).rejects.toThrow(
      'invalid-time',
    );
  expect(runTool).toHaveBeenCalledTimes(1);
});
