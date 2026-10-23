// SPDX-License-Identifier: MPL-2.0
import { ThumbnailSize } from './assets.ts';
import { BoardKind } from './boards.ts';
import { CommentCount, ElementRef } from './comments.ts';
import { Id, Timestamp, z } from './common.ts';
import { ElementReview } from './reviews.ts';
import { UserSummary } from './users.ts';

/**
 * Share links for people without an account (docs/decisions/0013). A guest never receives the
 * board document: the server renders a filtered, read-only snapshot over REST, leaves out the
 * cards hidden from guests (`guestHidden` in @inkadra/doc-schema) and serves pictures only as
 * thumbnails, and originals only when the link allows downloads.
 */

export const GuestRole = z.enum(['guest_view', 'guest_comment', 'guest_approve']).openapi({
  description:
    '`guest_view`: look. `guest_comment`: also read and write comments visible to everyone. ' +
    '`guest_approve`: also set the review status of cards.',
});
export type GuestRole = z.infer<typeof GuestRole>;

export const ShareLinkStatus = z.enum(['active', 'expired', 'revoked']);
export type ShareLinkStatus = z.infer<typeof ShareLinkStatus>;

export const ShareLink = z
  .object({
    id: Id,
    projectId: Id,
    boardId: Id,
    boardTitle: z.string(),
    includeSubBoards: z.boolean().openapi({
      description:
        'Guests can also open the sub-boards whose board card is not hidden from guests.',
    }),
    role: GuestRole,
    label: z.string().nullable().openapi({ description: 'Who the link is for, e.g. "Cliente".' }),
    hasPassword: z.boolean(),
    allowDownload: z.boolean().openapi({
      description: 'Guests may download original files. Otherwise they see thumbnails only.',
    }),
    proofing: z.boolean().openapi({ description: 'Guests may pick, reject and star pictures.' }),
    url: z.url().nullable().openapi({
      description: 'Link to send, for the people who manage it, while it is active.',
    }),
    status: ShareLinkStatus,
    createdBy: UserSummary.nullable(),
    createdAt: Timestamp,
    expiresAt: Timestamp.nullable().openapi({ description: 'Null: until revoked.' }),
    revokedAt: Timestamp.nullable(),
    guestCount: z.int().min(0).openapi({ description: 'Guests who opened it.' }),
    viewCount: z.int().min(0).openapi({ description: 'Boards shown through it.' }),
    lastUsedAt: Timestamp.nullable(),
  })
  .openapi('ShareLink');
export type ShareLink = z.infer<typeof ShareLink>;

const Password = z.string().min(6).max(128);

export const CreateShareLink = z
  .object({
    role: GuestRole.default('guest_view'),
    includeSubBoards: z.boolean().default(true),
    label: z.string().trim().min(1).max(80).optional(),
    password: Password.optional().openapi({ description: 'Stored only as a hash.' }),
    expiresInDays: z.int().min(1).max(365).optional().openapi({
      description: 'Omit for a link that works until it is revoked.',
    }),
    allowDownload: z.boolean().default(false),
    proofing: z.boolean().default(false),
  })
  .openapi('CreateShareLink');
export type CreateShareLink = z.infer<typeof CreateShareLink>;

export const UpdateShareLink = z
  .object({
    role: GuestRole,
    includeSubBoards: z.boolean(),
    label: z.string().trim().min(1).max(80).nullable(),
    password: Password.nullable().openapi({
      description:
        'A new password, or null to remove it. Guests who opened the link before must enter ' +
        'the new one.',
    }),
    expiresAt: Timestamp.nullable(),
    allowDownload: z.boolean(),
    proofing: z.boolean(),
  })
  .partial()
  .openapi('UpdateShareLink');
export type UpdateShareLink = z.infer<typeof UpdateShareLink>;

// What guests see ---------------------------------------------------------------

