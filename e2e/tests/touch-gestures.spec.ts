import { expect, type Page, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

type Finger = { x: number; y: number; id: number };

/** Scale and translation of the canvas world, read from its transform. */
async function view(page: Page) {
  const transform = await page.locator('.canvas__world').evaluate((n) => n.style.transform);
  const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(transform);
  if (!m) throw new Error(`unexpected transform: ${transform}`);
  return { x: Number(m[1]), y: Number(m[2]), zoom: Number(m[3]) };
}

/** Waits until the last input has been drawn: the pinch moves the view once per frame. */
const settle = (page: Page) =>
  page.evaluate(
    () =>
      new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 50))),
      ),
  );

/** Signs in, opens a new project and writes a note on its board; returns the note. */
async function boardWithNote(page: Page, baseURL: string) {
  const instance = await (await page.request.get('/api/v1/instance')).json();
  const auth = await page.request.post(
    `/api/auth/${instance.setupRequired ? 'sign-up/email' : 'sign-in/email'}`,
    {
      headers: { origin: baseURL },
      data: {
        name: 'Giulia Bianchi',
        email: 'giulia@example.com',
        password: 'correct-horse-battery',
      },
    },
  );
  expect(auth.ok()).toBe(true);
  const response = await page.request.post('/api/v1/projects', {
    headers: { origin: baseURL },
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
  return card;
}

/**
 * Real touches through the DevTools protocol: Chrome turns them into pointer events of type
 * touch, with pointer capture. The ids of the pointers, in the order they went down, are kept in
 * `window.fingers`.
 */
async function touchscreen(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { fingers: number[] };
    w.fingers = [];
    window.addEventListener('pointerdown', (e) => w.fingers.push(e.pointerId), true);
  });
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: Finger[]) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map((p) => ({ x: p.x, y: p.y, id: p.id })),
    });
  /**
   * Lifts one finger, the nth to go down. The protocol only lifts all fingers at once, so its
   * pointerup is sent by hand.
   */
  const lift = (nth: number, at: { x: number; y: number }) =>
    page.getByTestId('canvas').evaluate(
      (canvas, { nth, at }) => {
        const pointerId = (window as unknown as { fingers: number[] }).fingers[nth];
        canvas.dispatchEvent(
          new PointerEvent('pointerup', {
            pointerId,
            pointerType: 'touch',
            bubbles: true,
            clientX: at.x,
            clientY: at.y,
          }),
        );
      },
      { nth, at },
    );
  return { touch, lift };
}

