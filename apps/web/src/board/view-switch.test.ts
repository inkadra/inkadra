// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { beginViewSwitch, switchDirection } from './view-switch.ts';

const direction = () => document.documentElement.dataset.viewDirection;

function reducedMotion(matches: boolean) {
  vi.stubGlobal('matchMedia', () => ({ matches }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.viewDirection;
});

describe('switchDirection', () => {
  it('follows the order of the tabs', () => {
    expect(switchDirection('canvas', 'storyboard')).toBe('forward');
    expect(switchDirection('moodboard', 'shotlist')).toBe('back');
  });

  it('is null without a switch', () => {
    expect(switchDirection('review', 'review')).toBeNull();
    expect(switchDirection(null, 'review')).toBeNull();
  });
});

describe('beginViewSwitch', () => {
  it('asks for a transition and sets its direction', () => {
    reducedMotion(false);
    expect(beginViewSwitch('schedule', 'storyboard')).toEqual({ viewTransition: true });
    expect(direction()).toBe('back');
  });

  it('leaves first load and the open tab alone', () => {
    reducedMotion(false);
    expect(beginViewSwitch(null, 'canvas')).toEqual({});
    expect(beginViewSwitch('canvas', 'canvas')).toEqual({});
    expect(direction()).toBeUndefined();
  });

  it('is instant with reduced motion', () => {
    reducedMotion(true);
    expect(beginViewSwitch('canvas', 'storyboard')).toEqual({});
    expect(direction()).toBeUndefined();
  });

  it('forgets the direction on back and forward', () => {
    reducedMotion(false);
    beginViewSwitch('canvas', 'storyboard');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(direction()).toBeUndefined();
  });
});
