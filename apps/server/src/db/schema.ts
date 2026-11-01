import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Database contract. Changes go through a migration generated with `pnpm db:generate`
 * and reviewed in the Integrazione PR (see CONTRIBUTING.md).
 */

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => 'bytea',
  toDriver: (value) => Buffer.from(value),
  fromDriver: (value) => new Uint8Array(value),
});

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// Auth (tables required by Better Auth, with Inkadra fields) ------------------

export const user = pgTable('user', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  role: text('role', { enum: ['admin', 'member'] })
    .notNull()
    .default('member'),
  locale: text('locale'),
  deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
  /** Per-account choice over `membersCanCreateProjects`; null follows the instance (0041). */
  canCreateProjects: boolean('can_create_projects'),
  twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** One bounded normalized avatar per account, replaced atomically and cascaded on removal. */
export const userAvatar = pgTable('user_avatar', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  version: uuid('version').notNull(),
  image: bytea('image').notNull(),
});

export const session = pgTable(
  'session',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    token: text('token').notNull().unique(),
    transport: text('transport').notNull().default('https'),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('session_user_idx').on(t.userId)],
);

export const account = pgTable(
  'account',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('account_user_idx').on(t.userId)],
);

export const verification = pgTable(
  'verification',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
);

/** TOTP secret and backup codes (Better Auth two-factor plugin; both stored encrypted). */
export const twoFactor = pgTable(
  'two_factor',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    secret: text('secret').notNull(),
    backupCodes: text('backup_codes').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    verified: boolean('verified').notNull().default(true),
    failedVerificationCount: integer('failed_verification_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
  },
  (t) => [index('two_factor_user_idx').on(t.userId), index('two_factor_secret_idx').on(t.secret)],
);

/**
 * Bearer tokens for the browser clipper, the mobile app and scripts. Only a SHA-256 of the
 * token is kept.
 */
export const personalToken = pgTable(
  'personal_token',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    client: text('client', { enum: ['clipper', 'mobile'] }),
    tokenHash: text('token_hash').notNull().unique(),
    prefix: text('prefix').notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('personal_token_user_idx').on(t.userId)],
);

// Instance -------------------------------------------------------------------

/** Instance-wide settings and one-time markers (key `setup`: the first account was claimed). */
export const instanceSetting = pgTable('instance_setting', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<Record<string, unknown>>().notNull(),
  updatedAt: updatedAt(),
});

// Projects, boards, permissions ---------------------------------------------

const roleEnum = ['owner', 'editor', 'commenter', 'viewer'] as const;

export const project = pgTable('project', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  iconShape: text('icon_shape', {
    enum: [
      'diamond',
      'circle',
      'triangle',
      'square',
      'hexagon',
      'star',
      'pentagon',
      'cross',
      'octagon',
      'drop',
      'moon',
      'clapperboard',
    ],
  })
    .notNull()
    .default('circle'),
  iconEmoji: text('icon_emoji'),
  iconColor: text('icon_color', {
    enum: ['blue', 'orange', 'purple', 'green', 'neutral', 'teal', 'yellow', 'red', 'pink'],
  })
    .notNull()
    .default('neutral'),
  position: text('position').notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  type: text('type'),
  shootingStart: date('shooting_start'),
  shootingEnd: date('shooting_end'),
  createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const projectMember = pgTable(
  'project_member',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role', { enum: roleEnum }).notNull(),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * When the membership ends (decision 0041). Access checks ignore it from then on; the
     * sweep removes the row. Never set for owners.
     */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /** Set once the "expires soon" notification went out for the current `expiresAt`. */
    expiryWarnedAt: timestamp('expiry_warned_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.userId] }),
    index('project_member_user_idx').on(t.userId),
    index('project_member_expires_idx').on(t.expiresAt).where(sql`${t.expiresAt} is not null`),
    check('project_member_owner_no_expiry', sql`${t.role} <> 'owner' or ${t.expiresAt} is null`),
  ],
);

export const projectPin = pgTable(
  'project_pin',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.projectId] }),
    foreignKey({
      columns: [t.projectId, t.userId],
      foreignColumns: [projectMember.projectId, projectMember.userId],
    }).onDelete('cascade'),
  ],
);

