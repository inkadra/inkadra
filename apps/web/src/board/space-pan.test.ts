// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { canSpacePan } from './shortcuts.ts';

it('leaves Space to a focused video play button and its descendants', () => {
  const button = document.createElement('button');
  button.dataset.playLink = 'link';
  button.innerHTML = '<span>Play</span>';
  expect(canSpacePan(button)).toBe(false);
  expect(canSpacePan(button.firstChild)).toBe(false);
  expect(canSpacePan(document.createElement('div'))).toBe(true);
});
