// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXPORT_PREFERENCES,
  DEFAULT_PROJECT_THEME,
  ExportPreferences,
  ExportSettings,
  UpdateExportSettings,
} from './export-settings.ts';

describe('export settings contract', () => {
  it('has defaults that parse, safe for clients', () => {
    expect(ExportPreferences.parse(DEFAULT_EXPORT_PREFERENCES)).toEqual(DEFAULT_EXPORT_PREFERENCES);
    expect(DEFAULT_EXPORT_PREFERENCES.audience).toBe('client');
    expect(DEFAULT_EXPORT_PREFERENCES.comments).toBe(false);
  });

  it('accepts only 1, 2, 4 or 6 frames a page', () => {
    for (const n of [1, 2, 4, 6])
      expect(UpdateExportSettings.safeParse({ framesPerPage: n }).success).toBe(true);
    for (const n of [0, 3, 8, '4'])
      expect(UpdateExportSettings.safeParse({ framesPerPage: n }).success).toBe(false);
  });

  it('takes partial updates, a preset, a logo or its removal, and nothing unknown', () => {
    expect(UpdateExportSettings.parse({})).toEqual({});
    expect(
      UpdateExportSettings.parse({ preset: 'client-pitch', paper: null, logoAssetId: null }),
    ).toEqual({
      preset: 'client-pitch',
      paper: null,
      logoAssetId: null,
    });
    expect(UpdateExportSettings.parse({ preset: null })).toEqual({ preset: null });
    expect(UpdateExportSettings.safeParse({ preset: 'unknown' }).success).toBe(false);
    expect(UpdateExportSettings.safeParse({ logoAssetId: 'not-an-id' }).success).toBe(false);
    expect(UpdateExportSettings.safeParse({ logo: {} }).success).toBe(false);
    expect(UpdateExportSettings.safeParse({ audience: 'everyone' }).success).toBe(false);
  });

  it('adds the 16:9 page and the approved, kickoff and call sheet options, off by default', () => {
    expect(UpdateExportSettings.parse({ paper: 'slide' })).toEqual({ paper: 'slide' });
    expect(
      UpdateExportSettings.parse({ approvedOnly: true, kickoffSummary: true, callSheet: true }),
    ).toEqual({ approvedOnly: true, kickoffSummary: true, callSheet: true });
    expect(UpdateExportSettings.safeParse({ approvedOnly: 'yes' }).success).toBe(false);
    expect(DEFAULT_EXPORT_PREFERENCES).toMatchObject({
      approvedOnly: false,
      kickoffSummary: false,
      callSheet: false,
    });
  });

  it('takes JPEG and the remembered picture options, all optional', () => {
    expect(UpdateExportSettings.parse({ format: 'jpeg' })).toEqual({ format: 'jpeg' });
    const picture = { imageFormat: 'jpeg', imageAspect: '4:5', imageFit: 'fill' };
    expect(UpdateExportSettings.parse(picture)).toEqual(picture);
    expect(UpdateExportSettings.safeParse({ imageFormat: 'pdf' }).success).toBe(false);
    expect(UpdateExportSettings.safeParse({ imageAspect: '3:2' }).success).toBe(false);
    expect(UpdateExportSettings.safeParse({ imageFit: 'stretch' }).success).toBe(false);
  });

  it('takes the colour of the bands only as #RRGGBB', () => {
    for (const imageBandColor of ['#000000', '#3A5A7C', '#3a5a7c']) {
      expect(UpdateExportSettings.parse({ imageBandColor })).toEqual({ imageBandColor });
    }
    for (const imageBandColor of ['red', '#FFF', '#GGGGGG', '#0000000', 'url(x)', '', 12, null]) {
      expect(UpdateExportSettings.safeParse({ imageBandColor }).success).toBe(false);
    }
  });

  it('still reads settings of a server that knows no picture options', () => {
    const old = {
      ...DEFAULT_EXPORT_PREFERENCES,
      logoAssetId: null,
      logo: null,
      theme: DEFAULT_PROJECT_THEME,
      projectColor: 'green',
      canEdit: true,
      updatedAt: null,
    };
    expect(DEFAULT_EXPORT_PREFERENCES).not.toHaveProperty('imageAspect');
    expect(ExportSettings.parse(old)).toEqual(old);
  });

  it('describes the stored settings with the logo and who may change them', () => {
    const settings = {
      ...DEFAULT_EXPORT_PREFERENCES,
      logoAssetId: null,
      logo: null,
      theme: DEFAULT_PROJECT_THEME,
      projectColor: 'green',
      canEdit: false,
      updatedAt: null,
    };
    expect(ExportSettings.parse(settings)).toEqual(settings);
    expect(ExportSettings.safeParse({ ...settings, canEdit: undefined }).success).toBe(false);
  });

  it('starts the theme from the project colour and Inter, and takes only known values', () => {
    expect(DEFAULT_PROJECT_THEME).toEqual({ accent: null, headingFont: 'inter' });
    expect(UpdateExportSettings.parse({ theme: { headingFont: 'fraunces' } })).toEqual({
      theme: { headingFont: 'fraunces' },
    });
    expect(UpdateExportSettings.safeParse({ theme: { accent: 'teal' } }).success).toBe(true);
    expect(UpdateExportSettings.safeParse({ theme: { accent: '#ff0000' } }).success).toBe(false);
    expect(UpdateExportSettings.safeParse({ theme: { headingFont: 'Comic Sans' } }).success).toBe(
      false,
    );
  });
});