export const board = pgTable(
  'board',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    parentBoardId: uuid('parent_board_id'),
    kind: text('kind', { enum: ['board', 'storyboard'] })
      .notNull()
      .default('board'),
    title: text('title').notNull(),
    position: text('position').notNull(),
    coverAssetId: uuid('cover_asset_id').references(() => asset.id, { onDelete: 'set null' }),
    /** Board card icon (symbol or emoji and colour, as projects); null = the default icon. */
    icon: jsonb('icon').$type<import('@inkadra/shared').Board['icon']>(),
    docSchemaVersion: integer('doc_schema_version').notNull().default(1),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({ columns: [t.parentBoardId], foreignColumns: [t.id] }).onDelete('cascade'),
    index('board_project_idx').on(t.projectId),
    index('board_parent_idx').on(t.parentBoardId),
    // Exactly one root board per project.
    uniqueIndex('board_root_uq').on(t.projectId).where(sql`${t.parentBoardId} is null`),
  ],
);

/** Overrides the inherited project role on a board and its sub-boards. */
export const boardGrant = pgTable(
  'board_grant',
  {
    boardId: uuid('board_id')
      .notNull()
      .references(() => board.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role', { enum: roleEnum }).notNull(),
    grantedBy: uuid('granted_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    /** When the grant ends and the inherited role applies again (decision 0041). */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    expiryWarnedAt: timestamp('expiry_warned_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.boardId, t.userId] }),
    index('board_grant_user_idx').on(t.userId),
    index('board_grant_expires_idx').on(t.expiresAt).where(sql`${t.expiresAt} is not null`),
    check('board_grant_owner_no_expiry', sql`${t.role} <> 'owner' or ${t.expiresAt} is null`),
  ],
);

/**
 * Invitations to a project, a board or (from administrators) the instance alone. The token is
 * looked up by its SHA-256. For `link` invitations `tokenSealed` keeps it encrypted with a key
 * derived from AUTH_SECRET, so the people who manage it can copy the link again; `email`
 * invitations get a new token when they are sent again, so they keep none.
 */
export const invitation = pgTable(
  'invitation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind', { enum: ['email', 'link'] }).notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    tokenSealed: text('token_sealed'),
    email: text('email'),
    projectId: uuid('project_id').references(() => project.id, { onDelete: 'cascade' }),
    boardId: uuid('board_id').references(() => board.id, { onDelete: 'cascade' }),
    role: text('role', { enum: roleEnum }),
    invitedBy: uuid('invited_by').references(() => user.id, { onDelete: 'set null' }),
    uses: integer('uses').notNull().default(0),
    maxUses: integer('max_uses'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** When the role given by accepting ends; copied to the membership or grant (0041). */
    accessExpiresAt: timestamp('access_expires_at', { withTimezone: true }),
    lastSentAt: timestamp('last_sent_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('invitation_project_idx').on(t.projectId),
    index('invitation_board_idx').on(t.boardId),
  ],
);

/** Latest Yjs state of a board (a full update, compacted on store). */
export const boardDoc = pgTable('board_doc', {
  boardId: uuid('board_id')
    .primaryKey()
    .references(() => board.id, { onDelete: 'cascade' }),
  state: bytea('state').notNull(),
  schemaVersion: integer('schema_version').notNull(),
  size: integer('size').notNull(),
  updatedAt: updatedAt(),
  /** When board_element_index was last rebuilt from `state`; null = never (backfill). */
  indexedAt: timestamp('indexed_at', { withTimezone: true }),
});

/**
 * Searchable view of the elements of each board, rebuilt from the Yjs document whenever it is
 * stored (docs/decisions/0012). Never edited directly: the document is the source.
 */
export const boardElementIndex = pgTable(
  'board_element_index',
  {
    boardId: uuid('board_id')
      .notNull()
      .references(() => board.id, { onDelete: 'cascade' }),
    elementId: text('element_id').notNull(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    /** Short label for results: title, shot label, file name. */
    title: text('title').notNull().default(''),
    /** Every searchable text of the element, title included, one space apart. */
    text: text('text').notNull().default(''),
    /** Lower case. */
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    assetId: uuid('asset_id'),
    /** A few plain fields for views across boards (frames: label, scene, status). */
    data: jsonb('data').$type<Record<string, unknown>>(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.boardId, t.elementId] }),
    index('board_element_index_project_idx').on(t.projectId),
    index('board_element_index_text_idx').using('gin', t.text.op('gin_trgm_ops')),
    index('board_element_index_tags_idx').using('gin', t.tags),
  ],
);

// Files ----------------------------------------------------------------------

