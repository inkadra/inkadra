import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test('same-build updates survive updatefound delivered after installation', async ({ page }) => {
  const dist = new URL('../../apps/web/dist/', import.meta.url);
  let worker = readFileSync(new URL('sw.js', dist), 'utf8');
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://fixture').pathname;
    res.setHeader('cache-control', 'no-store');
    if (path.startsWith('/api/')) {
      res.setHeader('content-type', 'application/json');
      res.end('null');
      return;
    }
    try {
      const file = path === '/' || path === '/login' ? '/index.html' : path;
      res.setHeader(
        'content-type',
        file.endsWith('.js')
          ? 'application/javascript'
          : file.endsWith('.css')
            ? 'text/css'
            : 'text/html',
      );
      res.end(file === '/sw.js' ? worker : readFileSync(fileURLToPath(new URL(`.${file}`, dist))));
    } catch {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture address');
    await page.addInitScript(() => {
      const add = ServiceWorkerRegistration.prototype.addEventListener;
      ServiceWorkerRegistration.prototype.addEventListener = function (
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions,
      ) {
        if (type !== 'updatefound' || typeof listener !== 'function') {
          return add.call(this, type, listener, options);
        }
        return add.call(
          this,
          type,
          (event) => {
            const installing = this.installing;
            if (!installing) return listener.call(this, event);
            // Deliver the notification only after the browser has moved the worker to waiting.
            const deliver = () => {
              if (installing.state === 'installed') {
                setTimeout(() => listener.call(this, event), 0);
              }
            };
            installing.addEventListener('statechange', deliver, { once: true });
            if (installing.state === 'installed') deliver();
          },
          options,
        );
      };
    });
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.evaluate(async () => navigator.serviceWorker.ready);
    await page.reload();
    const previous = await page.evaluateHandle(() => navigator.serviceWorker.controller);
    expect(await previous.evaluate((controller) => !!controller)).toBe(true);
    worker += '\n// same build, different worker bytes\n';
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.update());
    await page.waitForFunction(
      (controller) => navigator.serviceWorker.controller !== controller,
      previous,
    );
    expect(
      await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting),
    ).toBe(false);
    await expect(page.locator('.pwa-update')).toHaveCount(0);
    await previous.dispose();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
