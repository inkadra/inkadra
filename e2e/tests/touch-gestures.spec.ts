import { expect, type Page, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

/** Scale and translation of the canvas world, read from its transform. */
async function view(page: Page) {
  const transform = await page.locator('.canvas__world').evaluate((n) => n.style.transform);
  const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(transform);
  if (!m) throw new Error(`unexpected transform: ${transform}`);
  return { x: Number(m[1]), y: Number(m[2]), zoom: Number(m[3]) };
}

/** Waits for the frame after the last input, when React has drawn it. */
const settle = (page: Page) =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

test('two fingers pan and zoom the canvas without moving the card under the first', async ({
  page,
  baseURL,
}) => {
  const instance = await (await page.request.get('/api/v1/instance')).json();
  const auth = await page.request.post(
    `/api/auth/${instance.setupRequired ? 'sign-up/email' : 'sign-in/email'}`,
    {
      headers: { origin: baseURL! },
      data: {
        name: 'Giulia Bianchi',
        email: 'giulia@example.com',
        password: 'correct-horse-battery',
      },
    },
  );
  expect(auth.ok()).toBe(true);
  const response = await page.request.post('/api/v1/projects', {
    headers: { origin: baseURL! },
    data: { name: `Touch ${Date.now()}` },
  });
  expect(response.ok()).toBe(true);
  const project = await response.json();
  await page.goto(`/p/${project.id}`);
  await expect(page.getByTestId('canvas')).toBeVisible();

  await page.locator('.canvas .toolbar').getByRole('button', { name: 'Nota', exact: true }).tap();
  await expect(page.locator('[data-type="note"] [contenteditable="true"]')).toBeFocused();
  await page.keyboard.type('Pizzico');
  await page.keyboard.press('Escape');
  const card = page.locator('.card[data-type="note"]', { hasText: 'Pizzico' });
  await expect(card).toHaveCount(1);
  const place = () => card.evaluate((n) => ({ left: n.style.left, top: n.style.top }));
  const before = await place();
  const start = await view(page);
  const box = await card.boundingBox();
  if (!box) throw new Error('note missing');
  const a = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  // The second finger lands on empty canvas above the note.
  const b = { x: a.x, y: Math.max(a.y - 160, box.y - 60) };

  // Real touches: Chrome turns them into pointer events of type touch, with pointer capture.
  await page.evaluate(() => {
    const w = window as unknown as { fingers: number[] };
    w.fingers = [];
    window.addEventListener('pointerdown', (e) => w.fingers.push(e.pointerId), true);
  });
  const cdp = await page.context().newCDPSession(page);
  const touch = (
    type: 'touchStart' | 'touchMove' | 'touchEnd',
    points: { x: number; y: number; id: number }[],
  ) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map((p) => ({ x: p.x, y: p.y, id: p.id })),
    });

  // One finger starts dragging the note…
  await touch('touchStart', [{ ...a, id: 1 }]);
  await touch('touchMove', [{ x: a.x + 12, y: a.y + 8, id: 1 }]);
  await touch('touchMove', [{ x: a.x + 24, y: a.y + 16, id: 1 }]);
  await expect(card).toHaveClass(/is-moving/);

  // …then the second lands: the drag is dropped and both fingers move the view.
  const a1 = { x: a.x + 24, y: a.y + 16 };
  await touch('touchStart', [
    { ...a1, id: 1 },
    { ...b, id: 2 },
  ]);
  await expect(card).not.toHaveClass(/is-moving/);
  for (let i = 1; i <= 5; i++) {
    await touch('touchMove', [
      { x: a1.x + 6 * i, y: a1.y + 10 * i, id: 1 },
      { x: b.x + 6 * i, y: b.y - 10 * i, id: 2 },
    ]);
  }
  await settle(page);
  const pinched = await view(page);
  expect(pinched.zoom).toBeGreaterThan(start.zoom * 1.2);
  expect(pinched.x).not.toBeCloseTo(start.x, 0);

  // Lifting one finger ends the pinch; the one left neither pans nor drags. The protocol only
  // lifts all fingers at once, so the second finger's pointerup is sent by hand.
  const lifted = { x: b.x + 30, y: b.y - 50 };
  await page.getByTestId('canvas').evaluate((canvas, at) => {
    const id = (window as unknown as { fingers: number[] }).fingers.at(-1);
    canvas.dispatchEvent(
      new PointerEvent('pointerup', {
        pointerId: id,
        pointerType: 'touch',
        bubbles: true,
        clientX: at.x,
        clientY: at.y,
      }),
    );
  }, lifted);
  for (let i = 1; i <= 3; i++) {
    await touch('touchMove', [{ x: a1.x + 30 + 15 * i, y: a1.y + 50 + 15 * i, id: 1 }]);
  }
  await settle(page);
  await expect(card).not.toHaveClass(/is-moving/);
  expect(await view(page)).toEqual(pinched);
  await touch('touchEnd', []);

  // The note stayed where it was; the page itself was not zoomed.
  await expect(card).not.toHaveClass(/is-moving/);
  expect(await place()).toEqual(before);
  expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
  await page.reload();
  await expect(card).toHaveCount(1);
  expect(await place()).toEqual(before);
});
