import type { Asset, AssetRendition, VideoRung } from '@inkadra/shared';
import { type RefObject, useEffect, useRef, useState } from 'react';
import { playbackUrl } from './assets.ts';

/**
 * What a video plays (decision 0128): the HLS master playlist of its rungs when one is ready,
 * the file of a rung or the old copy for players without HLS, and the original when the
 * browser plays it and the person may download it.
 */
export interface PlaybackSource {
  hls: string | null;
  /** A plain MP4 any `<video>` plays: the largest ready rung up to 1080, else as before. */
  src: string | undefined;
  original: string | null;
}

/** Nothing to play: for hooks that must run before the asset is there. */
export const NO_SOURCE: PlaybackSource = { hls: null, src: undefined, original: null };

const order = (a: AssetRendition, b: AssetRendition) => Number(a.name) - Number(b.name);

/** The ready rungs of a video, smallest first. */
export const readyRungs = (asset: Asset) =>
  [...(asset.playback?.renditions ?? [])].filter((r) => r.status === 'ready' && r.url).sort(order);

export function playbackSource(asset: Asset): PlaybackSource {
  const ready = readyRungs(asset);
  const file = ready.filter((r) => Number(r.name) <= 1080).at(-1) ?? ready[0];
  return {
    hls: asset.playback?.hls ?? null,
    src: file?.url ?? playbackUrl(asset),
    original: asset.playback?.original ? asset.url : null,
  };
}

const rungHeight = (rungs: AssetRendition[], name: VideoRung) =>
  rungs.find((r) => r.name === name)?.height ?? null;

/** Auto (the player follows the connection), one rung, or the original file. */
export type QualityChoice = 'auto' | VideoRung | 'original';

type HlsInstance = {
  levels: Array<{ height: number }>;
  currentLevel: number;
  nextLevel: number;
  loadSource(url: string): void;
  attachMedia(media: HTMLMediaElement): void;
  on(event: string, handler: (event: string, data: Record<string, unknown>) => void): void;
  destroy(): void;
};
type HlsClass = {
  new (config: Record<string, unknown>): HlsInstance;
  isSupported(): boolean;
  Events: Record<string, string>;
};

/** hls.js, loaded only when a video has a playlist; replaced in tests. */
export let loadHls: () => Promise<HlsClass> = async () =>
  (await import('hls.js/light')).default as unknown as HlsClass;
export function setHlsLoader(loader: typeof loadHls) {
  loadHls = loader;
}

/**
 * Plays `source` in the video of `ref` as `choice` asks. With a playlist, hls.js (also where
 * the browser plays HLS natively: only hls.js tells the levels and switches them); without
 * Media Source Extensions (iPhone before iOS 17.1), the playlist natively; when hls.js fails
 * for good, the plain file. Returns the `src` the element takes (undefined while hls.js feeds
 * it) and the height playing on Auto.
 */
export function useVideoSource(
  ref: RefObject<HTMLVideoElement | null>,
  source: PlaybackSource,
  choice: QualityChoice = 'auto',
  rungs: AssetRendition[] = [],
) {
  const [attached, setAttached] = useState(false);
  const [failed, setFailed] = useState(false);
  const [height, setHeight] = useState<number | null>(null);
  const hls = useRef<HlsInstance | null>(null);
  const applied = useRef<QualityChoice>('auto');
  const useHls = Boolean(source.hls) && !failed && choice !== 'original';
  // A rung chosen by hand plays from its own file when hls.js is not there.
  const pick = (name: VideoRung) => rungs.find((r) => r.name === name && r.url)?.url;

  useEffect(() => {
    const video = ref.current;
    if (!useHls || !video || !source.hls) return;
    let alive = true;
    let instance: HlsInstance | null = null;
    void loadHls()
      .then((Hls) => {
        if (!alive) return;
        if (!Hls.isSupported()) {
          if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = source.hls as string;
            setAttached(true);
          } else setFailed(true);
          return;
        }
        instance = new Hls({ enableWorker: false, capLevelToPlayerSize: true });
        hls.current = instance;
        instance.on(Hls.Events.LEVEL_SWITCHED ?? 'hlsLevelSwitched', (_e, data) => {
          const level = instance?.levels[Number(data.level)];
          setHeight(level?.height ?? null);
        });
        instance.on(Hls.Events.ERROR ?? 'hlsError', (_e, data) => {
          if (!data.fatal) return;
          // The plain file still plays: never an error on screen because of the playlist.
          instance?.destroy();
          hls.current = null;
          setAttached(false);
          setFailed(true);
        });
        applied.current = 'auto';
        instance.loadSource(source.hls as string);
        instance.attachMedia(video);
        setAttached(true);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      instance?.destroy();
      hls.current = null;
      setAttached(false);
    };
  }, [ref, source.hls, useHls]);

  // A rung by hand, or Auto again: set once per choice (setting the level flushes the buffer).
  const target = choice === 'auto' || choice === 'original' ? null : rungHeight(rungs, choice);
  useEffect(() => {
    const instance = hls.current;
    if (!instance || !attached || applied.current === choice) return;
    const index = target === null ? -1 : instance.levels.findIndex((l) => l.height === target);
    if (target !== null && index < 0) return;
    instance.currentLevel = index;
    applied.current = choice;
  }, [choice, attached, target]);

  const src = useHls
    ? undefined
    : choice === 'original' && source.original
      ? source.original
      : choice !== 'auto' && choice !== 'original'
        ? (pick(choice) ?? source.src)
        : source.src;
  return { src, height: useHls ? height : null, hls: useHls && attached };
}

/**
 * Keeps the position and the play state across a change of what the video plays (another
 * quality, the original): the new source starts where the old one was.
 */
export function useKeepPosition(ref: RefObject<HTMLVideoElement | null>, key: string) {
  const last = useRef<{ time: number; playing: boolean } | null>(null);
  const previous = useRef(key);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (previous.current === key) return;
    previous.current = key;
    const saved = last.current;
    if (!saved) return;
    const restore = () => {
      video.currentTime = saved.time;
      if (saved.playing) void video.play()?.catch(() => {});
    };
    video.addEventListener('loadedmetadata', restore, { once: true });
    return () => video.removeEventListener('loadedmetadata', restore);
  }, [ref, key]);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const note = () => {
      last.current = { time: video.currentTime, playing: !video.paused };
    };
    video.addEventListener('timeupdate', note);
    video.addEventListener('pause', note);
    video.addEventListener('play', note);
    return () => {
      video.removeEventListener('timeupdate', note);
      video.removeEventListener('pause', note);
      video.removeEventListener('play', note);
    };
  }, [ref]);
}
