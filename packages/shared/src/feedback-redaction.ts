// SPDX-License-Identifier: MPL-2.0
/** Lossy by design: diagnostics never need credentials, query strings or user identifiers. */
export function redactFeedback(text: string): string {
  return text
    .replace(
      /(?:authorization|proxy-authorization|cookie|set-cookie)\s*[:=]\s*[^\r\n]+/gi,
      '[redacted header]',
    )
    .replace(/\b(?:Bearer|Basic)\s+\S+/gi, '[redacted credential]')
    .replace(
      /\b(?:gh[pousr]_[\w]+|github_pat_[\w]+|ink_[\w.-]+|eyJ[\w-]+\.[\w-]+\.[\w-]+)\b/g,
      '[redacted token]',
    )
    .replace(/(?:https?|wss?):\/\/[^\s<>"']+/gi, '[redacted URL]')
    .replace(
      /\b(?:password|passwd|secret|token|api[-_]?key|access[-_]?key|session)\b["']?\s*[:=]\s*["']?[^\s,;"'}]+/gi,
      '[redacted secret]',
    )
    .replace(/\/(?:s|share|guest\/by-token|calendar)\/[^\s?#]+/gi, '/[redacted link]')
    .replace(/\?[^\s<>"']*/g, '?[redacted query]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[id]');
}
export function feedbackPage(path: string): string {
  const safe = new Set([
    'project',
    'projects',
    'board',
    'boards',
    'settings',
    'home',
    'inbox',
    'guest',
    'links',
    'profile',
    'about',
  ]);
  return (
    path
      .split(/[?#]/)[0]
      ?.split('/')
      .map((part) => (!part || safe.has(part) ? part : '[id]'))
      .join('/') ?? '/'
  );
}
