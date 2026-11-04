import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';

// New headless Chromium: the old headless shell has no tab capture.
test.use({
  channel: 'chromium',
  launchOptions: {
    args: [
      '--auto-select-tab-capture-source-by-title=Inkadra',
      '--enable-usermedia-screen-capturing',
    ],
  },
});

const FORM = { name: 'Segnala un problema', exact: true };
const PREVIEW = { name: 'Anteprima di ciò che invii', exact: true };
const ORIGIN_HEADERS = (page: Page) => ({ origin: new URL(page.url()).origin });

async function login(page: Page) {
  await page.goto('/login');
  const instance = await (await page.request.get('/api/v1/instance')).json();
  if (instance.setupRequired) throw new Error('first-run creates the administrator');
  await page.getByLabel('Email', { exact: true }).fill('giulia@example.com');
  await page.getByLabel('Password', { exact: true }).fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Accedi', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Giulia$/ })).toBeVisible();
}
const ready = (page: Page) => expect(page.getByRole('button', FORM).first()).toBeVisible();
async function configure(page: Page, destination = 'inbox', guests = false) {
  const saved = await page.request.put('/api/v1/feedback/settings', {
    headers: ORIGIN_HEADERS(page),
    data: { destination, repository: destination === 'github' ? 'test/feedback' : null, guests },
  });
  expect(saved.ok()).toBe(true);
}
// Explicitly turn reporting off after each test.
test.afterEach(async ({ page }) => {
  if (!page.url().startsWith('http')) return;
  await page.request.put('/api/v1/feedback/settings', {
    headers: ORIGIN_HEADERS(page),
    data: { destination: 'off', repository: null, guests: false },
  });
});

test('respects an explicit off choice, and the shortcut says so', async ({ page }) => {
  await page.addInitScript(() => {
    window.addEventListener(
      'keydown',
      (event) => {
        (window as unknown as { lastKey: KeyboardEvent }).lastKey = event;
      },
      true,
    );
  });
  await login(page);
  await configure(page, 'off');
  await page.reload();
  await expect(page.getByRole('heading', { name: /Giulia$/ })).toBeVisible();
  await expect(page.getByRole('button', FORM)).toHaveCount(0);
  await page.keyboard.press('Control+Shift+B');
  const dialog = page.getByRole('dialog', FORM);
  await expect(dialog).toContainText('Le segnalazioni non sono attive');
  // The browser's bookmarks bar stays shut: its default action is cancelled.
  expect(
    await page.evaluate(
      () => (window as unknown as { lastKey: KeyboardEvent }).lastKey.defaultPrevented,
    ),
  ).toBe(true);
  await dialog.getByRole('button', { name: 'Configura', exact: true }).click();
  await expect(page).toHaveURL(/section=instance/);
  await expect(
    page.getByText('Non attive su questa istanza. Chiedi a chi la gestisce.'),
  ).toBeVisible();
});

test('has no entry on the sign-in page', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Accedi', exact: true })).toBeVisible();
  await page.keyboard.press('Control+Shift+B');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', FORM)).toHaveCount(0);
});

test('the shortcut wins inside a note and leaves no quote behind', async ({ page }) => {
  await login(page);
  await configure(page);
  const project = await (
    await page.request.post('/api/v1/projects', {
      headers: ORIGIN_HEADERS(page),
      data: { name: 'Note e segnalazioni' },
    })
  ).json();
  await page.goto(`/p/${project.id}/b/${project.rootBoardId}`);
  await ready(page);
  await page.getByTestId('canvas').dblclick({ position: { x: 400, y: 300 } });
  await page.keyboard.type('Una nota');
  await page.keyboard.press('Control+Shift+B');
  await expect(page.getByRole('dialog', FORM)).toBeVisible();
  await expect(page.locator('.note-text blockquote')).toHaveCount(0);
});

