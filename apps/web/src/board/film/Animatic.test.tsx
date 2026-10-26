// @vitest-environment happy-dom
import { createElement, type FrameElement } from '@inkadra/canvas-core';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import mockEn from '../../i18n/en.json';
import mockIt from '../../i18n/it.json';
import { BoardStore } from '../store.ts';
import { Animatic } from './Animatic.tsx';
import { animaticTimeline, entryAt, snapDuration, timecode } from './animatic.ts';

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
});
