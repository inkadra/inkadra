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
  it('reports by default and permits same-origin connections', () => {
    const h = securityHeaders(config());
    expect(h['content-security-policy-report-only']).toContain("connect-src 'self'");
    expect(h['content-security-policy-report-only']).toContain("script-src 'self';");
    expect(h['content-security-policy']).toBeUndefined();
    expect(h['content-security-policy-report-only']).not.toContain('upgrade-insecure-requests');
    expect(h['strict-transport-security']).toBeUndefined();
    expect(h['cross-origin-opener-policy']).toBe('same-origin');
    expect(h['permissions-policy']).toContain('camera=()');
    // Only the two privacy-friendly players, and no Instagram embed (decision 0050).
    expect(h['content-security-policy-report-only']).toContain(
      'frame-src https://www.youtube-nocookie.com https://player.vimeo.com;',
    );
    expect(h['permissions-policy']).toContain(
      'fullscreen=(self "https://www.youtube-nocookie.com" "https://player.vimeo.com")',
    );
  });
  it('enforces only when opted in, including S3 presigned media and uploads', () => {
    const h = securityHeaders(
      config({
        CSP_ENFORCE: 'true',
        HSTS_ENABLED: 'true',
        STORAGE_DRIVER: 's3',
        S3_BUCKET: 'media',
        S3_FORCE_PATH_STYLE: 'true',
        CSP_REPORT_URI: 'https://reports.example/csp',
        S3_ENDPOINT: 'https://objects.example',
      }),
    );
    expect(h['content-security-policy']).toContain("connect-src 'self' https://objects.example");
    expect(h['strict-transport-security']).toBe('max-age=31536000');
    expect(h['content-security-policy']).toContain('upgrade-insecure-requests');
    expect(h['content-security-policy']).toContain('report-uri https://reports.example/csp');
    expect(
      securityHeaders(
        config({
          STORAGE_DRIVER: 's3',
          S3_BUCKET: 'media',
          S3_ENDPOINT: 'https://objects.example:9000',
          S3_FORCE_PATH_STYLE: 'false',
        }),
      )['content-security-policy-report-only'],
    ).toContain('https://media.objects.example:9000');
  });
  it('never sends HSTS or upgrades insecure requests on local HTTP', () => {
    const h = securityHeaders(config({ CSP_ENFORCE: 'true', HSTS_ENABLED: 'true' }), false);
    expect(h['strict-transport-security']).toBeUndefined();
    expect(h['content-security-policy']).not.toContain('upgrade-insecure-requests');
  });
});
