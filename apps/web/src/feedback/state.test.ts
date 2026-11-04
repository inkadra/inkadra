// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { isFeedbackKey, leftOutOfScreenshot, readFeedbackDraft } from './state.ts';

afterEach(() => localStorage.clear());

const key = (over: Partial<Parameters<typeof isFeedbackKey>[0]>) => ({
  ctrlKey: true,
  metaKey: false,
  shiftKey: true,
  altKey: false,
  key: 'B',
  ...over,
});

it('takes the chord by its character, and leaves AltGr alone', () => {
  expect(isFeedbackKey(key({}))).toBe(true);
  expect(isFeedbackKey(key({ ctrlKey: false, metaKey: true, key: 'b' }))).toBe(true);
  expect(isFeedbackKey(key({ altKey: true }))).toBe(false);
  expect(isFeedbackKey(key({ shiftKey: false }))).toBe(false);
  expect(isFeedbackKey(key({ key: 'x' }))).toBe(false);
});

it('leaves secrets out of the screenshot', () => {
  document.body.innerHTML = `
    <input id="plain" value="text">
    <input id="pass" type="password">
    <input id="link" readonly value="https://x/s/secret">
    <textarea id="area" readonly>secret</textarea>
    <ul data-feedback-secret><li id="code"><code>backup</code></li></ul>
    <div data-feedback-exclude><p id="form">form</p></div>`;
  const left = (id: string) => leftOutOfScreenshot(document.getElementById(id) as Element);
  expect(left('plain')).toBe(false);
  for (const id of ['pass', 'link', 'area', 'code', 'form']) expect(left(id)).toBe(true);
  expect(leftOutOfScreenshot(document.createTextNode('x'))).toBe(false);
});

it('keeps the request id with the draft, and survives what storage holds', () => {
  const requestId = '00000000-0000-4000-8000-000000000001';
  localStorage.setItem(
    'd',
    JSON.stringify({ title: 't', description: 'd', type: 'idea', requestId }),
  );
  expect(readFeedbackDraft('d')).toEqual({ title: 't', description: 'd', type: 'idea', requestId });
  localStorage.setItem('d', JSON.stringify({ title: 't', requestId: 'not-an-id', type: 'x' }));
  expect(readFeedbackDraft('d')).toEqual({ title: 't', description: '' });
  localStorage.setItem('d', '{broken');
  expect(readFeedbackDraft('d')).toBeNull();
});
