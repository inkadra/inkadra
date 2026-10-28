import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.ts';
import { securityHeaders } from './security-headers.ts';

const config = (env: Record<string, string> = {}) =>
  loadConfig({
    NODE_ENV: 'test',
    PUBLIC_URL: 'https://inkadra.example:8443',
    DATABASE_URL: 'unused',
    AUTH_SECRET: 'test-secret-test-secret-test-secret',
    ...env,
  });

describe('browser security policy', () => {
  it('reports by default and derives the websocket origin including port', () => {
    const h = securityHeaders(config());
    expect(h['content-security-policy-report-only']).toContain('wss://inkadra.example:8443');
    expect(h['content-security-policy-report-only']).toContain("script-src 'self';");
    expect(h['content-security-policy']).toBeUndefined();
    expect(h['strict-transport-security']).toBeUndefined();
    expect(h['cross-origin-opener-policy']).toBe('same-origin');
    expect(h['permissions-policy']).toContain('camera=()');
  });
  it('enforces only when opted in, including S3 presigned media and uploads', () => {
    const h = securityHeaders(
      config({
        CSP_ENFORCE: 'true',
        HSTS_ENABLED: 'true',
        STORAGE_DRIVER: 's3',
        S3_BUCKET: 'media',
        S3_ENDPOINT: 'https://objects.example',
      }),
    );
    expect(h['content-security-policy']).toContain(
      "connect-src 'self' wss://inkadra.example:8443 https://objects.example",
    );
    expect(h['strict-transport-security']).toBe('max-age=31536000');
  });
  it('never sends HSTS or upgrades insecure requests on local HTTP', () => {
    const h = securityHeaders(
      config({ PUBLIC_URL: 'http://localhost:3000', HSTS_ENABLED: 'true' }),
    );
    expect(h['strict-transport-security']).toBeUndefined();
    expect(h['content-security-policy-report-only']).not.toContain('upgrade-insecure-requests');
  });
});
