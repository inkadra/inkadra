import {
  API_PREFIX,
  Id,
  type ProjectRole,
  type SearchHit,
  SearchQuery,
  type TagCount,
  z,
} from '@inkadra/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { type Actor, effectiveRoles } from '../access.ts';
import type { Auth } from '../auth.ts';
import type { Database } from '../db/client.ts';
import { board, boardGrant, projectMember } from '../db/schema.ts';
import { requireActor } from './auth-routes.ts';
import { HttpError } from './errors.ts';

interface Deps {
  db: Database;
  auth: Auth;
}

const ProjectParams = z.object({ projectId: Id });
const SNIPPET = 140;

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
      .where(and(eq(projectMember.userId, actor.id), scope(projectMember.projectId))),
    db
      .select({ boardId: boardGrant.boardId, role: boardGrant.role, projectId: board.projectId })
      .from(boardGrant)
      .innerJoin(board, eq(board.id, boardGrant.boardId))
      .where(and(eq(boardGrant.userId, actor.id), isNull(board.deletedAt), scope(board.projectId))),
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

const uuids = (ids: string[]) => sql`${`{${ids.join(',')}}`}::uuid[]`;

export function registerSearchRoutes(app: FastifyInstance, { db, auth }: Deps) {
  const v1 = (path: string) => `${API_PREFIX}${path}`;

  app.get(v1('/search'), async (req) => {
    const actor = await requireActor(auth, req, db);
    const query = SearchQuery.parse(req.query ?? {});
    const readable = await readableBoards(db, actor, query.projectId);
    if (readable.boardIds.length === 0) return { items: [] };
    const boardIn = uuids(readable.boardIds);
    const q = query.q && query.q.length > 0 ? query.q : undefined;
    const tag = query.tag?.toLowerCase();
    const like = q ? containsPattern(q) : null;
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
          boardKind: r.kind as 'board' | 'storyboard',
          elementId: null,
          elementType: null,
          title: r.title as string,
          snippet: null,
          assetId: (r.cover_asset_id as string | null) ?? null,
          tags: [],
          myRole: readable.roles.get(r.id as string),
        });
      }
    }

    const tagMatch =
      q && !tag
        ? (() => {
            const { words, prefixes } = searchTagPatterns(q);
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
        ${tag ? sql`and i.tags @> array[${tag}]::text[]` : sql``}
        ${query.type ? sql`and i.type = ${query.type}` : sql``}
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
        boardKind: r.board_kind as 'board' | 'storyboard',
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
