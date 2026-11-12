// SPDX-License-Identifier: MPL-2.0
import { ListLimit } from './comments.ts';
import { Cursor, Id, Timestamp, z } from './common.ts';
import { UserSummary } from './users.ts';

/**
 * Saved states of a board document (docs/decisions/0013). Each version is a full Yjs update
 * kept in Postgres. Restoring writes the old content on top of the live document as a new
 * change, so open boards follow and nothing of the current state is lost: it is saved first
 * as a `restore` version.
 */

/** Named versions a board keeps at most; delete one to save another. */
export const MAX_NAMED_VERSIONS = 100;

export const BoardVersionKind = z.enum(['auto', 'named', 'restore']).openapi({
  description:
    '`auto`: taken by the server while the board is edited, removed by retention. `named`: ' +
    'saved by someone with a name, kept until deleted. `restore`: the state just before a ' +
    'restore, kept like an automatic one. Open: clients show a kind they do not know like ' +
    '`auto`.',
});
export type BoardVersionKind = z.infer<typeof BoardVersionKind>;

export const BoardVersion = z
  .object({
    id: Id,
    boardId: Id,
    kind: BoardVersionKind,
    name: z.string().nullable(),
    createdBy: UserSummary.nullable().openapi({ description: 'Null for automatic versions.' }),
    importedAuthor: z
      .string()
      .nullable()
      .optional()
      .openapi({
        description:
          'Imported versions (decision 0037): the author’s name on the exporting server, ' +
          'display-only; `createdBy` is then the person who imported. Missing before API 0.8.0.',
      }),
    createdAt: Timestamp,
    size: z.int().min(0).openapi({ description: 'Bytes of the stored state.' }),
    elementCount: z.int().min(0),
    docSchemaVersion: z.int().min(1),
    expiresAt: Timestamp.nullable().openapi({
      description: 'When retention will remove it; null for named versions.',
    }),
  })
  .openapi('BoardVersion');
export type BoardVersion = z.infer<typeof BoardVersion>;

export const BoardVersionQuery = z
  .object({
    kind: BoardVersionKind.optional(),
    cursor: Cursor.optional(),
    limit: ListLimit,
  })
  .openapi('BoardVersionQuery');

export const CreateBoardVersion = z
  .object({ name: z.string().trim().min(1).max(120) })
  .openapi('CreateBoardVersion');
export type CreateBoardVersion = z.infer<typeof CreateBoardVersion>;

export const UpdateBoardVersion = z
  .object({
    name: z.string().trim().min(1).max(120).openapi({
      description: 'Naming an automatic version makes it `named`, so retention keeps it.',
    }),
  })
  .openapi('UpdateBoardVersion');
export type UpdateBoardVersion = z.infer<typeof UpdateBoardVersion>;

/** `details` of a 409 answer about versions, so clients can tell the two conflicts apart. */
export const BoardVersionConflict = z
  .object({
    reason: z.enum(['named_versions_limit', 'newer_schema']).openapi({
      description:
        `\`named_versions_limit\`: the board already keeps ${MAX_NAMED_VERSIONS} named ` +
        'versions; delete one first. `newer_schema`: the version was saved by a newer ' +
        'Inkadra and this server cannot read it. Open: clients show a reason they do not know ' +
        'with the message of the answer.',
    }),
  })
  .openapi('BoardVersionConflict');
export type BoardVersionConflict = z.infer<typeof BoardVersionConflict>;

export const RestoredBoardVersion = z
  .object({
    restored: BoardVersion,
    backup: BoardVersion.openapi({ description: 'The state the board had before the restore.' }),
  })
  .openapi('RestoredBoardVersion');
export type RestoredBoardVersion = z.infer<typeof RestoredBoardVersion>;

/**
 * One restore of a board (decision 0112), so a client that edited offline can say who brought
 * the board back and to which version. The version's name and time are as they were at the
 * restore: renaming or pruning the version later does not change them.
 */
export const BoardRestore = z
  .object({
    count: z
      .int()
      .min(1)
      .openapi({
        description:
          'The board document’s `meta.restores` after this restore (decision 0109). A record ' +
          'with a count higher than the one the client reads in the document belongs to a ' +
          'restore not stored yet, or lost: ignore it.',
      }),
    restoredAt: Timestamp.openapi({
      description: 'When the record was saved, a moment after the board changed.',
    }),
    restoredBy: UserSummary.nullable().openapi({
      description: 'Null below editor, and when the account was deleted since.',
    }),
    version: z
      .object({
        id: Id.openapi({ description: 'May no longer exist: versions are pruned and deleted.' }),
        kind: BoardVersionKind,
        name: z.string().nullable().openapi({ description: 'Null for an unnamed version.' }),
        createdAt: Timestamp,
      })
      .nullable()
      .openapi({ description: 'The version the board was brought back to. Null below editor.' }),
  })
  .openapi('BoardRestore');
