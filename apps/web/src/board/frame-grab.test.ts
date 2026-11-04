// @vitest-environment happy-dom
import { createElement } from '@inkadra/canvas-core';
import { createBoardDoc } from '@inkadra/doc-schema';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BlackFrame,
  captureTabFrame,
  captureVideoFrame,
  formatSourceTime,
  placeVideoStill,
  VideoFrameStepper,
} from './frame-grab.ts';
import { BoardStore } from './store.ts';

const id = '11111111-1111-4111-8111-111111111111';
const source = { kind: 'uploaded-video' as const, assetId: id, timeSeconds: 12.345 };
function setup() {
  const store = new BoardStore(createBoardDoc(id));
  const video = createElement(
    store.doc,
    'file',
    { x: 100, y: 150 },
    { assetId: id, guestHidden: true },
    { userId: 'u' },
  );
  const frame = createElement(
    store.doc,
    'frame',
    { x: 0, y: 0 },
    { notes: 'Keep the train in view' },
    { userId: 'u' },
  );
  return { store, video, frame };
}

describe('video still destinations', () => {
  it('sets the image and exact provenance without erasing notes, preserving visibility', () => {
    const { store, video, frame } = setup();
    expect(
      placeVideoStill(store, {
        sourceId: video.id,
        targetId: frame.id,
        assetId: 'still',
        source,
        userId: 'u',
      }),
    ).toBeTruthy();
    expect(store.getSnapshot().byId.get(frame.id)).toMatchObject({
      assetId: 'still',
      source,
      notes: 'Keep the train in view',
      guestHidden: true,
    });
    store.undo.undo();
    expect(store.getSnapshot().byId.get(frame.id)).not.toHaveProperty('assetId');
  });
  it('adds an image beside the source and keeps time metadata', () => {
    const { store, video } = setup();
    placeVideoStill(store, {
      sourceId: video.id,
      targetId: null,
      assetId: 'still',
      source,
      userId: 'u',
    });
    const image = [...store.getSnapshot().byId.values()].find((el) => el.type === 'image');
    expect(image).not.toHaveProperty('caption');
    expect(image).toMatchObject({
      assetId: 'still',
      source,
      x: video.x + video.w + 24,
      y: video.y,
      guestHidden: true,
    });
  });
  it('rejects deleted destinations', () => {
    const { store, video } = setup();
    expect(
      placeVideoStill(store, {
        sourceId: video.id,
        targetId: 'deleted',
        assetId: 'still',
        source,
        userId: 'u',
      }),
    ).toBeNull();
  });
  it('keeps references in metadata without adding them to director notes', () => {
    const { store, video, frame } = setup();
    placeVideoStill(store, {
      sourceId: video.id,
      targetId: frame.id,
      assetId: 'thumbnail',
      source: {
        kind: 'link-thumbnail',
        url: 'https://youtube.com/watch?v=abcdefghijk',
        timeSeconds: 12,
      },
      userId: 'u',
    });
    expect(store.getSnapshot().byId.get(frame.id)).toMatchObject({
      notes: 'Keep the train in view',
    });
  });
});

it('pauses a playing video, waits for presentation, captures its timestamp and releases the canvas', async () => {
  const video = document.createElement('video');
  video.src = '/footage.mp4';
  let paused = false;
  let time = 1;
  Object.defineProperties(video, {
    videoWidth: { value: 1920 },
    videoHeight: { value: 1080 },
    readyState: { value: 2 },
    paused: { get: () => paused },
    currentTime: {
      get: () => time,
      set: () => {
        time = 1.25;
        queueMicrotask(() => video.dispatchEvent(new Event('seeked')));
      },
    },
  });
  vi.spyOn(video, 'pause').mockImplementation(() => {
    paused = true;
    time = 1.2;
  });
  video.requestVideoFrameCallback = (callback) => {
    expect(paused).toBe(true);
    queueMicrotask(() => callback(0, { mediaTime: 1.25 } as VideoFrameCallbackMetadata));
    return 1;
  };
  video.cancelVideoFrameCallback = vi.fn();
  const canvas = document.createElement('canvas');
  const draw = vi.fn(() => {
    expect(paused).toBe(true);
    expect(time).toBe(1.25);
    expect(canvas.width).toBe(1920);
    expect(canvas.height).toBe(1080);
  });
  vi.spyOn(canvas, 'getContext').mockReturnValue({ drawImage: draw } as never);
  vi.spyOn(canvas, 'toBlob').mockImplementation((callback) =>
    callback(new Blob(['png'], { type: 'image/png' })),
  );
  const create = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag, options) =>
    tag === 'canvas' ? canvas : create(tag, options),
  );
  const captured = await captureVideoFrame(video);
  expect(captured.timeSeconds).toBe(1.25);
  expect(captured.file.type).toBe('image/png');
  expect(draw).toHaveBeenCalledWith(video, 0, 0);
  expect(canvas.width).toBe(0);
  expect(canvas.height).toBe(0);
  video.src = 'https://other.example/footage.mp4';
  await expect(captureVideoFrame(video)).rejects.toThrow('cross-origin');
  vi.restoreAllMocks();
});

