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
import { setReviews } from '../review-store.ts';
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

/** A board whose frames are `frames`: only what the dialog reads from it here. */
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

describe('ExportDialog options', () => {
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

  const renderStoryboard = () =>
    act(async () => {
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
  const paper = () =>
    host.querySelector('.export__row [role="combobox"]')?.getAttribute('data-value');

  it('shows the PDF options straight away, with no presets and no kickoff summary', async () => {
    getMock.mockResolvedValue(freshSettings);
    await renderStoryboard();

    const dialog = host.querySelector('dialog');
    expect(dialog?.querySelector('.ink-dialog__title')?.textContent).toBe('Esporta «Spot Lagunc»');
    expect(host.querySelector('.export__remembered')?.textContent).toBe(
      'Ricordato per questo progetto',
    );
    expect(host.querySelector('input[type="radio"][value="client-pitch"]')).toBeNull();
    expect(host.textContent).not.toContain('Personalizza');
    expect(host.textContent).not.toContain('Consigliato');
    expect(host.textContent).not.toContain('Riepilogo kickoff');

    // The defaults of a project that never saved any: A4 landscape for the client.
    const options = host.querySelector<HTMLElement>('.export__pdf-options');
    expect(options?.hidden).toBe(false);
    expect(paper()).toBe('a4');
    expect(checkOf('Copertina')?.checked).toBe(true);
    expect(checkOf('Solo inquadrature approvate')?.checked).toBe(false);
    expect(checkOf('Ordine del giorno')?.disabled).toBe(true);

    // Every option is a direct choice.
    await act(async () => checkOf('Solo inquadrature approvate')?.click());
    expect(checkOf('Solo inquadrature approvate')?.checked).toBe(true);
    const team = [...host.querySelectorAll<HTMLLabelElement>('.ink-radio-group__option')]
      .find((el) => el.textContent?.trim() === 'Il team')
      ?.querySelector<HTMLInputElement>('input');
    await act(async () => team?.click());
    expect(checkOf('Ordine del giorno')?.disabled).toBe(false);
    await act(async () => checkOf('Ordine del giorno')?.click());
    expect(checkOf('Ordine del giorno')?.checked).toBe(true);
  });

  it('waits for settings and starts from the options the project remembers', async () => {
    let resolveSettings!: (settings: ExportSettings) => void;
    getMock.mockReturnValue(
      new Promise((resolve) => {
        resolveSettings = resolve;
      }),
    );
    await renderStoryboard();
    expect(host.querySelector('.export__pdf-options')).toBeNull();
    expect(host.querySelector<HTMLButtonElement>('.export__submit')?.disabled).toBe(true);
    await act(async () =>
      resolveSettings({
        ...freshSettings,
        paper: 'slide',
        audience: 'team',
        approvedOnly: true,
        callSheet: true,
        hideGuestHidden: false,
        updatedAt: '2026-10-01T12:00:00.000Z',
      }),
    );
    expect(paper()).toBe('slide');
    expect(checkOf('Solo inquadrature approvate')?.checked).toBe(true);
    expect(checkOf('Ordine del giorno')?.checked).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('.export__submit')?.disabled).toBe(false);
  });

  it('hides "Ricordato per questo progetto" from readers who cannot edit, and keeps the canvas scope', async () => {
    getMock.mockResolvedValue({ ...freshSettings, canEdit: false });

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
    expect(host.querySelector('.export__pdf-options')?.textContent).toContain('whatSelection');
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

  it('opens a picture from a menu on the image options', async () => {
    await renderImage(new Set(['a']));
    expect(radio('PNG')?.checked).toBe(true);
    expect(radio('4:5')?.checked).toBe(true);
    expect(radio('Riempi')?.checked).toBe(true);
    expect(host.querySelector('.export__pdf-options')).toBeNull();
    // One card: no choice of how many images.
    expect(radio('Una per card')).toBeUndefined();
    await act(async () => radio('PDF')?.click());
    expect(host.querySelector('.export__pdf-options')).not.toBeNull();
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

describe('ExportDialog scene sheets', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    getMock.mockReset();
    setReviews({ reviews: new Map(), reviewsStatus: 'ready' });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('offers the department and the scenes', async () => {
    // happy-dom has no popover: the list opens in place.
    HTMLElement.prototype.showPopover ??= () => {};
    HTMLElement.prototype.hidePopover ??= () => {};
    const schedule = {
      items: [
        { id: 'd2', date: '2026-11-18', blocks: [{ shotId: 'f1' }] },
        { id: 'd1', date: '2026-11-17', blocks: [] },
      ],
    };
    getMock.mockImplementation(((url: string) =>
      Promise.resolve(url.includes('/schedule') ? schedule : freshSettings)) as never);
    const byId = new Map<string, object>([
      ['s1', { id: 's1', type: 'scene', number: '1', parent: null }],
      ['f1', { id: 'f1', type: 'frame', parent: 's1' }],
    ]);
    const store = { getSnapshot: () => ({ byId }) } as unknown as BoardStore;
    await act(async () => {
      root.render(
        <ExportDialog
          source="shotlist"
          initialWhat="scenesheets"
          store={store}
          projectId="p1"
          boardId="b1"
          projectName="La lunga notte"
          boardTitle="Storyboard"
          boards={null}
          selection={new Set(['f1'])}
          visible={null}
          onClose={() => {}}
        />,
      );
    });
    const radios = [...host.querySelectorAll<HTMLInputElement>('.export__radio input')];
    expect(radios.map((r) => r.value)).toEqual([
      'everything',
      'camera',
      'lighting',
      'costume',
      'production',
    ]);
    expect(radios[0]?.checked).toBe(true);
    expect(host.querySelector('.export__departments legend')?.textContent).toBe('RepartoNuovo');
    await act(async () => radios[1]?.click());
    expect(radios[1]?.checked).toBe(true);

    const scenes = [...host.querySelectorAll('.export__departments + .export__field')].at(0);
    const trigger = scenes?.querySelector<HTMLButtonElement>('[role="combobox"]');
    expect(trigger?.getAttribute('data-value')).toBe('all');
    await act(async () => trigger?.click());
    const options = [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent);
    // All, the selection, then the shooting days in date order.
    expect(options).toHaveLength(4);
    expect(options.slice(0, 2)).toEqual(['Tutte le scene', 'Scene selezionate']);
    expect(getMock).toHaveBeenCalledWith('/boards/b1/schedule');
  });
});
