import { chooseSelect } from '../../test/select.ts';
// @vitest-environment happy-dom
import { addFrame, addScene, createElement, type FrameElement } from '@inkadra/canvas-core';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import mockEn from '../../i18n/en.json';
import mockIt from '../../i18n/it.json';
import { BoardStore } from '../store.ts';
import { Animatic } from './Animatic.tsx';
import {
  animaticTimeline,
  entryAt,
  estimatedDurationMs,
  snapDuration,
  timecode,
} from './animatic.ts';
import { StoryboardView } from './StoryboardView.tsx';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      let node: unknown = mockEn;
      for (const part of key.split('.')) {
        if (typeof node !== 'object' || node === null || !(part in node)) return key;
        node = (node as Record<string, unknown>)[part];
      }
      let text = typeof node === 'string' ? node : key;
      for (const [name, value] of Object.entries(params ?? {})) {
        text = text.replaceAll(`{{${name}}}`, String(value));
      }
      return text;
    },
  }),
}));

const disposals: Array<() => void> = [];
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const dispose of disposals.splice(0).reverse()) dispose();
});

function board() {
  const doc = new Y.Doc();
  const store = new BoardStore(doc);
  disposals.push(() => {
    store.destroy();
    doc.destroy();
  });
  return { doc, store };
}

function frames(doc: Y.Doc, durations: Array<number | undefined>) {
  return durations.map(
    (durationMs, i) =>
      createElement(
        doc,
        'frame',
        { x: i * 10, y: 0 },
        durationMs === undefined ? {} : { durationMs },
        { userId: null },
      ) as FrameElement,
  );
}

async function mount(element: React.ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(element));
  disposals.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  return host;
}

