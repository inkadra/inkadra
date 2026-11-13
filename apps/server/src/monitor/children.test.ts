import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { ChildSampler, parseRss, parseStat, trackTool, withToolLabel } from './children.ts';

const dir = await mkdtemp(join(tmpdir(), 'inkadra-proc-'));
afterAll(() => rm(dir, { recursive: true, force: true }));

/** A /proc entry: utime and stime are fields 14 and 15, the parent field 4. */
async function proc(pid: number, ticks: [number, number], kb: number, kids: number[] = []) {
  const rest = Array.from({ length: 40 }, (_, i) => String(i));
  rest[0] = 'S';
  rest[1] = '1';
  rest[11] = String(ticks[0]);
  rest[12] = String(ticks[1]);
  await mkdir(join(dir, String(pid), 'task', String(pid)), { recursive: true });
  await writeFile(join(dir, String(pid), 'stat'), `${pid} (soffice (bin) x) ${rest.join(' ')}\n`);
  await writeFile(join(dir, String(pid), 'status'), `Name:\tx\nVmRSS:\t   ${kb} kB\nThreads:\t1\n`);
  await writeFile(join(dir, String(pid), 'task', String(pid), 'children'), kids.join(' '));
}

it('reads the ticks and parent past a command name with spaces and parentheses', () => {
  expect(parseStat('42 (a) b) R 7 1 1 0 -1 0 0 0 0 0 150 50 0 0')).toEqual({ ticks: 200, ppid: 7 });
  expect(parseRss('Name:\tffmpeg\nVmRSS:\t  2048 kB\n')).toBe(2 * 1024 * 1024);
  expect(parseRss('Name:\tzombie\n')).toBeNull();
});

it('samples a tracked tool with its children, labelled, until it exits', async () => {
  // bubblewrap (10) runs LibreOffice (11) in its sandbox.
  await proc(10, [5, 5], 1000, [11]);
  await proc(11, [300, 100], 3000);
  const child = Object.assign(new EventEmitter(), { pid: 10 });
  const t0 = Date.now();
  withToolLabel('Budget.xlsx', () => trackTool(child, '/usr/bin/LibreOffice.exe'));
  const sampler = new ChildSampler(dir);
  const [first] = await sampler.sample(t0 + 4000);
  expect(first).toMatchObject({ tool: 'LibreOffice', label: 'Budget.xlsx', memory: 4000 * 1024 });
  expect(first?.cpu).toBeCloseTo(1.025, 1);
  await proc(11, [500, 100], 3000);
  const [second] = await sampler.sample(t0 + 6000);
  expect(second?.cpu).toBeCloseTo(1, 5);
  child.emit('exit', 0);
  expect(await sampler.sample(t0 + 8000)).toEqual([]);
});

it('gives no numbers where /proc is missing', async () => {
  const child = Object.assign(new EventEmitter(), { pid: 99 });
  trackTool(child, 'ffmpeg');
  expect(await new ChildSampler(join(dir, 'none')).sample()).toMatchObject([
    { tool: 'ffmpeg', label: null, cpu: null, memory: null },
  ]);
  child.emit('exit', 0);
});
