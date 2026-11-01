// SPDX-License-Identifier: AGPL-3.0-only
import { copyFile, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { readZip } from '../transfers/zip.ts';
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
};
export { officeKey } from '../storage.ts';

/** The worker fails closed: no conversion without Linux namespaces AND prlimit. */
export function officeCommand(dir: string, ext: string): string[] {
  return [
    '--unshare-all',
    '--die-with-parent',
    '--new-session',
    '--cap-drop',
    'ALL',
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
    '--bind',
    dir,
    '/work',
    '--chdir',
    '/work',
    '--setenv',
    'HOME',
    '/work',
    '--setenv',
    'TMPDIR',
    '/tmp',
    '/usr/bin/libreoffice',
    '-env:UserInstallation=file:///work/profile',
    '--headless',
    '--safe-mode',
    '--nologo',
    '--nodefault',
    '--nofirststartwizard',
    '--convert-to',
    'pdf',
    '--outdir',
    '/work',
    `/work/source.${ext}`,
  ];
}

export async function convertOffice(
  source: string,
  dir: string,
  ext: string,
): Promise<string | null> {
  const { prlimit } = await mediaTools();
  if (process.env.OFFICE_PREVIEWS !== 'true' || process.platform !== 'linux' || !prlimit)
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
  await copyFile(source, join(dir, `source.${ext}`));
  await runTool('bwrap', officeCommand(dir, ext), {
    timeoutMs: OFFICE_CAPS.timeout,
    memoryBytes: OFFICE_CAPS.memory,
    fileBytes: OFFICE_CAPS.pdf,
    maxBuffer: 64 * 1024,
  });
  const out = join(dir, 'source.pdf');
  if (
    (await stat(out)).size > OFFICE_CAPS.pdf ||
    !(await readFile(out)).subarray(0, 5).equals(Buffer.from('%PDF-'))
  )
    throw new Error('Invalid converted PDF');
  return out;
}