test('captures and redacts a screenshot, shows the scrubbed logs, waits for the network, sends once', async ({
  page,
  context,
}) => {
  await login(page);
  await configure(page);
  await page.reload();
  await ready(page);
  await page.evaluate(() => {
    console.warn('Authorization: Bearer never-send-this');
    console.error('TypeError: feedback test');
  });
  await page.keyboard.press('Control+Shift+B');
  const dialog = page.getByRole('dialog', FORM);
  await expect(dialog.getByRole('img', { name: 'Screenshot', exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Titolo', { exact: true })).toBeFocused();
  await dialog.getByRole('button', { name: 'Anteprima', exact: true }).click();
  await expect(dialog.getByText('Scrivi un titolo.')).toBeVisible();
  await dialog.getByLabel('Titolo', { exact: true }).fill('Il menu esce @maintainer');
  await dialog.getByRole('button', { name: 'Sfoca', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Modifica lo screenshot', exact: true });
  await editor.locator('canvas').focus();
  await page.keyboard.press('Enter');
  await editor.getByRole('button', { name: 'Applica', exact: true }).click();
  await expect(dialog.getByText('1 area sfocata')).toBeVisible();
  await dialog.getByRole('button', { name: 'Anteprima', exact: true }).click();
  const preview = page.getByRole('dialog', PREVIEW);
  await expect(preview).toContainText('[redacted header]');
  await expect(preview).not.toContainText('never-send-this');
  await expect(
    preview.getByLabel('Richieste fallite: solo metodo, percorso, stato'),
  ).not.toBeChecked();
  const send = preview.getByRole('button', { name: 'Invia segnalazione', exact: true });
  await context.setOffline(true);
  await expect(send).toBeDisabled();
  await context.setOffline(false);
  await expect(preview.getByText('Sei di nuovo online: puoi inviare.')).toBeVisible();
  await send.click();
  await expect(page.getByText('Segnalazione inviata', { exact: true })).toBeVisible();
  await expect(page.getByText('la trovano nella loro Inbox')).toBeVisible();
  const reports = await (await page.request.get('/api/v1/feedback/reports')).json();
  const [report] = reports.items;
  expect(report.report.diagnostics.console).not.toContain('never-send-this');
  expect(report.report.diagnostics.network).toBeUndefined();
  expect(report.report.attachments[0]).toMatchObject({ kind: 'screenshot', redactedAreas: 1 });
  // Whoever holds the link opens it, without a session; the bytes are a real image.
  const link = await context.browser()?.newContext();
  const opened = await link?.request.get(
    `${new URL(page.url()).origin}/api/v1/feedback/attachments/${report.report.attachments[0].id}`,
  );
  expect(opened?.status()).toBe(200);
  expect(opened?.headers()['content-type']).toBe('image/png');
  expect(opened?.headers()['cache-control']).toContain('no-store');
  await link?.close();
});

test('leaves the secrets on screen out of the screenshot', async ({ page }) => {
  await page.addInitScript(() => {
    // What the screenshot library draws: the whole page as text, before it becomes pixels.
    const src = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      ...src,
      set(value: string) {
        if (String(value).startsWith('data:image/svg+xml')) {
          const probe = window as unknown as { drawn: string };
          probe.drawn = decodeURIComponent(String(value));
        }
        src?.set?.call(this, value);
      },
    });
  });
  await page.route('**/api/auth/two-factor/enable', (route) =>
    route.fulfill({
      json: {
        totpURI: 'otpauth://totp/Inkadra?secret=TOTPSECRETVALUE&issuer=Inkadra',
        backupCodes: ['BACKUPCODEVALUE'],
      },
    }),
  );
  await login(page);
  await configure(page);
  const drawn = () => page.evaluate(() => (window as unknown as { drawn: string }).drawn);
  const shoot = async () => {
    await page.evaluate(() => {
      (window as unknown as { drawn: string }).drawn = '';
    });
    await page.keyboard.press('Control+Shift+B');
    const form = page.getByRole('dialog', FORM);
    await expect(form.getByRole('img', { name: 'Screenshot', exact: true })).toBeVisible();
    const text = await drawn();
    expect(text.length).toBeGreaterThan(1000);
    await page.keyboard.press('Escape');
    await expect(form).toHaveCount(0);
    return text;
  };

  await page.goto('/settings?section=account');
  await page.getByRole('button', { name: 'Attiva', exact: true }).click();
  const enabling = page.getByRole('dialog', { name: 'Verifica in due passaggi', exact: true });
  await enabling.getByLabel('Password attuale', { exact: true }).fill('correct-horse-battery');
  await enabling.getByRole('button', { name: 'Attiva', exact: true }).click();
  await expect(page.getByText('BACKUPCODEVALUE')).toBeVisible();
  let text = await shoot();
  expect(text).not.toContain('BACKUPCODEVALUE');
  expect(text).not.toContain('TOTP');

  await page.goto('/settings?section=notifications');
  const calendar = page.getByRole('textbox', { name: 'Link del tuo calendario' });
  await expect(calendar).not.toHaveValue('');
  const feed = await calendar.inputValue();
  text = await shoot();
  expect(text).not.toContain(feed);

  const project = await (
    await page.request.post('/api/v1/projects', {
      headers: ORIGIN_HEADERS(page),
      data: { name: 'Segreti' },
    })
  ).json();
  await page.goto(`/p/${project.id}/b/${project.rootBoardId}`);
  await page.getByRole('button', { name: 'Condividi', exact: true }).click();
  await page.getByRole('button', { name: 'Crea link', exact: true }).click();
  const invite = page.getByRole('textbox', { name: 'Link d’invito' });
  await expect(invite).not.toHaveValue('');
  const url = await invite.inputValue();
  text = await shoot();
  expect(text).not.toContain(url);
});

test('still draws blob images while the content policy is enforced', async ({ page }) => {
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'document') return route.fallback();
    const response = await route.fetch();
    const headers = { ...response.headers() };
    const policy = headers['content-security-policy-report-only'];
    delete headers['content-security-policy-report-only'];
    if (policy) headers['content-security-policy'] = policy;
    await route.fulfill({ response, headers });
  });
  await login(page);
  await configure(page);
  await page.reload();
  await ready(page);
  await page.evaluate(async () => {
    const probe = window as unknown as { blocked: string[] };
    probe.blocked = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      probe.blocked.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 8;
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done));
    const image = document.createElement('img');
    image.src = URL.createObjectURL(blob as Blob);
    await image.decode();
    document.body.append(image);
  });
  await page.getByRole('button', FORM).click();
  await expect(
    page.getByRole('dialog', FORM).getByRole('img', { name: 'Screenshot', exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { blocked: string[] }).blocked)).toEqual(
    [],
  );
});

