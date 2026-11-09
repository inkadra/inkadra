// SPDX-License-Identifier: MPL-2.0
import { Asset } from './assets.ts';
import { Id, Timestamp, z } from './common.ts';
import { ProjectIcon } from './projects.ts';

/**
 * Shared settings of the PDF and image export of a project (decision 0039): the choices the
 * export dialog starts from and the logo printed on the pages. One set per project, read by
 * everyone who can open one of its boards, changed by project editors and owners.
 */

export const ExportFormat = z.enum(['pdf', 'png', 'jpeg']);
/** The file formats of a picture; JPEG is written at quality 90, in sRGB, with no transparency. */
export const ExportImageFormat = z.enum(['png', 'jpeg']);
export type ExportImageFormat = z.infer<typeof ExportImageFormat>;
/** Shape of an exported picture. Not a page: the 16:9 here is 1920 × 1080 px, `slide` is a page. */
export const ExportImageAspect = z.enum(['original', '4:5', '1:1', '9:16', '16:9']);
export type ExportImageAspect = z.infer<typeof ExportImageAspect>;
export const ExportImageFit = z.enum(['fit', 'fill']);
export type ExportImageFit = z.infer<typeof ExportImageFit>;
/** `#RRGGBB`. Stored, so checked here: it is painted into files and into the page's style. */
export const ExportBandColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
export const ExportPaper = z.enum(['a4', 'letter', 'slide']);
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

/**
 * Heading fonts of the project theme (decision 0057): bundled with the app under the OFL, never
 * fetched from a font service. Body text always stays Inter.
 */
export const THEME_FONTS = ['inter', 'fraunces', 'space-grotesk', 'ibm-plex-mono'] as const;
export const ThemeFont = z.enum(THEME_FONTS);
export type ThemeFont = z.infer<typeof ThemeFont>;
export const ThemeColor = ProjectIcon.shape.color;
export type ThemeColor = z.infer<typeof ThemeColor>;

/** How the presentation view and the PDF export look for this project; the logo is shared. */
export const ProjectTheme = z
  .object({
    accent: ThemeColor.nullable().openapi({
      description:
        'Legacy field kept for compatibility, no longer set by the app and ignored by clients. ' +
        "The accent is always the project's colour (decision 0088).",
    }),
    headingFont: ThemeFont,
  })
  .openapi('ProjectTheme');
export type ProjectTheme = z.infer<typeof ProjectTheme>;
export const DEFAULT_PROJECT_THEME: ProjectTheme = { accent: null, headingFont: 'inter' };

export const ExportPreferences = z
  .object({
    format: ExportFormat,
    framesPerPage: ExportFramesPerPage,
    paper: ExportPaper.nullable().openapi({
      description:
        "Null: A4, or Letter where the reader's browser is set to the US or Canada. `slide`: a " +
        '16:9 landscape page (13.33 × 7.5 in), like a presentation slide.',
    }),
    orientation: ExportOrientation,
    audience: ExportAudience,
    titlePage: z.boolean(),
    comments: z.boolean(),
    hideGuestHidden: z.boolean().openapi({
      description: 'For the team: leave out cards hidden from guests. Always on for clients.',
    }),
    approvedOnly: z.boolean().openapi({
      description: 'Storyboard and shot list: only frames approved in review.',
    }),
    callSheet: z.boolean().openapi({
      description: 'PDF for the team: the call sheet of every shooting day of the board.',
    }),
    imageFormat: ExportImageFormat.optional().openapi({
      description: 'The last picture format used. Left out until a picture is exported.',
    }),
    imageAspect: ExportImageAspect.optional().openapi({
      description:
        'The last picture shape used. `original` keeps the proportions of the content; the ' +
        'others are 1080 px on the short side. Left out until a picture is exported.',
    }),
    imageFit: ExportImageFit.optional().openapi({
      description:
        '`fit`: all of the content, with bands of `imageBandColor`. `fill`: fills the shape and ' +
        'crops the edges. Left out until a picture is exported.',
    }),
    imageBandColor: ExportBandColor.optional().openapi({
      description:
        'The colour of the bands of `fit`, also under the transparent areas of a JPEG, as ' +
        '`#RRGGBB`: the same for everyone, whatever their theme. Left out until a picture is ' +
        'exported, and black until then.',
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
  approvedOnly: false,
  callSheet: false,
};

export const ExportSettings = ExportPreferences.extend({
  logoAssetId: Id.nullable(),
  logo: Asset.nullable().openapi({
    description:
      'The logo asset, so readers need no second request. Null without a logo or while its ' +
      'file is not ready.',
  }),
  theme: ProjectTheme,
  projectColor: ThemeColor.openapi({
    description:
      'The colour of the project icon: always the presentation and PDF accent (decision 0088).',
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
    theme: ProjectTheme.partial().optional().openapi({
      description: 'Fields left out keep their value.',
    }),
  })
  .strict()
  .openapi('UpdateExportSettings');
export type UpdateExportSettings = z.infer<typeof UpdateExportSettings>;
