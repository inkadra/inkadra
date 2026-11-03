// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ViewerImage } from './ViewerImage.tsx';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (s: string) => s }) }));
it('zooms, resets and closes only on the background', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const close = vi.fn();
  await act(async () =>
    root.render(
      <ViewerImage onClose={close}>
        <img src="test.png" alt="Mountains" />
      </ViewerImage>,
    ),
  );
  const plane = host.querySelector<HTMLElement>('.viewer__image-plane')!;
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="viewer.zoomIn"]')!.click(),
  );
  expect(plane.style.transform).toContain('scale(1.5)');
  await act(async () => host.querySelector('img')!.click());
  expect(close).not.toHaveBeenCalled();
  const canvas = host.querySelector<HTMLElement>('.viewer__image-view')!;
  canvas.setPointerCapture = vi.fn();
  await act(async () =>
    host
      .querySelector('img')!
      .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 })),
  );
  // Captured clicks target the canvas even though the press started on the image.
  await act(async () => canvas.click());
  expect(close).not.toHaveBeenCalled();
  await act(async () =>
    host
      .querySelector('.viewer__image-view')!
      .dispatchEvent(new WheelEvent('wheel', { deltaY: -30, bubbles: true, cancelable: true })),
  );
  expect(plane.style.transform).not.toContain('scale(1.5)');
  await act(async () => host.querySelectorAll<HTMLButtonElement>('button')[1]!.click());
  expect(plane.style.transform).toContain('scale(1)');
  await act(async () => host.querySelector<HTMLElement>('.viewer__image-view')!.click());
  expect(close).toHaveBeenCalledOnce();
  await act(async () => root.unmount());
  host.remove();
});

it('does not close after a background pan made of movements of at most two pixels', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const close = vi.fn();
  try {
    await act(async () =>
      root.render(
        <ViewerImage onClose={close}>
          <img src="test.png" alt="Mountains" />
        </ViewerImage>,
      ),
    );
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="viewer.zoomIn"]')!.click(),
    );
    const canvas = host.querySelector<HTMLElement>('.viewer__image-view')!;
    canvas.setPointerCapture = vi.fn();
    const pointer = (type: string, x: number) =>
      act(async () => {
        canvas.dispatchEvent(
          new PointerEvent(type, { bubbles: true, pointerId: 1, clientX: x, clientY: 10 }),
        );
      });
    await pointer('pointerdown', 10);
    for (const x of [11, 13, 14, 16]) await pointer('pointermove', x);
    await pointer('pointerup', 16);
    expect(host.querySelector<HTMLElement>('.viewer__image-plane')!.style.transform).toContain(
      'translate(6px, 0px)',
    );
    await act(async () => canvas.click());
    expect(close).not.toHaveBeenCalled();
    await pointer('pointerdown', 20);
    await pointer('pointerup', 20);
    await act(async () => canvas.click());
    expect(close).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
