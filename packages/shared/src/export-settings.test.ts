// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXPORT_PREFERENCES,
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

  it('takes partial updates, a logo or its removal, and nothing unknown', () => {
    expect(UpdateExportSettings.parse({})).toEqual({});
    expect(UpdateExportSettings.parse({ paper: null, logoAssetId: null })).toEqual({
      paper: null,
      logoAssetId: null,
    });
    expect(UpdateExportSettings.safeParse({ logoAssetId: 'not-an-id' }).success).toBe(false);
    expect(UpdateExportSettings.safeParse({ logo: {} }).success).toBe(false);
    expect(UpdateExportSettings.safeParse({ audience: 'everyone' }).success).toBe(false);
  });

  it('describes the stored settings with the logo and who may change them', () => {
    const settings = {
      ...DEFAULT_EXPORT_PREFERENCES,
      logoAssetId: null,
      logo: null,
      canEdit: false,
      updatedAt: null,
    };
    expect(ExportSettings.parse(settings)).toEqual(settings);
    expect(ExportSettings.safeParse({ ...settings, canEdit: undefined }).success).toBe(false);
  });
});