test('records a real Chromium tab without audio, reviews it and can remove it', async ({
  page,
}) => {
  await login(page);
  await configure(page);
  await page.reload();
  await ready(page);
  await page.evaluate(() => {
    document.title = 'Inkadra';
    const original = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getDisplayMedia = async (options) => {
      const stream = await original(options);
      const probe = window as unknown as { audioTracks: number; surface: string | undefined };
      probe.audioTracks = stream.getAudioTracks().length;
      probe.surface = stream.getVideoTracks()[0]?.getSettings().displaySurface;
      return stream;
    };
  });
  await page.getByRole('button', FORM).click();
  const dialog = page.getByRole('dialog', FORM);
  await dialog.getByRole('button', { name: 'Registra 60 s', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Registra lo schermo', exact: true })
    .getByRole('button', { name: 'Avvia', exact: true })
    .click();
  const pill = page.getByRole('region', { name: 'Registrazione in corso' });
  await expect(pill).toBeVisible({ timeout: 15000 });
  await expect(pill).toContainText(/restano 0:5\d/);
  await expect(dialog).toHaveCount(0);
  await pill.getByRole('button', { name: 'Ferma', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Riguarda il video', exact: true });
  await expect(review).toBeVisible();
  const probe = await page.evaluate(() => {
    const { audioTracks, surface } = window as unknown as {
      audioTracks: number;
      surface: string;
    };
    return { audioTracks, surface };
  });
  expect(probe).toEqual({ audioTracks: 0, surface: 'browser' });
  await expect(review.getByRole('alert')).toHaveCount(0);
  await expect(review.locator('video')).toHaveJSProperty('error', null);
  await review.getByRole('button', { name: 'Usa il video', exact: true }).click();
  await dialog.getByRole('button', { name: /^Video \d:\d\d$/ }).click();
  await review.getByRole('button', { name: 'Togli il video', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Registra 60 s', exact: true })).toBeVisible();
});

// Not a check: the screenshots of every state of the mockup, for the review of a person.
const SHOTS = process.env.FEEDBACK_SHOTS_DIR;
test.describe('every state, for review', () => {
  test.skip(!SHOTS, 'Set FEEDBACK_SHOTS_DIR to take the screenshots');
  test.use({ serviceWorkers: 'block' });
  test.setTimeout(300_000);

  async function snap(page: Page, name: string, widths = [1280, 390]) {
    if (!SHOTS) return;
    mkdirSync(SHOTS, { recursive: true });
    for (const theme of ['dark', 'light'])
      for (const width of widths) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
        await page.evaluate((value) => {
          localStorage.setItem('inkadra.theme', value);
          window.dispatchEvent(new Event('inkadra-theme-change'));
          document.documentElement.dataset.theme = value;
        }, theme);
        await page.mouse.move(0, 0);
        await page.waitForTimeout(120);
        await page.screenshot({ path: join(SHOTS, `${theme}-${width}-${name}.png`) });
      }
    await page.setViewportSize({ width: 1280, height: 800 });
  }
  const fill = async (page: Page) => {
    const dialog = page.getByRole('dialog', FORM);
    await dialog
      .getByLabel('Titolo', { exact: true })
      .fill('Il menu della card esce dallo schermo');
    await dialog
      .getByRole('textbox', { name: 'Descrizione', exact: true })
      .fill(
        'Apro il menu ⋯ della card «Casting comparse» vicino al bordo destro: le voci vengono tagliate e non riesco a cliccare Elimina.',
      );
    return dialog;
  };
  const answer = (page: Page, body: object, status = 201, headers = {}) =>
    page.route('**/api/v1/feedback', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status, json: body, headers })
        : route.fallback(),
    );
  const sendOnce = async (page: Page) => {
    await page
      .getByRole('dialog', FORM)
      .getByRole('button', { name: 'Anteprima', exact: true })
      .click();
    await page
      .getByRole('dialog', PREVIEW)
      .getByRole('button', { name: 'Invia segnalazione', exact: true })
      .click();
  };
  const close = async (page: Page) => {
    await page.getByRole('button', { name: 'Chiudi', exact: true }).last().click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  };

  test('form, editor, video, files, preview, sending and results', async ({ page, context }) => {
    await page.addInitScript(() => {
      // A stand-in for the browser's picker: the real one is covered by the test above.
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 400;
      const paint = () => {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = `hsl(${Date.now() % 360} 40% 40%)`;
          ctx.fillRect(0, 0, 640, 400);
        }
        requestAnimationFrame(paint);
      };
      paint();
      const media = navigator.mediaDevices as MediaDevices & { fail?: boolean; monitor?: boolean };
      media.getDisplayMedia = async () => {
        if (media.fail) throw new DOMException('Denied', 'NotAllowedError');
        const stream = canvas.captureStream(10);
        const [track] = stream.getVideoTracks();
        if (media.monitor && track) track.getSettings = () => ({ displaySurface: 'monitor' });
        return stream;
      };
    });
    await login(page);
    await configure(page);
    await page.reload();
    await ready(page);
    await page.evaluate(() => {
      console.error('TypeError: Cannot read properties of null (reading offsetWidth)');
      console.warn('upload retry /api/v1/assets/9f1c0a4e-1111-4222-8333-444455556666?token=abc');
      console.warn('invito a persona@example.com non recapitato');
      console.warn('Authorization: Bearer abc rifiutato, nuova sessione');
    });
    const entry = page.getByRole('button', FORM);
    await entry.hover();
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(SHOTS ?? '', 'dark-1280-entry.png') });

    // Empty, after pressing Preview.
    await entry.click();
    const dialog = page.getByRole('dialog', FORM);
    await expect(dialog.getByRole('img', { name: 'Screenshot', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Anteprima', exact: true }).click();
    await snap(page, 'compose-empty');
    await fill(page);
    await snap(page, 'compose');

    // The discard question.
    await page.keyboard.press('Escape');
    await snap(page, 'compose-discard');
    await page.getByRole('button', { name: /Continua/ }).click();

    // Editor.
    await dialog.getByRole('button', { name: 'Sfoca', exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'Modifica lo screenshot', exact: true });
    await editor.locator('canvas').focus();
    await page.keyboard.press('Enter');
    await snap(page, 'editor');
    await editor.getByRole('button', { name: 'Applica', exact: true }).click();
    await snap(page, 'compose-redacted');

    // Idea: nothing technical unless added.
    await dialog.getByRole('radio', { name: 'Idea', exact: true }).check({ force: true });
    await snap(page, 'compose-idea');
    await dialog.getByRole('radio', { name: 'Bug', exact: true }).check({ force: true });

    // Recording.
    await dialog.getByRole('button', { name: 'Registra 60 s', exact: true }).click();
    const intro = page.getByRole('dialog', { name: 'Registra lo schermo', exact: true });
    await snap(page, 'record-intro', [1280]);
    await page.evaluate(() => {
      (navigator.mediaDevices as MediaDevices & { fail?: boolean }).fail = true;
    });
    await intro.getByRole('button', { name: 'Avvia', exact: true }).click();
    await expect(intro.getByRole('alert')).toBeVisible();
    await snap(page, 'record-denied', [1280]);
    await page.evaluate(() => {
      (navigator.mediaDevices as MediaDevices & { fail?: boolean }).fail = false;
    });
    await intro.getByRole('button', { name: 'Riprova', exact: true }).click();
    const pill = page.getByRole('region', { name: 'Registrazione in corso' });
    await expect(pill).toBeVisible();
    await page.waitForTimeout(1200);
    await snap(page, 'record-pill', [1280]);
    await pill.getByRole('button', { name: 'Ferma', exact: true }).click();
    const review = page.getByRole('dialog', { name: 'Riguarda il video', exact: true });
    await expect(review).toBeVisible();
    await snap(page, 'video-review', [1280]);
    await review.getByRole('button', { name: 'Registra di nuovo', exact: true }).click();
    await page.evaluate(() => {
      (navigator.mediaDevices as MediaDevices & { monitor?: boolean }).monitor = true;
    });
    await intro.getByRole('button', { name: 'Avvia', exact: true }).click();
    await page.waitForTimeout(800);
    // The last ten seconds.
    await page.evaluate(() => {
      const now = Date.now.bind(Date);
      Date.now = () => now() + 52000;
    });
    await page.waitForTimeout(500);
    await snap(page, 'record-pill-warn', [1280]);
    await pill.getByRole('button', { name: 'Ferma', exact: true }).click();
    await expect(review.getByRole('alert')).toBeVisible();
    await snap(page, 'video-whole-screen', [1280]);
    await review.getByRole('button', { name: 'Usa il video', exact: true }).click();

    // Files, with the errors on their rows.
    await page.locator('input[type=file][multiple]').setInputFiles([
      {
        name: 'errore-menu-card-vicino-al-bordo-destro-versione-finale-definitiva-2.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.7 test'),
      },
      { name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('testo') },
      { name: 'installer.exe', mimeType: 'application/x-msdownload', buffer: Buffer.from('MZ') },
    ]);
    await snap(page, 'compose-files');
    await dialog.getByRole('button', { name: 'Togli installer.exe', exact: true }).click();
    await page.evaluate(() => {
      const zone = document.querySelector('.feedback-content');
      const data = new DataTransfer();
      data.items.add(new File(['x'], 'x.txt', { type: 'text/plain' }));
      zone?.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: data }));
    });
    await snap(page, 'compose-drop');
    await page.evaluate(() => {
      const zone = document.querySelector('.feedback-content');
      zone?.dispatchEvent(new DragEvent('dragleave', { bubbles: true }));
    });

    // Preview.
    await dialog.getByRole('button', { name: 'Anteprima', exact: true }).click();
    const preview = page.getByRole('dialog', PREVIEW);
    await snap(page, 'preview');

    // Offline, then back.
    await context.setOffline(true);
    await expect(preview.getByText('Sei offline.')).toBeVisible();
    await snap(page, 'preview-offline');
    await context.setOffline(false);
    await expect(preview.getByText('Sei di nuovo online: puoi inviare.')).toBeVisible();
    await snap(page, 'preview-back-online');

    // Sending, held on its upload.
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/v1/feedback/attachments*', async (route) => {
      await held;
      await route.fallback();
    });
    await preview.getByRole('button', { name: 'Invia segnalazione', exact: true }).click();
    await expect(preview.getByRole('progressbar')).toBeVisible();
    await snap(page, 'sending');
    await preview.getByRole('button', { name: 'Interrompi', exact: true }).click();
    await expect(preview.getByText(/Invio interrotto/)).toBeVisible();
    release();
    await page.unroute('**/api/v1/feedback/attachments*');

    // Failure and limits: nothing is lost.
    await answer(page, { error: { code: 'unavailable', message: 'x' } }, 503);
    await preview.getByRole('button', { name: 'Riprova', exact: true }).click();
    await expect(preview.getByText('Invio non riuscito.')).toBeVisible();
    await snap(page, 'send-failed');
    await page.unroute('**/api/v1/feedback');
    await answer(page, { error: { code: 'rate_limited', message: 'x' } }, 429, {
      'retry-after': '600',
    });
    await preview.getByRole('button', { name: 'Riprova', exact: true }).click();
    await expect(preview.getByText(/tra 10 minuti/)).toBeVisible();
    await expect(preview.getByRole('button', { name: 'Riprova', exact: true })).toBeDisabled();
    await snap(page, 'rate-limited');
    await page.unroute('**/api/v1/feedback');

    // Every result of sending.
    const id = '00000000-0000-4000-8000-000000000001';
    const results = {
      'sent-member': {
        id,
        reference: '#142',
        issueUrl: null,
        delivery: 'delivered',
        duplicate: false,
      },
      'sent-admin': {
        id,
        reference: '#142',
        issueUrl: 'https://github.com/inkadra/inkadra-feedback/issues/142',
        delivery: 'delivered',
        duplicate: false,
      },
      'sent-known': {
        id,
        reference: '#131',
        issueUrl: null,
        delivery: 'delivered',
        duplicate: true,
      },
      'sent-inbox': {
        id,
        reference: '#local-9',
        issueUrl: null,
        delivery: 'inbox',
        duplicate: false,
      },
    };
    await page.reload();
    await ready(page);
    for (const [name, body] of Object.entries(results)) {
      await answer(page, body);
      await page.getByRole('button', FORM).click();
      await expect(dialog.getByRole('img', { name: 'Screenshot', exact: true })).toBeVisible();
      await dialog.getByRole('radio', { name: 'Domanda', exact: true }).check({ force: true });
      await fill(page);
      await sendOnce(page);
      await expect(page.getByText('Segnalazione inviata', { exact: true })).toBeVisible();
      await snap(page, name);
      await close(page);
      await page.unroute('**/api/v1/feedback');
    }

    // Prefilled from an error.
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent('inkadra:feedback', {
          detail: {
            title: 'La pagina ha smesso di funzionare',
            details: 'TypeError: x',
            errorId: 'a3f1-9c20',
          },
        }),
      );
    });
    await expect(dialog.getByRole('img', { name: 'Screenshot', exact: true })).toBeVisible();
    await snap(page, 'compose-from-error');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Scarta', exact: true }).click();

    // Capture running, then failed.
    await page.evaluate(() => {
      const original = HTMLCanvasElement.prototype.toBlob;
      (window as unknown as { realToBlob: typeof original }).realToBlob = original;
      HTMLCanvasElement.prototype.toBlob = (callback) => {
        setTimeout(() => callback(null), 4000);
      };
    });
    await page.getByRole('button', FORM).click();
    await expect(dialog.getByRole('status').first()).toBeVisible();
    await snap(page, 'compose-capturing', [1280]);
    await expect(dialog.getByText('Non riesco a catturare questa vista.')).toBeVisible({
      timeout: 20000,
    });
    await snap(page, 'compose-capture-failed');
    await page.evaluate(() => {
      HTMLCanvasElement.prototype.toBlob = (
        window as unknown as { realToBlob: HTMLCanvasElement['toBlob'] }
      ).realToBlob;
    });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Capture again, from another view.
    await page.getByRole('button', FORM).click();
    await expect(dialog.getByRole('img', { name: 'Screenshot', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Cattura un’altra vista', exact: true }).click();
    await snap(page, 'capture-pill');
    await page.getByRole('button', { name: 'Annulla', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Phone: no recording, the file picker with its explanation.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/settings');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', FORM).scrollIntoViewIfNeeded();
    await snap(page, 'profile', [390]);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', FORM).click();
    await dialog.getByRole('button', { name: 'Allega un video', exact: true }).click({
      noWaitAfter: true,
    });
    await expect(
      dialog.getByText('Questo browser non può registrare lo schermo.', { exact: false }),
    ).toBeVisible();
    await snap(page, 'compose-no-recording', [390]);
  });

  test('settings, off states, board menu, error page and guest', async ({ page }) => {
    await login(page);
    // Off, as a person who does not run the instance would see it.
    await page.goto('/settings?section=instance');
    await page
      .getByText('Non attive su questa istanza. Chiedi a chi la gestisce.')
      .scrollIntoViewIfNeeded();
    await snap(page, 'settings-off');
    await page.route('**/api/v1/me', async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...(await response.json()), role: 'member' } });
    });
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.keyboard.press('Control+Shift+B');
    await expect(page.getByRole('dialog', FORM)).toContainText('Chiedi a chi gestisce');
    await snap(page, 'off-member');
    await page.unroute('**/api/v1/me');
    await page.reload();
    await expect(page.getByText('Non attive su questa istanza.', { exact: false })).toBeVisible();
    await page.keyboard.press('Control+Shift+B');
    await snap(page, 'off-admin');
    await page.keyboard.press('Escape');

    // Destination GitHub, no token yet: reports wait.
    await page.request.put('/api/v1/feedback/settings', {
      headers: ORIGIN_HEADERS(page),
      data: { destination: 'github', repository: 'inkadra/inkadra-feedback', guests: false },
    });
    await page.goto('/settings?section=instance');
    const panel = page.getByRole('region', { name: 'Segnalazioni', exact: true });
    await panel.scrollIntoViewIfNeeded();
    await expect(panel).toContainText('finché il token non è impostato');
    await snap(page, 'admin-no-token');

    // Configured, with reports of every kind. The list is fixed text: no real token exists.
    const report = (
      reference: string,
      title: string,
      delivery: string,
      reporter: string,
      type = 'bug',
    ) => ({
      id: crypto.randomUUID(),
      reference,
      issueUrl:
        delivery === 'delivered' ? 'https://github.com/inkadra/inkadra-feedback/issues/142' : null,
      delivery,
      duplicate: false,
      reporter,
      createdAt: '2026-11-03T14:03:00.000Z',
      report: {
        requestId: crypto.randomUUID(),
        type,
        area: 'board',
        title,
        description: 'Descrizione come scritta da chi segnala.',
        diagnostics: { page: '/p/[id]/b/[id]' },
        attachments: [],
      },
    });
    await page.route('**/api/v1/feedback/settings', (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            json: {
              destination: 'github',
              repository: 'inkadra/inkadra-feedback',
              guests: false,
              retentionDays: 90,
              tokenConfigured: true,
            },
          })
        : route.fallback(),
    );
    await page.route('**/api/v1/feedback/reports', (route) =>
      route.fulfill({
        json: {
          items: [
            report(
              '#142',
              'Il menu della card esce dallo schermo',
              'delivered',
              'Giulia B. (member)',
            ),
            report(
              '#141',
              'Vorrei duplicare una board in un altro progetto',
              'delivered',
              'Marco R. (member)',
              'idea',
            ),
            report(
              '#local-140',
              'Dopo l’esportazione in PDF la pianta risulta tagliata sul bordo destro della pagina, anche con formato A3',
              'pending',
              'Ospite (guest)',
            ),
            report('#local-139', 'Come cambio la lingua?', 'inbox', 'Sara L. (member)', 'question'),
          ],
        },
      }),
    );
    await page.reload();
    await panel.scrollIntoViewIfNeeded();
    await snap(page, 'admin-panel');
    await page
      .getByRole('region', { name: 'Segnalazioni ricevute', exact: true })
      .scrollIntoViewIfNeeded();
    await snap(page, 'admin-list');
    await page.unroute('**/api/v1/feedback/settings');
    await page.unroute('**/api/v1/feedback/reports');

    // Board menu.
    await configure(page);
    const project = await (
      await page.request.post('/api/v1/projects', {
        headers: ORIGIN_HEADERS(page),
        data: { name: 'Ultima corsa · segnalazioni' },
      })
    ).json();
    await page.goto(`/p/${project.id}/b/${project.rootBoardId}`);
    await page.getByRole('button', { name: 'Menu della board' }).click();
    await expect(page.getByRole('menuitem', { name: /Segnala un problema/ })).toBeVisible();
    await snap(page, 'board-menu');
    await page.keyboard.press('Escape');

    // Guest, once the administrator allows it.
    await configure(page, 'inbox', true);
    const link = await (
      await page.request.post(`/api/v1/boards/${project.rootBoardId}/share-links`, {
        headers: ORIGIN_HEADERS(page),
        data: {},
      })
    ).json();
    await page.goto(link.url);
    const guestEntry = page.getByRole('button', FORM);
    await guestEntry.scrollIntoViewIfNeeded();
    await snap(page, 'guest-entry');
    await guestEntry.click();
    await expect(
      page.getByRole('dialog', FORM).getByRole('img', { name: 'Screenshot' }),
    ).toBeVisible();
    await page
      .getByRole('dialog', FORM)
      .getByLabel('Titolo', { exact: true })
      .fill('Il video non parte');
    await snap(page, 'guest-form');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Scarta', exact: true }).click();

    // Crash page: a chunk that cannot load.
    await page.goto('/');
    await configure(page);
    await page.route('**/assets/BoardPage-*', (route) => route.abort());
    await page.reload();
    await page.goto(`/p/${project.id}/b/${project.rootBoardId}`);
    const report_ = page.getByRole('button', { name: 'Segnala il problema', exact: true });
    await expect(report_).toBeVisible();
    await snap(page, 'error-page');
    await report_.click();
    await expect(page.getByRole('dialog', FORM)).toContainText('Stiamo allegando');
    await snap(page, 'error-page-form');
  });
});

