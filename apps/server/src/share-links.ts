import { createHash } from 'node:crypto';
import { frameLabels, storyboardOf } from '@inkadra/canvas-core';
import {
  type Element,
  getBoardAspect,
  hiddenFromGuests,
  readElement,
  roots,
  toGuestElement,
} from '@inkadra/doc-schema';
import type { ShareLinkStatus } from '@inkadra/shared';
import { and, eq, inArray, isNotNull, lte, or } from 'drizzle-orm';
import * as Y from 'yjs';
import { atLeast, rolesOnProjectBoards } from './access.ts';
import type { Database } from './db/client.ts';
import { type board, boardDoc, shareGuest, shareLink } from './db/schema.ts';

/**
 * Share links for guests without an account (decision 0013): what a link may show, decided at
 * every request from the creator's current access and the stored board documents.
 */

export type ShareLinkRow = typeof shareLink.$inferSelect;
type BoardRow = typeof board.$inferSelect;

/** Status from the link alone; `suspended` needs the creator's access (resolveLink). */
export function storedStatus(row: ShareLinkRow, now = new Date()): ShareLinkStatus {
  if (row.revokedAt) return 'revoked';
  if (row.expiresAt && row.expiresAt <= now) return 'expired';
  return 'active';
}

/** Retain authors and totals, but clear personal names 90 days after a link stopped. */
export async function clearExpiredGuestNames(db: Database, now = new Date()) {
  const cutoff = new Date(now.getTime() - 90 * 86_400_000);
  const stopped = db
    .select({ id: shareLink.id })
    .from(shareLink)
    .where(or(lte(shareLink.revokedAt, cutoff), lte(shareLink.expiresAt, cutoff)));
  await db
    .update(shareGuest)
    .set({ name: null })
    .where(and(isNotNull(shareGuest.name), inArray(shareGuest.shareLinkId, stopped)));
}

/** A board guests of a link can open, and the board they reach it from. */
export interface LinkBoard {
  row: BoardRow;
  /** Null for the board of the link; else the board whose card leads here. */
  parentBoardId: string | null;
}

export interface LinkContents {
  /** In the order guests reach them, the board of the link first. */
  boards: Map<string, LinkBoard>;
  views: Map<string, BoardView>;
  shown: Map<string, Element[]>;
  assets: { shown: Set<string>; covers: Set<string> };
}

export type ResolvedLink =
  | { status: Exclude<ShareLinkStatus, 'active'> }
  | ({ status: 'active' } & LinkContents);

/**
 * Whether a link works now and which boards its guests can open (fail-closed): the board of
 * the link, while the creator has at least editor on it, and with `includeSubBoards` every
 * descendant board reached through a board card visible to guests on a board already
 * included, not in the trash, where the creator has at least editor.
 */
