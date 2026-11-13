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

describe('CSP_REPORT_URI', () => {
  it('treats an empty value as unset and rejects a relative one', () => {
    expect(loadConfig({ ...base, CSP_REPORT_URI: '' }).CSP_REPORT_URI).toBeUndefined();
    expect(
      loadConfig({ ...base, CSP_REPORT_URI: 'https://r.example.com/csp' }).CSP_REPORT_URI,
    ).toBe('https://r.example.com/csp');
    expect(() => loadConfig({ ...base, CSP_REPORT_URI: '/csp' })).toThrow(/CSP_REPORT_URI/);
  });
});

describe('empty variables', () => {
  // compose.yaml hands the container every line of .env, `OIDC_SCOPES=` included.
  it('read as unset, except FEEDBACK_RELAY_URL, where empty turns the relay off', () => {
    const empty = {
      UPLOAD_MAX_SIZE: '',
      LOG_LEVEL: '',
      HSTS_ENABLED: '',
      VIDEO_PROXY_MAX_DURATION: '',
      OIDC_ALLOWED_DOMAINS: '',
      OIDC_SCOPES: '',
      TRUST_PROXY: '',
      MAP_GEOCODER_URL: '',
      INSTANCE_NAME: '',
    };
    const c = loadConfig({ ...base, ...empty });
    expect(c).toEqual(loadConfig(base));
    expect(c).toMatchObject({
      UPLOAD_MAX_SIZE: 20 * 1024 ** 3,
      LOG_LEVEL: 'info',
      HSTS_ENABLED: false,
      VIDEO_PROXY_MAX_DURATION: 7200,
      OIDC_ALLOWED_DOMAINS: [],
      OIDC_SCOPES: 'openid email profile',
      TRUST_PROXY: 'loopback,linklocal,uniquelocal',
      INSTANCE_NAME: 'Inkadra',
      FEEDBACK_RELAY_URL: 'https://relay.inkadra.com',
    });
    expect(loadConfig({ ...base, ...empty, FEEDBACK_RELAY_URL: '' }).FEEDBACK_RELAY_URL).toBe('');
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
