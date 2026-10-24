import { describe, expect, it } from 'vitest';
import { isPrecached, type RequestLike, route, SERVER_ROUTES } from './routing.ts';

const origin = 'https://inkadra.example.com';
const precached = new Set(['/offline.html', '/assets/index-Bzm8OgW2.js', '/assets/app-1a2b.css']);

function request(
  path: string,
  init: Partial<Omit<RequestLike, 'headers'>> & { headers?: string[] } = {},
) {
  const headers = new Set(init.headers ?? []);
  return {
    method: init.method ?? 'GET',
    url: path.startsWith('http') ? path : `${origin}${path}`,
    mode: init.mode ?? 'cors',
    headers: { has: (name: string) => headers.has(name) },
  };
}
const navigation = (path: string) => request(path, { mode: 'navigate' });
const how = (r: RequestLike) => route(r, origin, precached);

describe('service worker routing', () => {
  it('serves this build’s scripts and styles from the precache', () => {
    expect(how(request('/assets/index-Bzm8OgW2.js'))).toBe('precache');
    expect(how(request('/assets/app-1a2b.css'))).toBe('precache');
  });

  it('leaves other /assets files to the network', () => {
    // An older build's chunk, a font subset that was not kept, anything with a query.
    expect(how(request('/assets/index-OLD.js'))).toBe('network');
    expect(how(request('/assets/inter-greek-400-normal-q2sYcFCs.woff'))).toBe('network');
    expect(how(request('/assets/index-Bzm8OgW2.js?v=2'))).toBe('network');
  });

  it('never handles the API, sign-in, user files, uploads or collaboration', () => {
    for (const path of [
      '/api/v1/me',
      '/api/v1/assets/0b7c/file',
      '/api/v1/assets/0b7c/variants/1024',
      '/api/v1/uploads/abc',
      '/api/v1/diagnostics',
      '/api/auth/get-session',
      '/api',
      '/collab',
      '/collab/board',
    ]) {
      expect(how(request(path)), path).toBe('network');
      expect(how(navigation(path)), `navigation to ${path}`).toBe('network');
    }
  });

  it('lets OAuth callbacks and other redirects go straight to the server', () => {
    expect(how(navigation('/api/auth/callback/google?code=x&state=y'))).toBe('network');
    expect(how(navigation('/api/auth/oauth2/callback/oidc?code=x'))).toBe('network');
  });

  it('handles page navigations network first, including the auth pages', () => {
    for (const path of [
      '/',
      '/login',
      '/authorize?client=clipper',
      '/join/9f1c2d',
      '/diagnostics',
      '/reset-password?token=t',
      '/p/1/b/2',
    ]) {
      expect(how(navigation(path)), path).toBe('navigate');
    }
  });

  it('does not answer navigations to build files', () => {
    expect(how(navigation('/assets/index-Bzm8OgW2.js'))).toBe('network');
  });

  it('ignores anything that is not a plain GET from this origin', () => {
    expect(how(request('/assets/index-Bzm8OgW2.js', { method: 'HEAD' }))).toBe('network');
    expect(how(request('/api/v1/uploads', { method: 'POST' }))).toBe('network');
    expect(how(request('/api/v1/uploads/abc', { method: 'PATCH' }))).toBe('network');
    expect(how(request('/login', { method: 'POST', mode: 'navigate' }))).toBe('network');
    expect(how(request('https://cdn.example.org/assets/index-Bzm8OgW2.js'))).toBe('network');
    expect(how(request('https://cdn.example.org/', { mode: 'navigate' }))).toBe('network');
  });

  it('ignores range requests and requests carrying credentials in headers', () => {
    expect(how(request('/assets/index-Bzm8OgW2.js', { headers: ['range'] }))).toBe('network');
    expect(how(request('/assets/app-1a2b.css', { headers: ['authorization'] }))).toBe('network');
    expect(how(request('/', { mode: 'navigate', headers: ['authorization'] }))).toBe('network');
  });
});

// The browser's URLPattern (Node 24 has it too): the static routes match what route() skips.
const Pattern = (
  globalThis as {
    URLPattern?: new (input: string, base: string) => { test(url: string): boolean };
  }
).URLPattern;

describe.skipIf(!Pattern)('static routes', () => {
  const routed = (path: string) =>
    SERVER_ROUTES.some(({ condition }) =>
      new (Pattern as NonNullable<typeof Pattern>)(condition.urlPattern, `${origin}/sw.js`).test(
        `${origin}${path}`,
      ),
    );

  it('cover exactly the server paths the fetch handler leaves alone', () => {
    const server = [
      '/api',
      '/api/v1/me',
      '/api/auth/callback/google?code=x&state=y',
      '/collab',
      '/collab?token=x',
      '/collab/board',
    ];
    for (const path of server) {
      expect(routed(path), path).toBe(true);
      expect(how(request(path)), path).toBe('network');
    }
    for (const path of ['/apis', '/collaborate', '/assets/index-Bzm8OgW2.js', '/p/1', '/'])
      expect(routed(path), path).toBe(false);
  });
});

describe('precache list', () => {
  it('keeps fingerprinted scripts, styles and woff2 fonts only', () => {
    expect(isPrecached('assets/index-Bzm8OgW2.js')).toBe(true);
    expect(isPrecached('assets/BoardPage-MVUSs2IG.css')).toBe(true);
    expect(isPrecached('assets/inter-latin-400-normal-C38fXH4l.woff2')).toBe(true);
    expect(isPrecached('assets/index-Bzm8OgW2.js.map')).toBe(false);
    expect(isPrecached('assets/inter-latin-400-normal-CyCys3Eg.woff')).toBe(false);
    expect(isPrecached('index.html')).toBe(false);
    expect(isPrecached('sw.js')).toBe(false);
    expect(isPrecached('manifest.webmanifest')).toBe(false);
    expect(isPrecached('icons/icon-192.png')).toBe(false);
  });
});