export async function resolveLink(
  db: Database,
  docs: DocViews,
  link: ShareLinkRow,
  now = new Date(),
): Promise<ResolvedLink> {
  const stored = storedStatus(link, now);
  if (stored !== 'active') return { status: stored };
  if (!link.createdBy) return { status: 'suspended' };
  const { boards, roles } = await rolesOnProjectBoards(db, link.createdBy, link.projectId);
  const byId = new Map(boards.map((b) => [b.id, b]));
  const editable = (id: string) => atLeast(roles.get(id)?.role ?? null, 'editor');
  const top = byId.get(link.boardId);
  if (!top || !editable(top.id)) return { status: 'suspended' };

  const isBelowTop = (id: string) => {
    const seen = new Set<string>();
    let at = byId.get(id)?.parentBoardId ?? null;
    while (at && !seen.has(at)) {
      if (at === top.id) return true;
      seen.add(at);
      at = byId.get(at)?.parentBoardId ?? null;
    }
    return false;
  };

  // One metadata query for the project, rather than one per board per thumbnail. Roles
  // and board metadata remain fresh on every request, including trash, covers and grants.
  const stamps = await db
    .select({ id: boardDoc.boardId, at: boardDoc.updatedAt })
    .from(boardDoc)
    .where(
      inArray(
        boardDoc.boardId,
        boards.map((b) => b.id),
      ),
    );
  const stampById = new Map(stamps.map((r) => [r.id, r.at.getTime()]));
  const key = createHash('sha256')
    .update(
      JSON.stringify({
        link: [
          link.id,
          link.createdBy,
          link.boardId,
          link.includeSubBoards,
          link.role,
          link.allowDownload,
          link.proofing,
          link.expiresAt,
          link.sessionsValidAfter,
        ],
        boards: [...boards].sort((a, b) => a.id.localeCompare(b.id)),
        roles: [...roles].sort(([a], [b]) => a.localeCompare(b)),
        stamps: [...stampById].sort(([a], [b]) => a.localeCompare(b)),
      }),
    )
    .digest('hex');
  const cached = docs.linkContents(key);
  if (cached) return { status: 'active', ...cached };
  const views = new Map<string, BoardView>();
  const viewFor = async (id: string) => {
    const known = views.get(id);
    if (known) return known;
    const view = await docs.get(db, id, stampById.get(id) ?? null);
    views.set(id, view);
    return view;
  };

  const included = new Map<string, LinkBoard>([[top.id, { row: top, parentBoardId: null }]]);
  if (link.includeSubBoards) {
    const queue = [top.id];
    for (let next = queue.shift(); next; next = queue.shift()) {
      const view = await viewFor(next);
      for (const el of view.visible) {
        if (el.type !== 'board' || included.has(el.boardId)) continue;
        const row = byId.get(el.boardId);
        if (!row || !isBelowTop(row.id) || !editable(row.id)) continue;
        included.set(row.id, { row, parentBoardId: next });
        queue.push(row.id);
      }
    }
  }
  const shown = new Map<string, Element[]>();
  const assets = { shown: new Set<string>(), covers: new Set<string>() };
  for (const [id, { row }] of included) {
    const elements = linkElements(await viewFor(id), included);
    shown.set(id, elements);
    for (const el of elements) for (const assetId of elementAssetIds(el)) assets.shown.add(assetId);
    if (row.coverAssetId) assets.covers.add(row.coverAssetId);
  }
  const contents = { boards: included, views, shown, assets };
  docs.rememberLink(key, contents);
  return { status: 'active', ...contents };
}

// Board documents as guests see them -----------------------------------------------

/** What guests may see of one stored board document, before the link is applied. */
export interface BoardView {
  aspect: string | null;
  /** Valid elements not hidden from guests, nor inside something hidden. */
  visible: Element[];
  /** Rich text of the visible notes, as ProseMirror JSON. */
  bodies: Map<string, Record<string, unknown>>;
  /** Frame shot labels computed on the full document, before hiding or stripping. */
  labels: Map<string, string>;
}

const EMPTY_VIEW: BoardView = { aspect: null, visible: [], bodies: new Map(), labels: new Map() };

/** Reads a document, leaving out what is hidden from guests (fails closed, decision 0013). */
export function viewOf(doc: Y.Doc): BoardView {
  const { elements } = roots(doc);
  const lookup = (id: string) => {
    const map = elements.get(id);
    if (!map) return undefined;
    const el = readElement(map);
    // Invalid containers cannot establish a visible chain, just like missing containers.
    return el?.id === id ? el : undefined;
  };
  const all: Element[] = [];
  const visible: Element[] = [];
  const bodies = new Map<string, Record<string, unknown>>();
  for (const [id, map] of elements.entries()) {
    const el = readElement(map);
    if (!el || el.id !== id) continue;
    all.push(el);
    if (hiddenFromGuests(id, lookup)) continue;
    visible.push(el);
    const body = map.get('body');
    if (el.type === 'note' && body instanceof Y.XmlFragment) bodies.set(id, proseMirrorJson(body));
  }
  // By id, so the snapshot and its version do not depend on how the document was decoded.
  visible.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const labels = frameLabels(storyboardOf(all));
  return { aspect: getBoardAspect(doc), visible, bodies, labels };
}

/**
 * Decoded views of stored board documents, kept while the stored document does not change, so
 * a poll costs a timestamp lookup instead of a decode.
 */
export class DocViews {
  private cache = new Map<string, { stamp: number; view: BoardView }>();
  private links = new Map<string, LinkContents>();
  constructor(private readonly max = 200) {}
  linkContents(key: string) {
    const known = this.links.get(key);
    if (known) {
      this.links.delete(key);
      this.links.set(key, known);
    }
    return known;
  }

  rememberLink(key: string, contents: LinkContents) {
    this.links.set(key, contents);
    if (this.links.size > this.max) {
      const oldest = this.links.keys().next().value;
      if (oldest) this.links.delete(oldest);
    }
  }

