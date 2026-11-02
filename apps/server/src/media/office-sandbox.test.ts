// SPDX-License-Identifier: AGPL-3.0-only

import { execFile } from 'node:child_process';
import { constants, existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  canDisableUserns,
  convertOffice,
  OFFICE_CAPS,
  officeCommand,
  takeSandboxPdf,
} from './office.ts';
import { officeSeccomp } from './seccomp.ts';
import { resetMediaTools } from './tools.ts';

const exec = promisify(execFile);
const linux = process.platform === 'linux';
const job = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'office-sandbox-'));
  await Promise.all(['in', 'out', 'render', 'profile'].map((n) => mkdir(join(dir, n))));
  return dir;
};

/** Runs the BPF program of `officeSeccomp` for system call `nr` on `arch`: the action returned. */
function filterAction(
  program: Buffer,
  arch: number,
  nr: number,
  flags = 0,
): 'allow' | 'eperm' | 'enosys' | 'kill' {
  // struct seccomp_data: the number, the architecture, the instruction pointer (8 bytes), then
  // the arguments (8 bytes each): this reads the low word of the first.
  const data = [nr, arch, 0, 0, flags];
  let a = 0;
  for (let pc = 0; pc < program.length / 8; pc++) {
    const code = program.readUInt16LE(pc * 8);
    const jt = program.readUInt8(pc * 8 + 2);
    const jf = program.readUInt8(pc * 8 + 3);
    const k = program.readUInt32LE(pc * 8 + 4);
    if (code === 0x20) a = data[k / 4] as number;
    else if (code === 0x15) pc += a === k ? jt : jf;
    else if (code === 0x35) pc += a >= k ? jt : jf;
    else if (code === 0x45) pc += a & k ? jt : jf;
    else if (code === 0x06)
      return k === 0x7fff0000
        ? 'allow'
        : k === 0x80000000
          ? 'kill'
          : k === 0x50001
            ? 'eperm'
            : 'enosys';
  }
  throw new Error('filter does not return');
}

describe('seccomp filter', () => {
  const x64 = officeSeccomp('x64') as Buffer;
  const arm64 = officeSeccomp('arm64') as Buffer;
  it('denies io_uring, keyring, ptrace, mounts and namespace changes on each architecture', () => {
    // [io_uring_setup, keyctl, ptrace, mount, unshare]
    for (const [filter, arch, numbers] of [
      [x64, 0xc000003e, [425, 250, 101, 165, 272]],
      [arm64, 0xc00000b7, [425, 219, 117, 40, 97]],
    ] as const)
      for (const nr of numbers) expect(filterAction(filter, arch, nr)).toBe('eperm');
  });
  it('allows what LibreOffice needs, refuses x32 numbers and foreign architectures', () => {
    // read, write, openat, mmap, futex on x86-64; read, write, openat on arm64
    for (const nr of [0, 1, 257, 9, 202]) expect(filterAction(x64, 0xc000003e, nr)).toBe('allow');
    for (const nr of [63, 64, 56]) expect(filterAction(arm64, 0xc00000b7, nr)).toBe('allow');
    expect(filterAction(x64, 0xc000003e, 0x40000000 + 425)).toBe('eperm');
    expect(filterAction(x64, 0x40000003, 0)).toBe('kill');
  });
  it('stops user namespaces made with clone, and sends clone3 back to clone', () => {
    for (const [filter, arch, clone] of [
      [x64, 0xc000003e, 56],
      [arm64, 0xc00000b7, 220],
    ] as const) {
      expect(filterAction(filter, arch, clone, 0x00010f00)).toBe('allow'); // a thread
      expect(filterAction(filter, arch, clone, 0x10000000 | 0x11)).toBe('eperm'); // CLONE_NEWUSER
      expect(filterAction(filter, arch, 435)).toBe('enosys');
    }
  });
  it('has no filter on other architectures: conversion stays off', () => {
    expect(officeSeccomp('riscv64')).toBeNull();
  });
});

describe.skipIf(!linux)('output taken from the sandbox', () => {
  it('copies a real PDF through its handle', async () => {
    const dir = await job();
    await writeFile(join(dir, 'out', 'source.pdf'), '%PDF-1.7\nbody');
    const copy = await takeSandboxPdf(join(dir, 'out', 'source.pdf'), join(dir, 'render', 'c.pdf'));
    expect(await readFile(copy, 'utf8')).toBe('%PDF-1.7\nbody');
  });
  it('refuses a symlink, even to a valid PDF on the host', async () => {
    const dir = await job();
    await writeFile(join(dir, 'host.pdf'), '%PDF-1.7\nhost secret');
    await symlink(join(dir, 'host.pdf'), join(dir, 'out', 'source.pdf'));
    await expect(
      takeSandboxPdf(join(dir, 'out', 'source.pdf'), join(dir, 'render', 'c.pdf')),
    ).rejects.toThrow();
    expect(existsSync(join(dir, 'render', 'c.pdf'))).toBe(false);
  });
  it('refuses a FIFO without hanging on it', async () => {
    const dir = await job();
    await exec('mkfifo', [join(dir, 'out', 'source.pdf')]);
    await expect(
      takeSandboxPdf(join(dir, 'out', 'source.pdf'), join(dir, 'render', 'c.pdf')),
    ).rejects.toThrow('Invalid converted PDF');
  });
  it('refuses a file over the cap, a wrong header and a directory', async () => {
    const dir = await job();
    const out = join(dir, 'out', 'source.pdf');
    await writeFile(out, 'not a pdf');
    await expect(takeSandboxPdf(out, join(dir, 'render', 'a.pdf'))).rejects.toThrow();
    await mkdir(join(dir, 'out', 'dir.pdf'));
    await expect(
      takeSandboxPdf(join(dir, 'out', 'dir.pdf'), join(dir, 'render', 'b.pdf')),
    ).rejects.toThrow();
    expect(constants.O_NOFOLLOW).toBeGreaterThan(0);
    expect(OFFICE_CAPS.pdf).toBe(64 * 1024 ** 2);
  });
});

