// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { forgetSandbox, rememberSandbox, sandboxEnded, timeLeft } from './demo.ts';

describe('the demo clock (decision 0084)', () => {
  it('counts minutes, rounded up, and seconds in the last minute', () => {
    expect(timeLeft(42 * 60_000)).toEqual({ unit: 'min', value: 42 });
    expect(timeLeft(4 * 60_000 + 1)).toEqual({ unit: 'min', value: 5 });
    expect(timeLeft(61_000)).toEqual({ unit: 'min', value: 2 });
    expect(timeLeft(60_000)).toEqual({ unit: 's', value: 60 });
    expect(timeLeft(1500)).toEqual({ unit: 's', value: 2 });
    expect(timeLeft(-5000)).toEqual({ unit: 's', value: 0 });
  });
});

describe('the end of a sandbox, as this browser remembers it', () => {
  afterEach(() => forgetSandbox());
  it('is over only once a remembered sandbox is past its time', () => {
    expect(sandboxEnded()).toBe(false);
    rememberSandbox({ expiresAt: new Date(Date.now() + 60_000).toISOString() });
    expect(sandboxEnded()).toBe(false);
    expect(sandboxEnded(Date.now() + 61_000)).toBe(true);
    forgetSandbox();
    expect(sandboxEnded(Date.now() + 61_000)).toBe(false);
  });
});
