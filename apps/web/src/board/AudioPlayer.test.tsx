// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioPlayer, resetAudioPlayers, waveformBars } from './AudioPlayer.tsx';
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

function mount(count = 1, peaks: number[] | null = null) {
  act(() =>
    root.render(
      <>
        {Array.from({ length: count }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed list
          <div key={i} className="card">
            <AudioPlayer
              id={`file_${i}`}
              src={`/a${i}.m4a`}
              name={`nota-${i}.m4a`}
              durationMs={92_000}
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
