import { expect, it, vi } from 'vitest';
import { runTool } from './tools.ts';
import { extractVideoFrame, NoVideoFrame } from './video.ts';

vi.mock('./tools.ts', async (original) => ({
  ...(await original<typeof import('./tools.ts')>()),
  runTool: vi.fn(),
}));
const stat = vi.hoisted(() => vi.fn(async () => ({ size: 123 })));
vi.mock('node:fs/promises', () => ({ stat }));
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

it('reports a time past the last frame, where ffmpeg succeeds and writes nothing', async () => {
  stat.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
  await expect(extractVideoFrame('ffmpeg', 'original', 'out', 9, null)).rejects.toBeInstanceOf(
    NoVideoFrame,
  );
});
