// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { returnFocus } from './focus.ts';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('returnFocus', () => {
  it('focuses the first anchor when it can take focus', () => {
    document.body.innerHTML = '<main><button id="a">Dock</button></main>';
    returnFocus(document.getElementById('a'));
    expect(document.activeElement?.id).toBe('a');
  });

  it('falls back to the main region when the anchor is not focusable, never body', () => {
    document.body.innerHTML = '<main><div id="a">Dock</div></main>';
    returnFocus(document.getElementById('a'));
    expect(document.activeElement?.tagName).toBe('MAIN');
  });

  it('moves a focus still inside the closing tour', () => {
    document.body.innerHTML =
      '<main><div id="a">Dock</div></main><dialog class="tour"><button id="next">Fatto</button></dialog>';
    document.getElementById('next')?.focus();
    returnFocus(document.getElementById('a'));
    expect(document.activeElement?.tagName).toBe('MAIN');
  });

  it('leaves a focus the browser already gave back', () => {
    document.body.innerHTML = '<main><button id="a">A</button><button id="b">B</button></main>';
    document.getElementById('b')?.focus();
    returnFocus(document.getElementById('a'));
    expect(document.activeElement?.id).toBe('b');
  });
});
