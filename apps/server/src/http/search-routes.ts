import {
  type CastAppearance,
  castAppearances,
  mergeProjectKits,
  type ProjectKitEntry,
  projectKit,
} from '@inkadra/canvas-core';
import { type Element, type ElementType, readElement, roots } from '@inkadra/doc-schema';
import {
  API_PREFIX,
  type BoardKind,
  CastAppearancesQuery,
  classificationOption,
  Id,
  PlanKitQuery,
  type ProjectRole,
  type SearchHit,
  SearchQuery,
  type TagCount,
  z,
} from '@inkadra/shared';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from 'fastify';
import * as Y from 'yjs';
import {
  type Actor,
  activeAccount,
  activeGrant,
  activeMember,
  boardReadable,
  effectiveRoles,
  live,
} from '../access.ts';
import type { Auth } from '../auth.ts';
import { readClassifications } from '../classifications.ts';
import type { Database } from '../db/client.ts';
import { board, boardDoc, boardElementIndex, boardGrant, projectMember } from '../db/schema.ts';
import { RateLimiter } from '../rate-limits.ts';
import { requireActor } from './auth-routes.ts';
import { HttpError } from './errors.ts';

interface Deps {
  db: Database;
  auth: Auth;
}

const ProjectParams = z.object({ projectId: Id });
const SNIPPET = 140;
/** Board documents read for one answer of cast-appearances or plan-kit. */
const MAX_CAST_BOARDS = 40;