test('relay disclosure, mandatory preview, limits and admin switch', async ({ page }) => {
  await login(page);
  await configure(page, 'relay');
  await page.reload();
  await ready(page);
  await page.getByRole('button', FORM).click();
  const dialog = page.getByRole('dialog', FORM);
  await expect(dialog).toContainText('lasciano questo server');
  await expect(dialog).toContainText('32 MB totali');
  await expect(dialog.getByRole('button', { name: 'Invia segnalazione', exact: true })).toHaveCount(
    0,
  );
  if (process.env.FEEDBACK_SHOTS_DIR) {
    mkdirSync(process.env.FEEDBACK_SHOTS_DIR, { recursive: true });
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((theme) => {
        localStorage.setItem('inkadra.theme', theme);
        window.dispatchEvent(new Event('inkadra-theme-change'));
        document.documentElement.dataset.theme = theme;
      }, theme);
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
        await page.mouse.move(0, 0);
        await page.screenshot({
          path: join(process.env.FEEDBACK_SHOTS_DIR, `${theme}-${width}-relay.png`),
        });
        await dialog.locator('.feedback-privacy').scrollIntoViewIfNeeded();
        await page.screenshot({
          path: join(process.env.FEEDBACK_SHOTS_DIR, `${theme}-${width}-relay-disclosure.png`),
        });
        await dialog.getByLabel('Titolo', { exact: true }).scrollIntoViewIfNeeded();
      }
    }
  }
  await dialog.getByLabel('Titolo', { exact: true }).fill('Relay unavailable');
  await dialog.getByRole('button', { name: 'Screenshot', exact: true }).click();
  await dialog.getByRole('button', { name: 'Anteprima', exact: true }).click();
  const preview = page.getByRole('dialog', PREVIEW);
  await expect(preview).toContainText('inkadra/inkadra-feedback');
  await page.route('**/api/v1/feedback', async (route) =>
    route.fulfill({
      status: 201,
      json: {
        id: '00000000-0000-4000-8000-000000000001',
        reference: '#local-1',
        issueUrl: null,
        delivery: 'pending',
        duplicate: false,
      },
    }),
  );
  await preview.getByRole('button', { name: 'Invia segnalazione', exact: true }).click();
  await expect(
    page.getByText('Segnalazione salvata su questo server', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('Il relay non risponde o è occupato');
  if (process.env.FEEDBACK_SHOTS_DIR) {
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => {
        localStorage.setItem('inkadra.theme', value);
        window.dispatchEvent(new Event('inkadra-theme-change'));
        document.documentElement.dataset.theme = value;
      }, theme);
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
        await page.mouse.move(0, 0);
        await page.screenshot({
          path: join(process.env.FEEDBACK_SHOTS_DIR, `${theme}-${width}-relay-pending.png`),
        });
      }
    }
  }
  await page.keyboard.press('Escape');
  await page.goto('/settings?section=instance');
  const toggle = page.getByRole('switch', {
    name: 'Invia agli sviluppatori di Inkadra',
    exact: true,
  });
  await expect(toggle).toBeChecked();
  if (process.env.FEEDBACK_SHOTS_DIR) {
    await toggle.scrollIntoViewIfNeeded();
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => {
        localStorage.setItem('inkadra.theme', value);
        window.dispatchEvent(new Event('inkadra-theme-change'));
        document.documentElement.dataset.theme = value;
      }, theme);
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
        await toggle.scrollIntoViewIfNeeded();
        await page.mouse.move(0, 0);
        await page.screenshot({
          path: join(process.env.FEEDBACK_SHOTS_DIR, `${theme}-${width}-settings-relay.png`),
        });
      }
    }
  }
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  expect((await (await page.request.get('/api/v1/feedback/settings')).json()).destination).toBe(
    'inbox',
  );
});

