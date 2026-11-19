import { describe, expect, it } from 'vitest';
import {
  clock,
  playerAction,
  playerLayout,
  rungLabel,
  shortSide,
  timecode,
} from './video-player.ts';

describe('video player', () => {
  it('writes the time as m:ss, with hours past the hour', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(2.9)).toBe('0:02');
    expect(clock(725)).toBe('12:05');
    expect(clock(3729)).toBe('1:02:09');
    expect(clock(Number.NaN)).toBe('0:00');
    expect(clock(-3)).toBe('0:00');
  });

  it('writes a timecode with frames, and m:ss without a frame rate', () => {
    expect(timecode(2.5, 25)).toBe('00:00:02:12');
    expect(timecode(6, 25)).toBe('00:00:06:00');
    expect(timecode(3600 + 61 + 23 / 24, 24)).toBe('01:01:01:23');
    expect(timecode(1, 29.97)).toBe('00:00:01:00');
    expect(timecode(2.5, null)).toBe('0:02');
  });

  it('maps the keys of the mockup, frames only while paused', () => {
    const key = (k: string, more: object = {}) => ({ key: k, ...more });
    expect(playerAction(key(' '), false)).toBe('toggle');
    expect(playerAction(key('K'), true)).toBe('toggle');
    expect(playerAction(key('ArrowLeft'), false)).toBe('back5');
    expect(playerAction(key('ArrowRight'), true)).toBe('forward5');
    expect(playerAction(key('j'), false)).toBe('back10');
    expect(playerAction(key('l'), false)).toBe('forward10');
    expect(playerAction(key(','), true)).toBe('previousFrame');
    expect(playerAction(key('.'), true)).toBe('nextFrame');
    expect(playerAction(key(','), false)).toBeNull();
    expect(playerAction(key('ArrowRight', { shiftKey: true }), true)).toBe('nextFrame');
    expect(playerAction(key('ArrowRight', { shiftKey: true }), false)).toBeNull();
    expect(playerAction(key('m'), false)).toBe('mute');
    expect(playerAction(key('f'), false)).toBe('fullscreen');
    expect(playerAction(key('q'), false)).toBe('quality');
    expect(playerAction(key('k', { ctrlKey: true }), false)).toBeNull();
    expect(playerAction(key('g'), true)).toBeNull();
    expect(playerAction(key('Escape'), true)).toBeNull();
  });

  it('a card goes compact under 360 px of its own width; the phone layout needs a phone', () => {
    expect(playerLayout(359, 'card')).toEqual({ compact: true, phone: false });
    expect(playerLayout(360, 'card')).toEqual({ compact: false, phone: false });
    // A card stays a card on a phone.
    expect(playerLayout(359, 'card', true)).toEqual({ compact: true, phone: false });
    // A portrait video on a desktop: narrow, but the desktop controls, fewer of them.
    expect(playerLayout(375, 'viewer')).toEqual({ compact: true, phone: false });
    expect(playerLayout(1280, 'viewer')).toEqual({ compact: false, phone: false });
    // On a phone, whatever the width of the player.
    expect(playerLayout(340, 'viewer', true)).toEqual({ compact: false, phone: true });
    expect(playerLayout(700, 'viewer', true)).toEqual({ compact: false, phone: true });
    // A portrait video in a short phone stage: still the phone layout, with a short row.
    expect(playerLayout(150, 'viewer', true)).toEqual({ compact: true, phone: true });
    // Not measured yet: the full layout.
    expect(playerLayout(0, 'card')).toEqual({ compact: false, phone: false });
  });

  it('names a copy by its short side, as the server names rungs', () => {
    expect(rungLabel(shortSide({ width: 480, height: 854 }))).toBe('480p');
    expect(rungLabel(shortSide({ width: 1920, height: 1080 }))).toBe('1080p');
    expect(rungLabel(shortSide({ width: 3840, height: 2160 }))).toBe('4K');
    expect(rungLabel('720')).toBe('720p');
    expect(shortSide({ height: 720 })).toBe(720);
  });
});
