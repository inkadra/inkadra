import {
  API_PREFIX,
  type AppClient,
  atLeast,
  type Board,
  type Project,
  type SearchHit,
} from '@inkadra/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { personalToken } from './db/schema.ts';
import { HttpError } from './http/errors.ts';

export type TokenScope = (typeof personalToken.$inferSelect)['scope'];

interface ScopedRoute {
  /** When present, must also pass. */
  allow?: (req: FastifyRequest, tokenId: string) => boolean;
  /** Narrows a successful answer to what the scope's client reads. */
  narrow?: (items: unknown[]) => unknown[];
}

/**
 * A Clipper search hit as board data only (decision 0137): the picker reads `kind`, `boardId`,
 * `boardTitle`, `projectId`, `projectName` and `myRole`; the rest is what the schema of every
 * released version allows to be empty. One hit per board, projects (no board) left out.
 */
function clipSearchHits(items: unknown[]): SearchHit[] {
  const seen = new Set<string>();
  const out: SearchHit[] = [];
  for (const hit of items as SearchHit[]) {
    if (!hit.boardId || seen.has(hit.boardId)) continue;
    seen.add(hit.boardId);
    out.push({
      kind: 'board',
      projectId: hit.projectId,
      projectName: hit.projectName,
      boardId: hit.boardId,
      boardTitle: hit.boardTitle,
      boardKind: null,
      elementId: null,
      elementType: null,
      title: hit.boardTitle ?? hit.projectName,
      snippet: null,
      assetId: null,
      tags: [],
      ...(hit.myRole ? { myRole: hit.myRole } : {}),
    });
  }
  return out;
}

/**
 * The Clipper's projects (decision 0137): those it offers, active ones where the person may add
 * cards, without the optional fields of later versions (dates, time zone, pins, groups).
 */
function clipProjects(items: unknown[]): Project[] {
  return (items as Project[])
    .filter((p) => !p.archivedAt && atLeast(p.myRole, 'editor'))
    .map(({ type, timeZone, shootingStart, shootingEnd, pinned, group, ...kept }) => kept);
}

/** Boards as the picker reads them: the tree and roles, no cover, icon, views or edit time. */
function clipBoard({ icon, views, editedAt, ...kept }: Board): Board {
  return { ...kept, coverAssetId: null };
}
/**
 * Every board of a project: a read-only board can lead to an editable one below it. A project
 * with nowhere to clip is not shown at all: the answer to a project that does not exist.
 */
function clipProjectBoards(items: unknown[]): Board[] {
  const boards = items as Board[];
  if (!boards.some((b) => atLeast(b.myRole, 'editor')))
    throw new HttpError('not_found', 'Project not found.');
  return boards.map(clipBoard);
}
/** Shared boards the picker offers: those where the person may add cards. */
const clipSharedBoards = (items: unknown[]) =>
  (items as Board[]).filter((b) => atLeast(b.myRole, 'editor')).map(clipBoard);

/**
 * What a token of each limited scope may call, as `METHOD route` (decision 0137). A route
 * missing here is refused, so a route added later stays closed to limited tokens. `clip` is what
 * the released Clipper versions call with their token; per-project and per-board access still
 * applies.
 */
const SCOPE_ROUTES: Record<Exclude<TokenScope, 'full'>, Record<string, ScopedRoute>> = {
  clip: {
    [`GET ${API_PREFIX}/me/clip-boards`]: {},
    [`DELETE ${API_PREFIX}/me/clip-boards/:boardId`]: {},
    [`GET ${API_PREFIX}/projects`]: { narrow: clipProjects },
    [`GET ${API_PREFIX}/projects/:projectId/boards`]: { narrow: clipProjectBoards },
    [`GET ${API_PREFIX}/shared-boards`]: { narrow: clipSharedBoards },
    [`GET ${API_PREFIX}/boards/:boardId/columns`]: {},
    // The route itself searches only boards a clip may go to, by words only.
    [`GET ${API_PREFIX}/search`]: { narrow: clipSearchHits },
    [`POST ${API_PREFIX}/clip`]: {},
    // Signing out of the Clipper revokes its own token, never another one.
    [`DELETE ${API_PREFIX}/me/tokens/:tokenId`]: {
      allow: (req, tokenId) => (req.params as { tokenId?: unknown }).tokenId === tokenId,
    },
  },
};

const routeKey = (req: FastifyRequest) => `${req.method} ${req.routeOptions.url ?? ''}`;
const admitted = new WeakMap<FastifyRequest, TokenScope>();

/**
 * Whether a token with this scope may make this request; `full` may make any. An admitted
 * request remembers its scope for `tokenScope` and the narrowing of its answer.
 */
export function admitToken(req: FastifyRequest, scope: TokenScope, tokenId: string): boolean {
  if (scope !== 'full') {
    const route = SCOPE_ROUTES[scope][routeKey(req)];
    if (!route || (route.allow && !route.allow(req, tokenId))) return false;
  }
  admitted.set(req, scope);
  return true;
}

/** The scope of the token this request was admitted with; `full` for sessions. */
export const tokenScope = (req: FastifyRequest): TokenScope => admitted.get(req) ?? 'full';

/** Narrows successful `{ items }` answers of routes whose scope entry asks for it. */
export function registerScopeNarrowing(app: FastifyInstance) {
  app.addHook('preSerialization', async (req, reply, payload) => {
    const scope = tokenScope(req);
    if (scope === 'full' || reply.statusCode >= 300) return payload;
    const narrow = SCOPE_ROUTES[scope][routeKey(req)]?.narrow;
    const body = payload as { items?: unknown };
    if (!narrow || !Array.isArray(body?.items)) return payload;
    return { ...body, items: narrow(body.items) };
  });
}

/** Tokens issued to the Clipper only clip (decision 0137); every other token keeps full access. */
export const scopeFor = (client: AppClient | undefined): TokenScope =>
  client === 'clipper' ? 'clip' : 'full';
