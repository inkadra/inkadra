// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ScreenshotEditor } from './ScreenshotEditor.tsx';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

it('moves an area without reading the finished event (error 018a-aa26)', async () => {
  class LoadedImage {
    width = 800;
    height = 600;
    onload: (() => void) | null = null;
    set src(_: string) {
      queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal('Image', LoadedImage);
  URL.createObjectURL = () => 'blob:shot';
  URL.revokeObjectURL = () => {};
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <ScreenshotEditor
        source={new Blob()}
        initialTool="draw"
        onSave={() => {}}
        onClose={() => {}}
      />,
    );
  });
  const canvas = document.querySelector('canvas') as HTMLCanvasElement;
  canvas.setPointerCapture = () => {};
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect;
  const pointer = (type: string, clientX: number, clientY: number) =>
    act(async () => {
      canvas.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX, clientY }));
    });

  await pointer('pointerdown', 100, 100);
  await pointer('pointermove', 400, 400);
  await pointer('pointerup', 400, 400);
  await pointer('pointerdown', 250, 250);
  // Two moves before a render: React runs only the first updater during the event.
  await act(async () => {
    for (const clientX of [300, 320]) {
      canvas.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX, clientY: 300 }));
    }
  });
  await pointer('pointerup', 320, 300);

  expect(document.querySelector('canvas')).not.toBeNull();
  await act(async () => root.unmount());
});
