import {
  DEFAULT_EXPORT_PREFERENCES,
  DEFAULT_PROJECT_THEME,
  type ExportSettings,
} from '@inkadra/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  initialExportState,
  initialImage,
  LogoTimeoutError,
  localePaper,
  logoProblem,
  preferencesPatch,
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

  it('starts from the remembered options, or the defaults, with the content of the open view', () => {
    const fresh: ExportSettings = {
      ...DEFAULT_EXPORT_PREFERENCES,
      logoAssetId: null,
      logo: null,
      theme: DEFAULT_PROJECT_THEME,
      projectColor: 'blue',
      canEdit: true,
      updatedAt: null,
    };
    // Never saved: the defaults, the reader's paper and the project's theme.
    expect(initialExportState(fresh, 'storyboard', undefined, 'en-US')).toEqual({
      format: 'pdf',
      what: 'storyboard',
      framesPerPage: 4,
      paper: 'letter',
      orientation: 'landscape',
      audience: 'client',
      titlePage: true,
      comments: false,
      hideGuestHidden: true,
      approvedOnly: false,
      callSheet: false,
      logo: null,
      theme: { color: 'blue', headingFont: 'inter' },
    });
    // An accent stored before decision 0088 is ignored: the project's colour, the chosen font.
    expect(
      initialExportState(
        { ...fresh, theme: { accent: 'teal', headingFont: 'fraunces' } },
        'storyboard',
        undefined,
        'it-IT',
      ).theme,
    ).toEqual({ color: 'blue', headingFont: 'fraunces' });
    // Settings that could not be read: the same defaults, without logo or theme.
    expect(initialExportState(null, 'canvas', undefined, 'it-IT')).toMatchObject({
      what: 'board',
      paper: 'a4',
      logo: null,
      theme: undefined,
    });
    // Remembered options win, the paper the project chose too; `what` follows the view.
    const saved = { ...fresh, paper: 'slide' as const, audience: 'team' as const, callSheet: true };
    expect(initialExportState(saved, 'shotlist', undefined, 'en-US')).toMatchObject({
      what: 'shotlist',
      paper: 'slide',
      audience: 'team',
      callSheet: true,
    });
    expect(initialExportState(saved, 'shotlist', 'scenesheets', 'it-IT').what).toBe('scenesheets');
    expect(initialExportState(saved, 'schedule', undefined, 'it-IT').what).toBe('storyboard');
  });

  it('sends only what changed, and keeps a null paper when the default was kept', () => {
    const chosen = { ...DEFAULT_EXPORT_PREFERENCES, paper: 'a4' as const };
    expect(preferencesPatch(DEFAULT_EXPORT_PREFERENCES, chosen, 'it-IT')).toEqual({});
    expect(preferencesPatch(DEFAULT_EXPORT_PREFERENCES, chosen, 'en-US')).toEqual({ paper: 'a4' });
    expect(
      preferencesPatch(
        DEFAULT_EXPORT_PREFERENCES,
        { ...chosen, framesPerPage: 6, audience: 'team', callSheet: true },
        'it-IT',
      ),
    ).toEqual({ framesPerPage: 6, audience: 'team', callSheet: true });
  });

  it('starts the picture options from what the project remembers, old rows included', () => {
    // A row saved before #315 has none: a card's menu offers 4:5, the board export the page as is.
    expect(initialImage(DEFAULT_EXPORT_PREFERENCES, true)).toMatchObject({
      format: 'png',
      aspect: '4:5',
      fit: 'fill',
      many: null,
    });
    expect(initialImage(DEFAULT_EXPORT_PREFERENCES, false).aspect).toBe('original');
    expect(initialImage(null, true).format).toBe('png');
    // Rows saved before the colour of the bands, and rows with one, in either case.
    expect(initialImage(DEFAULT_EXPORT_PREFERENCES, true).band).toBe('#000000');
    expect(initialImage({ imageBandColor: '#3a5a7c' }, true).band).toBe('#3A5A7C');
    const remembered = initialImage(
      { ...DEFAULT_EXPORT_PREFERENCES, imageFormat: 'jpeg', imageAspect: '9:16', imageFit: 'fit' },
      true,
    );
    expect(remembered).toMatchObject({ format: 'jpeg', aspect: '9:16', fit: 'fit', foci: {} });
  });

  it('saves the picture options when they change, and a PDF leaves them alone', () => {
    const chosen = { ...DEFAULT_EXPORT_PREFERENCES, paper: 'a4' as const };
    expect(
      preferencesPatch(
        DEFAULT_EXPORT_PREFERENCES,
        {
          ...chosen,
          imageFormat: 'jpeg',
          imageAspect: '4:5',
          imageFit: 'fit',
          imageBandColor: '#FFFFFF',
        },
        'it-IT',
      ),
    ).toEqual({
      imageFormat: 'jpeg',
      imageAspect: '4:5',
      imageFit: 'fit',
      imageBandColor: '#FFFFFF',
    });
    const stored = { ...DEFAULT_EXPORT_PREFERENCES, imageAspect: '4:5' as const };
    expect(preferencesPatch(stored, chosen, 'it-IT')).toEqual({});
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