export const asset = pgTable(
  'asset',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['image', 'video', 'audio', 'file'] }).notNull(),
    mime: text('mime').notNull(),
    filename: text('filename').notNull(),
    size: bigint('size', { mode: 'number' }).notNull(),
    sha256: text('sha256'),
    storageKey: text('storage_key').notNull(),
    width: integer('width'),
    height: integer('height'),
    durationMs: integer('duration_ms'),
    /** First video and audio streams of a video, as ffprobe names their codecs. */
    videoCodec: text('video_codec'),
    audioCodec: text('audio_codec'),
    frameRate: real('frame_rate'),
    /**
     * The playable MP4 copy of a video browsers cannot play (decision 0048): null when none is
     * needed. Its file is the `proxy` row of `asset_variant`.
     */
    proxyStatus: text('proxy_status', {
      enum: ['queued', 'processing', 'ready', 'failed', 'skipped'],
    }),
    proxyProgress: integer('proxy_progress'),
    /** Pages of a PDF, when poppler could read it. */
    pageCount: integer('page_count'),
    /** The route of a GPX file (decision 0053). */
    track: jsonb('track').$type<import('@inkadra/shared').AssetTrack>(),
    status: text('status', { enum: ['pending', 'processing', 'ready', 'failed'] })
      .notNull()
      .default('pending'),
    exif: jsonb('exif').$type<Record<string, unknown>>(),
    palette: jsonb('palette').$type<string[]>(),
    /** The worker wrote moving thumbnails beside the posters (`<size>-animated.webp`). */
    animated: boolean('animated').notNull().default(false),
    sourceUrl: text('source_url'),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    /** Came with an imported project: the author's name there, display-only (decision 0037). */
    importedAuthor: text('imported_author'),
    createdAt: createdAt(),
  },
  (t) => [index('asset_project_idx').on(t.projectId), index('asset_sha_idx').on(t.sha256)],
);

export const assetVariant = pgTable(
  'asset_variant',
  {
    assetId: uuid('asset_id')
      .notNull()
      .references(() => asset.id, { onDelete: 'cascade' }),
    /**
     * A WebP thumbnail width, `proxy`: the playable copy of a video or audio file (decision
     * 0048), or `waveform`: the peaks of an audio file as JSON (#327). The last two are not
     * thumbnails and never listed with them (`isThumbnail`).
     */
    size: text('size', { enum: ['256', '512', '1024', '2048', 'proxy', 'waveform'] }).notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    storageKey: text('storage_key').notNull(),
    /** Null for WebP thumbnails. */
    mime: text('mime'),
    /** Bytes of the file; null for thumbnails written before it was recorded. */
    bytes: bigint('bytes', { mode: 'number' }),
  },
  (t) => [primaryKey({ columns: [t.assetId, t.size] })],
);

// Review and sharing (docs/decisions/0013) -------------------------------------

/**
 * Comments on a board (`element_id` null) or one of its cards. A reply points to the first
 * comment of its thread on the same board; replies have no replies. The author is an account,
 * a guest of a share link, or nobody once the account is deleted. `mentions` holds the user ids
 * written as `@{id}` in the body that could read the board when it was saved.
 *
 * `share_link_id` is the audience among guests: set on everything a guest writes (their link)
 * and on `everyone` threads the team limits to one link. Guests read `everyone` threads whose
 * link is null or theirs, and replies whose link is null or theirs. It cascades: a comment
 * never outlives its link, so it can never fall back to "every link".
 */
