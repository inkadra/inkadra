// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FeedbackLauncher } from './Feedback.tsx';
import { openFeedback } from './state.ts';

vi.mock('react-i18next', () => ({
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('../lib/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api.ts')>()),
  api: {
    get: vi.fn(async () => ({
      enabled: true,
      guest: false,
      destination: 'inbox',
      retentionDays: 30,
      deviceVideos: true,
    })),
    post: vi.fn(),
  },
}));
vi.mock('../lib/session.tsx', () => ({
  useSession: () => ({ user: { id: 'me', name: 'Mia Rossi', image: null }, version: '1.0.0' }),
}));
// The automatic screenshot taken when the form opens.
vi.mock('html-to-image', () => ({ toBlob: async () => new Blob(['png']) }));

/** Every object URL made and released, each one distinct. */
let created: string[] = [];
let revoked: string[] = [];
beforeEach(() => {
  created = [];
  revoked = [];
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
    const url = `blob:${created.length}`;
    created.push(url);
    return url;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => {
    revoked.push(url);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

async function mount(strict = false) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const tree = (
    <MemoryRouter>
      <FeedbackLauncher />
    </MemoryRouter>
  );
  await act(async () => root.render(strict ? <StrictMode>{tree}</StrictMode> : tree));
  await act(async () => openFeedback());
  // The automatic screenshot.
  await vi.waitFor(() => expect(created).toHaveLength(1));
  return root;
}

const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(label))!;
const click = (label: string) => act(async () => button(label).click());

/** A screen share and a recorder the test drives. */
function stubRecording() {
  const track = { stop: vi.fn(), getSettings: () => ({ displaySurface: 'browser' }) };
  const media = {
    getTracks: () => [track],
    getAudioTracks: () => [],
    getVideoTracks: () => [track],
    removeTrack: () => {},
  };
  let grant: (m: typeof media) => void = () => {};
  const recorders: Array<{
    state: string;
    mimeType: string;
    ondataavailable?: (e: { data: Blob }) => void;
    onstop?: () => void;
    stop: () => void;
  }> = [];
  vi.stubGlobal(
    'MediaRecorder',
    class {
      state = 'inactive';
      mimeType = 'video/webm';
      ondataavailable?: (e: { data: Blob }) => void;
      onstop?: () => void;
      constructor() {
        recorders.push(this);
      }
      start() {
        this.state = 'recording';
      }
      stop() {
        this.state = 'inactive';
      }
    },
  );
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getDisplayMedia: () =>
        new Promise((resolve) => {
          grant = resolve;
        }),
    },
  });
  return { track, media, recorders, grant: (m = media) => act(async () => grant(m)) };
}

it('releases the screenshot it still holds when it goes away', async () => {
  const root = await mount();
  expect(revoked).toEqual([]);
  act(() => root.unmount());
  expect(revoked).toEqual(created);
});

it('releases every screenshot URL it made under StrictMode', async () => {
  const root = await mount(true);
  act(() => root.unmount());
  expect(new Set(revoked)).toEqual(new Set(created));
});

it('makes no video once it went away while recording, and releases what it held', async () => {
  const rec = stubRecording();
  const root = await mount();
  await click('feedback.record');
  await click('feedback.startRecord');
  await rec.grant();
  const recorder = rec.recorders[0]!;
  recorder.ondataavailable?.({ data: new Blob(['frame']) });
  act(() => root.unmount());
  expect(rec.track.stop).toHaveBeenCalled();
  // The recorder stops after the page went away.
  recorder.onstop?.();
  expect(created).toHaveLength(1);
  expect(revoked).toEqual(created);
});

it('stops a screen share granted after it went away', async () => {
  const rec = stubRecording();
  const root = await mount();
  await click('feedback.record');
  await click('feedback.startRecord');
  act(() => root.unmount());
  await rec.grant();
  expect(rec.track.stop).toHaveBeenCalled();
  expect(rec.recorders).toHaveLength(0);
});

it('releases a video under review replaced by another one, and each URL once', async () => {
  const rec = stubRecording();
  const root = await mount();
  await click('feedback.record');
  await click('feedback.startRecord');
  await rec.grant();
  const recorder = rec.recorders[0]!;
  recorder.ondataavailable?.({ data: new Blob(['frame']) });
  await act(async () => recorder.onstop?.());
  const recorded = created[1]!;
  // A video file dropped while the recording is under review takes its place.
  const input = document.querySelector<HTMLInputElement>('input[type=file][multiple]')!;
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [new File(['v'], 'clip.mp4', { type: 'video/mp4' })],
  });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  expect(created).toHaveLength(3);
  expect(revoked).toContain(recorded);
  // Accepted, then reopened for review: the same video is both attached and under review.
  await click('feedback.useVideo');
  await click('feedback.videoAttached');
  act(() => root.unmount());
  expect(revoked.toSorted()).toEqual(created.toSorted());
});
