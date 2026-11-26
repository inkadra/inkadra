// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioPlayer, PROBE_LIMIT_MS, resetAudioPlayers, waveformBars } from './AudioPlayer.tsx';
import { isPlayingInline, playInline } from './inline-player.ts';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// happy-dom plays nothing: a media element that only tracks paused and fires the events.
const running = new WeakSet<HTMLMediaElement>();
const play = vi.fn(function (this: HTMLMediaElement) {
  running.add(this);
  this.dispatchEvent(new Event('play'));
  return Promise.resolve();
});
const pause = vi.fn(function (this: HTMLMediaElement) {
  if (running.delete(this)) this.dispatchEvent(new Event('pause'));
});

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
    configurable: true,
    get(this: HTMLMediaElement) {
      return !running.has(this);
    },
  });
  HTMLMediaElement.prototype.play = play as unknown as HTMLMediaElement['play'];
  HTMLMediaElement.prototype.pause = pause;
  play.mockClear();
  pause.mockClear();
  resetAudioPlayers();
  playInline(null);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function mount(
  count = 1,
  peaks: number[] | null = null,
  durationMs: number | null = 92_000,
  file = 'a',
) {
  act(() =>
    root.render(
      <>
        {Array.from({ length: count }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed list
          <div key={i} className="card">
            <AudioPlayer
              id={`file_${i}`}
              src={`/${file}${i}.m4a`}
              name={`nota-${i}.m4a`}
              durationMs={durationMs}
              peaks={peaks}
              bars={4}
            />
          </div>
        ))}
      </>,
    ),
  );
  return [...host.querySelectorAll<HTMLDivElement>('.fcard__player')];
}

const button = (player: Element) => player.querySelector('button') as HTMLButtonElement;
const audio = (player: Element) => player.querySelector('audio') as HTMLAudioElement;
const chip = (player: Element) => player.querySelector('.fcard__audio-time')?.textContent;

describe('audio card player', () => {
  it('plays and pauses with the round button, behind a hidden audio element', () => {
    const [player] = mount();
    if (!player) throw new Error('no player');
    expect(audio(player).hidden).toBe(true);
    expect(chip(player)).toBe('0:00 / 1:32');
    expect(button(player).getAttribute('aria-label')).toBe('board.file.play');

    act(() => button(player).click());
    expect(play).toHaveBeenCalledTimes(1);
    expect(button(player).getAttribute('aria-pressed')).toBe('true');
    expect(button(player).getAttribute('aria-label')).toBe('board.file.pause');
    expect(player.classList.contains('is-playing')).toBe(true);

    act(() => button(player).click());
    expect(pause).toHaveBeenCalled();
    expect(button(player).getAttribute('aria-pressed')).toBe('false');
  });

  it('plays one audio at a time on the board', () => {
    const [first, second] = mount(2);
    if (!first || !second) throw new Error('no players');
    act(() => button(first).click());
    act(() => button(second).click());
    expect(audio(first).paused).toBe(true);
    expect(audio(second).paused).toBe(false);
    expect(button(first).getAttribute('aria-pressed')).toBe('false');
    expect(button(second).getAttribute('aria-pressed')).toBe('true');
  });

  it('toggles with Space while focused, without panning the board', () => {
    const [player] = mount();
    if (!player) throw new Error('no player');
    const board = vi.fn();
    window.addEventListener('keydown', board);
    const scrub = player.querySelector<HTMLElement>('[role="slider"]');
    scrub?.focus();
    act(() => {
      scrub?.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    });
    expect(play).toHaveBeenCalledTimes(1);
    act(() => {
      scrub?.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    });
    expect(audio(player).paused).toBe(true);
    expect(board).not.toHaveBeenCalled();
    window.removeEventListener('keydown', board);
  });

  it('scrubs by pointer on the bar and by arrow keys', () => {
    const [player] = mount();
    if (!player) throw new Error('no player');
    const scrub = player.querySelector<HTMLDivElement>('[role="slider"]');
    if (!scrub) throw new Error('no bar');
    scrub.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 200, height: 24, right: 200, bottom: 24 }) as DOMRect;

    act(() => {
      scrub.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, clientX: 100, pointerId: 1 }),
      );
    });
    expect(scrub.getAttribute('aria-valuenow')).toBe('46');
    expect(chip(player)).toBe('0:46 / 1:32');
    expect(audio(player).currentTime).toBe(46);
    expect((player.querySelector('.fcard__scrub-fill') as HTMLElement).style.width).toBe('50%');

    act(() => {
      scrub.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 150 }));
      scrub.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 150 }));
    });
    expect(chip(player)).toBe('1:09 / 1:32');

    act(() => {
      scrub.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });
    expect(chip(player)).toBe('1:04 / 1:32');
    act(() => {
      scrub.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    });
    expect(chip(player)).toBe('1:32 / 1:32');
  });
});

