// SPDX-License-Identifier: AGPL-3.0-only

import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { convertOffice, LIBREOFFICE_POLICY, OFFICE_CAPS, officeCommand } from './office.ts';
import { mediaTools, runTool } from './tools.ts';

vi.mock('./tools.ts', () => ({ mediaTools: vi.fn(), runTool: vi.fn() }));
afterEach(() => vi.unstubAllEnvs());
describe('Office sandbox', () => {
  it('unshares everything, requires user namespaces, forbids nesting and mounts only the job folders', () => {
    const args = officeCommand('/private/job-123', 'docx');
    for (const flag of ['--unshare-all', '--unshare-user', '--disable-userns', '--die-with-parent'])
      expect(args).toContain(flag);
    expect(args).not.toContain('--unshare-user-try');
    expect(args).not.toContain('--share-net');
    expect(args.join(' ')).toContain('--cap-drop ALL');
    expect(args.join(' ')).toContain('--seccomp 0');
    // /tmp is a bounded tmpfs: --size applies to the next --tmpfs.
    expect(args.indexOf('--size')).toBe(args.indexOf('--tmpfs') - 2);
    expect(args[args.indexOf('--size') + 1]).toBe(String(OFFICE_CAPS.tmp));
    // Only in/ (read-only), out/ and profile/ of the job; never the job folder itself.
    const job = (name: string) => join('/private/job-123', name);
    expect(args.join(' ')).toContain(`--ro-bind ${job('in')} /in`);
    expect(args.join(' ')).toContain(`--bind ${job('out')} /out`);
    expect(args.join(' ')).toContain(`--bind ${job('profile')} /profile`);
    expect(args).not.toContain('/private/job-123');
    expect(args).not.toContain('/data');
    expect(args).toContain('-env:UserInstallation=file:///profile');
    expect(args.at(-1)).toBe('/in/source.docx');
  });
  it('turns macros and link updates off in the LibreOffice profile', () => {
    expect(LIBREOFFICE_POLICY).toMatch(/MacroSecurityLevel"[^>]*><value>3</);
    expect(LIBREOFFICE_POLICY).toMatch(/DisableMacrosExecution"[^>]*><value>true</);
    expect(LIBREOFFICE_POLICY).toMatch(
      /Office\.Calc\/Content\/Update"><prop oor:name="Link"[^>]*><value>2</,
    );
    expect(LIBREOFFICE_POLICY).toMatch(
      /Office\.Writer\/Content\/Update"><prop oor:name="Link"[^>]*><value>2</,
    );
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
        processes: OFFICE_CAPS.processes,
        input: expect.any(Buffer),
      }),
    );
    // The profile that disables macros is seeded before LibreOffice starts.
    expect(await readFile(join(dir, 'profile', 'user', 'registrymodifications.xcu'), 'utf8')).toBe(
      LIBREOFFICE_POLICY,
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
