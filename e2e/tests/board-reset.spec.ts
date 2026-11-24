// SPDX-License-Identifier: AGPL-3.0-only
// The collab server closes a board's document with "Reset Connection" when it refuses an update
// (decision 0139) and keeps the socket: the board signs in again and syncs, and edits refused
// again and again are set aside and the board reloaded from the server.
import { expect, type Page, test } from '@playwright/test';
import { signIn } from './perf/seed.ts';

const account = { name: 'Giulia', email: 'giulia@example.com', password: 'correct-horse-battery' };

test.use({ viewport: { width: 1280, height: 800 } });

/** Reads a lib0 varUint at `pos`: its value and the position after it. */
function varUint(bytes: Uint8Array, pos: number): [number, number] {
  let value = 0;
  for (let shift = 0; ; shift += 7) {
    const byte = bytes[pos++] ?? 0;
    value += (byte & 0x7f) * 2 ** shift;
    if (byte < 0x80) return [value, pos];
  }
}

/**
 * Routes the board's socket and spoils every edit it sends (a sync step 2 or an update) into an
 * update no Yjs client writes, which the server refuses, until the server has reset the document
 * `until` times. Counted in the server's closes: several edits sent before the board hears a
 * close can end in one reset, or in one more after its next sign-in.
 */
async function spoilEdits(page: Page) {
  const spoil = { until: 0, resets: 0 };
  await page.routeWebSocket(/\/collab/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      if (typeof message === 'string' || spoil.resets >= spoil.until) return server.send(message);
      const bytes = new Uint8Array(message);
      const [nameLength, afterLength] = varUint(bytes, 0);
      const [type, afterType] = varUint(bytes, afterLength + nameLength);
      const [step, payloadAt] = varUint(bytes, afterType);
      // Sync (0) messages that carry edits: step 2 (1) and update (2).
      if (type !== 0 || (step !== 1 && step !== 2)) return server.send(message);
      server.send(
        Buffer.concat([bytes.subarray(0, payloadAt), Buffer.from([3, 0xff, 0xff, 0xff])]),
      );
    });
    server.onMessage((message) => {
      if (typeof message !== 'string') {
        const bytes = new Uint8Array(message);
        const [nameLength, afterLength] = varUint(bytes, 0);
        const [type, reasonAt] = varUint(bytes, afterLength + nameLength);
        const [reasonLength, textAt] = varUint(bytes, reasonAt);
        const reason = Buffer.from(bytes.subarray(textAt, textAt + reasonLength)).toString();
        // The server's close of the document (7).
        if (type === 7 && reason === 'Reset Connection') spoil.resets++;
      }
      ws.send(message);
    });
  });
  return spoil;
}

async function openNewBoard(page: Page, base: string) {
  const cookie = await signIn(base, account);
  await page.context().addCookies(
    cookie.split('; ').map((pair) => {
      const i = pair.indexOf('=');
      return { name: pair.slice(0, i), value: pair.slice(i + 1), url: base };
    }),
  );
  const response = await page.request.post('/api/v1/projects', {
    headers: { origin: base },
    data: { name: `Board reset ${Date.now()}` },
  });
  expect(response.ok()).toBe(true);
  const project = (await response.json()) as { id: string };
  await page.goto(`/p/${project.id}`);
  await expect(page.locator('.sync')).toHaveAttribute('data-status', 'synced');
}

/** A double click on empty canvas starts a note, away from the empty board's choices. */
async function addNote(page: Page, text: string) {
  await page.getByTestId('canvas').dblclick({ position: { x: 320, y: 250 } });
  await expect(page.locator('[data-type="note"] [contenteditable="true"]')).toBeFocused();
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
}

const note = (page: Page, text: string) =>
  page.locator('.canvas [data-el]').filter({ hasText: text });

test('a board the server resets once signs in again and saves the edit', async ({
  page,
  baseURL,
}) => {
  const spoil = await spoilEdits(page);
  await openNewBoard(page, baseURL as string);
  spoil.until = 1;
  await addNote(page, 'Saved after a reset');
  const status = page.locator('.sync');
  await expect.poll(() => spoil.resets).toBeGreaterThanOrEqual(1);
  await expect(status).toHaveAttribute('data-status', 'synced');
  await expect(status).toContainText('Sincronizzato');
  await expect(page.locator('.board-update-notice')).toHaveCount(0);
  // The retry's handshake took it: the server has it.
  await page.reload();
  await expect(note(page, 'Saved after a reset')).toHaveCount(1);
});

test('edits the server refuses again and again are set aside and can be restored', async ({
  page,
  baseURL,
}) => {
  const spoil = await spoilEdits(page);
  await openNewBoard(page, baseURL as string);
  spoil.until = 3;
  await addNote(page, 'Refused three times');
  const notice = page.locator('.board-update-notice');
  await expect(notice).toContainText('il server non le ha accettate');
  await expect(notice.getByRole('button')).toHaveText([
    'Ripristina nella board',
    'Scarica le modifiche',
    'Scarta',
  ]);
  // Reloaded from what the server has, and synced again.
  await expect(note(page, 'Refused three times')).toHaveCount(0);
  await expect(page.locator('.sync')).toHaveAttribute('data-status', 'synced');

  await notice.getByRole('button', { name: 'Ripristina nella board' }).click();
  await expect(note(page, 'Refused three times')).toHaveCount(1);
  await expect(notice).toHaveCount(0);
  await page.reload();
  await expect(note(page, 'Refused three times')).toHaveCount(1);
});
