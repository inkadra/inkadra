import { createElement, listElements, type NewElement } from '@inkadra/canvas-core';
import { boardDocName, roots, UNSORTED } from '@inkadra/doc-schema';
import type { Logger } from 'pino';
import * as Y from 'yjs';
import type { CollabServer } from './collab.ts';

/**
 * Cards the server adds to a board document on someone's behalf (the clipper, the share
 * sheet). The edit runs where the document is live, so open boards see it at once, and is
 * stored and indexed like an edit from the web app (decision 0014).
 */

/** A paragraph of a note: quoted, plain, or a link whose text is `text`. */
export interface NoteBlock {
  kind: 'quote' | 'paragraph' | 'link';
  text: string;
  href?: string;
}

type CardType = 'note' | 'image' | 'file' | 'link';
export type NewCard = {
  [T in CardType]: { type: T; fields: Omit<NewElement<T>, 'parent'>; body?: NoteBlock[] };
}[CardType];

export interface AddCard {
  boardId: string;
  /** A column of the board; omitted = "Non ordinati". */
  columnId?: string;
  userId: string;
  card: NewCard;
  /** Epoch ms: past it the card is not written (queued edits whose sender stopped waiting). */
  expiresAt?: number;
}

export type AddCardResult =
  | { ok: true; elementId: string }
  | { ok: false; reason: 'column' | 'expired' };

export interface BoardWriter {
  addCard(input: AddCard): Promise<AddCardResult>;
}

/** The new element, fields type-checked against its own card type. */
function create(doc: Y.Doc, card: NewCard, parent: string, userId: string) {
  const at = { x: 0, y: 0 };
  const opts = { userId };
  switch (card.type) {
    case 'note':
      return createElement(doc, 'note', at, { ...card.fields, parent }, opts);
    case 'image':
      return createElement(doc, 'image', at, { ...card.fields, parent }, opts);
    case 'file':
      return createElement(doc, 'file', at, { ...card.fields, parent }, opts);
    case 'link':
      return createElement(doc, 'link', at, { ...card.fields, parent }, opts);
  }
}

/**
 * Adds the card at the bottom of its column, or of "Non ordinati", in one transaction.
 * Pure Yjs: the caller decides where the document lives. Inside a direct connection the
 * transaction is nested in the connection's, whose origin (`source: 'local'`) it keeps.
 */
export function placeCard(doc: Y.Doc, input: Omit<AddCard, 'boardId'>): AddCardResult {
  if (input.expiresAt !== undefined && Date.now() > input.expiresAt)
    return { ok: false, reason: 'expired' };
  const parent = input.columnId ?? UNSORTED;
  if (input.columnId) {
    const column = listElements(doc).find((e) => e.id === input.columnId);
    if (column?.type !== 'column') return { ok: false, reason: 'column' };
  }
  const { card } = input;
  let elementId = '';
  doc.transact(() => {
    elementId = create(doc, card, parent, input.userId).id;
    const body = roots(doc).elements.get(elementId)?.get('body');
    if (card.body && body instanceof Y.XmlFragment) fillNote(body, card.body);
  });
  return { ok: true, elementId };
}

/** One ProseMirror paragraph per line, as the note editor (Tiptap) stores them. */
function paragraphs(text: string): Y.XmlElement[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => {
      const p = new Y.XmlElement('paragraph');
      if (line) p.insert(0, [new Y.XmlText(line)]);
      return p;
    });
}

function fillNote(fragment: Y.XmlFragment, blocks: NoteBlock[]) {
  const nodes: Y.XmlElement[] = [];
  for (const block of blocks) {
    if (block.kind === 'quote') {
      const quote = new Y.XmlElement('blockquote');
      quote.insert(0, paragraphs(block.text));
      nodes.push(quote);
    } else if (block.kind === 'link') {
      const p = new Y.XmlElement('paragraph');
      const text = new Y.XmlText();
      // Marks are formatting attributes named after the mark, holding its attributes.
      text.insert(0, block.text, { link: { href: block.href } });
      p.insert(0, [text]);
      nodes.push(p);
    } else {
      nodes.push(...paragraphs(block.text));
    }
  }
  fragment.insert(fragment.length, nodes);
}

/**
 * Writes through a collaboration server in the same process (`all`, `collab`).
 *
 * Once the transaction is applied the card is in the live document: open boards already show
 * it, so the clip has succeeded whatever happens next. The connection then closes like a
 * browser tab: the document is stored after the usual debounce, which also rebuilds its search
 * index, and a store that fails keeps the document in memory for the next one, as for edits
 * from the web app. (Closing with an immediate store would unload the document even when that
 * store fails, losing the card.)
 */
export function directBoardWriter(collab: CollabServer, log?: Logger): BoardWriter {
  return {
    async addCard({ boardId, ...input }) {
      const connection = await collab.hocuspocus.openDirectConnection(boardDocName(boardId));
      let result: AddCardResult = { ok: false, reason: 'column' };
      try {
        await connection.transact((doc) => {
          result = placeCard(doc, input);
        });
      } finally {
        try {
          await connection.disconnect({ unloadImmediately: false });
        } catch (err) {
          log?.error({ err, boardId }, 'direct connection not closed cleanly');
        }
      }
      return result;
    },
  };
}
