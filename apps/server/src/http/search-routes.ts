import { API_PREFIX, Id, type SearchHit, SearchQuery, type TagCount, z } from '@inkadra/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { requireProjectRole } from '../access.ts';
import type { Auth } from '../auth.ts';
import type { Database } from '../db/client.ts';
import { requireActor } from './auth-routes.ts';

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

export function registerSearchRoutes(app: FastifyInstance, { db, auth }: Deps) {
  const v1 = (path: string) => `${API_PREFIX}${path}`;

  app.get(v1('/search'), async (req) => {
    const actor = await requireActor(auth, req);
    const query = SearchQuery.parse(req.query ?? {});
    const q = query.q && query.q.length > 0 ? query.q : undefined;
    const tag = query.tag?.toLowerCase();
    const like = q ? containsPattern(q) : null;
    const project = query.projectId ? sql`and p.id = ${query.projectId}` : sql``;
    // Only projects the caller is a member of; trashed boards never show up.
    const member = sql`join project_member pm on pm.project_id = p.id and pm.user_id = ${actor.id}`;
    const hits: SearchHit[] = [];

    if (q && !tag && !query.type) {
      const projects = await db.execute<Row>(sql`
        select p.id, p.name from project p ${member}
        where p.name ilike ${like} ${project}
        order by word_similarity(${q}, p.name) desc, p.name
        limit ${query.limit}`);
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
        });
      }
      const boards = await db.execute<Row>(sql`
        select b.id, b.title, b.kind, b.cover_asset_id, p.id as project_id, p.name
        from board b join project p on p.id = b.project_id ${member}
        where b.deleted_at is null and b.parent_board_id is not null
          and b.title ilike ${like} ${project}
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
        });
      }
    }

    const elements = await db.execute<Row>(sql`
      select i.board_id, i.element_id, i.type, i.title, i.text, i.tags, i.asset_id,
             b.title as board_title, b.kind as board_kind, p.id as project_id, p.name
      from board_element_index i
      join board b on b.id = i.board_id
      join project p on p.id = i.project_id ${member}
      where b.deleted_at is null ${project}
        ${like ? sql`and i.text ilike ${like}` : sql``}
        ${tag ? sql`and i.tags @> array[${tag}]::text[]` : sql``}
        ${query.type ? sql`and i.type = ${query.type}` : sql``}
      order by ${q ? sql`word_similarity(${q}, i.text) desc,` : sql``} i.updated_at desc
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
      });
    }
    return { items: hits.slice(0, query.limit) };
  });

  app.get(v1('/projects/:projectId/tags'), async (req) => {
    const actor = await requireActor(auth, req);
    const { projectId } = ProjectParams.parse(req.params);
    await requireProjectRole(db, actor, projectId, 'viewer');
    const rows = await db.execute<{ tag: string; count: string }>(sql`
      select t.tag, count(*) as count
      from board_element_index i
      join board b on b.id = i.board_id and b.deleted_at is null
      cross join lateral unnest(i.tags) as t(tag)
      where i.project_id = ${projectId}
      group by t.tag
      order by count(*) desc, t.tag
      limit 500`);
    const items: TagCount[] = rows.map((r) => ({ tag: r.tag, count: Number(r.count) }));
    return { items };
  });
}
