// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { restoreEditingFocus } from './editing-focus.ts';

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
it('never steals focus from a surviving control, including one inside the same card', () => {
  const canvas = document.createElement('div');
  canvas.tabIndex = 0;
  const card = document.createElement('div');
  card.dataset.el = 'card';
  const button = document.createElement('button');
  card.append(button);
  document.body.append(canvas, card);
  button.focus();
  let frame: FrameRequestCallback = () => {};
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frame = callback;
    return 1;
  });
  restoreEditingFocus(canvas);
  frame(0);
  expect(document.activeElement).toBe(button);
});
it('restores canvas focus after the editor was removed and focus fell back to the body', () => {
  const canvas = document.createElement('div');
  canvas.tabIndex = 0;
  document.body.append(canvas);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  restoreEditingFocus(canvas);
  expect(document.activeElement).toBe(canvas);
});
