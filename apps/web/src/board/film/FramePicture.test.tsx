// @vitest-environment happy-dom
import type { Stroke } from '@inkadra/doc-schema';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { FramePicture } from './FramePicture.tsx';
import * as strokes from './strokes.ts';

vi.mock('./strokes.ts', { spy: true });
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const stroke = (id: string): Stroke => ({
  id,
  tool: 'pencil',
  color: '#112233',
  width: 4,
  points: [0, 0, 100, 100],
});

it('draws only the new stroke when one is added to a frame', async () => {
  const first = [stroke('stroke-01'), stroke('stroke-02')];
  const root = createRoot(document.createElement('div'));
  const picture = (list: Stroke[]) => (
    <FramePicture
      assetId={undefined}
      aspect="16:9"
      boardAspect="16:9"
      strokes={list}
      pixels={200}
    />
  );
  await act(async () => root.render(picture(first)));
  expect(strokes.strokePath).toHaveBeenCalledTimes(2);
  // A stroke keeps its object while it lives (decision 0094): the others are not redrawn.
  await act(async () => root.render(picture([...first, stroke('stroke-03')])));
  expect(strokes.strokePath).toHaveBeenCalledTimes(3);
  await act(async () => root.unmount());
});