/** True where bubblewrap can build the sandbox here (user namespaces allowed). */
async function sandboxWorks() {
  // The job mounts the fonts and LibreOffice configuration of the host: they must exist.
  if (!linux || !existsSync('/etc/libreoffice') || !existsSync('/etc/fonts')) return false;
  try {
    await exec('bwrap', [
      '--unshare-user',
      '--ro-bind',
      '/usr',
      '/usr',
      '--symlink',
      'usr/lib',
      '/lib',
      '--symlink',
      'usr/lib64',
      '/lib64',
      '/usr/bin/true',
    ]);
    return true;
  } catch {
    return false;
  }
}

describe('the real sandbox (Linux with user namespaces)', () => {
  let works = false;
  beforeAll(async () => {
    works = await sandboxWorks();
  });
  /** The production sandbox, running `script` instead of LibreOffice. */
  async function inSandbox(dir: string, script: string) {
    const args = officeCommand(dir, 'csv', await canDisableUserns());
    const sandbox = args.slice(0, args.indexOf('/usr/bin/libreoffice'));
    const { runTool } = await vi.importActual<typeof import('./tools.ts')>('./tools.ts');
    return runTool('bwrap', [...sandbox, '/usr/bin/perl', '-e', script], {
      timeoutMs: 20_000,
      input: officeSeccomp() as Buffer,
    });
  }
  it('denies io_uring_setup and keyctl with EPERM and no new user namespace', async (ctx) => {
    if (!works) return ctx.skip();
    const dir = await job();
    const nr = process.arch === 'arm64' ? { keyctl: 219 } : { keyctl: 250 };
    const out = await inSandbox(
      dir,
      `syscall(425, 0, 0); print "io_uring=", $!+0, "\\n"; $! = 0; syscall(${nr.keyctl}, 0, 0, 0, 0, 0); print "keyctl=", $!+0, "\\n";` +
        'system("/usr/bin/unshare", "-U", "true"); print "unshare=", $? >> 8, "\\n";',
    );
    expect(out.toString()).toContain('io_uring=1\n');
    expect(out.toString()).toContain('keyctl=1\n');
    expect(out.toString()).not.toContain('unshare=0');
  });
  it('shows only in/, out/ and profile/ of the job, and in/ is read-only', async (ctx) => {
    if (!works) return ctx.skip();
    const dir = await job();
    await writeFile(join(dir, 'in', 'source.csv'), 'a,b');
    await writeFile(join(dir, 'host-render.png'), 'host file');
    const out = await inSandbox(
      dir,
      'opendir(D, "/in"); my @f = grep { !/^[.]/ } readdir(D); print join(",", sort @f), "\\n";' +
        'print -e "/host-render.png" ? "leak\\n" : "isolated\\n";' +
        'open(my $f, ">", "/in/x") ? print "writable\\n" : print "readonly\\n";' +
        'open($f, ">", "/out/source.pdf") && print $f "%PDF-1.7"; close $f;',
    );
    expect(out.toString()).toBe('source.csv\nisolated\nreadonly\n');
    expect(await readFile(join(dir, 'out', 'source.pdf'), 'utf8')).toBe('%PDF-1.7');
  });
  it('rejects a link or FIFO the sandbox leaves as its output', async (ctx) => {
    if (!works) return ctx.skip();
    for (const plant of [
      'symlink("/etc/passwd", "/out/source.pdf");',
      'system("/usr/bin/mkfifo", "/out/source.pdf");',
    ]) {
      const dir = await job();
      await inSandbox(dir, plant);
      await expect(
        takeSandboxPdf(join(dir, 'out', 'source.pdf'), join(dir, 'render', 'c.pdf')),
      ).rejects.toThrow();
    }
  });
  it.skipIf(!existsSync('/usr/bin/libreoffice'))(
    'converts a CSV to a PDF',
    async (ctx) => {
      if (!works) return ctx.skip();
      vi.stubEnv('OFFICE_PREVIEWS', 'true');
      resetMediaTools();
      const dir = await job();
      const csv = join(dir, 'budget.csv');
      await writeFile(csv, 'Voce,Totale\nLuci,1080.5\n');
      const pdf = await convertOffice(csv, dir, 'csv');
      expect(pdf).toBe(join(dir, 'render', 'converted.pdf'));
      expect((await readFile(pdf as string)).subarray(0, 5).toString()).toBe('%PDF-');
      // LibreOffice kept the policy (a safe-mode start would have replaced the profile).
      expect(
        await readFile(join(dir, 'profile', 'user', 'registrymodifications.xcu'), 'utf8'),
      ).toContain('MacroSecurityLevel');
      vi.unstubAllEnvs();
    },
    90_000,
  );
});
