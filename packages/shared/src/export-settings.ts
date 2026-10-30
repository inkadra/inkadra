// SPDX-License-Identifier: MPL-2.0
import { Asset } from './assets.ts';
import { Id, Timestamp, z } from './common.ts';

/**
 * Shared settings of the PDF and image export of a project (decision 0039): the choices the
 * export dialog starts from and the logo printed on the pages. One set per project, read by
 * everyone who can open one of its boards, changed by project editors and owners.
 */

export const ExportFormat = z.enum(['pdf', 'png']);
export const ExportPaper = z.enum(['a4', 'letter']);
export const ExportOrientation = z.enum(['portrait', 'landscape']);
export const ExportAudience = z.enum(['client', 'team']).openapi({
  description:
    '`client`: only what guests of a share link see. `team`: everything the reader can see.',
});
export const ExportFramesPerPage = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(4),
  z.literal(6),
]);

/** Largest logo file, and the types it may have: PNG or JPEG (no SVG, which can carry scripts). */
export const EXPORT_LOGO_MAX_BYTES = 512 * 1024;
export const EXPORT_LOGO_TYPES = ['image/png', 'image/jpeg'] as const;

export const ExportPreferences = z
  .object({
    format: ExportFormat,
    framesPerPage: ExportFramesPerPage,
    paper: ExportPaper.nullable().openapi({
      description: "Null: A4, or Letter where the reader's browser is set to the US or Canada.",
    }),
    orientation: ExportOrientation,
    audience: ExportAudience,
    titlePage: z.boolean(),
    comments: z.boolean(),
    hideGuestHidden: z.boolean().openapi({
      description: 'For the team: leave out cards hidden from guests. Always on for clients.',
    }),
  })
  .openapi('ExportPreferences');
export type ExportPreferences = z.infer<typeof ExportPreferences>;

/** What a project that never saved its settings starts from. */
export const DEFAULT_EXPORT_PREFERENCES: ExportPreferences = {
  format: 'pdf',
  framesPerPage: 4,
  paper: null,
  orientation: 'landscape',
  audience: 'client',
  titlePage: true,
  comments: false,
  hideGuestHidden: true,
};

export const ExportSettings = ExportPreferences.extend({
  logoAssetId: Id.nullable(),
  logo: Asset.nullable().openapi({
    description:
      'The logo asset, so readers need no second request. Null without a logo or while its ' +
      'file is not ready.',
  }),
  canEdit: z.boolean().openapi({ description: 'The caller may change these settings.' }),
  updatedAt: Timestamp.nullable().openapi({ description: 'Null while the defaults apply.' }),
}).openapi('ExportSettings');
export type ExportSettings = z.infer<typeof ExportSettings>;

export const UpdateExportSettings = ExportPreferences.partial()
  .extend({
    logoAssetId: Id.nullable()
      .optional()
      .openapi({
        description:
          'A ready image asset of this project, PNG or JPEG (declared and read from the file) ' +
          'of at most EXPORT_LOGO_MAX_BYTES (512 KiB), uploaded like any other file. Null ' +
          'removes the logo. The previous logo asset is deleted when nothing else uses it.',
      }),
  })
  .strict()
  .openapi('UpdateExportSettings');
export type UpdateExportSettings = z.infer<typeof UpdateExportSettings>;
