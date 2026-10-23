import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
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
  twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const session = pgTable(
  'session',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    token: text('token').notNull().unique(),
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
  iconShape: text('icon_shape', { enum: ['diamond', 'circle', 'triangle', 'square'] })
    .notNull()
    .default('circle'),
  iconColor: text('icon_color', { enum: ['blue', 'orange', 'purple', 'green', 'neutral'] })
    .notNull()
    .default('neutral'),
  position: text('position').notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
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
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.userId] }),
    index('project_member_user_idx').on(t.userId),
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
  },
  (t) => [
    primaryKey({ columns: [t.boardId, t.userId] }),
    index('board_grant_user_idx').on(t.userId),
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
    status: text('status', { enum: ['pending', 'processing', 'ready', 'failed'] })
      .notNull()
      .default('pending'),
    exif: jsonb('exif').$type<Record<string, unknown>>(),
    palette: jsonb('palette').$type<string[]>(),
    sourceUrl: text('source_url'),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
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
    size: text('size', { enum: ['256', '512', '1024', '2048'] }).notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    storageKey: text('storage_key').notNull(),
  },
  (t) => [primaryKey({ columns: [t.assetId, t.size] })],
);

// Review and sharing (docs/decisions/0013) -------------------------------------

/**
 * Comments on a board (`element_id` null) or one of its cards. A reply points to the first
 * comment of its thread; replies have no replies. The author is an account, a guest of a share
 * link, or nobody once the account is deleted. `mentions` holds the user ids written as
 * `@{id}` in the body that could read the board when it was saved.
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
    authorGuestId: uuid('author_guest_id').references(() => shareGuest.id, {
      onDelete: 'set null',
    }),
    body: text('body').notNull(),
    mentions: uuid('mentions').array().notNull().default(sql`'{}'::uuid[]`),
    visibility: text('visibility', { enum: ['team', 'everyone'] })
      .notNull()
      .default('team'),
    pin: jsonb('pin').$type<{ x: number; y: number }>(),
    /** Thread starts only. */
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: uuid('resolved_by').references(() => user.id, { onDelete: 'set null' }),
    resolvedByGuest: uuid('resolved_by_guest').references(() => shareGuest.id, {
      onDelete: 'set null',
    }),
    /** Thread starts: the last reply or edit, to list the liveliest threads first. */
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    foreignKey({ columns: [t.threadId], foreignColumns: [t.id] }).onDelete('cascade'),
    index('comment_board_idx').on(t.boardId, t.elementId),
    index('comment_thread_idx').on(t.threadId),
    index('comment_activity_idx').on(t.boardId, t.lastActivityAt),
  ],
);

const reviewStatusEnum = ['none', 'in_review', 'approved', 'changes_requested'] as const;

/** Current review status of a card; the history is in element_review_event. */
export const elementReview = pgTable(
  'element_review',
  {
    boardId: uuid('board_id')
      .notNull()
      .references(() => board.id, { onDelete: 'cascade' }),
    elementId: text('element_id').notNull(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    status: text('status', { enum: reviewStatusEnum }).notNull(),
    note: text('note'),
    changedBy: uuid('changed_by').references(() => user.id, { onDelete: 'set null' }),
    changedByGuest: uuid('changed_by_guest').references(() => shareGuest.id, {
      onDelete: 'set null',
    }),
    /** Who last set `in_review`: told about the decision. */
    requestedBy: uuid('requested_by').references(() => user.id, { onDelete: 'set null' }),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.boardId, t.elementId] }),
    index('element_review_project_idx').on(t.projectId),
  ],
);

/** Every change of a review status, never edited. */
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
    guestId: uuid('guest_id').references(() => shareGuest.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('element_review_event_element_idx').on(t.boardId, t.elementId, t.createdAt)],
);

/** In-app notifications; email is sent from these rows according to the preference. */
export const notification = pgTable(
  'notification',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    type: text('type', {
      enum: ['mention', 'reply', 'comment', 'review', 'invitation_accepted'],
    }).notNull(),
    actorId: uuid('actor_id').references(() => user.id, { onDelete: 'set null' }),
    actorGuestId: uuid('actor_guest_id').references(() => shareGuest.id, { onDelete: 'set null' }),
    projectId: uuid('project_id').references(() => project.id, { onDelete: 'cascade' }),
    boardId: uuid('board_id').references(() => board.id, { onDelete: 'cascade' }),
    elementId: text('element_id'),
    commentId: uuid('comment_id').references(() => comment.id, { onDelete: 'cascade' }),
    reviewStatus: text('review_status', { enum: reviewStatusEnum }),
    excerpt: text('excerpt'),
    readAt: timestamp('read_at', { withTimezone: true }),
    /** Set once the notification went out by email, alone or in a digest. */
    emailedAt: timestamp('emailed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('notification_user_idx').on(t.userId, t.createdAt),
    index('notification_unread_idx').on(t.userId).where(sql`${t.readAt} is null`),
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
 * sessions opened before `sessions_valid_after` (a password change) must enter it again.
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
    viewCount: integer('view_count').notNull().default(0),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('share_link_board_idx').on(t.boardId),
    index('share_link_project_idx').on(t.projectId),
  ],
);

/**
 * A guest of a share link: the person behind one browser, with the name they typed. The cookie
 * token is looked up by its SHA-256 and replaced each time the guest opens the link again.
 */
export const shareGuest = pgTable(
  'share_guest',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shareLinkId: uuid('share_link_id')
      .notNull()
      .references(() => shareLink.id, { onDelete: 'cascade' }),
    name: text('name'),
    tokenHash: text('token_hash').notNull().unique(),
    authenticatedAt: timestamp('authenticated_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [index('share_guest_link_idx').on(t.shareLinkId)],
);

/** Photo proofing: what each guest picked, rejected or starred. */
export const sharePick = pgTable(
  'share_pick',
  {
    guestId: uuid('guest_id')
      .notNull()
      .references(() => shareGuest.id, { onDelete: 'cascade' }),
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
    index('share_pick_link_idx').on(t.shareLinkId),
    check('share_pick_stars_ck', sql`${t.stars} between 1 and 5`),
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
    createdAt: createdAt(),
    /** Retention removes the version after this; null for named versions. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => [
    index('board_version_board_idx').on(t.boardId, t.createdAt),
    index('board_version_expires_idx').on(t.expiresAt),
  ],
);