export const comment = pgTable(
  'comment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    boardId: uuid('board_id')
      .notNull()
      .references(() => board.id, { onDelete: 'cascade' }),
    elementId: text('element_id'),
    threadId: uuid('thread_id'),
    authorId: uuid('author_id').references(() => user.id, { onDelete: 'set null' }),
    /** A guest of `share_link_id` (composite foreign key). */
    authorGuestId: uuid('author_guest_id'),
    shareLinkId: uuid('share_link_id').references(() => shareLink.id, { onDelete: 'cascade' }),
    /** Came with an imported project: the author's name there, display-only (decision 0037). */
    importedAuthor: text('imported_author'),
    body: text('body').notNull(),
    mentions: uuid('mentions').array().notNull().default(sql`'{}'::uuid[]`),
    visibility: text('visibility', { enum: ['team', 'everyone'] })
      .notNull()
      .default('team'),
    pin: jsonb('pin').$type<{ x: number; y: number }>(),
    /** Thread starts only. Only the team resolves, so there is no guest column. */
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: uuid('resolved_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    /** Any change of the row (edit, resolve, reopen, delete); part of the guest snapshot ETag. */
    updatedAt: updatedAt(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    unique('comment_id_board_uq').on(t.id, t.boardId),
    // A reply belongs to a thread of the same board.
    foreignKey({ columns: [t.threadId, t.boardId], foreignColumns: [t.id, t.boardId] }).onDelete(
      'cascade',
    ),
    // A guest author belongs to the link of the comment. Guests go only with their link.
    foreignKey({
      name: 'comment_author_guest_fk',
      columns: [t.authorGuestId, t.shareLinkId],
      foreignColumns: [shareGuest.id, shareGuest.shareLinkId],
    }).onDelete('cascade'),
    index('comment_board_element_idx').on(t.boardId, t.elementId),
    index('comment_project_idx').on(t.projectId),
    // Thread lists: keyset on (created_at, id), newest first; a thread start never moves.
    index('comment_threads_idx')
      .on(t.boardId, t.createdAt.desc(), t.id.desc())
      .where(sql`${t.threadId} is null`),
    index('comment_replies_idx')
      .on(t.threadId, t.createdAt, t.id)
      .where(sql`${t.threadId} is not null`),
    index('comment_share_link_idx').on(t.shareLinkId).where(sql`${t.shareLinkId} is not null`),
    index('comment_author_idx').on(t.authorId).where(sql`${t.authorId} is not null`),
    index('comment_resolved_by_idx').on(t.resolvedBy).where(sql`${t.resolvedBy} is not null`),
    check('comment_one_author_ck', sql`num_nonnulls(${t.authorId}, ${t.authorGuestId}) <= 1`),
    check('comment_guest_link_ck', sql`${t.authorGuestId} is null or ${t.shareLinkId} is not null`),
    check('comment_team_no_link_ck', sql`${t.visibility} = 'everyone' or ${t.shareLinkId} is null`),
  ],
);

/** The quick reactions (decision 0013): a small fixed set, on comments and on cards. */
export const reactionEmojiEnum = ['👍', '❤️', '✅', '❓'] as const;

/**
 * A quick reaction to a comment or reply, by an account or by a guest of a share link (never
 * both). Stored with the review data, not in the board document. One row per person and emoji;
 * it goes with the comment, the account or the guest.
 */
export const commentReaction = pgTable(
  'comment_reaction',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    commentId: uuid('comment_id')
      .notNull()
      .references(() => comment.id, { onDelete: 'cascade' }),
    emoji: text('emoji', { enum: reactionEmojiEnum }).notNull(),
    userId: uuid('user_id').references(() => user.id, { onDelete: 'cascade' }),
    /** A guest of `share_link_id` (composite foreign key). */
    guestId: uuid('guest_id'),
    shareLinkId: uuid('share_link_id').references(() => shareLink.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: 'comment_reaction_guest_fk',
      columns: [t.guestId, t.shareLinkId],
      foreignColumns: [shareGuest.id, shareGuest.shareLinkId],
    }).onDelete('cascade'),
    uniqueIndex('comment_reaction_user_uq')
      .on(t.commentId, t.emoji, t.userId)
      .where(sql`${t.userId} is not null`),
    uniqueIndex('comment_reaction_guest_uq')
      .on(t.commentId, t.emoji, t.guestId)
      .where(sql`${t.guestId} is not null`),
    index('comment_reaction_user_idx').on(t.userId).where(sql`${t.userId} is not null`),
    index('comment_reaction_share_link_idx')
      .on(t.shareLinkId)
      .where(sql`${t.shareLinkId} is not null`),
    check('comment_reaction_one_author_ck', sql`num_nonnulls(${t.userId}, ${t.guestId}) = 1`),
  ],
);

/** A quick reaction to a card of the board, by an account. Gone with the board or the account. */
export const elementReaction = pgTable(
  'element_reaction',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    boardId: uuid('board_id')
      .notNull()
      .references(() => board.id, { onDelete: 'cascade' }),
    elementId: text('element_id').notNull(),
    emoji: text('emoji', { enum: reactionEmojiEnum }).notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    unique('element_reaction_uq').on(t.boardId, t.elementId, t.emoji, t.userId),
    index('element_reaction_user_idx').on(t.userId),
  ],
);

/**
 * What a person has read of a thread: when they last opened it, and whether they marked it
 * unread by hand. A thread is unread for them when `marked_unread` is set or someone else wrote
 * in it after `read_at` (or they never opened it). Per person, so it needs no notice.
 */
export const commentRead = pgTable(
  'comment_read',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => comment.id, { onDelete: 'cascade' }),
    readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
    markedUnread: boolean('marked_unread').notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.threadId] }),
    index('comment_read_thread_idx').on(t.threadId),
  ],
);