describe('audio card length', () => {
  it('reads the length of a recorded WebM that has none in its header (#26)', () => {
    const [player] = mount(1, null, null);
    if (!player) throw new Error('no player');
    const el = audio(player);
    let duration = Number.POSITIVE_INFINITY;
    Object.defineProperty(el, 'duration', { configurable: true, get: () => duration });
    act(() => {
      el.dispatchEvent(new Event('loadedmetadata'));
    });
    // Seeks past the end so the browser reads the whole file, without showing that time.
    expect(el.currentTime).toBe(Number.MAX_SAFE_INTEGER);
    act(() => {
      el.dispatchEvent(new Event('timeupdate'));
    });
    expect(chip(player)).toBe('0:00');
    duration = 4.2;
    act(() => {
      el.dispatchEvent(new Event('durationchange'));
    });
    expect(el.currentTime).toBe(0);
    expect(chip(player)).toBe('0:00 / 0:05');
    // From here the time moves the bar.
    el.currentTime = 2.1;
    act(() => {
      el.dispatchEvent(new Event('timeupdate'));
    });
    expect(chip(player)).toBe('0:02 / 0:05');
    expect((player.querySelector('.fcard__scrub-fill') as HTMLElement).style.width).toBe('50%');
  });
});

describe('audio card length probe (#26)', () => {
  /** A player whose recording has no length yet, in the middle of the probe. */
  function probing() {
    const [player] = mount(1, null, null);
    if (!player) throw new Error('no player');
    const el = audio(player);
    const state = { duration: Number.POSITIVE_INFINITY };
    Object.defineProperty(el, 'duration', { configurable: true, get: () => state.duration });
    act(() => {
      el.dispatchEvent(new Event('loadedmetadata'));
    });
    expect(el.currentTime).toBe(Number.MAX_SAFE_INTEGER);
    return { player, el, state };
  }

  it('plays from the start when play is pressed during the probe, and keeps playing', () => {
    const { player, el, state } = probing();
    act(() => button(player).click());
    expect(play).toHaveBeenCalledTimes(1);
    expect(el.currentTime).toBe(0);
    // The sound plays on; the length arrives late and does not send it back to 0.
    el.currentTime = 1.5;
    act(() => {
      el.dispatchEvent(new Event('timeupdate'));
    });
    state.duration = 4.2;
    act(() => {
      el.dispatchEvent(new Event('durationchange'));
    });
    expect(el.currentTime).toBe(1.5);
    expect(chip(player)).toBe('0:01 / 0:05');
    expect(audio(player).paused).toBe(false);
  });

  it('keeps a scrub that started during the probe', () => {
    const { player, el, state } = probing();
    const scrub = player.querySelector<HTMLDivElement>('[role="slider"]');
    if (!scrub) throw new Error('no bar');
    scrub.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 200, height: 24, right: 200, bottom: 24 }) as DOMRect;
    act(() => {
      scrub.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, clientX: 50, pointerId: 1 }),
      );
    });
    state.duration = 4;
    act(() => {
      el.dispatchEvent(new Event('durationchange'));
    });
    act(() => {
      scrub.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 100 }));
    });
    expect(el.currentTime).toBe(2);
    // Late events of the probe don't move it either.
    act(() => {
      el.dispatchEvent(new Event('durationchange'));
    });
    expect(el.currentTime).toBe(2);
    expect(chip(player)).toBe('0:02 / 0:04');
  });

  it('ends the probe on a scrub that never gets a length, and applies it if one comes', () => {
    vi.useFakeTimers();
    try {
      const { player, el, state } = probing();
      const scrub = player.querySelector<HTMLDivElement>('[role="slider"]');
      if (!scrub) throw new Error('no bar');
      scrub.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 200, height: 24, right: 200, bottom: 24 }) as DOMRect;
      act(() => {
        scrub.dispatchEvent(
          new PointerEvent('pointerdown', { bubbles: true, clientX: 150, pointerId: 1 }),
        );
        scrub.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 150 }));
      });
      // Back at the place shown, and the time moves again.
      expect(el.currentTime).toBe(0);
      el.currentTime = 0.6;
      act(() => {
        el.dispatchEvent(new Event('timeupdate'));
        vi.advanceTimersByTime(PROBE_LIMIT_MS * 2);
      });
      expect(el.currentTime).toBe(0.6);
      expect(chip(player)).toBe('0:00');
      // A length that comes later takes the sound where the scrub asked: three quarters.
      state.duration = 8;
      act(() => {
        el.dispatchEvent(new Event('durationchange'));
      });
      expect(el.currentTime).toBe(6);
      expect(chip(player)).toBe('0:06 / 0:08');
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up the probe after its time limit and still plays, showing the time alone', () => {
    vi.useFakeTimers();
    try {
      const { player, el } = probing();
      act(() => {
        vi.advanceTimersByTime(PROBE_LIMIT_MS - 1);
      });
      expect(el.currentTime).toBe(Number.MAX_SAFE_INTEGER);
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(el.currentTime).toBe(0);
      expect(chip(player)).toBe('0:00');
      act(() => button(player).click());
      expect(play).toHaveBeenCalledTimes(1);
      expect(el.currentTime).toBe(0);
      el.currentTime = 3.2;
      act(() => {
        el.dispatchEvent(new Event('timeupdate'));
      });
      expect(chip(player)).toBe('0:03');
      const slider = player.querySelector('[role="slider"]');
      // The range ends at the time played and the text says the length is unknown.
      expect(slider?.getAttribute('aria-valuetext')).toBe('board.file.seekUnknown');
      expect(slider?.getAttribute('aria-valuenow')).toBe('3');
      expect(slider?.getAttribute('aria-valuemax')).toBe('3');
      expect(slider?.getAttribute('aria-valuemin')).toBe('0');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps arrow keys pressed during the probe and applies them when the length arrives', () => {
    const { player, el, state } = probing();
    const scrub = player.querySelector<HTMLDivElement>('[role="slider"]');
    if (!scrub) throw new Error('no bar');
    act(() => {
      scrub.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      scrub.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }),
      );
    });
    // The probe ended where the person was.
    expect(el.currentTime).toBe(0);
    state.duration = 20;
    act(() => {
      el.dispatchEvent(new Event('durationchange'));
    });
    expect(el.currentTime).toBe(15);
    expect(chip(player)).toBe('0:15 / 0:20');
  });

  it('drops a key pressed during the probe once the person plays', () => {
    const { player, el, state } = probing();
    const scrub = player.querySelector<HTMLDivElement>('[role="slider"]');
    act(() => {
      scrub?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    });
    act(() => button(player).click());
    el.currentTime = 1;
    state.duration = 20;
    act(() => {
      el.dispatchEvent(new Event('durationchange'));
    });
    expect(el.currentTime).toBe(1);
  });

  it('is not moved by pause or ended events fired by the probe seek', () => {
    const { player, el, state } = probing();
    act(() => {
      el.dispatchEvent(new Event('pause'));
      el.dispatchEvent(new Event('ended'));
    });
    expect(play).not.toHaveBeenCalled();
    expect(button(player).getAttribute('aria-pressed')).toBe('false');
    state.duration = 4.2;
    act(() => {
      el.dispatchEvent(new Event('durationchange'));
    });
    expect(el.currentTime).toBe(0);
    expect(chip(player)).toBe('0:00 / 0:05');
  });

  it('clears the probe timer when the file changes and when the card goes', () => {
    vi.useFakeTimers();
    try {
      const { el } = probing();
      expect(vi.getTimerCount()).toBe(1);
      mount(1, null, null, 'b');
      expect(vi.getTimerCount()).toBe(0);
      // The new file plays on: the old probe's limit never sends it back.
      el.currentTime = 5;
      act(() => {
        vi.advanceTimersByTime(PROBE_LIMIT_MS * 2);
      });
      expect(el.currentTime).toBe(5);

      act(() => root.unmount());
      root = createRoot(host);
      probing();
      expect(vi.getTimerCount()).toBe(1);
      act(() => root.unmount());
      root = createRoot(host);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives the slider its range and time once the length is known', () => {
    const [player] = mount();
    const slider = player?.querySelector('[role="slider"]');
    expect(slider?.getAttribute('aria-valuemin')).toBe('0');
    expect(slider?.getAttribute('aria-valuemax')).toBe('92');
    expect(slider?.getAttribute('aria-valuenow')).toBe('0');
    expect(slider?.getAttribute('aria-valuetext')).toBe('0:00 / 1:32');
  });

  it('does not probe when the server knows the length', () => {
    const [player] = mount();
    if (!player) throw new Error('no player');
    const el = audio(player);
    Object.defineProperty(el, 'duration', { configurable: true, get: () => Infinity });
    act(() => {
      el.dispatchEvent(new Event('loadedmetadata'));
    });
    expect(el.currentTime).toBe(0);
  });
});

