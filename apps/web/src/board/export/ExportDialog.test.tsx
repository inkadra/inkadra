// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
import {
  DEFAULT_EXPORT_PREFERENCES,
  DEFAULT_PROJECT_THEME,
  type ExportSettings,
} from '@inkadra/shared';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import itLocale from '../../i18n/it.json';
import type { BoardStore } from '../store.ts';
import { ExportDialog } from './ExportDialog.tsx';

function lookup(key: string, vars?: Record<string, unknown>): string {
  const raw = key
    .split('.')
    .reduce<unknown>(
      (acc, part) =>
        acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined,
      itLocale,
    );
  if (typeof raw !== 'string') return key;
  return raw.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(vars?.[k] ?? ''));
}

const i18nState = vi.hoisted(() => ({
  t: (key: string, vars?: Record<string, unknown>) => lookup(key, vars),
  i18n: { language: 'it-IT' },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => i18nState,
}));

const getMock = vi.hoisted(() => vi.fn<() => Promise<ExportSettings>>());
const patchMock = vi.hoisted(() => vi.fn<() => Promise<ExportSettings>>());

vi.mock('../../lib/api.ts', () => ({
  api: {
    get: getMock,
    patch: patchMock,
  },
}));

describe('ExportDialog preset state and customization', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    getMock.mockReset();
    patchMock.mockReset();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('deselects the preset and shows "modifichi il preset N" when an option is edited, and restores the preset when reverted', async () => {
    getMock.mockResolvedValue({
      ...DEFAULT_EXPORT_PREFERENCES,
      logoAssetId: null,
      logo: null,
      theme: DEFAULT_PROJECT_THEME,
      projectColor: 'blue',
      canEdit: true,
      updatedAt: null,
    });

    await act(async () => {
      root.render(
        <ExportDialog
          source="storyboard"
          store={{} as BoardStore}
          projectId="p1"
          boardId="b1"
          projectName="Spot Lagunc"
          boardTitle="Storyboard"
          boards={null}
          selection={new Set()}
          visible={null}
          onClose={() => {}}
        />,
      );
    });

    const dialog = host.querySelector('dialog');
    expect(dialog?.querySelector('.ink-dialog__title')?.textContent).toBe('Esporta «Spot Lagunc»');
    expect(host.querySelector('.export__remembered')?.textContent).toBe(
      'Ricordato per questo progetto',
    );

    const pitchRadio = host.querySelector<HTMLInputElement>(
      'input.export__preset-input[value="client-pitch"]',
    );
    expect(pitchRadio?.checked).toBe(true);
    expect(host.querySelector('.export__disclosure-note')?.textContent).toBe(
      '· A4 orizzontale, PDF, clienti',
    );

    // Open Personalizza and edit an option (enable comments).
    const disclosure = host.querySelector<HTMLButtonElement>('.export__disclosure');
    await act(async () => disclosure?.click());

    const checkboxes = [
      ...host.querySelectorAll<HTMLInputElement>('.export__options input[type="checkbox"]'),
    ];
    const commentsCheckbox = checkboxes.at(-1);
    expect(commentsCheckbox?.checked).toBe(false);

    await act(async () => commentsCheckbox?.click());
    expect(commentsCheckbox?.checked).toBe(true);
    expect(pitchRadio?.checked).toBe(false);
    expect(host.querySelector('.export__disclosure-note')?.textContent).toBe(
      '· modifichi il preset 1',
    );

    // Close Personalizza while modified: still shows "modifichi il preset 1".
    await act(async () => disclosure?.click());
    expect(host.querySelector('.export__disclosure-note')?.textContent).toBe(
      '· modifichi il preset 1',
    );

    // Reopen and revert the edited option: preset comes back.
    await act(async () => disclosure?.click());
    await act(async () => commentsCheckbox?.click());
    expect(commentsCheckbox?.checked).toBe(false);
    expect(pitchRadio?.checked).toBe(true);

    await act(async () => disclosure?.click());
    expect(host.querySelector('.export__disclosure-note')?.textContent).toBe(
      '· A4 orizzontale, PDF, clienti',
    );
  });

  it('waits for settings before offering presets and restores the remembered value without early clicks', async () => {
    let resolveSettings!: (settings: ExportSettings) => void;
    getMock.mockReturnValue(
      new Promise((resolve) => {
        resolveSettings = resolve;
      }),
    );
    await act(async () => {
      root.render(
        <ExportDialog
          source="storyboard"
          store={{} as BoardStore}
          projectId="p1"
          boardId="b1"
          projectName="Spot Lagunc"
          boardTitle="Storyboard"
          boards={null}
          selection={new Set()}
          visible={null}
          onClose={() => {}}
        />,
      );
    });
    expect(host.querySelector('.export__preset-input')).toBeNull();
    expect(host.querySelector<HTMLButtonElement>('.export__submit')?.disabled).toBe(true);
    await act(async () =>
      resolveSettings({
        ...DEFAULT_EXPORT_PREFERENCES,
        preset: 'internal-kickoff',
        audience: 'team',
        comments: true,
        hideGuestHidden: false,
        logoAssetId: null,
        logo: null,
        theme: DEFAULT_PROJECT_THEME,
        projectColor: 'blue',
        canEdit: true,
        updatedAt: '2026-10-01T12:00:00.000Z',
      }),
    );
    expect(host.querySelector<HTMLInputElement>('input[value="internal-kickoff"]')?.checked).toBe(
      true,
    );
    expect(host.querySelector<HTMLInputElement>('input[value="client-pitch"]')?.checked).toBe(
      false,
    );
    expect(host.querySelector('.export__disclosure')?.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector<HTMLButtonElement>('.export__submit')?.disabled).toBe(false);
  });

  it('hides "Ricordato per questo progetto" when the user cannot edit project settings and preserves canvas scope across presets', async () => {
    getMock.mockResolvedValue({
      ...DEFAULT_EXPORT_PREFERENCES,
      logoAssetId: null,
      logo: null,
      theme: DEFAULT_PROJECT_THEME,
      projectColor: 'blue',
      canEdit: false,
      updatedAt: null,
    });

    await act(async () => {
      root.render(
        <ExportDialog
          source="canvas"
          initialWhat="selection"
          store={{} as BoardStore}
          projectId="p1"
          boardId="b1"
          projectName="Spot Lagunc"
          boardTitle="Canvas"
          boards={null}
          selection={new Set(['el-1', 'el-2'])}
          visible={null}
          onClose={() => {}}
        />,
      );
    });

    expect(host.querySelector('.export__remembered')).toBeNull();

    // Pick preset 2 (Libro di produzione) on a canvas board: scope stays "selection".
    const bookRadio = host.querySelector<HTMLInputElement>(
      'input.export__preset-input[value="production-book"]',
    );
    await act(async () => bookRadio?.click());
    expect(bookRadio?.checked).toBe(true);
  });
});