const reviewStatusEnum = ['none', 'in_review', 'approved', 'changes_requested'] as const;

/**
 * Review status of a card, one row per source (decision 0013): the team's status
 * (`share_link_id` null, set by accounts) and, for each link whose guests reviewed the card,
 * the latest decision of a guest of that link. Decisions of one link are never shown to guests
 * of another: a guest sees the more recent of the team row and their own link's row; the team
 * sees the most recent row of all. A link row with `none` is a withdrawn decision and shows
 * nothing, so the team status shows through. Clearing keeps the row with `none`, so the latest
 * `changed_at` always moves (guest ETag). Link rows go with their link.
 */
export const elementReview = pgTable(
  'element_review',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    boardId: uuid('board_id')
      .notNull()
      .references(() => board.id, { onDelete: 'cascade' }),
    elementId: text('element_id').notNull(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    status: text('status', { enum: reviewStatusEnum }).notNull(),
    note: text('note'),
    /** Team rows: the account that made the change. */
    changedBy: uuid('changed_by').references(() => user.id, { onDelete: 'set null' }),
    /** Link rows: the guest of `share_link_id` who made the change (composite foreign key). */
    changedByGuest: uuid('changed_by_guest'),
    shareLinkId: uuid('share_link_id').references(() => shareLink.id, { onDelete: 'cascade' }),
    /** Team rows: who last set `in_review`, told about later decisions. */
    requestedBy: uuid('requested_by').references(() => user.id, { onDelete: 'set null' }),
    /** Came with an imported project: the author's name there, display-only (decision 0037). */
    importedAuthor: text('imported_author'),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One team row (link null) and one row per link for each card. NULLS NOT DISTINCT makes
    // the null link count as one value; the index also serves board-wide reads and cascades.
    unique('element_review_uq').on(t.boardId, t.elementId, t.shareLinkId).nullsNotDistinct(),
    index('element_review_project_idx').on(t.projectId),
    foreignKey({
      name: 'element_review_guest_fk',
      columns: [t.changedByGuest, t.shareLinkId],
      foreignColumns: [shareGuest.id, shareGuest.shareLinkId],
    }).onDelete('cascade'),
    index('element_review_share_link_idx')
      .on(t.shareLinkId)
      .where(sql`${t.shareLinkId} is not null`),
    index('element_review_changed_by_idx').on(t.changedBy).where(sql`${t.changedBy} is not null`),
    index('element_review_requested_by_idx')
      .on(t.requestedBy)
      .where(sql`${t.requestedBy} is not null`),
    // A team row has no guest; a link row has its guest and no account.
    check(
      'element_review_source_ck',
      sql`(${t.shareLinkId} is null and ${t.changedByGuest} is null) or (${t.shareLinkId} is not null and ${t.changedByGuest} is not null and ${t.changedBy} is null and ${t.requestedBy} is null and ${t.status} <> 'in_review')`,
    ),
  ],
);

/** Every change of a review status, of the team or of one link, never edited. */
export const elementReviewEvent = pgTable(
  'element_review_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    boardId: uuid('board_id')
      .notNull()
      .references(() => board.id, { onDelete: 'cascade' }),
    elementId: text('element_id').notNull(),
    previous: text('previous', { enum: reviewStatusEnum }).notNull(),
    status: text('status', { enum: reviewStatusEnum }).notNull(),
    note: text('note'),
    userId: uuid('user_id').references(() => user.id, { onDelete: 'set null' }),
    /** A guest of `share_link_id` (composite foreign key). */
    guestId: uuid('guest_id'),
    /**
     * The source the change belongs to: null for the team, else the link of the guest. It
     * cascades, so a guest's decision can never turn into one of the team.
     */
    shareLinkId: uuid('share_link_id').references(() => shareLink.id, { onDelete: 'cascade' }),
    /** Came with an imported project: the author's name there, display-only (decision 0037). */
    importedAuthor: text('imported_author'),
    createdAt: createdAt(),
  },
  (t) => [
    index('element_review_event_element_idx').on(
      t.boardId,
      t.elementId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    foreignKey({
      name: 'element_review_event_guest_fk',
      columns: [t.guestId, t.shareLinkId],
      foreignColumns: [shareGuest.id, shareGuest.shareLinkId],
    }).onDelete('cascade'),
    index('element_review_event_share_link_idx')
      .on(t.shareLinkId)
      .where(sql`${t.shareLinkId} is not null`),
    index('element_review_event_user_idx').on(t.userId).where(sql`${t.userId} is not null`),
    check(
      'element_review_event_source_ck',
      sql`(${t.shareLinkId} is null and ${t.guestId} is null) or (${t.shareLinkId} is not null and ${t.guestId} is not null and ${t.userId} is null)`,
    ),
  ],
);

