import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

describe('collaboration libraries', () => {
  // lib0 before 0.2.120 read `localStorage` on import, and Node 25+ warns about it in every log.
  it('load without an ExperimentalWarning about localStorage', async () => {
    const { stderr } = await promisify(execFile)(
      process.execPath,
      ['--input-type=module', '-e', "await import('yjs'); await import('@hocuspocus/server');"],
      { cwd: import.meta.dirname },
    );
    expect(stderr).not.toContain('localStorage');
  });
});
