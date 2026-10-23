import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
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
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.boardId, t.userId] })],
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
});

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