/**
 * In-app notifications; email is sent from these rows according to the preference, after
 * checking again that the person can still open the board. The excerpt is not stored: it is
 * rendered from the comment as it is when the notification is read or emailed.
 */
export const notification = pgTable(
  'notification',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    type: text('type', {
      enum: [
        'mention',
        'reply',
        'comment',
        'review',
        'invitation_accepted',
        'export_ready',
        'import_ready',
        'access_expiring',
        'access_expired',
        'link_opened',
        'task_assigned',
      ],
    }).notNull(),
    actorId: uuid('actor_id').references(() => user.id, { onDelete: 'set null' }),
    actorGuestId: uuid('actor_guest_id').references(() => shareGuest.id, { onDelete: 'set null' }),
    projectId: uuid('project_id').references(() => project.id, { onDelete: 'cascade' }),
    boardId: uuid('board_id').references(() => board.id, { onDelete: 'cascade' }),
    elementId: text('element_id'),
    commentId: uuid('comment_id').references(() => comment.id, { onDelete: 'cascade' }),
    reviewStatus: text('review_status', { enum: reviewStatusEnum }),
    /** access_expiring/access_expired: whose access, and when it ends (decision 0041). */
    subjectUserId: uuid('subject_user_id').references(() => user.id, { onDelete: 'cascade' }),
    accessExpiresAt: timestamp('access_expires_at', { withTimezone: true }),
    /** link_opened: the link a guest opened; the notification shows its label. */
    shareLinkId: uuid('share_link_id').references(() => shareLink.id, { onDelete: 'cascade' }),
    readAt: timestamp('read_at', { withTimezone: true }),
    /** Set once the notification went out by email, alone or in a digest. */
    emailedAt: timestamp('emailed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('notification_user_idx').on(t.userId, t.createdAt.desc(), t.id.desc()),
    index('notification_unread_idx').on(t.userId).where(sql`${t.readAt} is null`),
    // The email job: unread notifications not emailed yet, oldest first.
    index('notification_email_idx')
      .on(t.createdAt)
      .where(sql`${t.emailedAt} is null and ${t.readAt} is null`),
    // Retention: notifications are removed after 90 days.
    index('notification_created_idx').on(t.createdAt),
    index('notification_actor_idx').on(t.actorId).where(sql`${t.actorId} is not null`),
    index('notification_subject_idx')
      .on(t.subjectUserId)
      .where(sql`${t.subjectUserId} is not null`),
    index('notification_actor_guest_idx')
      .on(t.actorGuestId)
      .where(sql`${t.actorGuestId} is not null`),
    // Comments are hard-deleted and cascade here.
    index('notification_comment_idx').on(t.commentId).where(sql`${t.commentId} is not null`),
    index('notification_share_link_idx').on(t.shareLinkId).where(sql`${t.shareLinkId} is not null`),
  ],
);

export const notificationPreference = pgTable('notification_preference', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  email: text('email', { enum: ['immediate', 'daily', 'off'] })
    .notNull()
    .default('immediate'),
  lastDigestAt: timestamp('last_digest_at', { withTimezone: true }),
  updatedAt: updatedAt(),
});

/**
 * Links for guests without an account. The token is looked up by its SHA-256 and kept sealed
 * (like link invitations) so managers can copy it again; the password only as a hash. Guest
 * sessions opened before `sessions_valid_after` (a password change) must enter it again. A link
 * acts for `created_by`: it works only while that person has at least editor on the board, and
 * shows only sub-boards where they have it (checked on every request, decision 0013).
 */
export const shareLink = pgTable(
  'share_link',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    boardId: uuid('board_id')
      .notNull()
      .references(() => board.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['guest_view', 'guest_comment', 'guest_approve'] }).notNull(),
    includeSubBoards: boolean('include_sub_boards').notNull().default(true),
    label: text('label'),
    tokenHash: text('token_hash').notNull().unique(),
    tokenSealed: text('token_sealed').notNull(),
    passwordHash: text('password_hash'),
    sessionsValidAfter: timestamp('sessions_valid_after', { withTimezone: true })
      .notNull()
      .defaultNow(),
    allowDownload: boolean('allow_download').notNull().default(false),
    proofing: boolean('proofing').notNull().default(false),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    /** Sessions opened or resumed, not polls. */
    viewCount: integer('view_count').notNull().default(0),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: createdAt(),
    /** Any change of the options; part of the guest snapshot ETag. */
    updatedAt: updatedAt(),
  },
  (t) => [
    index('share_link_board_idx').on(t.boardId),
    index('share_link_project_idx').on(t.projectId),
    index('share_link_created_by_idx').on(t.createdBy).where(sql`${t.createdBy} is not null`),
  ],
);

