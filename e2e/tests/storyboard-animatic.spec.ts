// SPDX-License-Identifier: AGPL-3.0-only
// Runs after first-run.spec.ts in CI (the administrator exists); alone, it creates one.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { addFrame, addScene, type FrameElement, storyboardOf } from '@inkadra/canvas-core';
import { createBoardDoc, getAnimaticAudio, readElement, roots } from '@inkadra/doc-schema';
import { expect, type Page, test } from '@playwright/test';
import { readBoard } from './frame-grab.helpers.ts';
import { pushBoardDoc, signIn, uploadFile, waitForAssets } from './perf/seed.ts';

const out = fileURLToPath(new URL('../../docs/screenshots/0.7-animatic/', import.meta.url));
const account = {
  name: 'Giulia Bianchi',
  email: 'giulia@example.com',
  password: 'correct-horse-battery',
};

/** "Ultimo Treno", a fictional short: two scenes, five frames. */
const SCENES = [
  {
    number: '1',
    title: 'Binario 9',
    location: 'Stazione',
    frames: [
      { action: 'Il tabellone annuncia l’ultimo treno.', durationMs: 2000, shot: 'ws' },
      { action: 'Marta corre lungo il binario.', durationMs: 1500, shot: 'ms' },
      { action: 'Il fischio del capotreno.', shot: 'cu' },
    ],
  },
  {
    number: '2',
    title: 'Carrozza 4',
    location: 'Treno',
    frames: [
      { action: 'Marta si siede accanto al finestrino.', durationMs: 2500, shot: 'ms' },
      {
        action: 'Fuori, le luci della città scorrono.',
        durationMs: 2000,
        shot: 'ws',
        dialogue: 'Ce l’ho fatta.',
      },
    ],
  },
] as const;

/** A night platform drawn in the browser: one picture per frame, no third-party media. */
async function pictures(page: Page) {
  return page.evaluate(async (count) => {
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = i < 3 ? '#16222d' : '#1f1a2b';
      ctx.fillRect(0, 0, 1280, 720);
      ctx.fillStyle = i < 3 ? '#25384a' : '#2f2840';
      ctx.fillRect(0, 380 - i * 20, 1280, 340 + i * 20);
      ctx.fillStyle = '#d6af6a';
      for (let w = 0; w < 6; w++) ctx.fillRect(120 + w * 180 + i * 18, 300, 90, 70);
      ctx.fillStyle = '#f0e8d5';
      ctx.beginPath();
      ctx.arc(320 + i * 160, 460, 36, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(300 + i * 160, 490, 40, 120);
      const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/png'));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (const b of bytes) s += String.fromCharCode(b);
      out.push(btoa(s));
    }
    return out;
  }, 5);
}

/** Eight seconds of a soft two-note tone as 16-bit mono WAV. */
function tone(seconds = 8, rate = 8000): Buffer {
  const samples = seconds * rate;
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const f = Math.floor(i / rate) % 2 ? 330 : 220;
    buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * f * i) / rate) * 6000), 44 + i * 2);
  }
  return buf;
}

async function open(page: Page, baseURL: string, theme: 'light' | 'dark') {
  const cookie = await signIn(baseURL, account);
  await page.context().addCookies(
    cookie.split('; ').map((pair) => {
      const index = pair.indexOf('=');
      return { name: pair.slice(0, index), value: pair.slice(index + 1), url: baseURL };
    }),
  );
  await page.addInitScript((theme) => localStorage.setItem('inkadra.theme', theme), theme);
  await page.goto('/');
  const headers = { origin: baseURL };
  const response = await page.request.post('/api/v1/projects', {
    headers,
    data: { name: 'Ultimo Treno', type: 'short_film' },
  });
  expect(response.ok()).toBe(true);
  const project = await response.json();
  const created = await page.request.post(`/api/v1/projects/${project.id}/boards`, {
    headers,
    data: { parentBoardId: project.rootBoardId, title: 'Storyboard', kind: 'storyboard' },
  });
  expect(created.ok()).toBe(true);
  const boardId: string = (await created.json()).id;
  const ids: string[] = [];
  for (const [i, body] of (await pictures(page)).entries()) {
    const id = await uploadFile(baseURL, cookie, project.id, {
      body: Buffer.from(body, 'base64'),
      name: `ultimo-treno-${i + 1}.png`,
      type: 'image/png',
    });
    expect(id).toBeTruthy();
    ids.push(id!);
  }
  await waitForAssets(baseURL, cookie, ids);
  const doc = createBoardDoc(boardId);
  const opts = { userId: null };
  let n = 0;
  for (const s of SCENES) {
    const scene = addScene(
      doc,
      { number: s.number, title: s.title, location: s.location, setting: 'ext', time: 'night' },
      opts,
    );
    for (const f of s.frames) addFrame(doc, scene.id, null, { ...f, assetId: ids[n++] }, opts);
  }
  await pushBoardDoc(baseURL, cookie, boardId, doc);
  await page.goto(`/p/${project.id}/b/${boardId}?view=storyboard`);
  // A phone shows the storyboard modes as a picker instead of segments.
  const picker = page.getByRole('combobox', { name: 'Modalità storyboard' });
  await page.locator('.story__bar').waitFor();
  if (await picker.isVisible()) await picker.selectOption('animatic');
  else await page.getByRole('button', { name: 'Animatic', exact: true }).click();
  await expect(page.locator('.animatic__block')).toHaveCount(5);
  return { cookie, project, boardId };
}