async function relayShots(page: Page, name: string, focus?: () => Promise<void>) {
  if (!process.env.FEEDBACK_SHOTS_DIR) return;
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => {
      localStorage.setItem('inkadra.theme', value);
      window.dispatchEvent(new Event('inkadra-theme-change'));
      document.documentElement.dataset.theme = value;
    }, theme);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
      await focus?.();
      await page.mouse.move(0, 0);
      await page.screenshot({
        path: join(process.env.FEEDBACK_SHOTS_DIR, `${theme}-${width}-${name}.png`),
      });
    }
  }
  // The next steps use the desktop entry, which a phone keeps in a menu.
  await page.setViewportSize({ width: 1280, height: 800 });
}

test('with the relay down the report stays queued and everyone is told', async ({ page }) => {
  await login(page);
  await configure(page, 'relay');
  await page.reload();
  await ready(page);
  await page.getByRole('button', FORM).click();
  let dialog = page.getByRole('dialog', FORM);
  await dialog.getByLabel('Titolo', { exact: true }).fill('Relay down');
  const big = (name: string) => ({
    name,
    mimeType: 'text/plain',
    buffer: Buffer.alloc(9 * 1024 * 1024, 'x'),
  });
  await page
    .locator('input[type=file][multiple]')
    .setInputFiles([big('a.txt'), big('b.txt'), big('c.txt'), big('d.txt')]);
  await expect(dialog.getByRole('alert')).toContainText('superano i 32 MB');
  await relayShots(page, 'relay-over-limit');
  await dialog.getByRole('button', { name: 'Anteprima', exact: true }).click();
  await expect(page.getByRole('dialog', PREVIEW)).toHaveCount(0);

  await page.reload();
  await ready(page);
  await page.getByRole('button', FORM).click();
  dialog = page.getByRole('dialog', FORM);
  await dialog.getByLabel('Titolo', { exact: true }).fill('Relay down');
  await dialog.getByRole('button', { name: 'Anteprima', exact: true }).click();
  const preview = page.getByRole('dialog', PREVIEW);
  await expect(preview).toContainText('inkadra/inkadra-feedback');
  await relayShots(page, 'relay-preview');
  await preview.getByRole('button', { name: 'Invia segnalazione', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Il relay non risponde o è occupato');
  await page.keyboard.press('Escape');

  await page.goto('/settings?section=instance');
  const banner = page.getByText(/Il relay non risponde o è occupato: \d+ segnalazion/);
  await expect(banner).toBeVisible();
  await relayShots(page, 'settings-relay-down', () => banner.scrollIntoViewIfNeeded());

  // No answer from the relay: nobody here can read its private repository, trying again is safe.
  await page.route('**/api/v1/feedback/reports*', async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    json.items[0].delivery = 'uncertain';
    await route.fulfill({ response, json });
  });
  await page.reload();
  const unsure = page.getByText(/riprovare è sicuro/);
  await expect(unsure).toBeVisible();
  await relayShots(page, 'settings-relay-uncertain', () => unsure.scrollIntoViewIfNeeded());
});

test('a dialog opened before the destination changed asks to read again', async ({ page }) => {
  await login(page);
  await configure(page, 'inbox');
  await page.reload();
  await ready(page);
  await page.getByRole('button', FORM).click();
  const dialog = page.getByRole('dialog', FORM);
  await dialog.getByLabel('Titolo', { exact: true }).fill('Told something else');
  await dialog.getByRole('button', { name: 'Anteprima', exact: true }).click();
  const preview = page.getByRole('dialog', PREVIEW);
  await expect(preview).not.toContainText('inkadra/inkadra-feedback');
  await configure(page, 'relay');
  await preview.getByRole('button', { name: 'Invia segnalazione', exact: true }).click();
  await expect(preview.getByRole('alert')).toContainText('ha cambiato la destinazione');
  await expect(preview).toContainText('inkadra/inkadra-feedback');
  await relayShots(page, 'relay-destination-changed');
  const reports = await (await page.request.get('/api/v1/feedback/reports')).json();
  expect(
    reports.items.filter((r: { report: { title: string } }) => r.report.title.includes('Told')),
  ).toHaveLength(0);
});

test('without ffmpeg a video from the device stays here, and says why', async ({ page }) => {
  await login(page);
  await configure(page, 'relay');
  await page.route('**/api/v1/feedback/status', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), deviceVideos: false } });
  });
  await page.reload();
  await ready(page);
  await page.getByRole('button', FORM).click();
  const dialog = page.getByRole('dialog', FORM);
  await page
    .locator('input[type=file][multiple]')
    .setInputFiles([{ name: 'clip.mp4', mimeType: 'video/mp4', buffer: Buffer.from('video') }]);
  await expect(dialog).toContainText('non può togliere GPS');
  await relayShots(page, 'relay-no-device-video');
});