describe('audio card waveform (#327)', () => {
  it('groups the stored peaks into as many bars as the card fits', () => {
    expect(waveformBars([10, 50, 20, 80, 0, 30, 90, 40], 4)).toEqual([50, 80, 30, 90]);
    expect(waveformBars([10, 20], 8)).toEqual([10, 20]);
    expect(waveformBars([], 8)).toEqual([]);
  });

  it('draws the played part full and the rest dimmed, scrubbing on the bars', () => {
    const [player] = mount(1, [10, 50, 20, 80, 0, 30, 90, 40]);
    if (!player) throw new Error('no player');
    const scrub = player.querySelector<HTMLDivElement>('[role="slider"]');
    if (!scrub) throw new Error('no bar');
    expect(scrub.classList.contains('fcard__scrub--wave')).toBe(true);
    const bars = [...player.querySelectorAll<HTMLElement>('.fcard__wave i')];
    expect(bars.map((b) => b.style.height)).toEqual(['50%', '80%', '30%', '90%']);
    expect(player.querySelectorAll('.is-played')).toHaveLength(0);
    scrub.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 200, height: 44, right: 200, bottom: 44 }) as DOMRect;
    act(() => {
      scrub.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, clientX: 100, pointerId: 1 }),
      );
    });
    // Half way: the first two bars are played.
    expect(bars.map((b) => b.classList.contains('is-played'))).toEqual([true, true, false, false]);
  });

  it('takes turns with link card videos and the viewer, through the one inline player', () => {
    const [player] = mount();
    if (!player) throw new Error('no player');
    act(() => button(player).click());
    expect(isPlayingInline('file_0')).toBe(true);
    // A link card starts its video: the card stops.
    act(() => playInline('link_1'));
    expect(audio(player).paused).toBe(true);
    expect(button(player).getAttribute('aria-pressed')).toBe('false');
    // The card plays again: the link card loses its turn.
    act(() => button(player).click());
    expect(isPlayingInline('link_1')).toBe(false);
    expect(isPlayingInline('file_0')).toBe(true);
    // Pausing gives the turn back.
    act(() => button(player).click());
    expect(isPlayingInline('file_0')).toBe(false);
  });
});