/** Frame ids on the time line, in order. */
const order = (page: Page) =>
  page
    .locator('.animatic__block')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-frame')));

async function savedFrames(baseURL: string, cookie: string, boardId: string) {
  const doc = await readBoard(baseURL, cookie, boardId);
  const all = [...roots(doc).elements.values()].map((m) => readElement(m)!).filter(Boolean);
  return {
    frames: storyboardOf(all).flatMap((g) => g.frames) as FrameElement[],
    audio: getAnimaticAudio(doc),
  };
}

test('the animatic plays, retimes and reorders frames, with a sound track guests hear', async ({
  page,
  baseURL,
  browser,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const { cookie, project, boardId } = await open(page, baseURL!, 'dark');
  const player = page.getByRole('region', { name: 'Animatic' });
  // A missing duration counts one second: 2 + 1.5 + 1 + 2.5 + 2.
  await expect(player.getByText('5 inquadrature · durata 0:09.0')).toBeVisible();
  await expect(player.locator('.animatic__scene')).toHaveText(['1 · Binario 9', '2 · Carrozza 4']);

  // Change a duration: the edge of 1C, two quarter seconds with the keyboard, then a drag.
  const handle = player.getByRole('slider', { name: 'Durata di 1C' });
  await handle.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(handle).toHaveAttribute('aria-valuenow', '1.5');
  const track = (await player.locator('.animatic__track').boundingBox())!;
  const box = (await handle.boundingBox())!;
  const pxPerSecond = track.width / 9.5;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + pxPerSecond * 0.5, box.y + box.height / 2, {
    steps: 5,
  });
  await page.mouse.up();
  await expect(handle).toHaveAttribute('aria-valuenow', '2');
  await expect(player.getByText('5 inquadrature · durata 0:10.0')).toBeVisible();
  await expect
    .poll(async () => (await savedFrames(baseURL!, cookie, boardId)).frames[2]?.durationMs)
    .toBe(2000);

  // Reorder: drag 1A after 1B; then Alt + arrow moves 2A back into scene 1.
  const before = await order(page);
  const first = (await player.locator('.animatic__block').nth(0).boundingBox())!;
  const second = (await player.locator('.animatic__block').nth(1).boundingBox())!;
  await page.mouse.move(first.x + first.width / 3, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(second.x + second.width * 0.8, second.y + second.height / 2, { steps: 8 });
  await expect(player.locator('.animatic__block.drop-after')).toHaveCount(1);
  await page.mouse.up();
  await expect
    .poll(() => order(page))
    .toEqual([before[1], before[0], before[2], before[3], before[4]]);
  await player.locator(`[data-frame="${before[3]}"] button`).focus();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect
    .poll(() => order(page))
    .toEqual([before[1], before[0], before[2], before[3], before[4]]);
  await expect(player.locator('.animatic__scene')).toHaveText(['1 · Binario 9', '2 · Carrozza 4']);
  await expect(player.locator('.animatic__block.is-scene-start')).toHaveCount(1);
  expect(
    (await player.locator('.animatic__block').nth(3).getAttribute('class'))?.includes(
      'is-scene-start',
    ),
  ).toBe(false);
  await expect
    .poll(async () => (await savedFrames(baseURL!, cookie, boardId)).frames.map((f) => f.id))
    .toEqual([before[1], before[0], before[2], before[3], before[4]]);

  // A sound track, uploaded from the player.
  await player.locator('input[type="file"][accept="audio/*"]').setInputFiles({
    name: 'binario.wav',
    mimeType: 'audio/wav',
    buffer: tone(),
  });
  await expect(player.getByText('binario.wav')).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => (await savedFrames(baseURL!, cookie, boardId)).audio)
    .toMatchObject({
      volume: 1,
    });
  const audio = player.locator('audio');
  await expect(audio).toHaveAttribute('src', /\/api\/v1\/assets\/.+\/file$/);
  await page.waitForFunction(
    () => (document.querySelector('.animatic audio') as HTMLAudioElement)?.readyState >= 1,
  );

  // Frame step moves the sound with the picture.
  await player.locator('.animatic__stage').focus();
  await page.keyboard.press('ArrowRight');
  await expect(player.locator('.animatic__time')).toHaveText('0:01.5 / 0:10.0');
  await expect
    .poll(() => audio.evaluate((el: HTMLAudioElement) => el.currentTime))
    .toBeCloseTo(1.5, 1);

  // Play: the time runs, the sound plays in step; Space pauses both.
  await player.getByRole('button', { name: 'Riproduci' }).click();
  await expect(player.getByRole('button', { name: 'Pausa' })).toBeVisible();
  await expect.poll(() => audio.evaluate((el: HTMLAudioElement) => el.paused)).toBe(false);
  await page.waitForTimeout(1200);
  const [picture, sound] = await Promise.all([
    player.locator('.animatic__time').textContent(),
    audio.evaluate((el: HTMLAudioElement) => el.currentTime),
  ]);
  const [, secs, tenths] = /0:(\d\d)\.(\d)/.exec(picture ?? '') ?? [];
  expect(Math.abs(Number(secs) + Number(tenths) / 10 - sound)).toBeLessThan(0.5);
  await player.locator('.animatic__stage').focus();
  await page.keyboard.press('Space');
  await expect(player.getByRole('button', { name: 'Riproduci' })).toBeVisible();
  await expect.poll(() => audio.evaluate((el: HTMLAudioElement) => el.paused)).toBe(true);
  await player.getByRole('button', { name: 'Disattiva audio' }).click();
  await expect.poll(() => audio.evaluate((el: HTMLAudioElement) => el.muted)).toBe(true);
  await player.getByRole('button', { name: 'Attiva audio' }).click();

  // Guests of a link watch the same animatic read only, the sound streamed.
  const link = await page.request.post(`/api/v1/boards/${boardId}/share-links`, {
    headers: { origin: baseURL! },
    data: { role: 'guest_view' },
  });
  expect(link.ok()).toBe(true);
  const { url } = await link.json();
  const context = await browser.newContext({ locale: 'it-IT', colorScheme: 'dark' });
  const guest = await context.newPage();
  await guest.goto(new URL(url, baseURL).href);
  await guest.getByRole('button', { name: 'Guarda l’animatic' }).click({ timeout: 30_000 });
  const dialog = guest.getByRole('dialog', { name: 'Presenta' });
  await expect(dialog.locator('.animatic__block')).toHaveCount(5);
  await expect(dialog.getByRole('slider', { name: /Durata di/ })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Aggiungi colonna sonora' })).toHaveCount(0);
  await expect(dialog.locator('audio')).toHaveAttribute(
    'src',
    /\/api\/v1\/guest\/links\/.+\/stream$/,
  );
  await dialog.getByRole('button', { name: 'Riproduci' }).click();
  await expect
    .poll(() => dialog.locator('audio').evaluate((el: HTMLAudioElement) => el.paused))
    .toBe(false);
  await context.close();

  await page.request.delete(`/api/v1/projects/${project.id}`, { headers: { origin: baseURL! } });
});

for (const [device, width, height] of [
  ['desktop', 1440, 900],
  ['phone', 412, 915],
] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`animatic screenshots ${device} ${theme}`, async ({ page, baseURL }) => {
      test.setTimeout(120_000);
      mkdirSync(out, { recursive: true });
      await page.setViewportSize({ width, height });
      const { project } = await open(page, baseURL!, theme);
      const player = page.getByRole('region', { name: 'Animatic' });
      await player.locator('input[type="file"][accept="audio/*"]').setInputFiles({
        name: 'ultimo-treno-temp.wav',
        mimeType: 'audio/wav',
        buffer: tone(),
      });
      // The file name is left out on a phone; the mute button shows the track is there.
      await expect(player.getByRole('button', { name: 'Disattiva audio' })).toBeVisible({
        timeout: 30_000,
      });
      // Into 2B: the dialogue line shows over the picture.
      await player.locator('.animatic__stage').focus();
      for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Shift+ArrowRight');
      await expect(player.locator('.animatic__caption')).toContainText('Ce l’ho fatta.');
      await page.locator('.animatic__stage').blur();
      await expect
        .poll(() =>
          player
            .locator('.animatic__picture img')
            .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
        )
        .toBe(true);
      await page.screenshot({ path: `${out}/${device}-${theme}-animatic.png` });
      await page.request.delete(`/api/v1/projects/${project.id}`, {
        headers: { origin: baseURL! },
      });
    });
  }
}