// On by default, so the report button is in every header: the view tabs must still work.
test('beside the report button the view tabs stay whole and every click lands', async ({
  page,
}) => {
  await login(page);
  await configure(page, 'relay');
  const headers = ORIGIN_HEADERS(page);
  const project = await (
    await page.request.post('/api/v1/projects', {
      headers,
      data: { name: 'A project with a rather long name for the header' },
    })
  ).json();
  const board = await (
    await page.request.post(`/api/v1/projects/${project.id}/boards`, {
      headers,
      data: {
        parentBoardId: project.rootBoardId,
        title: 'A storyboard with a rather long name too',
        kind: 'storyboard',
      },
    })
  ).json();
  await page.goto(`/p/${project.id}/b/${board.id}`);
  await ready(page);
  const strip = page.getByRole('tablist', { name: 'Vista' });
  const tabs = strip.getByRole('tab');
  await expect(tabs).toHaveCount(5);
  // At 1440 nothing is cut off.
  const box = await strip.boundingBox();
  const last = await tabs.last().boundingBox();
  expect((last?.x ?? 0) + (last?.width ?? 0)).toBeLessThanOrEqual(
    (box?.x ?? 0) + (box?.width ?? 0),
  );
  // Narrower, the strip may scroll, and a click on a tab it cuts off still has to land.
  for (const width of [1440, 1000]) {
    await page.setViewportSize({ width, height: 900 });
    for (const name of ['Piano riprese', 'Revisione', 'Shot list', 'Storyboard']) {
      const tab = strip.getByRole('tab', { name, exact: true });
      await tab.click();
      await expect(tab).toHaveAttribute('aria-selected', 'true');
    }
  }
  await relayShots(page, 'board-header-report');
});