/** What someone opening a share link sees before entering a name or a password. */
export const ShareLinkPreview = z
  .object({
    linkId: Id,
    instanceName: z.string(),
    boardTitle: z.string(),
    sharedBy: z.string().nullable().openapi({ description: 'Name of the person who shared.' }),
    role: GuestRole,
    needsPassword: z.boolean(),
    status: ShareLinkStatus,
    expiresAt: Timestamp.nullable(),
  })
  .openapi('ShareLinkPreview');
export type ShareLinkPreview = z.infer<typeof ShareLinkPreview>;

/**
 * `details` of a 401 or 403 answer to a guest request, so the page can ask for the right
 * thing.
 */
export const GuestDenied = z
  .object({
    reason: z.enum([
      'no_session',
      'password_required',
      'wrong_password',
      'expired',
      'revoked',
      'name_required',
    ]),
  })
  .openapi('GuestDenied');
export type GuestDenied = z.infer<typeof GuestDenied>;

export const CreateGuestSession = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .optional()
      .openapi({
        description:
          'Shown on the guest’s comments, reviews and picks. Needed before any of those; can be ' +
          'given later with PATCH.',
      }),
    password: z.string().max(128).optional(),
  })
  .openapi('CreateGuestSession');
export type CreateGuestSession = z.infer<typeof CreateGuestSession>;

export const UpdateGuestSession = z
  .object({ name: z.string().trim().min(1).max(80) })
  .openapi('UpdateGuestSession');
export type UpdateGuestSession = z.infer<typeof UpdateGuestSession>;

export const GuestBoard = z
  .object({
    id: Id,
    parentBoardId: Id.nullable().openapi({
      description: 'Null for the board of the link, the top of what guests can open.',
    }),
    kind: BoardKind,
    title: z.string(),
    coverUrl: z.string().nullable().openapi({ description: 'Guest thumbnail path, 512 px.' }),
  })
  .openapi('GuestBoard');
export type GuestBoard = z.infer<typeof GuestBoard>;

export const GuestSession = z
  .object({
    linkId: Id,
    guest: z.object({ id: Id, name: z.string().nullable() }),
    role: GuestRole,
    boardId: Id.openapi({ description: 'Board of the link.' }),
    boards: z.array(GuestBoard).openapi({
      description: 'Every board the guest can open; build the tree from parentBoardId.',
    }),
    allowDownload: z.boolean(),
    proofing: z.boolean(),
    linkExpiresAt: Timestamp.nullable(),
  })
  .openapi('GuestSession');
export type GuestSession = z.infer<typeof GuestSession>;

export const GuestAssetVariant = z
  .object({
    size: ThumbnailSize,
    width: z.int(),
    height: z.int(),
    url: z.string().openapi({
      description:
        'Same-origin path, `/api/v1/guest/links/{linkId}/assets/{assetId}/variants/{size}`.',
    }),
  })
  .openapi('GuestAssetVariant');

/** A file shown on a guest board: thumbnails always, the original only with allowDownload. */
export const GuestAsset = z
  .object({
    id: Id,
    kind: z.enum(['image', 'video', 'audio', 'file']),
    mime: z.string(),
    filename: z.string().nullable().openapi({ description: 'Only when downloads are allowed.' }),
    size: z.int().min(0).nullable().openapi({ description: 'Only when downloads are allowed.' }),
    width: z.int().nullable(),
    height: z.int().nullable(),
    durationMs: z.int().nullable(),
    variants: z.array(GuestAssetVariant).openapi({ description: 'Smallest first.' }),
    downloadUrl: z
      .string()
      .nullable()
      .openapi({
        description:
          '`/api/v1/guest/links/{linkId}/assets/{assetId}/file` when the link allows downloads, ' +
          'else null.',
      }),
  })
  .openapi('GuestAsset');
export type GuestAsset = z.infer<typeof GuestAsset>;

/**
 * An element of the board document as a guest sees it: the plain view of @inkadra/doc-schema
 * (parse it with `Element`), with `createdBy` always null, the rich text of notes in `body`
 * and no `guestHidden` element, nor any child of one.
 */