it('steps only while paused and labels unobserved steps as approximate', () => {
  const video = document.createElement('video');
  Object.defineProperties(video, {
    paused: { value: true, configurable: true },
    duration: { value: 10 },
  });
  video.currentTime = 1;
  const stepper = new VideoFrameStepper();
  expect(stepper.step(video, 1)).toBe(false);
  expect(video.currentTime).toBeCloseTo(1 + 1 / 30);
  Object.defineProperty(video, 'paused', { value: false });
  const before = video.currentTime;
  stepper.step(video, -1);
  expect(video.currentTime).toBe(before);
});

it('uses adjacent observed presentation timestamps for variable frame rate footage', () => {
  const video = document.createElement('video');
  Object.defineProperties(video, { paused: { value: true }, duration: { value: 10 } });
  let callback: VideoFrameRequestCallback;
  video.requestVideoFrameCallback = (next) => {
    callback = next;
    return 1;
  };
  video.cancelVideoFrameCallback = vi.fn();
  const stepper = new VideoFrameStepper();
  const stop = stepper.start(video);
  callback!(0, { mediaTime: 1, presentedFrames: 1 } as VideoFrameCallbackMetadata);
  callback!(0, { mediaTime: 1.04, presentedFrames: 2 } as VideoFrameCallbackMetadata);
  expect(stepper.step(video, -1)).toBe(true);
  expect(video.currentTime).toBe(1);
  callback!(0, { mediaTime: 1, presentedFrames: 3 } as VideoFrameCallbackMetadata);
  expect(stepper.step(video, 1)).toBe(true);
  expect(video.currentTime).toBe(1.04);
  stop();
  expect(video.cancelVideoFrameCallback).toHaveBeenCalledWith(1);
});

it('formats source time consistently in Italian and English, carrying rounded seconds', () => {
  expect(formatSourceTime(0.62, 'it')).toBe('0:00,62');
  expect(formatSourceTime(0.62, 'en')).toBe('0:00.62');
  expect(formatSourceTime(65.125, 'it')).toBe('1:05,13');
  expect(formatSourceTime(59.999, 'en')).toBe('1:00.00');
});

describe('photo of a browser tab', () => {
  function stubDisplayMedia(pixels: number) {
    const stop = vi.fn();
    const cropTo = vi.fn(async () => {});
    const track = { cropTo, stop };
    const getDisplayMedia = vi.fn(async () => ({
      getVideoTracks: () => [track],
      getTracks: () => [track],
    }));
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getDisplayMedia },
    });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    for (const size of ['videoWidth', 'videoHeight'])
      Object.defineProperty(HTMLVideoElement.prototype, size, { configurable: true, value: 4 });
    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
      configurable: true,
      set: () => {},
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      getImageData: () => ({ data: new Uint8ClampedArray(64).fill(pixels) }),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((done) =>
      done(new Blob(['png'])),
    );
    return { stop, cropTo, getDisplayMedia };
  }
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout'] }));
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  const run = async (cropTo: Element | null = null) => {
    const shot = captureTabFrame(cropTo);
    const settled = shot.then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    await vi.runAllTimersAsync();
    return settled;
  };

  it('keeps the picture, crops to the player where it can, and always stops the tracks', async () => {
    const { stop, cropTo } = stubDisplayMedia(200);
    vi.stubGlobal('CropTarget', { fromElement: async () => 'target' });
    const result = await run(document.createElement('iframe'));
    expect(result).toMatchObject({ value: { width: 4, height: 4 } });
    expect(cropTo).toHaveBeenCalledWith('target');
    expect(stop).toHaveBeenCalledOnce();
  });

  it('refuses a black frame and stops the tracks', async () => {
    const { stop } = stubDisplayMedia(0);
    const result = await run();
    expect((result as { error: unknown }).error).toBeInstanceOf(BlackFrame);
    expect(stop).toHaveBeenCalledOnce();
  });

  it('stops the tracks when the capture fails halfway, and asks nothing after a refusal', async () => {
    const { stop, getDisplayMedia } = stubDisplayMedia(200);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(new Error('no'));
    await run();
    expect(stop).toHaveBeenCalledOnce();
    getDisplayMedia.mockRejectedValueOnce(new DOMException('no', 'NotAllowedError'));
    const refused = await run();
    expect((refused as { error: DOMException }).error.name).toBe('NotAllowedError');
    expect(stop).toHaveBeenCalledOnce();
  });
});
