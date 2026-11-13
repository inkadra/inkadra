// @vitest-environment happy-dom
import type { Asset, AssetRendition } from '@inkadra/shared';
import { act, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { QualityMenu } from './QualityMenu.tsx';
import {
  type PlaybackSource,
  playbackSource,
  type QualityChoice,
  setHlsLoader,
  useVideoSource,
} from './video-source.ts';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
    i18n: { language: 'en' },
  }),
}));

const rung = (name: AssetRendition['name'], status: AssetRendition['status'] = 'ready') => ({
  name,
  status,
  progress: status === 'ready' ? 100 : 64,
  width: (Number(name) * 16) / 9,
  height: Number(name),
  bitrate: 1,
  size: 1,
  url: status === 'ready' ? `/api/v1/assets/a/hls/${name}.mp4?v=abcdef` : null,
});
const asset = (renditions: AssetRendition[], original = true): Asset =>
  ({
    id: 'a',
    kind: 'video',
    url: '/api/v1/assets/a/file',
    size: 600e6,
    durationMs: 48_000,
    width: 3840,
    height: 2160,
    proxy: null,
    playback: { hls: '/api/v1/assets/a/hls/master.m3u8?v=1', original, renditions },
  }) as unknown as Asset;

it('plays the playlist, a plain rung up to 1080 as a fallback, and the original', () => {
  expect(playbackSource(asset([rung('480'), rung('720'), rung('1080', 'processing')]))).toEqual({
    hls: '/api/v1/assets/a/hls/master.m3u8?v=1',
    src: '/api/v1/assets/a/hls/720.mp4?v=abcdef',
    original: '/api/v1/assets/a/file',
  });
  expect(playbackSource(asset([rung('2160')], false)).original).toBeNull();
});

const host = document.createElement('div');
document.body.append(host);
let root = createRoot(host);
afterEach(() => {
  act(() => root.unmount());
  root = createRoot(host);
});

/** A stand-in for hls.js: records what the player asks and lets the test fire its events. */
function fakeHls(supported = true) {
  const instances: Array<{
    loaded?: string;
    media?: HTMLMediaElement;
    currentLevel: number;
    levels: Array<{ height: number }>;
    handlers: Record<string, (e: string, d: Record<string, unknown>) => void>;
    destroyed: boolean;
  }> = [];
  class Hls {
    static isSupported = () => supported;
    static Events = { LEVEL_SWITCHED: 'switched', ERROR: 'error' };
    state = {
      currentLevel: -1,
      levels: [{ height: 480 }, { height: 720 }],
      handlers: {} as Record<string, (e: string, d: Record<string, unknown>) => void>,
      destroyed: false,
    } as (typeof instances)[number];
    constructor() {
      instances.push(this.state);
    }
    get levels() {
      return this.state.levels;
    }
    get currentLevel() {
      return this.state.currentLevel;
    }
    set currentLevel(v: number) {
      this.state.currentLevel = v;
    }
    nextLevel = -1;
    loadSource(url: string) {
      this.state.loaded = url;
    }
    attachMedia(media: HTMLMediaElement) {
      this.state.media = media;
    }
    on(event: string, handler: (e: string, d: Record<string, unknown>) => void) {
      this.state.handlers[event] = handler;
    }
    destroy() {
      this.state.destroyed = true;
    }
  }
  setHlsLoader(async () => Hls as never);
  return instances;
}

