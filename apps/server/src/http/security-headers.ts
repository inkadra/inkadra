import type { Config } from '../config.ts';

export function securityHeaders(config: Config): Record<string, string> {
  const publicUrl = new URL(config.PUBLIC_URL);
  const socket = `${publicUrl.protocol === 'https:' ? 'wss:' : 'ws:'}//${publicUrl.host}`;
  const storage =
    config.STORAGE_DRIVER === 's3'
      ? config.S3_ENDPOINT
        ? new URL(config.S3_ENDPOINT).origin
        : `https://${config.S3_BUCKET}.s3.${config.S3_REGION}.amazonaws.com`
      : '';
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: https://*.googleusercontent.com ${storage}`.trim(),
    `media-src 'self' blob: ${storage}`.trim(),
    "font-src 'self'",
    `connect-src 'self' ${socket} ${storage}`.trim(),
    'frame-src https://www.youtube-nocookie.com',
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(publicUrl.protocol === 'https:' ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
  const youtube = '(self "https://www.youtube-nocookie.com")';
  return {
    [config.CSP_ENFORCE ? 'content-security-policy' : 'content-security-policy-report-only']:
      policy,
    'permissions-policy': `camera=(), microphone=(), geolocation=(), payment=(), usb=(), autoplay=${youtube}, encrypted-media=${youtube}, picture-in-picture=${youtube}, fullscreen=${youtube}, clipboard-write=${youtube}`,
    'cross-origin-opener-policy': 'same-origin',
    ...(config.HSTS_ENABLED && publicUrl.protocol === 'https:'
      ? { 'strict-transport-security': 'max-age=31536000' }
      : {}),
  };
}
