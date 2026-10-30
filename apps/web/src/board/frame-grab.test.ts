// @vitest-environment happy-dom
import { createElement } from '@inkadra/canvas-core';
import { createBoardDoc } from '@inkadra/doc-schema';
import { describe, expect, it, vi } from 'vitest';
import {
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
        caption: 'Last Train',
      }),
    ).toBe(true);
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
      caption: 'Last Train',
    });
    const image = [...store.getSnapshot().byId.values()].find((el) => el.type === 'image');
    expect(image).toMatchObject({
      assetId: 'still',
      source,
      x: video.x + video.w + 24,
      y: video.y,
      guestHidden: true,
    });
  });
  it('rejects deleted destinations and notes that cannot fit the reference', () => {
    const { store, video } = setup();
    expect(
      placeVideoStill(store, {
        sourceId: video.id,
        targetId: 'deleted',
        assetId: 'still',
        source,
        userId: 'u',
        caption: '',
      }),
    ).toBe(false);
  });
  it('appends the YouTube reference without replacing director notes', () => {
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
      caption: '',
      reference: 'https://youtube.com/watch?v=abcdefghijk&t=12',
    });
    expect(store.getSnapshot().byId.get(frame.id)).toMatchObject({
      notes: 'Keep the train in view\nhttps://youtube.com/watch?v=abcdefghijk&t=12',
    });
  });
});

it('captures at intrinsic resolution and rejects cross-origin or seeking video', async () => {
  const video = document.createElement('video');
  video.src = '/footage.mp4';
  Object.defineProperties(video, {
    videoWidth: { value: 1920 },
    videoHeight: { value: 1080 },
    readyState: { value: 2 },
    currentTime: { value: 1.25 },
  });
  const canvas = document.createElement('canvas');
  const draw = vi.fn();
  vi.spyOn(canvas, 'getContext').mockReturnValue({ drawImage: draw } as never);
  vi.spyOn(canvas, 'toBlob').mockImplementation((callback) =>
    callback(new Blob(['png'], { type: 'image/png' })),
  );
  const create = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag, options) =>
    tag === 'canvas' ? canvas : create(tag, options),
  );
  const file = await captureVideoFrame(video);
  expect(canvas.width).toBe(1920);
  expect(canvas.height).toBe(1080);
  expect(draw).toHaveBeenCalledWith(video, 0, 0);
  expect(file.type).toBe('image/png');
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
