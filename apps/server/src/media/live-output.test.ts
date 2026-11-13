import { execFile } from 'node:child_process';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { liveOutput } from './live.ts';
import { mediaTools } from './tools.ts';

const ffmpeg = (await mediaTools()).ffmpeg;

// The real muxer: an absolute init name made every live session exit with 254 (ENOENT).
describe.skipIf(!ffmpeg)('liveOutput with ffmpeg', () => {
  it('writes the init segment and the first segment into the session folder', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'inkadra-live-'));
    const args = [
      ...['-hide_banner', '-v', 'error', '-y'],
      ...['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25:duration=3'],
      ...['-c:v', 'mpeg4'],
      ...liveOutput(dir, 0)(join(dir, 'live.m3u8')),
    ];
    await promisify(execFile)(ffmpeg as string, args, { timeout: 60_000 });
    const files = await readdir(dir);
    expect(files).toContain('init.mp4');
    expect(files).toContain('seg-0.m4s');
  });
});
