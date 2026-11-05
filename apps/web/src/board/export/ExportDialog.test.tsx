// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
import {
  DEFAULT_EXPORT_PREFERENCES,
  DEFAULT_PROJECT_THEME,
  type ExportSettings,
  type ProjectRole,
} from '@inkadra/shared';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import itLocale from '../../i18n/it.json';
import { type ReviewsState, setReviews } from '../review-store.ts';
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

/** A board whose frames are `frames`: only what the dialog reads to recommend a preset. */
function storeWith(...frames: { id: string; approved?: boolean }[]): BoardStore {
  const byId = new Map(frames.map((f) => [f.id, { type: 'frame', parent: null, ...f }]));
  return { getSnapshot: () => ({ byId }) } as unknown as BoardStore;
}

const approvedStore = storeWith({ id: 'f1', approved: true });

const freshSettings: ExportSettings = {
  ...DEFAULT_EXPORT_PREFERENCES,
  logoAssetId: null,
  logo: null,
  theme: DEFAULT_PROJECT_THEME,
  projectColor: 'blue',
  canEdit: true,
  updatedAt: null,
};

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
    setReviews({ reviews: new Map(), reviewsStatus: 'ready' });
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
          store={approvedStore}
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
      '· 16:9 · Orizzontale, PDF, clienti',
    );

    // Open Personalizza and edit an option (enable comments).
    const disclosure = host.querySelector<HTMLButtonElement>('.export__disclosure');
    await act(async () => disclosure?.click());

    const checkOf = (label: string) =>
      [...host.querySelectorAll<HTMLLabelElement>('.export__options .export__check')]
        .find((el) => el.textContent?.startsWith(label))
        ?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    const commentsCheckbox = checkOf('Includi i commenti');
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
      '· 16:9 · Orizzontale, PDF, clienti',
    );
  });

  it('offers 16:9, approved frames only, kickoff summary and call sheet through the presets', async () => {
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
          store={approvedStore}
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
    const checkOf = (label: string) =>
      [...host.querySelectorAll<HTMLLabelElement>('.export__options .export__check')]
        .find((el) => el.textContent?.startsWith(label))
        ?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    const radio = (id: string) =>
      host.querySelector<HTMLInputElement>(`input.export__preset-input[value="${id}"]`);
    const orientation = () => host.querySelector('.export__row fieldset');

    // Client pitch: a 16:9 slide (no orientation to pick), approved frames only, and no
    // kickoff or call sheet, which are for the team.
    expect(host.querySelector('.export__row [role="combobox"]')?.getAttribute('data-value')).toBe(
      'slide',
    );
    expect(orientation()).toBeNull();
    expect(checkOf('Solo inquadrature approvate')?.checked).toBe(true);
    expect(checkOf('Riepilogo kickoff')?.disabled).toBe(true);
    expect(checkOf('Ordine del giorno')?.disabled).toBe(true);
    await act(async () => checkOf('Solo inquadrature approvate')?.click());
    expect(radio('client-pitch')?.checked).toBe(false);
    await act(async () => checkOf('Solo inquadrature approvate')?.click());
    expect(radio('client-pitch')?.checked).toBe(true);

    // Production book: A4 portrait with the call sheet.
    await act(async () => radio('production-book')?.click());
    expect(host.querySelector('.export__row [role="combobox"]')?.getAttribute('data-value')).toBe(
      'a4',
    );
    expect(orientation()).not.toBeNull();
    expect(checkOf('Ordine del giorno')?.checked).toBe(true);
    expect(checkOf('Riepilogo kickoff')?.checked).toBe(false);

    // Internal kickoff: the kickoff summary.
    await act(async () => radio('internal-kickoff')?.click());
    expect(checkOf('Riepilogo kickoff')?.checked).toBe(true);
    expect(checkOf('Ordine del giorno')?.checked).toBe(false);
    await act(async () => checkOf('Riepilogo kickoff')?.click());
    expect(radio('internal-kickoff')?.checked).toBe(false);
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
          store={approvedStore}
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

  const renderStoryboard = (store: BoardStore) =>
    act(async () => {
      root.render(
        <ExportDialog
          source="storyboard"
          store={store}
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
  const checked = () =>
    host.querySelector<HTMLInputElement>('input.export__preset-input:checked')?.value;
  const badged = () =>
    host
      .querySelector('.export__preset-badge')
      ?.closest('.export__preset')
      ?.querySelector<HTMLInputElement>('input')?.value;

  it('recommends the production book from a Storyboard without approved frames, and still allows the pitch', async () => {
    getMock.mockResolvedValue(freshSettings);
    await renderStoryboard(storeWith({ id: 'f1' }, { id: 'f2' }));
    expect(checked()).toBe('production-book');
    expect(badged()).toBe('production-book');
    // Picked by hand, the pitch stays available: its PDF says no frame is approved yet.
    await act(async () =>
      host.querySelector<HTMLInputElement>('input[value="client-pitch"]')?.click(),
    );
    expect(checked()).toBe('client-pitch');
    expect(host.querySelector<HTMLButtonElement>('.export__submit')?.disabled).toBe(false);
  });

  it('recommends the pitch for a frame approved in review, waiting for review statuses to load', async () => {
    getMock.mockResolvedValue(freshSettings);
    setReviews({ reviews: new Map(), reviewsStatus: 'loading' });
    await renderStoryboard(storeWith({ id: 'f1' }));
    // No guess while the statuses are on their way: the presets appear once they are known.
    expect(host.querySelector('.export__preset-input')).toBeNull();
    await act(async () =>
      setReviews({
        reviews: new Map([['f1', { status: 'approved' }]]) as unknown as ReviewsState['reviews'],
        reviewsStatus: 'ready',
      }),
    );
    expect(checked()).toBe('client-pitch');
    expect(badged()).toBe('client-pitch');
  });

  it('recommends without review statuses that never arrive', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      getMock.mockResolvedValue(freshSettings);
      setReviews({ reviews: new Map(), reviewsStatus: 'loading' });
      await renderStoryboard(storeWith({ id: 'f1' }));
      expect(host.querySelector('.export__preset-input')).toBeNull();
      await act(async () => vi.advanceTimersByTime(1500));
      expect(checked()).toBe('production-book');
    } finally {
      vi.useRealTimers();
    }
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
    expect(host.querySelector('.export__custom-body')?.textContent).toContain('whatSelection');
  });

  const renderImage = (
    selection: Set<string>,
    loaded: ExportSettings = freshSettings,
    role: ProjectRole | null = 'editor',
  ) => {
    getMock.mockResolvedValue(loaded);
    return act(async () => {
      root.render(
        <ExportDialog
          source="canvas"
          initialWhat="selection"
          imageEntry
          store={{ getSnapshot: () => ({ byId: new Map() }) } as unknown as BoardStore}
          projectId="p1"
          boardId="b1"
          projectName="Spot Lagunc"
          boardTitle="Canvas"
          boards={null}
          selection={selection}
          visible={null}
          role={role}
          onClose={() => {}}
        />,
      );
    });
  };
  const radio = (name: string) =>
    [...host.querySelectorAll<HTMLLabelElement>('.ink-radio-group__option, .ink-tile')]
      .find((el) => el.textContent?.trim() === name)
      ?.querySelector<HTMLInputElement>('input');

  it('opens a picture from a menu on the image options, with no presets', async () => {
    await renderImage(new Set(['a']));
    expect(radio('PNG')?.checked).toBe(true);
    expect(radio('4:5')?.checked).toBe(true);
    expect(radio('Riempi')?.checked).toBe(true);
    expect(host.querySelector('.export__preset-input')).toBeNull();
    expect(host.textContent).toContain('I preset 1–3 sono documenti PDF');
    // One card: no choice of how many images.
    expect(radio('Una per card')).toBeUndefined();
    await act(async () => radio('PDF')?.click());
    expect(host.querySelector('.export__preset-input')).not.toBeNull();
    expect(host.textContent).not.toContain('I preset 1–3 sono documenti PDF');
  });

  it('defaults to one image per card with a social format, and to one picture with Original', async () => {
    await renderImage(new Set(['a', 'b']));
    expect(radio('Una per card')?.checked).toBe(true);
    await act(async () => radio('Originale')?.click());
    expect(radio('Una sola')?.checked).toBe(true);
    // "Original" has no bands and nothing to fit.
    expect(radio('Contieni')).toBeUndefined();
    expect(radio('Nero')).toBeUndefined();
    await act(async () => radio('1:1')?.click());
    expect(radio('Una per card')?.checked).toBe(true);
    // A choice made by hand stays, whatever the shape.
    await act(async () => radio('Una sola')?.click());
    await act(async () => radio('16:9')?.click());
    expect(radio('Una sola')?.checked).toBe(true);
  });

  it('offers the colour of the bands with Fit only, black until the project remembers one', async () => {
    await renderImage(new Set(['a']));
    expect(radio('Nero')).toBeUndefined();
    await act(async () => radio('Contieni')?.click());
    expect(radio('Nero')?.checked).toBe(true);
    await act(async () => radio('Bianco')?.click());
    expect(radio('Bianco')?.checked).toBe(true);
    expect(host.querySelector('.colorpicker')).toBeNull();
    await act(async () => radio('Colore…')?.click());
    expect(radio('Colore…')?.checked).toBe(true);
    expect(host.querySelector('.colorpicker')).not.toBeNull();
    await act(async () => radio('Riempi')?.click());
    expect(radio('Nero')).toBeUndefined();
  });

  it('starts on a colour the project remembers, as Colore…', async () => {
    await renderImage(new Set(['a']), {
      ...freshSettings,
      imageAspect: '9:16',
      imageFit: 'fit',
      imageBandColor: '#3a5a7c',
      updatedAt: '2026-10-01T12:00:00.000Z',
    });
    expect(radio('Colore…')?.checked).toBe(true);
  });

  it('offers the original file with Original only, without format, fit or bands', async () => {
    await renderImage(new Set(['a']));
    expect(radio('File originale')).toBeUndefined();
    await act(async () => radio('Originale')?.click());
    expect(radio('Anteprima')?.checked).toBe(true);
    expect(host.textContent).toContain("Un'immagine ridotta, senza metadati.");
    await act(async () => radio('File originale')?.click());
    expect(radio('File originale')?.checked).toBe(true);
    expect(radio('PNG')).toBeUndefined();
    expect(radio('JPEG')).toBeUndefined();
    expect(radio('Contieni')).toBeUndefined();
    // Not a remembered choice: the footer's note about it goes too.
    expect(host.querySelector('.export__remembered')).toBeNull();
    expect(host.querySelector('.export__field--warn')).not.toBeNull();
  });

  it('starts on Anteprima every time the dialog opens', async () => {
    await renderImage(new Set(['a']));
    await act(async () => radio('Originale')?.click());
    await act(async () => radio('File originale')?.click());
    expect(radio('File originale')?.checked).toBe(true);
    await act(async () => root.unmount());
    root = createRoot(host);
    await renderImage(new Set(['a']));
    await act(async () => radio('Originale')?.click());
    expect(radio('Anteprima')?.checked).toBe(true);
    expect(patchMock).not.toHaveBeenCalled();
  });

  it('disables the original file for people who can only view, and says why', async () => {
    for (const role of ['viewer', null] as const) {
      await renderImage(new Set(['a']), freshSettings, role);
      await act(async () => radio('Originale')?.click());
      expect(radio('File originale')?.disabled).toBe(true);
      expect(radio('Anteprima')?.checked).toBe(true);
      expect(host.textContent).toContain('solo guardare non può scaricare');
    }
    await renderImage(new Set(['a']), freshSettings, 'commenter');
    expect(radio('File originale')?.disabled).toBe(false);
  });

  it('starts from the picture options the project remembers', async () => {
    await renderImage(new Set(['a']), {
      ...freshSettings,
      imageFormat: 'jpeg',
      imageAspect: '9:16',
      imageFit: 'fit',
      updatedAt: '2026-10-01T12:00:00.000Z',
    });
    expect(radio('JPEG')?.checked).toBe(true);
    expect(radio('9:16')?.checked).toBe(true);
    expect(radio('Contieni')?.checked).toBe(true);
    // The use comes from a key without a colon, which i18next would read as a namespace.
    expect(host.textContent).toContain('Storia e video verticale · 1080 × 1920 px');
  });
});