function Player({
  source,
  choice,
  rungs,
}: {
  source: PlaybackSource;
  choice: QualityChoice;
  rungs: AssetRendition[];
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const played = useVideoSource(ref, source, choice, rungs);
  return (
    // biome-ignore lint/a11y/useMediaCaption: test
    <video ref={ref} src={played.src} data-height={played.height ?? ''} />
  );
}

it('attaches hls.js, follows a rung chosen by hand, and falls back to the file on a fatal error', async () => {
  const instances = fakeHls();
  const rungs = [rung('480'), rung('720')];
  const source = playbackSource(asset(rungs));
  await act(async () => root.render(<Player source={source} choice="auto" rungs={rungs} />));
  const [hls] = instances;
  expect(hls?.loaded).toBe(source.hls);
  expect(host.querySelector('video')?.getAttribute('src')).toBeNull();
  await act(async () => hls?.handlers.switched?.('switched', { level: 1 }));
  expect(host.querySelector('video')?.dataset.height).toBe('720');
  await act(async () => root.render(<Player source={source} choice="480" rungs={rungs} />));
  expect(hls?.currentLevel).toBe(0);
  await act(async () => hls?.handlers.error?.('error', { fatal: true }));
  expect(hls?.destroyed).toBe(true);
  expect(host.querySelector('video')?.getAttribute('src')).toBe(
    '/api/v1/assets/a/hls/480.mp4?v=abcdef',
  );
});

it('keeps the playlist on Safari (native HLS) across a re-render', async () => {
  // No MediaSource: hls.js says no, the video element plays the playlist itself.
  const instances = fakeHls(false);
  const canPlay = vi
    .spyOn(HTMLMediaElement.prototype, 'canPlayType')
    .mockImplementation((type) => (type === 'application/vnd.apple.mpegurl' ? 'maybe' : ''));
  const rungs = [rung('480'), rung('720')];
  const source = playbackSource(asset(rungs));
  await act(async () => root.render(<Player source={source} choice="auto" rungs={rungs} />));
  expect(instances).toHaveLength(0);
  const video = host.querySelector('video') as HTMLVideoElement;
  expect(video.getAttribute('src')).toBe(source.hls);
  // A render with the same props (a parent updating): React leaves the attribute alone.
  await act(async () =>
    root.render(<Player source={{ ...source }} choice="auto" rungs={[...rungs]} />),
  );
  expect(video.getAttribute('src')).toBe(source.hls);
  canPlay.mockRestore();
});

it('plays the original file when chosen', async () => {
  fakeHls();
  const rungs = [rung('480')];
  await act(async () =>
    root.render(<Player source={playbackSource(asset(rungs))} choice="original" rungs={rungs} />),
  );
  expect(host.querySelector('video')?.getAttribute('src')).toBe('/api/v1/assets/a/file');
});

function Menu() {
  const [choice, setChoice] = useState<QualityChoice>('auto');
  return (
    <QualityMenu
      asset={asset([
        rung('480'),
        rung('720'),
        rung('1080', 'processing'),
        { ...rung('2160', 'processing'), live: true },
      ])}
      choice={choice}
      onChoose={setChoice}
      playing={720}
    />
  );
}

it('lists Auto, the rungs (those being made disabled) and the original in the menu', async () => {
  await act(async () => root.render(<Menu />));
  const button = host.querySelector<HTMLButtonElement>('.viewer-quality__button');
  expect(button?.textContent).toContain('viewer.quality.autoAt:{"quality":"720p"}');
  await act(async () => button?.click());
  const items = [...host.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
  expect(items.map((i) => [i.textContent, i.disabled])).toEqual([
    ['viewer.quality.autoviewer.quality.now:{"quality":"720p"}', false],
    // Offered live: it plays before its file is made.
    ['4Kviewer.quality.live · viewer.quality.liveCopy:{"percent":64}', false],
    ['1080pviewer.quality.preparing:{"percent":64}', true],
    ['720p', false],
    ['480p', false],
    ['viewer.quality.original4K · 100 Mbit/s', false],
  ]);
  // What the "al volo" levels are, next to the menu.
  expect(host.querySelector('.viewer-quality__note')?.textContent).toBe('viewer.quality.liveNote');
  await act(async () => items[4]?.click());
  expect(host.querySelector('.viewer-quality__button')?.textContent).toContain('480p');
});

it('says no copy is coming when the levels offered live are never stored', async () => {
  const liveOnly = {
    ...rung('1080', 'queued'),
    progress: null,
    live: true,
    liveOnly: true as const,
  };
  await act(async () =>
    root.render(
      <QualityMenu asset={asset([liveOnly])} choice="auto" onChoose={() => {}} playing={1080} />,
    ),
  );
  await act(async () => host.querySelector<HTMLButtonElement>('.viewer-quality__button')?.click());
  expect(host.querySelector('.viewer-quality__note')?.textContent).toBe(
    'viewer.quality.liveOnlyNote',
  );
});
