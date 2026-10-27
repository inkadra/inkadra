// @vitest-environment happy-dom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MovingPicture, movingVariantUrl } from './moving.tsx';

const variants = [
  { width: 256, url: '/variants/256' },
  { width: 512, url: '/variants/512' },
  { width: 1024, url: '/variants/1024' },
  { width: 2048, url: '/variants/2048' },
];

describe('movingVariantUrl', () => {
  it('asks for the moving copy nearest the width, never above the worker cap', () => {
    const gif = { animated: true, variants };
    expect(movingVariantUrl(gif, 100)).toBe('/variants/256?animated=1');
    expect(movingVariantUrl(gif, 300)).toBe('/variants/512?animated=1');
    expect(movingVariantUrl(gif, 4000)).toBe('/variants/1024?animated=1');
  });

  it('never asks for a moving copy the server did not make', () => {
    // A still picture, an animated WebP past the worker caps, or one whose only variants
    // are wider than the moving copies: no request, no 404.
    expect(movingVariantUrl({ animated: false, variants }, 300)).toBeNull();
    expect(movingVariantUrl({ animated: false, variants: [] }, 300)).toBeNull();
    expect(
      movingVariantUrl({ animated: true, variants: [{ width: 2048, url: '/variants/2048' }] }, 300),
    ).toBeNull();
  });
});

describe('MovingPicture', () => {
  let container: HTMLDivElement;
  let root: Root;
  let reduced = false;
  let probes: FakeImage[] = [];

  /** The off-screen picture the component loads the moving variant with. */
  class FakeImage {
    onload: (() => void) | null = null;
    src = '';
    constructor() {
      probes.push(this);
    }
  }

  const matchMedia = (query: string) =>
    ({
      matches: reduced && query.includes('reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;

  const render = async (node: ReactNode) => act(async () => root.render(node));
  const src = () => container.querySelector('img')?.getAttribute('src');
  const picture = (moving: string | null = '/variants/256?animated=1') => (
    <MovingPicture poster="/variants/256" moving={moving} alt="gatto" />
  );
  const loaded = async () => act(async () => probes.at(-1)?.onload?.());

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('Image', FakeImage);
    reduced = false;
    probes = [];
    window.matchMedia = vi.fn(matchMedia) as unknown as typeof window.matchMedia;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows the poster until the moving variant has loaded, then plays it', async () => {
    await render(picture());
    expect(src()).toBe('/variants/256');
    expect(probes.map((p) => p.src)).toEqual(['/variants/256?animated=1']);

    await loaded();
    expect(src()).toBe('/variants/256?animated=1');
  });

  it('keeps playing the loaded variant until the new size has loaded', async () => {
    await render(picture('/variants/256?animated=1'));
    await loaded();
    expect(src()).toBe('/variants/256?animated=1');

    // The card is zoomed: the poster changes size, the moving variant follows.
    await render(
      <MovingPicture poster="/variants/512" moving="/variants/512?animated=1" alt="gatto" />,
    );
    expect(probes.map((p) => p.src)).toEqual([
      '/variants/256?animated=1',
      '/variants/512?animated=1',
    ]);
    // Still the old animation: no flash of the new poster.
    expect(src()).toBe('/variants/256?animated=1');

    await loaded();
    expect(src()).toBe('/variants/512?animated=1');
  });

  it('drops the loaded variant when the picture itself changes', async () => {
    await render(picture('/variants/256?animated=1'));
    await loaded();

    await render(<MovingPicture poster="/other/256" moving="/other/256?animated=1" alt="cane" />);
    expect(src()).toBe('/other/256');
  });

  it('never asks for the moving variant when motion is reduced', async () => {
    reduced = true;
    await render(picture());
    expect(src()).toBe('/variants/256');
    expect(probes).toHaveLength(0);
  });

  it('keeps the poster when there is no moving variant', async () => {
    await render(picture(null));
    expect(src()).toBe('/variants/256');
    expect(probes).toHaveLength(0);
  });
});
