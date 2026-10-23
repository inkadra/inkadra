// SPDX-License-Identifier: MPL-2.0
import { Id, Timestamp, z } from './common.ts';

export const AssetKind = z.enum(['image', 'video', 'audio', 'file']);
export type AssetKind = z.infer<typeof AssetKind>;

export const AssetStatus = z.enum(['pending', 'processing', 'ready', 'failed']);

/** Thumbnail widths produced by the worker; every variant is WebP. */
export const ThumbnailSize = z.enum(['256', '512', '1024', '2048']);
export type ThumbnailSize = z.infer<typeof ThumbnailSize>;

export const AssetVariant = z
  .object({
    size: ThumbnailSize,
    width: z.int(),
    height: z.int(),
    url: z.string().openapi({
      description: 'Same-origin path, `/api/v1/assets/{assetId}/variants/{size}`.',
    }),
  })
  .openapi('AssetVariant');

export const Asset = z
  .object({
    id: Id,
    projectId: Id,
    kind: AssetKind,
    mime: z.string(),
    filename: z.string(),
    size: z.int().min(0),
    sha256: z.string().length(64).nullable(),
    width: z.int().nullable(),
    height: z.int().nullable(),
    durationMs: z.int().nullable(),
    status: AssetStatus,
    url: z.string().openapi({
      description:
        'Original file, served with the session cookie or token: same-origin path ' +
        '`/api/v1/assets/{assetId}/file`.',
    }),
    variants: z.array(AssetVariant).openapi({
      description:
        'WebP thumbnails, smallest first, empty until `status` is `ready`. Sizes wider than ' +
        'the original are skipped.',
    }),
    exif: z.record(z.string(), z.unknown()).nullable().openapi({
      description: 'Camera and exposure data. Location (GPS) fields are never stored.',
    }),
    palette: z.array(z.string().regex(/^#[0-9A-F]{6}$/)).nullable(),
    sourceUrl: z.url().nullable(),
    createdAt: Timestamp,
  })
  .openapi('Asset');
export type Asset = z.infer<typeof Asset>;

/**
 * Metadata sent in the tus `Upload-Metadata` header (values base64 encoded, as tus requires).
 * See https://tus.io/protocols/resumable-upload.
 */
export const UploadMetadata = z
  .object({
    projectId: Id,
    boardId: Id.optional().openapi({
      description:
        'Board the file goes to. People who can edit that board but are not editors of the ' +
        'whole project (board grants) must send it.',
    }),
    filename: z.string().min(1).max(255),
    filetype: z.string().min(1).max(255),
  })
  .openapi('UploadMetadata');
export type UploadMetadata = z.infer<typeof UploadMetadata>;

export const VariantParams = z.object({ assetId: Id, size: ThumbnailSize });

/** Body of POST /api/v1/link-previews. */
export const CreateLinkPreview = z
  .object({
    projectId: Id.openapi({ description: 'Project that will own the preview image asset.' }),
    boardId: Id.optional().openapi({ description: 'As in UploadMetadata.' }),
    url: z.url({ protocol: /^https?$/ }),
  })
  .openapi('CreateLinkPreview');
export type CreateLinkPreview = z.infer<typeof CreateLinkPreview>;

export const LinkPreview = z
  .object({
    url: z.url().openapi({ description: 'Final address after redirects.' }),
    title: z.string().max(500).nullable(),
    description: z.string().max(2000).nullable(),
    siteName: z.string().max(200).nullable(),
    imageAssetId: Id.nullable().openapi({
      description: 'Preview image (og:image) copied into the project as an asset.',
    }),
  })
  .openapi('LinkPreview');
export type LinkPreview = z.infer<typeof LinkPreview>;
