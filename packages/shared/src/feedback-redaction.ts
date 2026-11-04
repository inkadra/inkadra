// SPDX-License-Identifier: MPL-2.0
/** Lossy by design: diagnostics never need credentials, query strings or user identifiers. */
export function redactFeedback(text: string): string {
  return (
    text
      .replace(
        /(?:authorization|proxy-authorization|cookie|set-cookie)\s*[:=]\s*[^\r\n]+/gi,
        '[redacted header]',
      )
      .replace(/\b(?:Bearer|Basic)\s+\S+/gi, '[redacted credential]')
      .replace(
        /\b(?:gh[pousr]_\w+|github_pat_\w+|glpat-[\w-]+|ink_[\w.-]+|xox[abprs]-[\w-]+|sk-[\w-]{16,}|AKIA[0-9A-Z]{16}|eyJ[\w-]+\.[\w-]+\.[\w-]+)\b/g,
        '[redacted token]',
      )
      .replace(/(?:https?|wss?):\/\/[^\s<>"']+/gi, '[redacted URL]')
      .replace(
        /[\w-]{0,40}(?:password|passwd|pwd|secret|token|api[-_]?key|access[-_]?key|private[-_]?key|session|(?<![a-z])sid(?![a-z]))[\w-]{0,40}["']?\s*[:=]\s*["']?[^\s,;"'}]+/gi,
        '[redacted secret]',
      )
      .replace(/\/(?:s|share|guest\/by-token|calendar)\/[^\s?#]+/gi, '/[redacted link]')
      .replace(/\?(?!\[redacted)[^\s<>"']*/g, '?[redacted query]')
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]')
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[id]')
      // Bare share-link tokens and other opaque credentials have no prefix to recognise.
      .replace(/(?<![\w.-])[A-Za-z0-9_-]{32,}(?![\w-]|\.\w)/g, '[redacted token]')
  );
}
export function feedbackPage(path: string): string {
  const safe = new Set([
    'p',
    'b',
    'api',
    'v1',
    'me',
    'assets',
    'variants',
    'thumb',
    'comments',
    'reviews',
    'search',
    'users',
    'notifications',
    'schedule',
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
    'team',
    'diagnostics',
    'onboarding',
  ]);
  return (
    path
      .split(/[?#]/)[0]
      ?.split('/')
      .map((part) => (!part || safe.has(part) ? part : '[id]'))
      .join('/') ?? '/'
  );
}
