// @vitest-environment happy-dom
import {
  addFrame,
  addScene,
  childrenOf,
  type FrameElement,
  listElements,
  toGrid,
  updateElement,
} from '@inkadra/canvas-core';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import mockEn from '../../i18n/en.json';
import { BoardStore } from '../store.ts';
import { DrawingEditor } from './DrawingEditor.tsx';

vi.mock('../assets.ts', () => ({
  useAsset: () => undefined,
  pickVariant: () => '',
}));

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
  for (const dispose of disposals.splice(0).reverse()) dispose();
});

function board() {
  const doc = new Y.Doc();
  const store = new BoardStore(doc);
  disposals.push(() => {
    store.destroy();
    doc.destroy();
  });
  const scene = addScene(doc, { number: '4' }, { userId: null });
  const first = addFrame(doc, scene.id, null, {}, { userId: null });
  const second = addFrame(doc, scene.id, null, {}, { userId: null });
  return { doc, store, scene, first, second };
}

const frameOf = (store: BoardStore, id: string) => store.getSnapshot().byId.get(id) as FrameElement;

async function mount(props: {
  store: BoardStore;
  frame: FrameElement;
  frames?: FrameElement[];
  readOnly?: boolean;
  onPick?: (id: string) => void;
}) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const render = (frame: FrameElement) =>
    root.render(
      <DrawingEditor
        store={props.store}
        frame={frame}
        label="4A"
        boardAspect="16:9"
        readOnly={props.readOnly ?? false}
        frames={props.frames}
        labels={new Map(props.frames?.map((f, i) => [f.id, `4${'AB'[i]}`]))}
        onPick={props.onPick}
        onClose={() => {}}
      />,
    );
  await act(async () => render(props.frame));
  disposals.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  const area = host.querySelector<HTMLElement>('.pen__area');
  if (!area) throw new Error('no drawing area');
  // A 400 × 225 picture at the top left of the page.
  vi.spyOn(area, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 400,
    height: 225,
  } as DOMRect);
  const pointer = (type: string, x: number, y: number, target: Element = area) =>
    target.dispatchEvent(
      new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: x, clientY: y }),
    );
  const rerender = async () => act(async () => render(frameOf(props.store, props.frame.id)));
  return { host, area, pointer, rerender };
}

const press = (key: string) =>
  act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
const button = (host: HTMLElement, label: string) => {
  const found = [...host.querySelectorAll('button')].find(
    (b) => b.getAttribute('aria-label') === label || b.textContent === label,
  );
  if (!found) throw new Error(`no button ${label}`);
  return found;
};

