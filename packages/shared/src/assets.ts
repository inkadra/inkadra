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
    url: z.string(),
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
    url: z
      .string()
      .openapi({ description: 'Original file, served with the session cookie or token.' }),
    variants: z.array(AssetVariant),
    exif: z.record(z.string(), z.unknown()).nullable(),
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
    filename: z.string().min(1).max(255),
    filetype: z.string().min(1).max(255),
  })
  .openapi('UploadMetadata');
export type UploadMetadata = z.infer<typeof UploadMetadata>;