/**
 * The first time a link was opened for each version of its board (the newest named version at
 * that moment, '' before any). It only decides whether to notify the owner of the link: no
 * address, device or guest is stored, and views are not counted per row.
 */
export const shareLinkOpen = pgTable(
  'share_link_open',
  {
    shareLinkId: uuid('share_link_id')
      .notNull()
      .references(() => shareLink.id, { onDelete: 'cascade' }),
    versionKey: text('version_key').notNull(),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.shareLinkId, t.versionKey] })],
);

/**
 * A guest of a share link: the person behind one browser, with the name they typed. The cookie
 * token is looked up by its SHA-256 and replaced each time the guest opens the link again; it
 * is null after the guest leaves. The session lasts 30 days after the last request
 * (`session_expires_at`, moved forward at most once an hour) and never beyond the link expiry.
 * Rows are never deleted while their link exists: retention clears `name` once the link has
 * been revoked or expired for 90 days, so totals and authorship stay.
 */
export const shareGuest = pgTable(
  'share_guest',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shareLinkId: uuid('share_link_id')
      .notNull()
      .references(() => shareLink.id, { onDelete: 'cascade' }),
    name: text('name'),
    tokenHash: text('token_hash').unique(),
    authenticatedAt: timestamp('authenticated_at', { withTimezone: true }).notNull().defaultNow(),
    sessionExpiresAt: timestamp('session_expires_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    index('share_guest_link_idx').on(t.shareLinkId),
    unique('share_guest_id_link_uq').on(t.id, t.shareLinkId),
  ],
);

/** Photo proofing: what each guest picked, rejected or starred. */
export const sharePick = pgTable(
  'share_pick',
  {
    guestId: uuid('guest_id').notNull(),
    shareLinkId: uuid('share_link_id')
      .notNull()
      .references(() => shareLink.id, { onDelete: 'cascade' }),
    boardId: uuid('board_id')
      .notNull()
      .references(() => board.id, { onDelete: 'cascade' }),
    elementId: text('element_id').notNull(),
    /** The picture the card showed when it was picked. */
    assetId: uuid('asset_id').references(() => asset.id, { onDelete: 'set null' }),
    pick: text('pick', { enum: ['picked', 'rejected'] }),
    stars: integer('stars'),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.guestId, t.boardId, t.elementId] }),
    // The guest belongs to the link of the pick.
    foreignKey({
      name: 'share_pick_guest_fk',
      columns: [t.guestId, t.shareLinkId],
      foreignColumns: [shareGuest.id, shareGuest.shareLinkId],
    }).onDelete('cascade'),
    index('share_pick_link_idx').on(t.shareLinkId),
    index('share_pick_board_idx').on(t.boardId),
    check('share_pick_stars_ck', sql`${t.stars} between 1 and 5`),
    check('share_pick_value_ck', sql`${t.pick} is not null or ${t.stars} is not null`),
  ],
);

/** Saved states of a board document: a full Yjs update each (docs/decisions/0013). */
export const boardVersion = pgTable(
  'board_version',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    boardId: uuid('board_id')
      .notNull()
      .references(() => board.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['auto', 'named', 'restore'] }).notNull(),
    name: text('name'),
    state: bytea('state').notNull(),
    schemaVersion: integer('schema_version').notNull(),
    size: integer('size').notNull(),
    elementCount: integer('element_count').notNull(),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    /** Came with an imported project: the author's name there, display-only (decision 0037). */
    importedAuthor: text('imported_author'),
    createdAt: createdAt(),
    /** Retention removes the version after this; null for named versions. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => [
    index('board_version_board_idx').on(t.boardId, t.createdAt.desc(), t.id.desc()),
    index('board_version_expires_idx').on(t.expiresAt),
    index('board_version_created_by_idx').on(t.createdBy).where(sql`${t.createdBy} is not null`),
    check('board_version_named_ck', sql`${t.kind} <> 'named' or ${t.name} is not null`),
  ],
);

// Production planning is separate from storyboard content (decision 0022).
export const shootingDay = pgTable(
  'shooting_day',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    boardId: uuid('board_id')
      .notNull()
      .references(() => board.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    callTime: text('call_time').notNull(),
    wrap: text('wrap'),
    location: text('location').notNull(),
    notes: text('notes').notNull(),
    blocks: jsonb('blocks').$type<import('@inkadra/shared').ScheduleBlock[]>().notNull(),
    revision: integer('revision').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('shooting_day_board_date_idx').on(t.boardId, t.date)],
);

/** Bounded personal history of confirmed clip destinations. */
export const clipBoardUse = pgTable(
  'clip_board_use',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    boardId: uuid('board_id')
      .notNull()
      .references(() => board.id, { onDelete: 'cascade' }),
    usedAt: timestamp('used_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.boardId] }),
    index('clip_board_use_board_idx').on(t.boardId),
  ],
);