  async get(db: Database, boardId: string, knownStamp?: number | null): Promise<BoardView> {
    let stamp = knownStamp;
    if (stamp === undefined) {
      const [meta] = await db
        .select({ updatedAt: boardDoc.updatedAt })
        .from(boardDoc)
        .where(eq(boardDoc.boardId, boardId));
      stamp = meta?.updatedAt.getTime() ?? null;
    }
    if (stamp === null) return EMPTY_VIEW;
    const known = this.cache.get(boardId);
    if (known?.stamp === stamp) return known.view;
    const [row] = await db
      .select({ state: boardDoc.state, updatedAt: boardDoc.updatedAt })
      .from(boardDoc)
      .where(eq(boardDoc.boardId, boardId));
    if (!row) return EMPTY_VIEW;
    const doc = new Y.Doc();
    try {
      Y.applyUpdate(doc, row.state);
      const view = viewOf(doc);
      this.cache.delete(boardId);
      this.cache.set(boardId, { stamp: row.updatedAt.getTime(), view });
      if (this.cache.size > this.max) {
        const oldest = this.cache.keys().next().value;
        if (oldest) this.cache.delete(oldest);
      }
      return view;
    } finally {
      doc.destroy();
    }
  }
}

/**
 * The elements of a board guests of a link receive: board cards of boards outside the link
 * and arrows attached to anything not shown are dropped too.
 */
export function linkElements(view: BoardView, linkBoards: ReadonlyMap<string, unknown>) {
  const shown = view.visible.filter((el) => el.type !== 'board' || linkBoards.has(el.boardId));
  const ids = new Set(shown.map((el) => el.id));
  const attached = (end: { elementId?: string | undefined }) =>
    end.elementId === undefined || ids.has(end.elementId);
  return shown.filter((el) => el.type !== 'arrow' || (attached(el.from) && attached(el.to)));
}

/** Files an element shows. */
export function elementAssetIds(el: Element): string[] {
  switch (el.type) {
    case 'image':
    case 'file':
      return [el.assetId];
    case 'frame':
    case 'character':
    case 'location':
      return el.assetId ? [el.assetId] : [];
    case 'link':
      return el.imageAssetId ? [el.imageAssetId] : [];
    default:
      return [];
  }
}

/** Pictures guests may pick: image cards and storyboard frames with a picture. */
export function pictureAssetId(el: Element): string | null {
  if (el.type === 'image') return el.assetId;
  if (el.type === 'frame') return el.assetId ?? null;
  return null;
}

/** An element as guests receive it, with the rich text of notes in `body`. */
export function guestElement(view: BoardView, el: Element): Record<string, unknown> {
  const label = el.type === 'frame' ? (view.labels?.get(el.id) ?? el.label) : undefined;
  const out = toGuestElement(el, label);
  const body = view.bodies.get(el.id);
  if (body) out.body = body;
  return out;
}

// Rich text ---------------------------------------------------------------------------

type PmNode = Record<string, unknown>;

/** A Tiptap note body (Y.XmlFragment, as y-prosemirror stores it) as ProseMirror JSON. */
export function proseMirrorJson(fragment: Y.XmlFragment): PmNode {
  return { type: 'doc', content: children(fragment) };
}

function children(node: Y.XmlFragment | Y.XmlElement): PmNode[] {
  const out: PmNode[] = [];
  for (const child of node.toArray()) {
    if (child instanceof Y.XmlElement) {
      const attrs = child.getAttributes();
      const content = children(child);
      out.push({
        type: child.nodeName,
        ...(Object.keys(attrs).length > 0 ? { attrs } : {}),
        ...(content.length > 0 ? { content } : {}),
      });
    } else if (child instanceof Y.XmlText) {
      for (const op of child.toDelta() as Array<{ insert: unknown; attributes?: PmNode }>) {
        if (typeof op.insert !== 'string' || op.insert === '') continue;
        const marks = Object.entries(op.attributes ?? {}).map(([type, attrs]) =>
          attrs && typeof attrs === 'object' && Object.keys(attrs).length > 0
            ? { type: type.split('--')[0], attrs }
            : { type: type.split('--')[0] },
        );
        out.push({ type: 'text', text: op.insert, ...(marks.length > 0 ? { marks } : {}) });
      }
    }
  }
  return out;
}
