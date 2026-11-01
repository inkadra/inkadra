// SPDX-License-Identifier: AGPL-3.0-only

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { convertOffice, OFFICE_CAPS, officeCommand } from './office.ts';
import { mediaTools, runTool } from './tools.ts';

vi.mock('./tools.ts', () => ({ mediaTools: vi.fn(), runTool: vi.fn() }));
afterEach(() => vi.unstubAllEnvs());
describe('Office sandbox', () => {
  it('unshares the network, PID and user namespaces and exposes only system programs and this job', () => {
    const args = officeCommand('/private/job-123', 'docx');
    expect(args).toContain('--unshare-all');
    expect(args).toContain('--die-with-parent');
    expect(args).toContain('--cap-drop');
    expect(args).not.toContain('--share-net');
    expect(args).toContain('/private/job-123');
    expect(args).not.toContain('/data');
    expect(args).toContain('-env:UserInstallation=file:///work/profile');
  });
  it('never runs without explicit opt in or resource limits', async () => {
    vi.mocked(mediaTools).mockResolvedValue({ prlimit: null } as Awaited<
      ReturnType<typeof mediaTools>
    >);
    expect(await convertOffice('missing', 'missing', 'docx')).toBeNull();
    vi.stubEnv('OFFICE_PREVIEWS', 'true');
    expect(await convertOffice('missing', 'missing', 'docx')).toBeNull();
    expect(runTool).not.toHaveBeenCalled();
  });
  it.skipIf(process.platform !== 'linux')('sets hard caps and propagates a timeout', async () => {
    vi.stubEnv('OFFICE_PREVIEWS', 'true');
    vi.mocked(mediaTools).mockResolvedValue({ prlimit: '/usr/bin/prlimit' } as Awaited<
      ReturnType<typeof mediaTools>
    >);
    vi.mocked(runTool).mockRejectedValue(new Error('timeout'));
    const dir = await mkdtemp(join(tmpdir(), 'office-timeout-'));
    const source = join(dir, 'input.csv');
    await writeFile(source, 'a,b');
    await expect(convertOffice(source, dir, 'csv')).rejects.toThrow('timeout');
    expect(runTool).toHaveBeenCalledWith(
      'bwrap',
      expect.any(Array),
      expect.objectContaining({
        timeoutMs: OFFICE_CAPS.timeout,
        memoryBytes: OFFICE_CAPS.memory,
        fileBytes: OFFICE_CAPS.pdf,
      }),
    );
  });
});
it('the subprocess runner kills a hung job within its wall-clock limit', async () => {
  const { runTool: actualRun } = await vi.importActual<typeof import('./tools.ts')>('./tools.ts');
  const start = Date.now();
  await expect(
    actualRun(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 100 }),
  ).rejects.toThrow();
  expect(Date.now() - start).toBeLessThan(5000);
});
it.skipIf(process.platform !== 'linux')(
  'enforces the output file cap in the subprocess',
  async () => {
    const { runTool: actualRun } = await vi.importActual<typeof import('./tools.ts')>('./tools.ts');
    const dir = await mkdtemp(join(tmpdir(), 'office-file-cap-'));
    const out = join(dir, 'oversized');
    await expect(
      actualRun(
        process.execPath,
        ['-e', 'require("node:fs").writeFileSync(process.argv[1], Buffer.alloc(4096))', out],
        { timeoutMs: 5000, fileBytes: 1024 },
      ),
    ).rejects.toThrow();
  },
);
