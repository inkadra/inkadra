import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from './config.ts';

const base = {
  PUBLIC_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://unused',
  AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
};

describe('UPLOAD_MAX_SIZE', () => {
  it.each([
    ['1048576', 1048576],
    ['500MB', 500 * 1024 ** 2],
    ['20 GB', 20 * 1024 ** 3],
    ['2TiB', 2 * 1024 ** 4],
    ['1.5g', 1.5 * 1024 ** 3],
    ['0', 0],
  ])('reads %s', (value, bytes) => {
    expect(loadConfig({ ...base, UPLOAD_MAX_SIZE: value }).UPLOAD_MAX_SIZE).toBe(bytes);
  });

  it('defaults to 20GB and rejects nonsense', () => {
    expect(loadConfig(base).UPLOAD_MAX_SIZE).toBe(20 * 1024 ** 3);
    expect(() => loadConfig({ ...base, UPLOAD_MAX_SIZE: 'lots' })).toThrow(/UPLOAD_MAX_SIZE/);
  });
});

describe('backup folder and bucket (#899)', () => {
  it('defaults to DATA_DIR/backups and the files bucket, and wants both keys and a folder prefix', async () => {
    const { backupDirOf, backupRemoteLabel } = await import('./backup.ts');
    const local = loadConfig({ ...base, DATA_DIR: '/data' });
    expect(backupDirOf(local)).toMatch(/[/\\]data[/\\]backups$/);
    expect(backupRemoteLabel(local)).toBeNull();
    expect(backupDirOf(loadConfig({ ...base, BACKUP_DIR: '/mnt/backups' }))).toBe('/mnt/backups');
    const remote = loadConfig({
      ...base,
      BACKUP_S3_BUCKET: 'archives',
      BACKUP_S3_ACCESS_KEY_ID: 'id',
      BACKUP_S3_SECRET_ACCESS_KEY: 'secret',
    });
    expect(backupRemoteLabel(remote)).toBe('s3://archives/backups/');
    expect(() =>
      loadConfig({ ...base, BACKUP_S3_BUCKET: 'archives', BACKUP_S3_ACCESS_KEY_ID: 'id' }),
    ).toThrow(/BACKUP_S3_SECRET_ACCESS_KEY/);
    expect(() => loadConfig({ ...base, BACKUP_S3_PREFIX: 'backups' })).toThrow(/BACKUP_S3_PREFIX/);
    expect(() => loadConfig({ ...base, BACKUP_S3_PREFIX: '../x/' })).toThrow(/BACKUP_S3_PREFIX/);
    expect(() => loadConfig({ ...base, BACKUP_S3_PREFIX: 'my-backups/' })).toThrow(
      /BACKUP_S3_PREFIX/,
    );
    // Never among the stored files: originals (and tus uploads), copies, feedback attachments.
    for (const prefix of ['originals/', 'variants/backups/', 'feedback/'])
      expect(() => loadConfig({ ...base, BACKUP_S3_PREFIX: prefix })).toThrow(
        /BACKUP_S3_PREFIX: Not inside the folders of stored files/,
      );
    expect(loadConfig({ ...base, BACKUP_S3_PREFIX: 'inkadra/nightly-2/' }).BACKUP_S3_PREFIX).toBe(
      'inkadra/nightly-2/',
    );
  });
});

describe('CSP_REPORT_URI', () => {
  it('treats an empty value as unset and rejects a relative one', () => {
    expect(loadConfig({ ...base, CSP_REPORT_URI: '' }).CSP_REPORT_URI).toBeUndefined();
    expect(
      loadConfig({ ...base, CSP_REPORT_URI: 'https://r.example.com/csp' }).CSP_REPORT_URI,
    ).toBe('https://r.example.com/csp');
    expect(() => loadConfig({ ...base, CSP_REPORT_URI: '/csp' })).toThrow(/CSP_REPORT_URI/);
  });
});

it('identifies edge revisions without changing release versions', async () => {
  try {
    vi.stubEnv('INKADRA_VERSION', 'edge');
    vi.stubEnv('INKADRA_REVISION', 'abcdef123456789');
    vi.resetModules();
    expect((await import('./config.ts')).VERSION).toBe('edge-abcdef1');
    vi.stubEnv('INKADRA_VERSION', '0.9.0');
    vi.resetModules();
    expect((await import('./config.ts')).VERSION).toBe('0.9.0');
  } finally {
    vi.unstubAllEnvs();
    vi.resetModules();
  }
});

it('defaults board caps and requires positive safe integers', () => {
  expect(loadConfig(base).BOARD_MAX_STATE_BYTES).toBe(64 * 1024 * 1024);
  expect(loadConfig(base).BOARD_MAX_ELEMENTS).toBe(20_000);
  for (const key of ['BOARD_MAX_STATE_BYTES', 'BOARD_MAX_ELEMENTS']) {
    for (const value of ['0', '-1', 'Infinity', 'lots', '9007199254740992', ''])
      expect(() => loadConfig({ ...base, [key]: value })).toThrow(key);
    expect(loadConfig({ ...base, [key]: '100' })[key as 'BOARD_MAX_ELEMENTS']).toBe(100);
  }
  expect(() => loadConfig({ ...base, BOARD_MAX_ELEMENTS: '1.5' })).toThrow('BOARD_MAX_ELEMENTS');
  // The same spellings as the other sizes.
  for (const value of ['64MB', '64MiB', '64 mb', '67108864'])
    expect(loadConfig({ ...base, BOARD_MAX_STATE_BYTES: value }).BOARD_MAX_STATE_BYTES).toBe(
      64 * 1024 * 1024,
    );
});
