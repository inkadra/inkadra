// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
import type { HocuspocusProvider } from '@hocuspocus/provider';
import type { BoardVersion } from '@inkadra/shared';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BoardStore } from './store.ts';
import { VersionsDialog } from './VersionsDialog.tsx';

const translations = vi.hoisted(() => {
  const t = (key: string) => key;
  return { t, i18n: { language: 'it-IT' } };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => translations,
}));

vi.mock('../lib/api.ts', () => ({
  api: { get: vi.fn(async () => ({ items: [], nextCursor: null })) },
}));

const version = {
  id: 'version-1',
  boardId: 'board-1',
  kind: 'named',
  name: 'Taglio approvato',
  createdBy: null,
  createdAt: '2026-10-26T10:00:00.000Z',
  size: 10,
  elementCount: 3,
  docSchemaVersion: 4,
  expiresAt: null,
} as unknown as BoardVersion;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function render(open: boolean) {
  const onPreview = vi.fn();
  const onClose = vi.fn();
  await act(async () =>
    root.render(
      <VersionsDialog
        open={open}
        boardId="board-1"
        provider={{ on: vi.fn(), off: vi.fn() } as unknown as HocuspocusProvider}
        onClose={onClose}
        preview={{ version, store: {} as BoardStore }}
        onPreview={onPreview}
        onRestored={vi.fn()}
      />,
    ),
  );
  return { onPreview, onClose };
}

function pressEscape() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

it('leaves the preview when Escape lands before the panel commits as closed', async () => {
  const { onPreview } = await render(true);
  const panel = host.querySelector('dialog');
  expect(panel?.open).toBe(true);
  // The browser closes the panel's dialog on Escape at once, while React renders the closed panel
  // a frame later: a second Escape in that gap must still leave the preview.
  await act(async () => panel?.close());
  await act(async () => pressEscape());
  expect(onPreview).toHaveBeenCalledExactlyOnceWith(null);
});

it('lets the open panel take Escape instead of the preview', async () => {
  const { onPreview } = await render(true);
  await act(async () => pressEscape());
  expect(onPreview).not.toHaveBeenCalled();
});

it('lets a confirmation opened from the banner take Escape instead of the preview', async () => {
  const { onPreview } = await render(false);
  const restore = [...host.querySelectorAll('button')].find(
    (button) => button.textContent === 'versions.restore',
  );
  await act(async () => restore?.click());
  expect([...host.querySelectorAll('dialog')].some((dialog) => dialog.open)).toBe(true);
  await act(async () => pressEscape());
  expect(onPreview).not.toHaveBeenCalled();
});