function PresentHost({ store, frames }: { store: BoardStore; frames: FrameElement[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="opener" onClick={() => setOpen(true)}>
        Present
      </button>
      {open && (
        <Animatic
          store={store}
          frames={frames}
          labels={new Map()}
          boardAspect="16:9"
          readOnly
          present
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

describe('animatic time line', () => {
  it('plays frames in order, one second for a missing duration, skipping zero', () => {
    const { doc } = board();
    const [a, b, c, d] = frames(doc, [4000, undefined, 0, 2500]);
    const line = animaticTimeline([a, b, c, d] as FrameElement[]);
    expect(line.map((e) => [e.frame.id, e.start, e.end])).toEqual([
      [a?.id, 0, 4000],
      [b?.id, 4000, 5000],
      [d?.id, 5000, 7500],
    ]);
    expect(entryAt(line, 0)?.frame.id).toBe(a?.id);
    expect(entryAt(line, 4000)?.frame.id).toBe(b?.id);
    expect(entryAt(line, 7500)?.frame.id).toBe(d?.id);
    expect(entryAt([], 0)).toBeNull();
  });

  it('estimates the duration the animatic plays', () => {
    const { doc } = board();
    expect(estimatedDurationMs(frames(doc, [4000, undefined, 0]))).toBe(5000);
    expect(estimatedDurationMs([])).toBe(0);
  });

  it('formats timecodes and snaps durations', () => {
    expect(timecode(0)).toBe('0:00.0');
    expect(timecode(65_340)).toBe('1:05.3');
    expect(snapDuration(1240)).toBe(1000);
    expect(snapDuration(1260)).toBe(1500);
    expect(snapDuration(-300)).toBe(500);
    expect(snapDuration(10_000_000)).toBe(3_600_000);
  });

  it('has the same playback strings in Italian and English', () => {
    const keys = (o: object): string[] =>
      Object.entries(o).flatMap(([k, v]) =>
        typeof v === 'object' ? keys(v).map((s) => `${k}.${s}`) : [k],
      );
    expect(keys(mockIt.film.playback).sort()).toEqual(keys(mockEn.film.playback).sort());
  });
});

describe('Animatic', () => {
  it('seeks with the keyboard and changes a duration from the block edge', async () => {
    const { doc, store } = board();
    const list = frames(doc, [2000, undefined]);
    const labels = new Map(list.map((f, i) => [f.id, `1${'AB'[i]}`]));
    const host = await mount(
      <Animatic store={store} frames={list} labels={labels} boardAspect="16:9" readOnly={false} />,
    );
    const time = () => host.querySelector('.animatic__time')?.textContent;
    expect(time()).toBe('0:00.0 / 0:03.0');
    const stage = host.querySelector<HTMLElement>('.animatic__stage');
    if (!stage) throw new Error('no stage');
    await act(async () => {
      stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    });
    expect(time()).toBe('0:03.0 / 0:03.0');
    await act(async () => {
      stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
      stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(time()).toBe('0:01.0 / 0:03.0');
    expect(stage.getAttribute('aria-label')).toBe('Frame 1A at 0:01.0');

    const handles = host.querySelectorAll<HTMLElement>('[role="slider"]');
    expect(handles).toHaveLength(2);
    expect(handles[1]?.getAttribute('aria-label')).toBe('Duration of 1B');
    await act(async () => {
      handles[1]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    const frame = store.getSnapshot().byId.get(list[1]?.id ?? '') as FrameElement;
    expect(frame.durationMs).toBe(1500);
  });

  it('shows no duration handles when read only', async () => {
    const { doc, store } = board();
    const list = frames(doc, [1000]);
    const host = await mount(
      <Animatic store={store} frames={list} labels={new Map()} boardAspect="16:9" readOnly />,
    );
    expect(host.querySelectorAll('[role="slider"]')).toHaveLength(0);
    expect(host.querySelectorAll('.animatic__block')).toHaveLength(1);
  });

  it('writes a dragged duration once, as one undo step', async () => {
    const { doc, store } = board();
    const list = frames(doc, [2000, 2000]);
    const id = list[0]?.id ?? '';
    const host = await mount(
      <Animatic
        store={store}
        frames={list}
        labels={new Map()}
        boardAspect="16:9"
        readOnly={false}
      />,
    );
    const track = host.querySelector<HTMLElement>('.animatic__track');
    if (!track) throw new Error('no track');
    // 4 s over 400 px: 10 ms per pixel.
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({ width: 400 } as DOMRect);
    const handle = host.querySelector<HTMLElement>('[role="slider"]');
    if (!handle) throw new Error('no handle');
    const updates = vi.fn();
    doc.on('update', updates);
    const pointer = (type: string, clientX: number) =>
      handle.dispatchEvent(
        new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX }),
      );
    await act(async () => {
      pointer('pointerdown', 100);
      pointer('pointermove', 150);
      pointer('pointermove', 200);
    });
    expect(handle.getAttribute('aria-valuenow')).toBe('3');
    expect(updates).not.toHaveBeenCalled();
    await act(async () => pointer('pointerup', 200));
    expect(updates).toHaveBeenCalledOnce();
    const duration = () => (store.getSnapshot().byId.get(id) as FrameElement).durationMs;
    expect(duration()).toBe(3000);
    await act(async () => store.undo.undo());
    expect(duration()).toBe(2000);
    expect(store.undo.undoStack).toHaveLength(0);

    await act(async () => {
      pointer('pointerdown', 100);
      pointer('pointermove', 300);
      pointer('pointercancel', 300);
    });
    expect(duration()).toBe(2000);
    expect(handle.getAttribute('aria-valuenow')).toBe('2');
  });

  it('keeps playing at the new speed when the speed changes', async () => {
    const { doc, store } = board();
    const list = frames(doc, [5000]);
    const ticks: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => ticks.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => {});
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const host = await mount(
      <Animatic store={store} frames={list} labels={new Map()} boardAspect="16:9" readOnly />,
    );
    const time = () => host.querySelector('.animatic__time')?.textContent;
    const tick = async (at: number) => {
      const cb = ticks.at(-1);
      await act(async () => cb?.(at));
    };
    const play = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Play');
    await act(async () => play?.click());
    await tick(1000);
    expect(time()).toBe('0:01.0 / 0:05.0');
    now = 1000;
    const .ink-select = host.querySelector('.ink-select');
    if (!select) throw new Error('no speed');
    await act(async () => {
      chooseSelect(select, '2');
    });
    await tick(1500);
    expect(time()).toBe('0:02.0 / 0:05.0');
    expect(host.querySelector('button')?.textContent).toBe('Pause');
  });

  it('returns focus to the opener when Present closes with Escape', async () => {
    const { doc, store } = board();
    const list = frames(doc, [1000]);
    // happy-dom does not implement the native modal API.
    vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (
      this: HTMLDialogElement,
    ) {
      this.open = true;
    });
    const host = await mount(<PresentHost store={store} frames={list} />);
    const opener = host.querySelector<HTMLButtonElement>('.opener');
    if (!opener) throw new Error('no opener');
    opener.focus();
    await act(async () => opener.click());
    const dialog = host.querySelector('dialog');
    expect(dialog?.open).toBe(true);
    expect(document.activeElement).toBe(host.querySelector('.animatic__stage'));
    await act(async () => {
      dialog?.dispatchEvent(new Event('cancel', { cancelable: true }));
    });
    expect(host.querySelector('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});

describe('StoryboardView animatic', () => {
  it('offers to add a frame when the filtered scene has none', async () => {
    const { doc, store } = board();
    const opts = { userId: null };
    addScene(doc, { title: 'Full' }, opts);
    const empty = addScene(doc, { title: 'Empty' }, opts);
    const full = [...store.getSnapshot().byId.values()].find(
      (e) => e.type === 'scene' && e.id !== empty.id,
    );
    addFrame(doc, full?.id ?? null, null, {}, opts);
    const host = await mount(
      <StoryboardView store={store} projectId="p" boardId="b" userId="u" readOnly={false} />,
    );
    const button = (text: string) =>
      [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(text));
    await act(async () => button('Animatic')?.click());
    expect(host.querySelector('.animatic')).not.toBeNull();
    await act(async () => button('Empty')?.click());
    expect(host.querySelector('.animatic')).toBeNull();
    expect(host.textContent).toContain('No frames in this scene');
    const frameCount = () =>
      [...store.getSnapshot().byId.values()].filter((e) => e.type === 'frame').length;
    expect(frameCount()).toBe(1);
    await act(async () => button('New frame')?.click());
    expect(frameCount()).toBe(2);
    expect(host.querySelector('.animatic')).not.toBeNull();
  });
});
