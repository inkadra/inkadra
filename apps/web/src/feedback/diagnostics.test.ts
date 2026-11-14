// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { browserAndSystem, diagnostics, installFeedbackDiagnostics } from './diagnostics.ts';

afterEach(() => vi.restoreAllMocks());

it('names the browser and system without the full user agent', () => {
  expect(
    browserAndSystem(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
    ),
  ).toBe('Chrome 142 · Windows');
  expect(
    browserAndSystem(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
    ),
  ).toBe('Safari 26 · macOS');
  expect(
    browserAndSystem('Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0'),
  ).toBe('Firefox 140 · Linux');
});

it('scrubs what it collects and stays inside the sizes the server accepts', () => {
  installFeedbackDiagnostics();
  for (let i = 0; i < 60; i++)
    console.error(`Authorization: Bearer never-send-${i} ${'x'.repeat(1900)}`);
  console.warn('invite to person@example.com failed');
  const data = diagnostics('0.8.0', 'it', 'App error a3f1 token=never-send');
  expect(data.console.length).toBeLessThanOrEqual(16000);
  expect(data.console).not.toContain('never-send');
  expect(data.console).not.toContain('person@example.com');
  expect(data.console.endsWith('[redacted secret]')).toBe(true);
  expect(data.environment).toContain('Inkadra 0.8.0');
});

it('keeps the stack of an uncaught error and the text of any rejection', () => {
  installFeedbackDiagnostics();
  const error = new TypeError('x is undefined');
  error.stack = 'TypeError: x is undefined\n    at handler (board.ts:12:5)';
  window.dispatchEvent(new ErrorEvent('error', { error, message: error.message }));
  const rejection = new Event('unhandledrejection');
  Object.assign(rejection, { reason: 'plain text reason' });
  window.dispatchEvent(rejection);
  const { console: text } = diagnostics('0.8.0', 'it');
  expect(text).toContain('at handler (board.ts:12:5)');
  expect(text).toContain('error Unhandled rejection: plain text reason');
});