export type BoardRestore = z.infer<typeof BoardRestore>;

export const BoardRestoreQuery = z
  .object({
    // Not z.coerce: it turns null into 0, and the OpenAPI document would then allow null.
    after: z
      .preprocess(
        (v) => (v === undefined || v === null ? v : Number(v)),
        z.int().min(0).max(2147483647),
      )
      .default(0)
      .openapi({
        description: 'The restore count the client last confirmed: only later restores are listed.',
      }),
  })
  .openapi('BoardRestoreQuery');

export const BoardRestores = z
  .object({
    items: z.array(BoardRestore).openapi({
      description:
        'Highest count first, at most the last 50 saved for the board. The record is saved just ' +
        'after the board changes, so a client can see a count before its record: when one is ' +
        'missing, ask again for a few seconds, then show the restore without details. Fewer ' +
        'records than the counts differ by also means older ones are gone, or one failed to ' +
        'save; the counts still say how many restores there were.',
    }),
  })
  .openapi('BoardRestores');
export type BoardRestores = z.infer<typeof BoardRestores>;

/**
 * Who wrote under a Yjs client id of a board (decision 0120), so a client that finds a field
 * changed by someone else while it was offline can name them. The server maps the ids it
 * receives on authenticated sockets to accounts; the board document itself carries no author.
 */

/** Capability on `GET /instance/version` of servers that answer `POST /boards/{id}/writers`. */
export const BOARD_WRITERS_CAPABILITY = 'board-writers';

/** Yjs client ids are unsigned 32-bit integers. */
const YjsClientId = z.int().min(0).max(4294967295);

export const BoardWritersQuery = z
  .object({
    items: z
      .array(
        z.object({
          client: YjsClientId.openapi({
            description: 'The Yjs client id that wrote the item (`item.id.client`).',
          }),
          clock: z
            .int()
            .min(0)
            .optional()
            .openapi({
              description:
                'The item’s clock (`item.id.clock`): `changedAt` is then the time that write ' +
                'reached the server. Without it, `changedAt` is the last time the id wrote.',
            }),
        }),
      )
      .min(1)
      .max(50)
      .openapi({ description: '1 to 50 lookups; the answer has one item per lookup, in order.' }),
  })
  .openapi('BoardWritersQuery');
export type BoardWritersQuery = z.infer<typeof BoardWritersQuery>;

export const BoardWriterKind = z
  .enum(['user', 'server', 'deleted', 'unknown', 'contested'])
  .openapi({
    description:
      '`user`: an account wrote under this id, named in `user` (also when they are no longer ' +
      'a member). `server`: the server itself (a restore, a clip, a migration). `deleted`: the ' +
      'account was deleted since. `unknown`: no record, because the write is older than 30 ' +
      'days, older than this feature, came from an archive, was only a deletion, or reached the ' +
      'server in the last few seconds; retry for a few seconds, then show the change without a ' +
      'name. `contested`: more than one account wrote under this id, so nobody is named. Open: ' +
      'clients treat a kind they do not know like `unknown`.',
  });
export type BoardWriterKind = z.infer<typeof BoardWriterKind>;

export const BoardWriter = z
  .object({
    client: YjsClientId,
    kind: BoardWriterKind,
    user: UserSummary.nullable().openapi({
      description: 'Set only for `user`; never an email.',
    }),
    changedAt: Timestamp.nullable().openapi({
      description:
        'About to the minute: when the write with the asked clock reached the server (the ' +
        'first mark at or after that clock), else `lastSeenAt`. Null for `unknown`.',
    }),
    lastSeenAt: Timestamp.nullable().openapi({
      description: 'The last time the server stored a write under this id. Null for `unknown`.',
    }),
  })
  .openapi('BoardWriter');
export type BoardWriter = z.infer<typeof BoardWriter>;

export const BoardWriters = z
  .object({
    items: z.array(BoardWriter).openapi({
      description:
        'One per lookup, in the order asked. A client may cache an answer per (boardId, ' +
        'client, clock) for the session: an answer other than `unknown` never changes, and ' +
        '`unknown` may later become known, so cache everything but `unknown`.',
    }),
  })
  .openapi('BoardWriters');
export type BoardWriters = z.infer<typeof BoardWriters>;
