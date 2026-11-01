import {
  DEFAULT_EXPORT_PREFERENCES,
  DEFAULT_PROJECT_THEME,
  type ExportSettings,
} from '@inkadra/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  initialExportState,
  LogoTimeoutError,
  localePaper,
  logoProblem,
  matchesPreset,
  preferencesPatch,
  presetChoices,
  presetNumber,
  recommendedPreset,
  uploadLogo,
} from './settings.ts';

// The upload panel already holds this file: it resumes that upload and never calls onAsset.
vi.mock('../uploads.ts', () => ({ startUpload: vi.fn(() => 'u1') }));

describe('export settings on the client', () => {
  it('reads a null paper as the reader’s own default', () => {
    expect(localePaper('en-US')).toBe('letter');
    expect(localePaper('fr-CA')).toBe('letter');
    expect(localePaper('it-IT')).toBe('a4');
    expect(localePaper('en-GB')).toBe('a4');
  });

  it('recommends a preset for the open view', () => {
    expect(recommendedPreset('storyboard')).toBe('client-pitch');
    expect(recommendedPreset('shotlist')).toBe('production-book');
    expect(recommendedPreset('schedule')).toBe('internal-kickoff');
    expect(recommendedPreset('canvas')).toBe('client-pitch');
    expect(presetNumber('client-pitch')).toBe(1);
    expect(presetNumber('production-book')).toBe(2);
    expect(presetNumber('internal-kickoff')).toBe(3);
  });

  it('maps each preset to existing export options and detects manual edits', () => {
    const pitch = presetChoices('client-pitch', 'storyboard', undefined, 'it-IT');
    expect(pitch).toEqual({
      format: 'pdf',
      what: 'storyboard',
      framesPerPage: 1,
      paper: 'a4',
      orientation: 'landscape',
      audience: 'client',
      titlePage: true,
      comments: false,
      hideGuestHidden: true,
    });
    expect(matchesPreset(pitch, 'client-pitch', 'storyboard', 'it-IT')).toBe(true);
    expect(
      matchesPreset({ ...pitch, framesPerPage: 4 }, 'client-pitch', 'storyboard', 'it-IT'),
    ).toBe(false);

    const book = presetChoices('production-book', 'storyboard', undefined, 'en-US');
    expect(book).toEqual({
      format: 'pdf',
      what: 'shotlist',
      framesPerPage: 4,
      paper: 'a4',
      orientation: 'portrait',
      audience: 'team',
      titlePage: true,
      comments: false,
      hideGuestHidden: false,
    });
    expect(matchesPreset(book, 'production-book', 'storyboard', 'en-US')).toBe(true);

    const kickoff = presetChoices('internal-kickoff', 'schedule', undefined, 'it-IT');
    expect(kickoff).toEqual({
      format: 'pdf',
      what: 'storyboard',
      framesPerPage: 4,
      paper: 'a4',
      orientation: 'landscape',
      audience: 'team',
      titlePage: true,
      comments: true,
      hideGuestHidden: false,
    });
    expect(matchesPreset(kickoff, 'internal-kickoff', 'schedule', 'it-IT')).toBe(true);

    // On a regular canvas board, presets keep the user's scope and matchesPreset ignores what.
    const canvasSel = presetChoices('production-book', 'canvas', 'selection', 'it-IT');
    expect(canvasSel.what).toBe('selection');
    expect(
      matchesPreset({ ...canvasSel, what: 'visible' }, 'production-book', 'canvas', 'it-IT'),
    ).toBe(true);

    // A stored explicit 'a4' with client-pitch still matches for a US-locale reader.
    expect(
      matchesPreset({ ...pitch, paper: 'a4' }, 'client-pitch', 'storyboard', 'en-US', 'a4'),
    ).toBe(true);
    expect(
      matchesPreset({ ...pitch, paper: 'letter' }, 'client-pitch', 'storyboard', 'en-US', 'a4'),
    ).toBe(true);
  });

  it('chooses the initial preset from remembered settings and view compatibility', () => {
    const baseSettings: ExportSettings = {
      ...DEFAULT_EXPORT_PREFERENCES,
      logoAssetId: null,
      logo: null,
      theme: DEFAULT_PROJECT_THEME,
      projectColor: 'blue',
      canEdit: true,
      updatedAt: '2026-10-01T12:00:00.000Z',
    };
    // A project that only uploaded a logo (preset is null, default preferences) selects recommended and keeps Personalizza closed.
    const logoOnly = initialExportState(baseSettings, 'storyboard', undefined, 'it-IT');
    expect(logoOnly.basePreset).toBe('client-pitch');
    expect(logoOnly.customOpen).toBe(false);
    expect(logoOnly.req.theme).toEqual({ color: 'blue', headingFont: 'inter' });
    expect(
      matchesPreset(logoOnly.req, logoOnly.basePreset, 'storyboard', 'it-IT', baseSettings.paper),
    ).toBe(true);

    // Remembered preset whose content does not match the open view falls back to the view's recommended preset.
    const mismatch = initialExportState(
      { ...baseSettings, preset: 'client-pitch', framesPerPage: 1 },
      'shotlist',
      undefined,
      'it-IT',
    );
    expect(mismatch.basePreset).toBe('production-book');
    expect(mismatch.req.what).toBe('shotlist');
    expect(mismatch.customOpen).toBe(false);

    // Remembered preset whose content matches the open view is restored.
    const remembered = initialExportState(
      {
        ...baseSettings,
        preset: 'internal-kickoff',
        framesPerPage: 4,
        audience: 'team',
        comments: true,
        hideGuestHidden: false,
      },
      'storyboard',
      undefined,
      'it-IT',
    );
    expect(remembered.basePreset).toBe('internal-kickoff');
    expect(remembered.customOpen).toBe(false);

    // Custom preferences that match no preset open Personalizza automatically.
    const custom = initialExportState(
      { ...baseSettings, preset: null, framesPerPage: 2 },
      'storyboard',
      undefined,
      'it-IT',
    );
    expect(custom.customOpen).toBe(true);
    expect(
      matchesPreset(custom.req, custom.basePreset, 'storyboard', 'it-IT', baseSettings.paper),
    ).toBe(false);
  });

  it('sends only what changed, including the remembered preset, and keeps a null paper when the default was kept', () => {
    const chosen = { ...DEFAULT_EXPORT_PREFERENCES, paper: 'a4' as const };
    expect(preferencesPatch(DEFAULT_EXPORT_PREFERENCES, chosen, 'it-IT')).toEqual({});
    expect(preferencesPatch(DEFAULT_EXPORT_PREFERENCES, chosen, 'en-US')).toEqual({ paper: 'a4' });
    expect(
      preferencesPatch(
        DEFAULT_EXPORT_PREFERENCES,
        { ...chosen, preset: 'production-book', framesPerPage: 6, audience: 'team' },
        'it-IT',
      ),
    ).toEqual({ preset: 'production-book', framesPerPage: 6, audience: 'team' });
    expect(
      preferencesPatch(
        { ...DEFAULT_EXPORT_PREFERENCES, preset: 'production-book' },
        { ...chosen, preset: null },
        'it-IT',
      ),
    ).toEqual({ preset: null });
  });

  it('accepts small PNG and JPEG logos only', () => {
    expect(logoProblem({ type: 'image/png', size: 1000 })).toBeNull();
    expect(logoProblem({ type: 'image/jpeg', size: 512 * 1024 })).toBeNull();
    expect(logoProblem({ type: 'image/svg+xml', size: 1000 })).toBe('type');
    expect(logoProblem({ type: 'image/webp', size: 1000 })).toBe('type');
    expect(logoProblem({ type: 'image/png', size: 512 * 1024 + 1 })).toBe('size');
  });
});

describe('uploadLogo', () => {
  it('gives up with a timeout instead of waiting for ever', async () => {
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'logo.png', {
      type: 'image/png',
    });
    await expect(uploadLogo(file, 'p1', 'b1', 20)).rejects.toBeInstanceOf(LogoTimeoutError);
  });
});
