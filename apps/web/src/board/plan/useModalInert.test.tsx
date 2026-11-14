// @vitest-environment happy-dom
import { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { useModalInert } from './useModalInert.ts';

function Modal() {
  const ref = useRef<HTMLDivElement>(null);
  useModalInert(ref);
  return <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" />;
}

it('makes the app inert while mounted, takes the focus and gives both back', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const app = document.createElement('div');
  app.id = 'root';
  const opener = document.createElement('button');
  app.append(opener);
  const portal = document.createElement('div');
  document.body.append(app, portal);
  opener.focus();
  const root = createRoot(portal);
  await act(async () => root.render(<Modal />));
  expect(app.inert).toBe(true);
  expect(document.activeElement).toBe(portal.querySelector('[role="dialog"]'));
  await act(async () => root.unmount());
  expect(app.inert).toBe(false);
  expect(document.activeElement).toBe(opener);
});