test('two fingers pan and zoom the canvas without moving the card under the first', async ({
  page,
  baseURL,
}) => {
  const card = await boardWithNote(page, baseURL!);
  const place = () => card.evaluate((n) => ({ left: n.style.left, top: n.style.top }));
  const before = await place();
  const start = await view(page);
  const box = await card.boundingBox();
  if (!box) throw new Error('note missing');
  const a = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  // The second finger lands on empty canvas above the note.
  const b = { x: a.x, y: Math.max(a.y - 160, box.y - 60) };
  const { touch, lift } = await touchscreen(page);

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

  // Lifting one finger ends the pinch; the one left neither pans nor drags.
  await lift(1, { x: b.x + 30, y: b.y - 50 });
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

test('a finger on the toolbar works its button and never joins a pinch', async ({
  page,
  baseURL,
}) => {
  await boardWithNote(page, baseURL!);
  const canvas = await page.getByTestId('canvas').boundingBox();
  if (!canvas) throw new Error('canvas missing');
  const toolbar = page.locator('.canvas .toolbar');
  const hand = toolbar.getByRole('button', { name: 'Mano', exact: true });
  await hand.scrollIntoViewIfNeeded();
  const button = await hand.boundingBox();
  if (!button) throw new Error('hand tool missing');
  const tap = { x: button.x + button.width / 2, y: button.y + button.height / 2 };
  // Empty canvas near the top, away from the note in the middle.
  const board = { x: canvas.x + 60, y: canvas.y + 140 };
  const start = await view(page);
  const { touch } = await touchscreen(page);

  // A finger on the board, then a tap on a toolbar button: the button works, nothing pinches.
  // Chrome only clicks for a lone finger, so the tap is the events a phone sends for it.
  await touch('touchStart', [{ ...board, id: 1 }]);
  await hand.evaluate((button: HTMLElement) => {
    const at = button.getBoundingClientRect();
    const init = {
      pointerId: 99,
      pointerType: 'touch',
      isPrimary: false,
      bubbles: true,
      clientX: at.x + at.width / 2,
      clientY: at.y + at.height / 2,
    };
    button.dispatchEvent(new PointerEvent('pointerdown', init));
    button.dispatchEvent(new PointerEvent('pointerup', init));
    button.click();
  });
  for (let i = 1; i <= 4; i++) {
    await touch('touchMove', [{ x: board.x + 20 * i, y: board.y + 30 * i, id: 1 }]);
  }
  await settle(page);
  await expect(hand).toHaveAttribute('aria-pressed', 'true');
  expect(await view(page)).toEqual(start);
  // The finger on the board goes on with its selection rectangle.
  await expect(page.locator('.canvas__marquee')).toBeVisible();
  await touch('touchEnd', []);
  expect(await view(page)).toEqual(start);

  // The other way round: a finger on the button, then one on the board.
  await toolbar.getByRole('button', { name: 'Seleziona', exact: true }).tap();
  await expect(hand).toHaveAttribute('aria-pressed', 'false');
  await touch('touchStart', [{ ...tap, id: 1 }]);
  await touch('touchStart', [
    { ...tap, id: 1 },
    { ...board, id: 2 },
  ]);
  for (let i = 1; i <= 4; i++) {
    await touch('touchMove', [
      { ...tap, id: 1 },
      { x: board.x + 20 * i, y: board.y + 30 * i, id: 2 },
    ]);
  }
  await settle(page);
  expect((await view(page)).zoom).toBe(start.zoom);
  await touch('touchEnd', []);
});

test('with the hand tool a finger on a note being written leaves no pan behind', async ({
  page,
  baseURL,
}) => {
  const card = await boardWithNote(page, baseURL!);
  const canvas = await page.getByTestId('canvas').boundingBox();
  if (!canvas) throw new Error('canvas missing');
  await page.locator('.canvas .toolbar').getByRole('button', { name: 'Mano', exact: true }).tap();
  await card.dblclick();
  await page.getByRole('button', { name: 'Modifica sulla board', exact: true }).tap();
  const editor = card.locator('[data-no-drag] [contenteditable="true"]');
  await expect(editor).toBeVisible();
  const box = await editor.boundingBox();
  if (!box) throw new Error('editor missing');
  const { touch } = await touchscreen(page);

  // A tap in the editor: as with a mouse, the hand tool would pan from there until it lifts.
  await touch('touchStart', [{ x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 }]);
  await touch('touchEnd', []);
  await settle(page);
  const start = await view(page);

  // Once it lifted, the pointer moving over the board pans nothing.
  await page.mouse.move(canvas.x + 60, canvas.y + 140);
  await page.mouse.move(canvas.x + 160, canvas.y + 260, { steps: 4 });
  await settle(page);
  expect(await view(page)).toEqual(start);
  await expect(page.getByTestId('canvas')).not.toHaveClass(/canvas--panning/);

  // A finger on empty board still pans the view.
  const board = { x: canvas.x + 60, y: canvas.y + 140 };
  await touch('touchStart', [{ ...board, id: 2 }]);
  for (let i = 1; i <= 4; i++) {
    await touch('touchMove', [{ x: board.x + 20 * i, y: board.y + 30 * i, id: 2 }]);
  }
  await touch('touchEnd', []);
  await settle(page);
  const panned = await view(page);
  expect(panned.zoom).toBe(start.zoom);
  expect(panned.x).toBeCloseTo(start.x + 80, 0);
  expect(panned.y).toBeCloseTo(start.y + 120, 0);
});

test('with three fingers the pinch follows the two most recent', async ({ page, baseURL }) => {
  await boardWithNote(page, baseURL!);
  const canvas = await page.getByTestId('canvas').boundingBox();
  if (!canvas) throw new Error('canvas missing');
  const f1 = { x: canvas.x + 120, y: canvas.y + 120 };
  const f2 = { x: canvas.x + 300, y: canvas.y + 120 };
  const f3 = { x: canvas.x + 190, y: canvas.y + 220 };
  const { touch, lift } = await touchscreen(page);

  await touch('touchStart', [{ ...f1, id: 1 }]);
  await touch('touchStart', [
    { ...f1, id: 1 },
    { ...f2, id: 2 },
  ]);
  const g1 = { x: f1.x - 20, y: f1.y };
  const g2 = { x: f2.x + 20, y: f2.y };
  await touch('touchMove', [
    { ...g1, id: 1 },
    { ...g2, id: 2 },
  ]);
  await settle(page);
  const two = await view(page);

  // A third finger takes over from the oldest: landing does not move the view…
  await touch('touchStart', [
    { ...g1, id: 1 },
    { ...g2, id: 2 },
    { ...f3, id: 3 },
  ]);
  await settle(page);
  expect(await view(page)).toEqual(two);
  // …the oldest finger no longer counts…
  const h1 = { x: g1.x - 40, y: g1.y + 40 };
  await touch('touchMove', [
    { ...h1, id: 1 },
    { ...g2, id: 2 },
    { ...f3, id: 3 },
  ]);
  await settle(page);
  expect(await view(page)).toEqual(two);
  // …and the two most recent pinch.
  const h3 = { x: f3.x - 60, y: f3.y + 120 };
  await touch('touchMove', [
    { ...h1, id: 1 },
    { ...g2, id: 2 },
    { ...h3, id: 3 },
  ]);
  await settle(page);
  const three = await view(page);
  expect(three.zoom).toBeGreaterThan(two.zoom * 1.1);

  // Lifting one of the pair with two others down goes on with those two, from where they are.
  await lift(1, g2);
  await settle(page);
  expect(await view(page)).toEqual(three);
  await touch('touchMove', [
    { x: h1.x - 40, y: h1.y, id: 1 },
    { ...g2, id: 2 },
    { ...h3, id: 3 },
  ]);
  await settle(page);
  expect((await view(page)).zoom).toBeGreaterThan(three.zoom);
  await touch('touchEnd', []);
});