export const GuestElement = z
  .object({
    id: ElementRef,
    type: z.string().openapi({ description: 'Element type of @inkadra/doc-schema.' }),
    body: z.record(z.string(), z.unknown()).optional().openapi({
      description: 'Notes: the rich text as ProseMirror JSON (`{ "type": "doc", … }`).',
    }),
  })
  .catchall(z.unknown())
  .openapi('GuestElement');
export type GuestElement = z.infer<typeof GuestElement>;

export const PickValue = z.enum(['picked', 'rejected']);
export type PickValue = z.infer<typeof PickValue>;

export const GuestPick = z
  .object({
    boardId: Id,
    elementId: ElementRef,
    pick: PickValue.nullable(),
    stars: z.int().min(1).max(5).nullable(),
    updatedAt: Timestamp,
  })
  .openapi('GuestPick');
export type GuestPick = z.infer<typeof GuestPick>;

export const GuestBoardSnapshot = z
  .object({
    board: GuestBoard.extend({
      aspect: z.string().nullable().openapi({ description: 'Storyboards: `meta.aspect`.' }),
    }),
    breadcrumb: z.array(z.object({ id: Id, title: z.string() })).openapi({
      description: 'From the board of the link to the parent; empty for the board of the link.',
    }),
    elements: z.array(GuestElement),
    assets: z.array(GuestAsset).openapi({ description: 'Files the elements refer to.' }),
    reviews: z.array(ElementReview).openapi({ description: 'Cards with a review status.' }),
    commentCounts: z.array(CommentCount).openapi({
      description:
        'Threads visible to guests, per card. Empty for `guest_view`, who cannot read comments.',
    }),
    picks: z.array(GuestPick).openapi({ description: 'This guest’s picks on the board.' }),
    version: z.string().openapi({
      description: 'Changes when the snapshot would change; also sent as ETag.',
    }),
    generatedAt: Timestamp,
  })
  .openapi('GuestBoardSnapshot');
export type GuestBoardSnapshot = z.infer<typeof GuestBoardSnapshot>;

export const SetPick = z
  .object({
    pick: PickValue.nullable().optional().openapi({ description: 'Null clears it.' }),
    stars: z.int().min(1).max(5).nullable().optional().openapi({ description: 'Null clears it.' }),
  })
  .refine((v) => v.pick !== undefined || v.stars !== undefined, {
    message: 'Send pick, stars or both.',
  })
  .openapi('SetPick');
export type SetPick = z.infer<typeof SetPick>;

// Proofing results, for the people who manage the link ---------------------------------

export const ShareLinkGuest = z
  .object({
    id: Id,
    name: z.string().nullable(),
    createdAt: Timestamp,
    lastSeenAt: Timestamp,
  })
  .openapi('ShareLinkGuest');
export type ShareLinkGuest = z.infer<typeof ShareLinkGuest>;

export const PickSummary = z
  .object({
    boardId: Id,
    elementId: ElementRef,
    assetId: Id.nullable(),
    filename: z.string().nullable().openapi({ description: 'To find the file in a folder.' }),
    picked: z.int().min(0),
    rejected: z.int().min(0),
    starsAverage: z.number().min(1).max(5).nullable(),
    starsCount: z.int().min(0),
    byGuest: z.array(
      z.object({
        guestId: Id,
        pick: PickValue.nullable(),
        stars: z.int().min(1).max(5).nullable(),
      }),
    ),
  })
  .openapi('PickSummary');
export type PickSummary = z.infer<typeof PickSummary>;

export const ShareLinkPicks = z
  .object({
    guests: z.array(ShareLinkGuest),
    items: z.array(PickSummary).openapi({ description: 'Cards with at least one pick or star.' }),
  })
  .openapi('ShareLinkPicks');
export type ShareLinkPicks = z.infer<typeof ShareLinkPicks>;

/** Cookie that keeps a guest session, scoped to the path of its link. */
export const GUEST_COOKIE = 'inkadra.guest';