/**
 * Shared PDF and image export settings of a project (decision 0039). `preferences` holds the
 * dialog's starting choices as JSON, read field by field against ExportPreferences so a value a
 * later version adds or drops never breaks the row; the logo is an asset of the project.
 */
export const projectExportSettings = pgTable('project_export_settings', {
  projectId: uuid('project_id')
    .primaryKey()
    .references(() => project.id, { onDelete: 'cascade' }),
  preferences: jsonb('preferences').$type<Record<string, unknown>>().notNull().default({}),
  logoAssetId: uuid('logo_asset_id').references(() => asset.id, { onDelete: 'set null' }),
  updatedBy: uuid('updated_by').references(() => user.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Export, import and backups (docs/decisions/0037) ---------------------------

/**
 * A project export or import of one person, run by the worker. The archive lives in
 * `DATA_DIR/transfers/<id>.zip` (shared by the web and worker roles): exports until
 * `expires_at`, uploaded imports until they are read.
 */
export const projectTransfer = pgTable(
  'project_transfer',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind', { enum: ['export', 'import'] }).notNull(),
    status: text('status', { enum: ['queued', 'running', 'ready', 'failed'] })
      .notNull()
      .default('queued'),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** Export: the source. Import: the new project, once created. */
    projectId: uuid('project_id').references(() => project.id, { onDelete: 'set null' }),
    projectName: text('project_name').notNull(),
    /** Thousandths of the work done. */
    progress: integer('progress').notNull().default(0),
    size: bigint('size', { mode: 'number' }),
    failure: text('failure'),
    summary: jsonb('summary').$type<import('@inkadra/shared').TransferSummary>(),
    createdAt: createdAt(),
    /** Moves with every progress step: a `running` row still for 15 minutes is interrupted. */
    updatedAt: updatedAt(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => [
    index('project_transfer_user_idx').on(t.userId, t.createdAt.desc()),
    index('project_transfer_project_idx').on(t.projectId).where(sql`${t.projectId} is not null`),
    index('project_transfer_expires_idx').on(t.expiresAt).where(sql`${t.expiresAt} is not null`),
    // One import at a time per person: each holds a whole archive on disk.
    uniqueIndex('project_transfer_one_import_uq')
      .on(t.userId)
      .where(sql`${t.kind} = 'import' and ${t.status} in ('queued', 'running')`),
    index('project_transfer_active_idx')
      .on(t.updatedAt)
      .where(sql`${t.status} in ('queued', 'running')`),
  ],
);

/** Instance backups: rows survive their files so the history shows failures too. */
export const instanceBackup = pgTable(
  'instance_backup',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    trigger: text('trigger', { enum: ['scheduled', 'manual'] }).notNull(),
    status: text('status', { enum: ['running', 'ready', 'failed'] })
      .notNull()
      .default('running'),
    fileName: text('file_name'),
    size: bigint('size', { mode: 'number' }),
    copiedToBucket: boolean('copied_to_bucket').notNull().default(false),
    fileCount: integer('file_count'),
    fileBytes: bigint('file_bytes', { mode: 'number' }),
    failure: text('failure'),
    requestedBy: uuid('requested_by').references(() => user.id, { onDelete: 'set null' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * Moved by the running backup every few seconds. A `running` row older than 15 minutes is
     * marked `failed` (`interrupted`) by the next start or the hourly sweep, so a crash never
     * blocks later backups through the unique index below.
     */
    heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    /** Set once retention removed the archive. */
    removedAt: timestamp('removed_at', { withTimezone: true }),
  },
  (t) => [
    index('instance_backup_started_idx').on(t.startedAt.desc()),
    // One backup at a time across workers.
    uniqueIndex('instance_backup_running_uq').on(t.status).where(sql`${t.status} = 'running'`),
  ],
);
