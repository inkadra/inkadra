import type { Config } from '../config.ts';

export function securityHeaders(
  config: Config,
  secure = config.PUBLIC_URL.startsWith('https:'),
): Record<string, string> {
  const storage =
    config.STORAGE_DRIVER === 's3'
      ? config.S3_ENDPOINT
        ? (() => {
            const url = new URL(config.S3_ENDPOINT);
            if (!config.S3_FORCE_PATH_STYLE) url.hostname = `${config.S3_BUCKET}.${url.hostname}`;
            return url.origin;
          })()
        : `https://${config.S3_BUCKET}.s3.${config.S3_REGION}.amazonaws.com`
      : '';
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: https://*.googleusercontent.com ${storage}`.trim(),
    `media-src 'self' blob: ${storage}`.trim(),
    "font-src 'self'",
    `connect-src 'self' ${storage}`.trim(),
    'frame-src https://www.youtube-nocookie.com https://player.vimeo.com https://www.instagram.com',
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(config.CSP_REPORT_URI ? [`report-uri ${config.CSP_REPORT_URI}`] : []),
    ...(config.CSP_ENFORCE && secure ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
  const players =
    '(self "https://www.youtube-nocookie.com" "https://player.vimeo.com" "https://www.instagram.com")';
  return {
    [config.CSP_ENFORCE ? 'content-security-policy' : 'content-security-policy-report-only']:
      policy,
    'permissions-policy': `camera=(), microphone=(), geolocation=(), payment=(), usb=(), autoplay=${players}, encrypted-media=${players}, picture-in-picture=${players}, fullscreen=${players}, clipboard-write=${players}`,
    'cross-origin-opener-policy': 'same-origin',
    ...(config.HSTS_ENABLED && secure ? { 'strict-transport-security': 'max-age=31536000' } : {}),
  };
}
