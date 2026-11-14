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
  it('enforces by default and permits same-origin connections', () => {
    const h = securityHeaders(config());
    expect(h['content-security-policy']).toContain("connect-src 'self'");
    expect(h['content-security-policy']).toContain("script-src 'self';");
    expect(h['content-security-policy-report-only']).toBeUndefined();
    expect(h['content-security-policy']).toContain('upgrade-insecure-requests');
    expect(h['strict-transport-security']).toBe('max-age=31536000');
    expect(h['cross-origin-opener-policy']).toBe('same-origin');
    expect(h['permissions-policy']).toContain('camera=()');
    expect(h['permissions-policy']).toContain('microphone=(self)');
    // Only the three players of link cards, loaded after a click (decision 0050).
    expect(h['content-security-policy']).toContain(
      'frame-src https://www.youtube-nocookie.com https://player.vimeo.com https://www.instagram.com;',
    );
    expect(h['permissions-policy']).toContain(
      'fullscreen=(self "https://www.youtube-nocookie.com" "https://player.vimeo.com" "https://www.instagram.com")',
    );
  });
  it('only reports, and sends no HSTS, when turned off', () => {
    const h = securityHeaders(config({ CSP_ENFORCE: 'false', HSTS_ENABLED: 'false' }));
    expect(h['content-security-policy']).toBeUndefined();
    expect(h['content-security-policy-report-only']).toContain("script-src 'self';");
    expect(h['content-security-policy-report-only']).not.toContain('upgrade-insecure-requests');
    expect(h['strict-transport-security']).toBeUndefined();
  });
  it('allows S3 presigned media and uploads', () => {
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
      )['content-security-policy'],
    ).toContain('https://media.objects.example:9000');
    // The address browsers are sent to (#839), not the one the server uses.
    const media = securityHeaders(
      config({
        STORAGE_DRIVER: 's3',
        S3_BUCKET: 'media',
        S3_ENDPOINT: 'http://rustfs:9000',
        S3_PUBLIC_ENDPOINT: 'https://files.example',
        S3_PUBLIC_REDIRECT: 'true',
        S3_FORCE_PATH_STYLE: 'true',
      }),
    )['content-security-policy'];
    expect(media).toContain("media-src 'self' blob: https://files.example");
    expect(media).not.toContain('rustfs');
  });
  it('never sends HSTS or upgrades insecure requests on local HTTP', () => {
    const h = securityHeaders(config({ CSP_ENFORCE: 'true', HSTS_ENABLED: 'true' }), false);
    expect(h['strict-transport-security']).toBeUndefined();
    expect(h['content-security-policy']).not.toContain('upgrade-insecure-requests');
  });
  it('never sends HSTS when PUBLIC_URL is plain HTTP, even on an HTTPS request', () => {
    const h = securityHeaders(config({ PUBLIC_URL: 'http://inkadra.lan:3000' }), true);
    expect(h['strict-transport-security']).toBeUndefined();
    expect(h['content-security-policy']).toBeDefined();
  });
});
