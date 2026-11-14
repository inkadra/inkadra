// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { hasUnsaved, isBusy, setBusy, setUnsaved, whenIdle } from './busy.ts';

describe('waiting for the board and uploads', () => {
  it('runs at once when nothing is busy', () => {
    const run = vi.fn();
    whenIdle(run);
    expect(run).toHaveBeenCalledOnce();
  });

  it('waits until every reason is idle', () => {
    const board = {};
    setBusy(board, true);
    setBusy('uploads', true);
    const run = vi.fn();
    whenIdle(run);
    setBusy(board, false);
    expect(run).not.toHaveBeenCalled();
    setBusy('uploads', true);
    setBusy('uploads', false);
    expect(run).toHaveBeenCalledOnce();
    expect(isBusy()).toBe(false);
    // Idle again does not run it twice.
    setBusy('uploads', false);
    expect(run).toHaveBeenCalledOnce();
  });

  it('can be cancelled', () => {
    setBusy('uploads', true);
    const run = vi.fn();
    whenIdle(run)();
    setBusy('uploads', false);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('leaving the tab', () => {
  const leave = () => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };

  it('asks first only while something exists only in this tab', () => {
    expect(leave()).toBe(false);
    setUnsaved('board', true);
    setUnsaved('uploads', true);
    setUnsaved('board', false);
    expect(hasUnsaved()).toBe(true);
    expect(leave()).toBe(true);
    setUnsaved('uploads', false);
    expect(hasUnsaved()).toBe(false);
    expect(leave()).toBe(false);
  });
});
