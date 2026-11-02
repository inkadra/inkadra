// SPDX-License-Identifier: AGPL-3.0-only
import { constants, createWriteStream } from 'node:fs';
import { copyFile, mkdir, open, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { readZip } from '../transfers/zip.ts';
import { officeSeccomp } from './seccomp.ts';
import { mediaTools, runTool } from './tools.ts';

export const OFFICE_EXTENSIONS = ['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'csv'];
export const officeExtension = (name: string) => {
  const ext = name.split('.').at(-1)?.toLowerCase() ?? '';
  return OFFICE_EXTENSIONS.includes(ext) ? ext : null;
};
export const OFFICE_CAPS = {
  input: 32 * 1024 ** 2,
  pdf: 64 * 1024 ** 2,
  pages: 50,
  timeout: 60_000,
  memory: 4 * 1024 ** 3,
  /** Tasks of the worker's user the sandbox may hold (`prlimit --nproc`). */
  processes: 1024,
  /** Size of the sandbox's /tmp, a memory-backed filesystem. */
  tmp: 256 * 1024 ** 2,
};

import { officeDerivativeKeys } from '../storage.ts';

export { officeKey } from '../storage.ts';

/** The derivative files of the Office assets among `assets`, to delete with their originals. */
export const officeFiles = (assets: Array<{ id: string; filename: string }>) =>
  assets.flatMap((a) => (officeExtension(a.filename) ? officeDerivativeKeys(a.id) : []));

/**
 * LibreOffice's own policy, seeded into the job profile: macros never run, and a document
 * never refreshes links to other files or sites (the sandbox has no network anyway).
 */
export const LIBREOFFICE_POLICY = `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop></item>
<item oor:path="/org.openoffice.Office.Calc/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>2</value></prop></item>
<item oor:path="/org.openoffice.Office.Writer/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>2</value></prop></item>
</oor:items>
`;

/**
 * The bubblewrap command of one job. The sandbox sees system programs and fonts read-only, a
 * read-only `in/` with the document, and two folders the host never trusts afterwards: `out/`
 * for the PDF and `profile/` for LibreOffice's settings. Nothing else of the job folder is
 * mounted, so the host's own files (renders, copies) cannot be reached or replaced from inside.
 * `--seccomp 0` reads the filter from standard input.
 */
export function officeCommand(dir: string, ext: string, disableUserns = true): string[] {
  return [
    // Fail closed: user namespaces are required (not "if possible") and cannot be nested.
    '--unshare-all',
    '--unshare-user',
    ...(disableUserns ? ['--disable-userns'] : []),
    '--die-with-parent',
    '--new-session',
    '--cap-drop',
    'ALL',
    '--seccomp',
    '0',
    '--ro-bind',
    '/usr',
    '/usr',
    '--symlink',
    'usr/bin',
    '/bin',
    '--symlink',
    'usr/lib',
    '/lib',
    '--symlink',
    'usr/lib64',
    '/lib64',
    '--proc',
    '/proc',
    '--dev',
    '/dev',
    '--size',
    String(OFFICE_CAPS.tmp),
    '--tmpfs',
    '/tmp',
    '--dir',
    '/etc',
    '--ro-bind',
    '/etc/fonts',
    '/etc/fonts',
    '--ro-bind',
    '/etc/libreoffice',
    '/etc/libreoffice',
    '--ro-bind',
    join(dir, 'in'),
    '/in',
    '--bind',
    join(dir, 'out'),
    '/out',
    '--bind',
    join(dir, 'profile'),
    '/profile',
    '--chdir',
    '/tmp',
    '--setenv',
    'HOME',
    '/tmp',
    '--setenv',
    'TMPDIR',
    '/tmp',
    '/usr/bin/libreoffice',
    '-env:UserInstallation=file:///profile',
    '--headless',
    '--safe-mode',
    '--nologo',
    '--nodefault',
    '--nofirststartwizard',
    '--convert-to',
    'pdf',
    '--outdir',
    '/out',
    `/in/source.${ext}`,
  ];
}

/** The smallest sandbox that can start a program: user namespace, system files, nothing else. */
const PROBE = [
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
];
let userns: Promise<boolean> | undefined;
/**
 * Whether bubblewrap can forbid nested user namespaces here (`--disable-userns`). It writes a
 * sysctl of the new namespace, which Docker's default read-only /proc/sys refuses. Then the
 * filter does the same job: it denies `unshare`, `setns` and `clone` with CLONE_NEWUSER.
 */
export function canDisableUserns(): Promise<boolean> {
  userns ??= (async () => {
    try {
      await runTool('bwrap', [...PROBE, '--disable-userns', '/usr/bin/true'], {
        timeoutMs: 10_000,
      });
      return true;
    } catch {
      return false;
    }
  })();
  return userns;
}

/**
 * Copies the PDF the sandbox wrote to a file of ours. The sandbox controls that name, so it
 * may be a link to a host file (`O_NOFOLLOW`), a FIFO (`O_NONBLOCK`: opening it would hang) or
 * a device: only the opened handle is trusted, checked with fstat, read for the header and
 * copied; poppler then reads the copy, which the sandbox never had a way to touch.
 */
export async function takeSandboxPdf(from: string, to: string): Promise<string> {
  const file = await open(from, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > OFFICE_CAPS.pdf) throw new Error('Invalid converted PDF');
    const header = Buffer.alloc(5);
    await file.read(header, 0, 5, 0);
    if (!header.equals(Buffer.from('%PDF-'))) throw new Error('Invalid converted PDF');
    await pipeline(
      file.createReadStream({ start: 0, end: info.size - 1, autoClose: false }),
      createWriteStream(to, { flags: 'wx' }),
    );
  } finally {
    await file.close();
  }
  return to;
}

/**
 * The PDF of an Office file, converted in the sandbox and copied out; null when conversion is
 * off or the host cannot sandbox it. Throws on a failed or invalid conversion.
 */
export async function convertOffice(
  source: string,
  dir: string,
  ext: string,
): Promise<string | null> {
  const { prlimit } = await mediaTools();
  const filter = officeSeccomp();
  if (process.env.OFFICE_PREVIEWS !== 'true' || process.platform !== 'linux' || !prlimit || !filter)
    return null;
  if ((await stat(source)).size > OFFICE_CAPS.input) throw new Error('Office file too large');
  if (ext !== 'csv') {
    const zip = await readZip(source, {
      entries: 10_000,
      totalBytes: 128 * 1024 ** 2,
      compressionRatio: 100,
    });
    zip.close();
  }
  const profile = join(dir, 'profile', 'user');
  await Promise.all(
    ['in', 'out', 'render'].map((name) => mkdir(join(dir, name), { recursive: true })),
  );
  await mkdir(profile, { recursive: true });
  await copyFile(source, join(dir, 'in', `source.${ext}`));
  await writeFile(join(profile, 'registrymodifications.xcu'), LIBREOFFICE_POLICY);
  await runTool('bwrap', officeCommand(dir, ext, await canDisableUserns()), {
    timeoutMs: OFFICE_CAPS.timeout,
    memoryBytes: OFFICE_CAPS.memory,
    fileBytes: OFFICE_CAPS.pdf,
    processes: OFFICE_CAPS.processes,
    maxBuffer: 64 * 1024,
    input: filter,
  });
  return takeSandboxPdf(join(dir, 'out', 'source.pdf'), join(dir, 'render', 'converted.pdf'));
}
