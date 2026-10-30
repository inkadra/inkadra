// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { onArrowStyleButton } from './arrows.tsx';

describe('Enter on the canvas', () => {
  it('is left to arrow style buttons only', () => {
    document.body.innerHTML = `
      <div class="ctxbar">
        <span data-arrow-styles><button id="curve"><svg id="icon"></svg></button></span>
        <button id="lock"></button>
      </div>
      <div class="card" tabindex="0" id="card"><a href="https://example.com" id="link">x</a></div>`;
    const el = (id: string) => document.getElementById(id);
    expect(onArrowStyleButton(el('curve'))).toBe(true);
    expect(onArrowStyleButton(el('icon'))).toBe(true);
    // Other buttons, links and focused cards keep Enter as "open / edit".
    expect(onArrowStyleButton(el('lock'))).toBe(false);
    expect(onArrowStyleButton(el('card'))).toBe(false);
    expect(onArrowStyleButton(el('link'))).toBe(false);
    expect(onArrowStyleButton(null)).toBe(false);
  });
});