describe('drawing editor', () => {
  it('draws a rectangle in one gesture, undone in one step', async () => {
    const { store, first } = board();
    const { host, pointer, rerender } = await mount({ store, frame: first });
    await press('r');
    expect(button(host, 'Shapes').getAttribute('aria-pressed')).toBe('true');
    await act(async () => {
      pointer('pointerdown', 40, 45);
      pointer('pointermove', 120, 90);
      pointer('pointermove', 200, 135);
    });
    expect(host.querySelector('.frame-pic__ink rect')).not.toBeNull();
    expect(frameOf(store, first.id).shapes).toEqual([]);
    await act(async () => pointer('pointerup', 200, 135));
    const [shape] = frameOf(store, first.id).shapes ?? [];
    expect(shape).toMatchObject({
      kind: 'rect',
      x0: toGrid(0.1),
      y0: toGrid(0.2),
      x1: toGrid(0.5),
      y1: toGrid(0.6),
    });
    await act(async () => store.undo.undo());
    expect(frameOf(store, first.id).shapes).toEqual([]);
    expect(store.undo.undoStack).toHaveLength(0);

    // A click with no drag draws nothing.
    await rerender();
    await act(async () => {
      pointer('pointerdown', 40, 45);
      pointer('pointerup', 40, 45);
    });
    expect(frameOf(store, first.id).shapes).toEqual([]);
  });

  it('places a text where the picture is clicked and erases it', async () => {
    const { store, first } = board();
    const { host, pointer, rerender } = await mount({ store, frame: first });
    await press('t');
    await act(async () => pointer('pointerdown', 100, 112.5));
    const input = host.querySelector<HTMLInputElement>('.pen__text');
    if (!input) throw new Error('no text field');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        input,
        'Treno',
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(host.querySelector('.pen__text')).toBeNull();
    expect(frameOf(store, first.id).shapes).toMatchObject([
      { kind: 'text', text: 'Treno', x0: toGrid(0.25), y0: toGrid(0.5) },
    ]);
    await rerender();
    expect(host.querySelector('.frame-pic__ink text')?.textContent).toBe('Treno');
    await press('e');
    await act(async () => {
      pointer('pointerdown', 110, 108);
      pointer('pointerup', 110, 108);
    });
    expect(frameOf(store, first.id).shapes).toEqual([]);
  });

  it('only looks in read-only mode: no tools, dragging pans', async () => {
    const { store, first } = board();
    const { host, area, pointer } = await mount({ store, frame: first, readOnly: true });
    expect(host.querySelector('.pen__tools')).toBeNull();
    await press('r');
    await act(async () => {
      pointer('pointerdown', 40, 45);
      pointer('pointermove', 140, 45);
      pointer('pointerup', 140, 45);
    });
    expect(frameOf(store, first.id).shapes).toEqual([]);
    expect(frameOf(store, first.id).strokes).toEqual([]);
    expect(area.style.transform).toBe('translate(100px, 0px) scale(1)');
    expect(host.querySelector('.pen__strip-add')).toBeNull();
  });

  it('zooms with the buttons and the keys, and goes back to 100%', async () => {
    const { store, first } = board();
    const { host, area } = await mount({ store, frame: first });
    await act(async () => button(host, 'Zoom in').click());
    expect(button(host, 'Zoom 125%: back to 100%')).toBeTruthy();
    expect(area.style.transform).toContain('scale(1.25)');
    await press('-');
    await press('-');
    expect(area.style.transform).toContain('scale(0.8)');
    await press('0');
    expect(area.style.transform).toBe('translate(0px, 0px) scale(1)');
  });

  it('shows the previous frame as an onion skin and the guides', async () => {
    const { doc, store, first, second } = board();
    const frames = [first, second];
    const firstView = await mount({ store, frame: first, frames, onPick: () => {} });
    const onionFirst = firstView.host.querySelector<HTMLButtonElement>(
      '.pen__view button:first-child',
    );
    expect(onionFirst?.disabled).toBe(true);
    for (const dispose of disposals.splice(0).reverse()) dispose();

    const store2 = new BoardStore(doc);
    disposals.push(() => store2.destroy());
    const { host } = await mount({ store: store2, frame: second, frames, onPick: () => {} });
    const onion = button(host, 'Onion skin · 4A');
    expect(onion.disabled).toBe(false);
    await act(async () => onion.click());
    expect(onion.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('.frame-pic__ink g[opacity="0.35"]')).not.toBeNull();
    expect(host.querySelector('.pen__guides')).toBeNull();
    await press('g');
    expect(host.querySelector('.pen__guides')).not.toBeNull();
  });

  it('moves between the frames of the scene and adds one after the current', async () => {
    const { doc, store, scene, first, second } = board();
    const onPick = vi.fn();
    const { host } = await mount({ store, frame: first, frames: [first, second], onPick });
    const items = host.querySelectorAll('.pen__strip-item');
    expect(items).toHaveLength(2);
    expect(items[0]?.getAttribute('aria-current')).toBe('true');
    await act(async () => (items[1] as HTMLButtonElement).click());
    expect(onPick).toHaveBeenLastCalledWith(second.id);
    await act(async () => button(host, 'New frame').click());
    const order = childrenOf(listElements(doc), scene.id).map((e) => e.id);
    expect(order).toHaveLength(3);
    expect(order[0]).toBe(first.id);
    expect(order[2]).toBe(second.id);
    expect(onPick).toHaveBeenLastCalledWith(order[1]);
  });

  it('hides layers and fades the reference picture in one undo step', async () => {
    const { doc, store, first } = board();
    const { host, rerender } = await mount({ store, frame: first });
    await press('l');
    expect(host.querySelector('.pen__layers')).not.toBeNull();
    // No reference picture: nothing to fade.
    expect(host.querySelector('.pen__opacity')).toBeNull();
    const drawing = button(host, 'Drawing');
    await act(async () => drawing.click());
    expect(drawing.getAttribute('aria-pressed')).toBe('false');

    updateElement(doc, first.id, { assetId: 'asset-1' });
    await rerender();
    const slider = host.querySelector<HTMLInputElement>('.pen__opacity input');
    if (!slider) throw new Error('no opacity slider');
    await act(async () => {
      slider.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(slider, '40');
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(slider, '30');
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    });
    expect(frameOf(store, first.id).referenceOpacity).toBe(0.3);
    await act(async () => store.undo.undo());
    expect(frameOf(store, first.id).referenceOpacity).toBeUndefined();
  });
});