/** `q` as a LIKE pattern that matches it anywhere, with % and _ taken literally. */
export function containsPattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** `w` as a prefix LIKE pattern, with % and _ taken literally. */
export function prefixPattern(w: string): string {
  return `${w.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Words to match against element tags (both exact and as prefix). */
export function searchTagPatterns(q: string): { words: string[]; prefixes: string[] } {
  const norm = q.trim().toLowerCase().replace(/^#/, '');
  const rawWords = norm.split(/\s+/).filter(Boolean);
  const words = [...new Set([norm, ...rawWords])].filter(Boolean);
  const prefixes = words.map(prefixPattern);
  return { words, prefixes };
}

/** About SNIPPET characters of `text` around the first match of `q`. */
export function snippet(text: string, q: string | undefined): string | null {
  if (!text) return null;
  const at = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (text.length <= SNIPPET) return text;
  const start = Math.max(0, (at === -1 ? 0 : at) - 40);
  const end = Math.min(text.length, start + SNIPPET);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

type Row = Record<string, unknown>;

interface Readable {
  /** Boards the person can open, with the same rule as everywhere else (decision 0011). */
  boardIds: string[];
  /** Projects whose root board the person can open: those show up as project results. */
  projectIds: string[];
  /** The person's role on each board of `boardIds`, and on each project (its root board). */
  roles: Map<string, ProjectRole>;
}

/**
 * What the person may find: boards of projects they are a member of, and the subtrees of the
 * boards they were given, minus the boards a grant closes. Trashed boards are left out.
 */
export async function readableBoards(
  db: Database,
  actor: Pick<Actor, 'id'>,
  onlyProject?: string,
): Promise<Readable> {
  const scope = (col: typeof projectMember.projectId | typeof board.projectId) =>
    onlyProject ? eq(col, onlyProject) : undefined;
  const [memberships, grantRows] = await Promise.all([
    db
      .select({ projectId: projectMember.projectId, role: projectMember.role })
      .from(projectMember)
      .where(
        and(eq(projectMember.userId, actor.id), scope(projectMember.projectId), activeMember()),
      ),
    db
      .select({ boardId: boardGrant.boardId, role: boardGrant.role, projectId: board.projectId })
      .from(boardGrant)
      .innerJoin(board, eq(board.id, boardGrant.boardId))
      .where(
        and(
          eq(boardGrant.userId, actor.id),
          isNull(board.deletedAt),
          scope(board.projectId),
          activeGrant(),
        ),
      ),
  ]);
  const projectRoles = new Map<string, ProjectRole>(memberships.map((m) => [m.projectId, m.role]));
  const grants = new Map<string, Map<string, ProjectRole>>();
  for (const g of grantRows) {
    const map = grants.get(g.projectId) ?? new Map<string, ProjectRole>();
    map.set(g.boardId, g.role);
    grants.set(g.projectId, map);
  }
  const projects = [...new Set([...projectRoles.keys(), ...grants.keys()])];
  if (projects.length === 0) return { boardIds: [], projectIds: [], roles: new Map() };
  const boards = await db
    .select({ id: board.id, parentBoardId: board.parentBoardId, projectId: board.projectId })
    .from(board)
    .where(and(inArray(board.projectId, projects), isNull(board.deletedAt)));
  const byProject = new Map<string, typeof boards>();
  for (const b of boards) byProject.set(b.projectId, [...(byProject.get(b.projectId) ?? []), b]);
  const boardIds: string[] = [];
  const projectIds: string[] = [];
  const out = new Map<string, ProjectRole>();
  for (const projectId of projects) {
    const tree = byProject.get(projectId) ?? [];
    const roles = effectiveRoles(
      tree,
      grants.get(projectId) ?? new Map(),
      projectRoles.get(projectId) ?? null,
    );
    for (const b of tree) {
      const role = roles.get(b.id)?.role;
      if (!role) continue;
      boardIds.push(b.id);
      out.set(b.id, role);
      if (b.parentBoardId === null) {
        projectIds.push(projectId);
        out.set(projectId, role);
      }
    }
  }
  return { boardIds, projectIds, roles: out };
}

/** What the project kit routes derive from one stored board document (decisions 0095, 0114). */
interface BoardKit {
  cast: CastAppearance[];
  plan: ProjectKitEntry[];
}

type Part = keyof BoardKit;
/** The cards whose index rows say a board has something for that part. */
const PART_TYPE: Record<Part, ElementType> = { cast: 'frame', plan: 'plan' };

/** One part of the kit of a stored document, decoded for this alone. */
function kitOf<P extends Part>(state: Uint8Array, part: P): BoardKit[P] {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    const elements = [...roots(doc).elements.values()].flatMap((map): Element[] => {
      const el = readElement(map);
      return el ? [el] : [];
    });
    return (
      part === 'cast'
        ? castAppearances(elements)
        : projectKit(
            elements.filter((e): e is Extract<Element, { type: 'plan' }> => e.type === 'plan'),
          )
    ) as BoardKit[P];
  } finally {
    doc.destroy();
  }
}

/**
 * Which stored bytes a row holds. shortcut: xmin changes with every write of the row, so it
 * cannot come back for other bytes with the same stored timestamp and size unless transaction
 * ids wrap around. It also changes when the index writer, in its own transaction after a store,
 * writes the row's derived columns (same state): a board stored meanwhile can be decoded once
 * more. No cheaper fact of the state alone tells two states apart; a hash would read them all.
 */
const version = sql<string>`${boardDoc.updatedAt}::text || '/' || ${boardDoc.size} || '/' || board_doc.xmin::text`;

/**
 * The parts derived lately, by part and board, least recently used first, with the version of
 * the bytes they come from and their size as JSON (an estimate of their memory).
 */
const kitCache = new Map<string, { version: string; value: unknown; size: number }>();
const KIT_CACHE_ENTRIES = 500;
export const KIT_CACHE_CHARS = 8_000_000;
let kitCacheChars = 0;

export function cachedPart<P extends Part>(part: P, boardId: string) {
  const key = `${part}:${boardId}`;
  const entry = kitCache.get(key);
  if (entry) {
    kitCache.delete(key);
    kitCache.set(key, entry);
  }
  return entry as { version: string; value: BoardKit[P] } | undefined;
}

export function keepPart(part: Part, boardId: string, version: string, value: unknown) {
  const key = `${part}:${boardId}`;
  const old = kitCache.get(key);
  if (old) {
    kitCache.delete(key);
    kitCacheChars -= old.size;
  }
  const size = JSON.stringify(value).length;
  // One huge kit would push out hundreds of others: it is derived again instead.
  if (size > KIT_CACHE_CHARS / 20) return;
  kitCache.set(key, { version, value, size });
  kitCacheChars += size;
  for (const [oldest, entry] of kitCache) {
    if (kitCache.size <= KIT_CACHE_ENTRIES && kitCacheChars <= KIT_CACHE_CHARS) break;
    kitCache.delete(oldest);
    kitCacheChars -= entry.size;
  }
}

/** Kits decoded and requests waiting for a decode, in this process (read by the tests). */
export const kitDecodes = { decoded: 0, waiting: 0 };
/**
 * Requests that may wait for a decode. A request beyond them is answered 503: a partial answer
 * would be kept by the clients as if it were whole.
 */
export const MAX_WAITING_DECODES = 16;
/** Decodes one account may have waiting or running, so one person cannot take every place. */
export const MAX_DECODES_PER_ACCOUNT = 4;
const perAccount = new Map<string, number>();
let decoding: Promise<unknown> = Promise.resolve();

/**
 * Runs `task` for `account` once every task given before it has settled, one at a time in the
 * process; null, without running it, when MAX_WAITING_DECODES requests already wait or the
 * account already has MAX_DECODES_PER_ACCOUNT waiting or running.
 */
export function oneAtATime<T>(task: () => Promise<T>, account: string): Promise<T> | null {
  const mine = perAccount.get(account) ?? 0;
  if (kitDecodes.waiting >= MAX_WAITING_DECODES || mine >= MAX_DECODES_PER_ACCOUNT) return null;
  perAccount.set(account, mine + 1);
  kitDecodes.waiting += 1;
  const run = decoding.then(() => {
    kitDecodes.waiting -= 1;
    return task();
  });
  const settled = () => {
    const left = (perAccount.get(account) ?? 1) - 1;
    if (left > 0) perAccount.set(account, left);
    else perAccount.delete(account);
  };
  decoding = run.then(settled, settled);
  return run;
}

/**
 * The `part` of the kits of the boards among `ids` (all readable by `actor` when asked) whose
 * index says they hold its cards: the most recently edited MAX_CAST_BOARDS, most recent first,
 * as decoded from their stored documents. A part derived from the same stored bytes is reused;
 * the others are decoded one board at a time in the process, read only while `actor` can still
 * read the board, letting other requests run between them. `gone`: the client went away.
 */
async function boardKits<P extends Part>(
  db: Database,
  actor: Pick<Actor, 'id'>,
  projectId: string,
  ids: string[],
  part: P,
  gone: () => boolean,
  log: FastifyBaseLogger,
): Promise<Array<BoardKit[P]>> {
  if (ids.length === 0) return [];
  const type = PART_TYPE[part];
  const rows = await db
    .select({ boardId: boardDoc.boardId, version })
    .from(boardDoc)
    .where(
      and(
        inArray(boardDoc.boardId, ids),
        // Again in this statement: a cached part is served only for a board readable now.
        boardReadable(boardDoc.boardId, actor.id),
        sql`exists (select 1 from ${boardElementIndex}
          where ${boardElementIndex.boardId} = ${boardDoc.boardId}
            and ${boardElementIndex.type} = ${type})`,
      ),
    )
    .orderBy(desc(boardDoc.updatedAt))
    .limit(MAX_CAST_BOARDS);
  const out: Array<BoardKit[P]> = [];
  for (const row of rows) {
    const cached = cachedPart(part, row.boardId);
    if (cached?.version === row.version) {
      out.push(cached.value);
      continue;
    }
    if (gone()) break;
    const queued = oneAtATime(async () => {
      if (gone()) return null;
      await new Promise((resolve) => setImmediate(resolve));
      // The request's own rule again, as if it had just arrived: its account may have been
      // deactivated, a grant closed or a board (or one above it) trashed while it waited.
      if (!(await activeAccount(db, actor.id)))
        throw new HttpError('unauthorized', 'Account deactivated.');
      if (!(await readableBoards(db, actor, projectId)).boardIds.includes(row.boardId)) return null;
      // Then the access rule in the same statement as the state, for what changed since. The
      // state only when no request before this one decoded the same version meanwhile.
      const known = cachedPart(part, row.boardId);
      const [stored] = await db
        .select({
          version,
          state: sql<Uint8Array | null>`case when ${version} = ${known?.version ?? ''} then null
            else ${boardDoc.state} end`,
        })
        .from(boardDoc)
        .where(and(eq(boardDoc.boardId, row.boardId), boardReadable(boardDoc.boardId, actor.id)));
      if (!stored) return null;
      if (!stored.state) return known?.value ?? null;
      // Nobody is left to answer: the decode is for nothing.
      if (gone()) return null;
      try {
        const derived = kitOf(stored.state, part);
        kitDecodes.decoded += 1;
        keepPart(part, row.boardId, stored.version, derived);
        return derived;
      } catch (err) {
        // One unreadable document must not cost the answers of all the others.
        log.warn({ err, boardId: row.boardId }, `${type} cards: board document not readable`);
        return null;
      }
    }, actor.id);
    if (!queued) throw new HttpError('unavailable', 'The server is busy. Try again.', undefined, 5);
    const kit = await queued;
    if (kit) out.push(kit);
  }
  return out;
}

/** Whether the client of `req` went away: its connection closed before the answer. */
const gone = (req: FastifyRequest) => () => req.raw.socket?.destroyed === true;

const uuids = (ids: string[]) => sql`${`{${ids.join(',')}}`}::uuid[]`;

export function registerSearchRoutes(app: FastifyInstance, { db, auth }: Deps) {
  const v1 = (path: string) => `${API_PREFIX}${path}`;
  // Each search ranks trigrams over every card a person can read: a person typing makes a few
  // a second at most, a script would keep the database busy for everyone.
  const searches = new RateLimiter(60, 60_000, 'search-routes:searches');
  // Each project kit may decode up to MAX_CAST_BOARDS documents; the editor asks once a minute per
  // board, so a person never needs more than a few (decision 0114).
  const kits = new RateLimiter(20, 60_000, 'search-routes:kits');

  app.get(v1('/projects/:projectId/cast-appearances'), async (req) => {
    const actor = await requireActor(auth, req, db);
    await kits.require(actor.id, 'Too many reads of the project kit. Try again in a minute.');
    const { projectId } = ProjectParams.parse(req.params);
    const { excludeBoardId } = CastAppearancesQuery.parse(req.query ?? {});
    const { boardIds } = await readableBoards(db, actor, projectId);
    const merged = new Map<string, { frames: number; scenes: Set<string> }>();
    const ids = boardIds.filter((id) => id !== excludeBoardId);
    for (const cast of await boardKits(db, actor, projectId, ids, 'cast', gone(req), req.log))
      for (const entry of cast) {
        const seen = merged.get(entry.name) ?? { frames: 0, scenes: new Set<string>() };
        seen.frames += entry.frames;
        for (const scene of entry.scenes) seen.scenes.add(scene);
        merged.set(entry.name, seen);
      }
    const items: CastAppearance[] = [...merged].map(([name, { frames, scenes }]) => ({
      name,
      frames,
      scenes: [...scenes],
    }));
    return { items };
  });

  // The project kit of the set plan editor (decision 0114): the configured lights and cameras of
  // the plans of the other boards the caller can read, derived on each request, never stored.
  app.get(v1('/projects/:projectId/plan-kit'), async (req) => {
    const actor = await requireActor(auth, req, db);
    await kits.require(actor.id, 'Too many reads of the project kit. Try again in a minute.');
    const { projectId } = ProjectParams.parse(req.params);
    const { excludeBoardId } = PlanKitQuery.parse(req.query ?? {});
    const { boardIds } = await readableBoards(db, actor, projectId);
    const ids = boardIds.filter((id) => id !== excludeBoardId);
    const boards = await boardKits(db, actor, projectId, ids, 'plan', gone(req), req.log);
    // At most MAX_CAST_BOARDS kits, merged in one pass.
    return { items: mergeProjectKits(...boards) };
  });

  app.get(v1('/search'), async (req) => {
    const actor = await requireActor(auth, req, db);
    await searches.require(actor.id, 'Too many searches. Try again in a minute.');
    const query = SearchQuery.parse(req.query ?? {});
    const readable = await readableBoards(db, actor, query.projectId);
    if (readable.boardIds.length === 0) return { items: [] };
    const boardIn = uuids(readable.boardIds);
    const q = query.q && query.q.length > 0 ? query.q : undefined;
    const catalogs = await readClassifications(db);
    const selectedTag = query.tag
      ? (classificationOption(catalogs.tags, query.tag) ??
        catalogs.tags.find((o) => o.label.toLowerCase() === query.tag?.toLowerCase()))
      : undefined;
    const tag = query.tag?.toLowerCase();
    const tagBindings = selectedTag
      ? [selectedTag.id, selectedTag.legacy].filter((v): v is string => !!v)
      : tag
        ? [tag]
        : [];
    const like = q ? containsPattern(q) : null;
    // A type in a project without words lists those cards, and characters and locations are
    // found by name: an unnamed one would only show the title of its board.
    const listing =
      (!q && !tag && !!query.type) || query.type === 'character' || query.type === 'location';
    const hits: SearchHit[] = [];

    if (q && !tag && !query.type) {
      const projects =
        readable.projectIds.length > 0
          ? await db.execute<Row>(sql`
        select p.id, p.name from project p
        where p.id = any(${uuids(readable.projectIds)}) and p.name ilike ${like}
        order by word_similarity(${q}, p.name) desc, p.name
        limit ${query.limit}`)
          : [];
      for (const r of projects) {
        hits.push({
          kind: 'project',
          projectId: r.id as string,
          projectName: r.name as string,
          boardId: null,
          boardTitle: null,
          boardKind: null,
          elementId: null,
          elementType: null,
          title: r.name as string,
          snippet: null,
          assetId: null,
          tags: [],
          myRole: readable.roles.get(r.id as string),
        });
      }
      const boards = await db.execute<Row>(sql`
        select b.id, b.title, b.kind, b.cover_asset_id, p.id as project_id, p.name
        from board b join project p on p.id = b.project_id
        where b.id = any(${boardIn}) and b.parent_board_id is not null
          and b.title ilike ${like}
        order by word_similarity(${q}, b.title) desc, b.title
        limit ${query.limit}`);
      for (const r of boards) {
        hits.push({
          kind: 'board',
          projectId: r.project_id as string,
          projectName: r.name as string,
          boardId: r.id as string,
          boardTitle: r.title as string,
          boardKind: r.kind as BoardKind,
          elementId: null,
          elementType: null,
          title: r.title as string,
          snippet: null,
          assetId: (r.cover_asset_id as string | null) ?? null,
          tags: [],
          myRole: readable.roles.get(r.id as string),
        });
      }
      // People of the crew by name, role or department. The roster is the project members'
      // (decision 0091): a grant on one board never finds it. They open the Troupe view of the
      // Production board, so only while the project has a live one (decision 0123).
      const crew = await db.execute<Row>(sql`
        select c.id, c.name, c.role, c.department, p.id as project_id, p.name as project_name,
               pb.id as root_id, pb.title as root_title, pb.kind as root_kind
        from crew_member c
        join project p on p.id = c.project_id
        join project_member m on m.project_id = c.project_id and m.user_id = ${actor.id}
          and ${live('m')}
        join board pb on pb.project_id = c.project_id and pb.kind = 'production'
          and pb.deleted_at is null
        where pb.id = any(${boardIn})
          and (c.name ilike ${like} or c.role ilike ${like} or c.department ilike ${like})
        order by word_similarity(${q}, c.name) desc, c.name
        limit ${query.limit}`);
      for (const r of crew) {
        hits.push({
          kind: 'element',
          projectId: r.project_id as string,
          projectName: r.project_name as string,
          boardId: r.root_id as string,
          boardTitle: r.root_title as string,
          boardKind: r.root_kind as BoardKind,
          elementId: r.id as string,
          elementType: 'crew',
          title: r.name as string,
          snippet: [r.role, r.department].filter(Boolean).join(' · ') || null,
          assetId: null,
          tags: [],
          myRole: readable.roles.get(r.root_id as string),
        });
      }
      // The location of a shooting day, on the Production boards whose schedule the person can
      // open: only they show a schedule (decision 0123).
      const days = await db.execute<Row>(sql`
        select d.id, d.date, d.location, b.id as board_id, b.title as board_title,
               b.kind as board_kind, p.id as project_id, p.name
        from shooting_day d
        join board b on b.id = d.board_id and b.kind = 'production'
        join project p on p.id = d.project_id
        where d.board_id = any(${boardIn}) and d.location ilike ${like}
        order by d.date, d.id
        limit ${query.limit}`);
      for (const r of days) {
        const location = r.location as string;
        hits.push({
          kind: 'element',
          projectId: r.project_id as string,
          projectName: r.name as string,
          boardId: r.board_id as string,
          boardTitle: r.board_title as string,
          boardKind: r.board_kind as BoardKind,
          elementId: r.id as string,
          elementType: 'shootingDay',
          // Its first line names the place; a map link is no title.
          title:
            location
              .split('\n')
              .map((line) => line.trim())
              .find((line) => line && !/^https?:\/\//i.test(line)) ?? (r.date as string),
          // The date of the day (YYYY-MM-DD): a search finds a place, then when it is shot.
          snippet: r.date as string,
          assetId: null,
          tags: [],
          myRole: readable.roles.get(r.board_id as string),
        });
      }
    }

    const tagMatch =
      q && !tag
        ? (() => {
            const { words, prefixes } = searchTagPatterns(q);
            for (const option of catalogs.tags) {
              if (option.label.toLowerCase().includes(q.toLowerCase().replace(/^#/, ''))) {
                words.push(option.id);
                if (option.legacy) words.push(option.legacy);
              }
            }
            if (words.length === 0) return null;
            const wordsArr = sql`array[${sql.join(
              words.map((w) => sql`${w}`),
              sql`, `,
            )}]::text[]`;
            const prefArr = sql`array[${sql.join(
              prefixes.map((p) => sql`${p}`),
              sql`, `,
            )}]::text[]`;
            return sql`or i.tags && ${wordsArr} or exists (select 1 from unnest(i.tags) as t where t like any(${prefArr}))`;
          })()
        : null;

    const elements = await db.execute<Row>(sql`
      select i.board_id, i.element_id, i.type, i.title, i.text, i.tags, i.asset_id,
             b.title as board_title, b.kind as board_kind, p.id as project_id, p.name
      from board_element_index i
      join board b on b.id = i.board_id
      join project p on p.id = i.project_id
      where i.board_id = any(${boardIn})
        ${
          like
            ? tagMatch
              ? sql`and (i.text ilike ${like} ${tagMatch})`
              : sql`and i.text ilike ${like}`
            : sql``
        }
        ${
          tag
            ? sql`and i.tags && array[${sql.join(
                tagBindings.map((v) => sql`${v}`),
                sql`, `,
              )}]::text[]`
            : sql``
        }
        ${query.type ? sql`and i.type = ${query.type}` : sql``}
        ${listing ? sql`and i.title <> ''` : sql``}
      order by ${
        q
          ? sql`greatest(word_similarity(${q}, i.text), word_similarity(${q}, array_to_string(i.tags, ' '))) desc,`
          : sql``
      } i.updated_at desc
      limit ${query.limit}`);
    for (const r of elements) {
      const text = r.text as string;
      hits.push({
        kind: 'element',
        projectId: r.project_id as string,
        projectName: r.name as string,
        boardId: r.board_id as string,
        boardTitle: r.board_title as string,
        boardKind: r.board_kind as BoardKind,
        elementId: r.element_id as string,
        elementType: r.type as string,
        title: (r.title as string) || (r.board_title as string),
        snippet: snippet(text, q),
        assetId: (r.asset_id as string | null) ?? null,
        tags: r.tags as string[],
        myRole: readable.roles.get(r.board_id as string),
      });
    }
    return { items: hits.slice(0, query.limit) };
  });

  app.get(v1('/projects/:projectId/tags'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const { projectId } = ProjectParams.parse(req.params);
    const { boardIds } = await readableBoards(db, actor, projectId);
    // Same answer as for a project that does not exist, so ids cannot be probed.
    if (boardIds.length === 0) throw new HttpError('not_found', 'Project not found.');
    const rows = await db.execute<{ tag: string; count: string }>(sql`
      select t.tag, count(*) as count
      from board_element_index i
      cross join lateral unnest(i.tags) as t(tag)
      where i.board_id = any(${uuids(boardIds)})
      group by t.tag
      order by count(*) desc, t.tag
      limit 500`);
    const items: TagCount[] = rows.map((r) => ({ tag: r.tag, count: Number(r.count) }));
    return { items };
  });
}
